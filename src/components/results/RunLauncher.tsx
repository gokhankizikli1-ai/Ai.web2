// RunLauncher — Sprint 1.8 — start a run from the Results page and immediately
// watch it live. Uses the SHARED useStartRun (no duplicated run-creation
// logic). On success it hands the new run_id to the page, which selects it →
// useLiveRun streams it. Hidden when the orchestrator is disabled.
import { useCallback, useState } from 'react';
import { Play, Loader2, Sparkles } from 'lucide-react';
import { useStartRun } from '@/hooks/useStartRun';

interface RunLauncherProps {
  projectId: string;
  onStarted: (runId: string) => void;
  disabled?: boolean;
}

export default function RunLauncher({ projectId, onStarted, disabled }: RunLauncherProps) {
  const [text, setText] = useState('');
  const { start, starting, error } = useStartRun();

  const submit = useCallback(async () => {
    const snap = await start({ userRequest: text, projectId });
    if (snap) { setText(''); onStarted(snap.run_id); }
  }, [start, text, projectId, onStarted]);

  if (disabled) return null;

  return (
    <div className="p-2.5 border-b border-white/[0.05]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles className="h-3 w-3 text-[#52677A]/60" />
        <span className="text-[11px] font-medium text-white/55">Start a run</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe what to build — it runs and streams here…"
        rows={2}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
        className="w-full bg-white/[0.02] border border-white/[0.05] rounded-lg px-2 py-1.5 text-[12px] text-white/80 placeholder:text-white/25 outline-none resize-none focus:border-[#52677A]/20"
      />
      <button
        onClick={submit}
        disabled={!text.trim() || starting}
        className="mt-1.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg text-[12px] font-medium text-[#637B90] disabled:opacity-40 transition-colors"
        style={{ background: 'rgba(82,103,122,0.07)', border: '1px solid rgba(82,103,122,0.14)' }}
      >
        {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {starting ? 'Starting…' : 'Start run'}
      </button>
      {error && <p className="text-[10px] text-[#B76E79]/70 mt-1">{error}</p>}
    </div>
  );
}
