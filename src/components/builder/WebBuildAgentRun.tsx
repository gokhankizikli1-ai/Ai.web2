import type { RunRow } from '@/lib/webBuildRun';

/**
 * Web Build agent-run timeline — INTENTIONALLY DISABLED (renders nothing).
 *
 * The post-completion agent/file-row reveal — Think, Research Agent …, "Create
 * components/Hero.tsx", the Preparing-preview row — is removed from the main chat
 * entirely. A finished build turn shows only the result cards (Preview / All Files
 * / Save). This component is kept only as an inert stub that renders null so no
 * code path can resurrect the running/progress UI. Internal agent data/artifacts
 * are unaffected.
 */
export default function WebBuildAgentRun(_props: {
  rows: RunRow[];
  brief?: { type?: string; audience?: string; goal?: string; style?: string };
  animate: boolean;
  onOpenFile: (path: string) => void;
  onComplete?: () => void;
}): null {
  return null;
}
