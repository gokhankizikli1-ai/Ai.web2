# Web Build — Image Intelligence / Hybrid Image Routing

**Scope: WEB BUILD ONLY.** App Build is untouched and structurally excluded (see *App Build
isolation*). Nothing here runs, and no generated-image call can originate, for `buildType: 'app'`.

Korvix used to treat every visual requirement as the same problem: *find a stock photo*. A
restaurant's dining room and a SaaS hero abstraction went through one stock search, and a
developer tool that should show a terminal was handed a photograph of an office.

This layer adds the decision that was missing — **where should this image come from?** — and
answers it per image slot:

| route | meaning | example |
| --- | --- | --- |
| `stock` | a real photograph of a real thing; authenticity is the point | restaurant interior, portfolio work, product shot, speaker portrait |
| `generated` | a bespoke, brand-defining or conceptual visual stock cannot supply | an abstract brand field for a SaaS feature section |
| `none` | no photo at all; the interface, type or a native component IS the visual | developer tool, dashboard-like web product, explicit "no images" |

## Where it sits

```
prompt
  → identity / site archetype        (designIntelligence — imagery ROLE)
  → image coverage                   (imageCoverage — the required photography FLOOR)
  → page composition                 (composition — which sections carry media)
  → visual concept                   (visualConcept.imageRoles — per-image ART DIRECTION)
  → experience intelligence          (media verdict — is imagery needed at all, in what medium)
  → IMAGE SOURCE STRATEGY  ← this layer: stock / generated / none, per slot
      → visual intelligence agent    (unchanged: photography strategy + queries)
      → generated route (≤1 by default, hard ceiling 2)   ─┐
      → ONE stock request (the slots that stayed stock)   ─┤→ enriched image slots
      → builder request → generated site                   │
      → Quality V2 acceptance / repair / optimization  ─────┘
```

It **re-decides none of those authorities** — it reads them as evidence and emits one bounded,
typed, JSON-safe routing contract with a per-decision basis and reason, so a wrong route is
attributable. It is deterministic: **zero model calls are added to make this decision.**

## Routing policy (precedence order)

1. **Explicit exclusion** — the coverage authority resolved "no photography" → `none`.
2. **Media verdict** — imagery unnecessary / lead visual forbidden / this section carries no
   media → `none`. A REQUIRED coverage target always outranks this.
3. **UI-native superiority** — the art direction asks for product UI / data visualization /
   diagram / type, or the classification says the product's evidence is an interface:
   `none` when the interface is the argument (interface-led lead, or imagery rated incidental),
   otherwise a bespoke `generated` visual — never a stock photo of strangers in an office.
4. **Authenticity** — an authentic photograph is required, the subject is proof-heavy, or the
   medium is real-world photography → `stock`.
5. **Bespoke / conceptual** — a generative medium (abstract, illustration, collage, texture, 3D)
   or a graphic-first signature → `generated`.
6. **Default** — `stock`, exactly as before this contract existed.

Section role matters more than archetype: a restaurant's dish photo is `stock` while an ambient
brand band in the same build can be `generated`.

## Cost discipline

* **The routing can never increase the number of images in a build.** Every decision is attached
  to a slot the pipeline already planned; it only re-routes or removes one.
* Generated images are bounded by the **existing per-build AI ceiling**
  (`MAX_AI_FALLBACK_ATTEMPTS = 2`), not a new quota. Default budget: **1**.
* Zero generated images is a valid, common outcome.
* A build with nothing routed to `generated` makes **no** generated-image call at all — not even
  a health probe.
* A generated slot never enters the stock request, so it costs no provider search and can never
  trigger the (flag-gated) vision rerank.

## Generated images are decorative, never evidence

The art-direction contract handed to the provider carries subject, framing, composition,
lighting, focal point, negative space / text-safe area, brand tone, visual style, medium, aspect
ratio and the intended section role — plus an explicit fabrication boundary. The prompt forbids
text, logos, wordmarks, badges, invented UI/metrics and identifiable people, and the asset carries
an honest label the builder request repeats: never captioned as a photo of the business, its
team, its premises, its products or its customers, and never attributed to a photographer.

Proof-heavy slots (project, gallery, product listing, portfolio work, team, premises, archive,
before/after) are **never** generated — the same kind sets the backend gate already enforces.

## Bounds on the generated route

Beyond the per-build image budget, the route is bounded on three more axes so a provider can
never hold a build hostage or pollute it:

* **Wall clock** — `GENERATED_IMAGERY_TOTAL_BUDGET_MS` (120 s) caps the WHOLE route, not just each
  call. Once spent, the remaining decisions fall back instead of waiting out a second timeout.
* **Uniqueness** — a generated image that repeats a URL already placed in this build is dropped;
  one image may never fill two roles.
* **Transport** — an absolute provider URL must be `https:` (a plain-http image renders as broken
  mixed content in the delivered site). A relative URL is our own asset route and is resolved
  against the API base, so local development is unaffected.

The stored byte size of the heaviest generated image is recorded in the manifest diagnostics and
shown on the build timeline: a provider PNG is materially heavier than a stock CDN image with
sizing parameters, and the optimizer's oversized-image detector reads dimension *query params*,
which a stored asset URL does not carry.

## Durability

A provider returns a session-only `data:` URL, which would not survive save → reopen → revision
and would bloat the persisted payload. The generated route asks the backend to store the image
through the **existing asset system** (the same storage the device-upload route uses) and returns
a stable delivery URL. An image that cannot be stored durably is reported `not-persistable` and
the decision falls back — a `data:` URL is never written into generated source.

## Fallback

`generated` → `stock` **only** where a real photograph would still be an honest answer for that
slot → otherwise `none`. Stock → `none`. A required coverage image is never removed by this layer.
Any provider outage, disabled flag, quota block or malformed response is an honest outcome, never
a failed build.

## App Build isolation

* The routing contract is **never derived** for `buildType: 'app'` — an app build has no contract,
  so nothing can route it.
* The sourcing pipeline forces `routing = undefined` for an app spec: every need stays stock,
  byte-for-byte the previous behaviour.
* The generated route refuses an app spec before any HTTP call (belt **and** braces).
* Acceptance receives no routing contract for an app build, so App Build Quality V2 is unchanged.
* Regression-tested in `src/lib/webBuildImageRouting.test.ts` and
  `src/lib/webBuildImageSourceStrategy.test.ts`.

## What the model is (and is not) told

The routing contract is **not** sent to any model. What the builder must honour is materialized on
the image slots themselves (`url`, `imageSource`, `honestyLabel`) plus the P1 image block, which
survives every level of request priority shedding. Review and repair calls do not receive the
contract at all — it has no model-facing acceptance surface, and the deterministic analyzer reads
it locally from the spec.

## Quality V2 + optimizer

* Generated images travel through the **same** slot contract as stock, so the existing image
  coverage acceptance (`required-image-not-rendered` / `-semantically-mismatched` / `-uncovered`),
  the visual acceptance analyzer and the deterministic optimization pass apply unchanged.
* One **advisory, non-blocking** finding is added — `unnecessary-imagery-used` — when the routing
  resolved every visual to `none` and the project still renders content photography.
* The optimization guard now also protects the media this build actually **placed** (required
  coverage slots and the lead/hero image, whatever source resolved it), which the planning-time
  contract could not name.

## Environment variables

**No new environment variables.** The route reuses the existing ones:

| Variable | Default | Effect on this feature |
| --- | --- | --- |
| `ENABLE_WEB_BUILD_IMAGE_GEN` | `false` | Master switch. Off ⇒ zero generated images, zero cost. |
| `IMAGE_GENERATION_PROVIDER` / `IMAGE_GENERATION_API_KEY` / `IMAGE_GENERATION_MODEL` | — | Provider + model, server-side only. |
| `IMAGE_GENERATION_OWNER_ONLY` | `true` | Non-owners get an honest `disabled` asset and fall back. |
| `ENABLE_ASSET_SYSTEM` | `false` | Required for durability. Off ⇒ generated images are refused as non-persistable. |
| `ASSETS_STORAGE_BACKEND` | `local` | `local` is container-ephemeral; use a cloud backend for durable generated images. |
