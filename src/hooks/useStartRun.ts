// useStartRun — Sprint 1.8 — the SINGLE source of run-creation for the UI.
//
// Wraps projectOrchestratorClient.startRun with the established project-
// ownership fallback (when ENABLE_PROJECTS is on and the project id is a
// local-only tag the route 404s, so we retry project-less). Both the
// ProjectRunPanel and the Results-page launcher use this — no duplicated run
// creation code. No new endpoint; reuses the existing POST /v2/orchestrator/run.
import { useCallback, useState } from 'react';
import { projectOrchestratorClient, type RunSnapshot } from '@/hooks/useProjectOrchestrator';

export interface StartRunInput {
  userRequest: string;
  projectId?:  string;
  templateId?: string;
  metadata?:   Record<string, unknown>;
}

export interface UseStartRun {
  start:    (input: StartRunInput) => Promise<RunSnapshot | null>;
  starting: boolean;
  error:    string | null;
  reset:    () => void;
}

export function useStartRun(): UseStartRun {
  const [starting, setStarting] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const start = useCallback(async (input: StartRunInput): Promise<RunSnapshot | null> => {
    const userRequest = input.userRequest.trim();
    if (!userRequest || starting) return null;
    setStarting(true);
    setError(null);
    try {
      try {
        return await projectOrchestratorClient.startRun({
          userRequest,
          projectId: input.projectId,
          templateId: input.templateId,
          metadata: input.metadata,
        });
      } catch (e: unknown) {
        // ENABLE_PROJECTS on + local-only project id → ownership 404. Fall back
        // to a project-less run so orchestration still works end-to-end.
        if ((e as { code?: string })?.code === 'project_not_found') {
          return await projectOrchestratorClient.startRun({
            userRequest, templateId: input.templateId, metadata: input.metadata,
          });
        }
        throw e;
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to start run');
      return null;
    } finally {
      setStarting(false);
    }
  }, [starting]);

  const reset = useCallback(() => setError(null), []);

  return { start, starting, error, reset };
}
