import { Navigate, useSearchParams } from 'react-router';

/**
 * App Builder (Surface B) — the dedicated `/tools/app-builder` entry.
 *
 * App Build is NOT a separate pipeline: it is the mature Web Build spine made
 * BUILD-TYPE PARAMETRIC (shared core + thin app adapters). There is exactly ONE
 * canonical production App Build execution spine — the same planning → spec →
 * generation → validation → review → repair → acceptance → preview → persistence
 * path the Web Build uses — entered with the canonical build type `app`
 * (resolveBuildType), which routes generation through the app adapters.
 *
 * This surface therefore enters that ONE spine in app mode rather than owning a
 * second builder UI (which would be a forbidden parallel system) or the legacy
 * deterministic-HTML orchestrator prototype (which is classified non-production and
 * must never own a production App Build). Both the chat app-chip and this route
 * resolve to the identical canonical behavior: they open the canonical builder with
 * `mode=app`. Any incoming `?prompt=` / `?session=` handoff is forwarded verbatim so
 * a deep link keeps working; the mode is forced to `app` so the build type is never
 * re-inferred from the prompt text.
 *
 * NOTE (legacy orchestrator): the previous implementation POSTed to
 * `/v2/intelligence/orchestrate` (Blueprint → Orchestrator → deterministic HTML
 * renderer → single-file PreviewPayload). That path is legacy/non-production and no
 * longer participates in production App Build; it is intentionally not referenced
 * here. The orchestrator remains available for future Core work, but it does not own
 * the App Build product.
 */
export default function AppBuilder() {
  const [params] = useSearchParams();
  // Preserve every incoming handoff parameter, then force the canonical app build type.
  const forwarded = new URLSearchParams(params);
  forwarded.set('mode', 'app');
  return <Navigate to={`/tools/website-builder?${forwarded.toString()}`} replace />;
}
