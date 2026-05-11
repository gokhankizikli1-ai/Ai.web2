import { memo } from 'react';
import type { WorkspaceTab } from '@/types';

const WORKSPACE_COLORS: Record<WorkspaceTab, { glow: string; opacity: string }> = {
  chat:     { glow: 'bg-cyan-500/3',    opacity: 'opacity-30' },
  coding:   { glow: 'bg-blue-500/3',    opacity: 'opacity-30' },
  research: { glow: 'bg-violet-500/3',  opacity: 'opacity-30' },
  trading:  { glow: 'bg-emerald-500/3', opacity: 'opacity-40' },
  business: { glow: 'bg-amber-500/3',   opacity: 'opacity-30' },
  startup:  { glow: 'bg-orange-500/3',  opacity: 'opacity-30' },
  agents:   { glow: 'bg-indigo-500/3',  opacity: 'opacity-30' },
  study:    { glow: 'bg-rose-500/3',    opacity: 'opacity-30' },
  creative: { glow: 'bg-pink-500/3',    opacity: 'opacity-30' },
};

const AdaptiveBackground = memo(function AdaptiveBackground({ activeTab }: { activeTab: WorkspaceTab }) {
  const colors = WORKSPACE_COLORS[activeTab] || WORKSPACE_COLORS.chat;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
      {/* Primary gradient orb */}
      <div
        className={`absolute top-0 right-0 w-[60vw] h-[60vh] rounded-full blur-[120px] transition-all duration-[2000ms] ease-out ${colors.glow} ${colors.opacity}`}
      />
      {/* Secondary orb */}
      <div
        className={`absolute bottom-0 left-0 w-[40vw] h-[40vh] rounded-full blur-[100px] transition-all duration-[2000ms] ease-out ${colors.glow} opacity-20`}
      />
      {/* Center subtle glow */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vh] rounded-full blur-[150px] transition-all duration-[3000ms] ease-out ${colors.glow} opacity-10`}
      />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
});

export default AdaptiveBackground;
