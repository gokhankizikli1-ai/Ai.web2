/**
 * Canonical BUILD TYPE — the production classification of what the mature Build
 * spine is producing on a given run. Unlike `BuilderMode` (a UI-facing selection
 * that also carries website flavours like `landing`/`ecommerce` and the not-yet
 * standalone `game`), `BuildType` is the *pipeline* axis: it is carried on the
 * WebBuildPayload and the FrontendBuildSpecification, survives request → spec →
 * generation → validation → review → repair → acceptance → preview → persistence,
 * and lets the shared spine + its analyzers branch ONCE instead of re-inferring
 * "app vs website" from prompt text at every stage.
 *
 * Only two production targets exist today:
 *   - 'web' — the native scrolling website pipeline (page sections, hero, scroll).
 *   - 'app' — a client-routed, multi-screen React/Vite application (screens,
 *             routes, navigation, stateful flows) built on the SAME spine via
 *             thin app adapters. NOT React Native/Expo — a web-hostable app.
 *
 * The type is intentionally a small, closed union so a future native adapter can
 * extend it as a routing change rather than a re-architecture. `web` is the
 * backward-compatible default: any payload/spec without a `buildType` (every
 * build persisted before this field existed) is treated as `web`.
 */
export type BuildType = 'web' | 'app';

/** The backward-compatible default for any build that predates `buildType`. */
export const DEFAULT_BUILD_TYPE: BuildType = 'web';

import type { BuilderMode } from '@/lib/builderMode';

/**
 * Resolve the canonical pipeline BuildType from the UI-facing BuilderMode. Only
 * `app` maps to the app pipeline; every website flavour (`website`/`landing`/
 * `ecommerce`) and the non-standalone `game` mode resolve to `web`. Null/undefined
 * (no explicit mode selected) is a plain website build.
 */
export function buildTypeFromBuilderMode(mode: BuilderMode | null | undefined): BuildType {
  return mode === 'app' ? 'app' : 'web';
}

/**
 * Normalize an unknown/legacy value into a valid BuildType. Anything that is not
 * the literal string `'app'` collapses to `web` — this is what keeps every
 * pre-`buildType` persisted build loading as a website.
 */
export function resolveBuildType(value: unknown): BuildType {
  return value === 'app' ? 'app' : DEFAULT_BUILD_TYPE;
}

/** True when a build/spec targets the multi-screen app pipeline. */
export function isAppBuild(value: unknown): boolean {
  return resolveBuildType(value) === 'app';
}

/** Human-facing label for the build type (used for project category/name). */
export function buildTypeLabel(type: BuildType): string {
  return type === 'app' ? 'App' : 'Website';
}
