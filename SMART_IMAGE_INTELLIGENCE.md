# Smart Image Intelligence — Web Builder

Foundation for automatically selecting the best visual assets for generated
websites, so output feels custom-designed rather than AI-generated.

**Status:** disabled by default. Enabling `ENABLE_SMART_IMAGES=true` is the only
thing that routes generation through the ranking engine; everything else keeps the
existing deterministic behaviour and is used as the fail-open fallback.

## Flow

```
User prompt
  → Website Analyzer (existing spec pipeline)
    → Design Intent  (backend/services/image_intelligence/design_intent.py)
      → Image Intelligence Service  (image_intelligence.select_assets)
        → Image Search Provider     (providers.ImageProvider → StockImageProvider)
          → Image Ranking Engine    (ranking.ImageRankingEngine)
            → Selected Assets       → Website Generator (unchanged)
```

## What it adds

- **Design Intent object** — structured brief: `industry`, `targetAudience`,
  `brandStyle`, `emotionalTone`, `colorPalette`, `imageStyle`, `requiredSections`,
  `heroImageRequirement`, `sectionImageRequirements`, `conversionGoal`.
- **ImageProvider abstraction** — `search()` / `get_details()` / `validate_license()`,
  with a registry so Pixabay / AI-generation providers plug in without engine changes.
  The one built-in provider adapts the existing server-side Pexels + Unsplash service
  (`web_build_images.stock`) — keys never leave the server; images stay hotlinked.
- **Ranking engine** — every candidate scored 0–100 on six weighted, extendable
  dimensions: `relevance`, `quality`, `style`, `color`, `composition`, `conversion`
  → a weighted `finalScore`. Real signal (token coverage, HSL color harmony against
  the brand palette, pixel-dimension quality/composition), not a keyword matcher.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ENABLE_SMART_IMAGES` | No | `false` | Master flag. `true` turns on the ranking engine. |
| `SMART_IMAGE_WEIGHT_RELEVANCE` | No | `0.30` | Weight of the relevance dimension. |
| `SMART_IMAGE_WEIGHT_QUALITY` | No | `0.15` | Weight of the resolution/quality dimension. |
| `SMART_IMAGE_WEIGHT_STYLE` | No | `0.15` | Weight of the brand-style match. |
| `SMART_IMAGE_WEIGHT_COLOR` | No | `0.15` | Weight of the color-harmony dimension. |
| `SMART_IMAGE_WEIGHT_COMPOSITION` | No | `0.10` | Weight of the composition dimension. |
| `SMART_IMAGE_WEIGHT_CONVERSION` | No | `0.15` | Weight of the conversion-impact dimension. |

Weights are optional and normalized automatically; set any subset. Provider keys are
unchanged and remain server-side only: `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`.

## Fallback behaviour (never breaks generation)

- Flag off → the deterministic selector runs, byte-for-byte as before.
- Flag on but the ranking path returns nothing (no providers, no results, any error)
  → automatic fallback to the deterministic selector.
- Missing color / description / dimensions → neutral per-dimension score, never a
  failure. Nothing in the layer raises to the caller.
