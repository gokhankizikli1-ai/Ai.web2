/**
 * BuildType — the ONE canonical authority for "what kind of product is this build?".
 *
 * Korvix has a mature Web Build spine (planning → spec → generation → validation →
 * review → repair → acceptance → preview → persistence). App Build is NOT a second
 * pipeline: it is the SAME spine made BUILD-TYPE PARAMETRIC — a shared core plus thin,
 * app-specific adapters. This module is the single place that decides the build type
 * and normalizes it, so every stage reads ONE resolved value instead of re-inferring
 * "is this an app?" from prompt text (which would drift between stages).
 *
 *   web → the native Web Build (websites, landing pages, stores, marketing).
 *   app → a client-routed, multi-screen React/Vite APPLICATION (dashboards, SaaS,
 *         CRM, tools). NOT React Native / Expo — a web-hostable single-page app with
 *         real in-product screens, navigation and state, not a marketing page.
 *
 * The BuilderMode a user picks on the start screen is the INPUT authority; this module
 * projects it onto the canonical build type. Older persisted builds have no build type
 * recorded — they are always treated as `web` so nothing that was saved before this
 * change changes shape. Pure, deterministic, dependency-light (type-only import).
 */
import type { BuilderMode } from '@/lib/builderMode';

/** The canonical product build type carried through the whole pipeline. */
export type BuildType = 'web' | 'app';

/** The default build type — the native Web Build. Old/absent inputs resolve here. */
export const DEFAULT_BUILD_TYPE: BuildType = 'web';

/**
 * Project the user-selected BuilderMode onto the canonical BuildType. `app` is the
 * only mode that routes to the App Build adapters; every other mode (website / game /
 * landing / ecommerce / null) stays on the native Web Build spine. Game keeps `web`
 * for now — it reuses the web pipeline exactly as before, so this is behavior-neutral
 * for every non-app mode.
 */
export function resolveBuildType(mode: BuilderMode | null | undefined): BuildType {
  return mode === 'app' ? 'app' : 'web';
}

/**
 * Normalize an arbitrary (possibly persisted, possibly unknown) value to a BuildType.
 * ANY value that is not exactly the string `'app'` resolves to `web` — so old saved
 * builds (which carry no build type at all) and any malformed value load as web,
 * never crash and never accidentally become an app. Backward-compatibility gate.
 */
export function normalizeBuildType(value: unknown): BuildType {
  return value === 'app' ? 'app' : DEFAULT_BUILD_TYPE;
}

/** True when a resolved/normalized value denotes an App Build. */
export function isAppBuild(value: unknown): boolean {
  return normalizeBuildType(value) === 'app';
}

/** A short, human-facing label for diagnostics / UI (never inserted into prompts). */
export function buildTypeLabel(value: unknown): string {
  return isAppBuild(value) ? 'App' : 'Web';
}
