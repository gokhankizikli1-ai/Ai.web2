/**
 * Builder mode — the target product type a user selects on the Web Build start
 * screen (ChatGPT/Kimi-style "tool" selection). It is a hidden BUILD CONTEXT,
 * not prompt text: the selected mode never touches the user's typed message; it
 * only augments the request the generator receives so Korvix knows what kind of
 * product to build.
 *
 * Future-proofing: `website` uses the current Web Build pipeline as-is. `app`
 * and `game` reuse the same pipeline for now (the app/game builders are not
 * standalone yet) but their context label is preserved so wiring a dedicated
 * pipeline later is a routing change, not a UI change. `landing`/`ecommerce`
 * are secondary website flavours — most product details are still inferred from
 * the prompt, so we intentionally keep the primary choices few.
 */
export type BuilderMode = 'website' | 'app' | 'game' | 'landing' | 'ecommerce';

/** The three primary builder modes shown most prominently. */
export const PRIMARY_MODES: BuilderMode[] = ['website', 'app', 'game'];

/** Secondary website flavours — offered, but not as loud as the primaries. */
export const SECONDARY_MODES: BuilderMode[] = ['landing', 'ecommerce'];

/**
 * A short, hidden build-context line appended to the generation request so the
 * model knows the target product type. `website` is the native pipeline, so it
 * adds nothing. This is meta-context (not user content) — it never appears in
 * the user's message or the persisted prompt.
 */
export function buildModeContext(mode: BuilderMode | null | undefined): string | undefined {
  switch (mode) {
    case 'app':
      return 'Target product: a mobile/web APP — frame the structure, navigation and copy as an application (screens, flows, in-product actions), not a marketing site.';
    case 'game':
      return 'Target product: a GAME feature/UI — frame it as a game screen or feature (HUD, menus, in-game UI), not a marketing site.';
    case 'landing':
      return 'Target product: a single, focused, high-converting LANDING PAGE.';
    case 'ecommerce':
      return 'Target product: an ONLINE STORE / ecommerce site (product listings, product detail, cart).';
    default:
      return undefined;
  }
}
