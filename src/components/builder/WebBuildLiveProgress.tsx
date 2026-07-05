/**
 * Web Build live progress — INTENTIONALLY DISABLED (renders nothing).
 *
 * The running-state agent timeline — the "Think" line, the pulsing orb, and the
 * Research / UI-Art Director / Strategy / Layout Architect / Component Engineer /
 * Preparing-preview rows — is removed from the main chat entirely. This component
 * is kept only as an inert stub that renders null, so no code path can bring the
 * running/progress UI back. Agents still run internally and their artifacts are
 * unchanged; only this visual surface is gone.
 */
export default function WebBuildLiveProgress(_props?: { kind?: 'build' | 'revision' }): null {
  return null;
}
