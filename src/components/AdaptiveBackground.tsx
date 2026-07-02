import { memo } from 'react';
import type { WorkspaceTab } from '@/types';

const WORKSPACE_COLORS: Record<WorkspaceTab, { glow: string; opacity: string }> = {
  chat:     { glow: 'bg-[#3B82F6]/3',    opacity: 'opacity-15' },
  coding:   { glow: 'bg-[#3B82F6]/3',    opacity: 'opacity-15' },
  research: { glow: 'bg-[#3B82F6]/3',  opacity: 'opacity-15' },
  trading:  { glow: 'bg-[#3B82F6]/3', opacity: 'opacity-20' },
  business: { glow: 'bg-[#3B82F6]/3',   opacity: 'opacity-15' },
  startup:  { glow: 'bg-[#3B82F6]/3',  opacity: 'opacity-15' },
  agents:   { glow: 'bg-[#3B82F6]/3',  opacity: 'opacity-15' },
  study:    { glow: 'bg-[#3B82F6]/3',    opacity: 'opacity-15' },
  creative: { glow: 'bg-[#3B82F6]/3',  opacity: 'opacity-15' },
};

const AdaptiveBackground = memo(function AdaptiveBackground({ activeTab }: { activeTab: WorkspaceTab }) {
  const colors = WORKSPACE_COLORS[activeTab] || WORKSPACE_COLORS.chat;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
      {/* Primary gradient orb — very subtle */}
      <div
        className={`absolute top-0 right-0 w-[60vw] h-[60vh] rounded-full blur-[120px] transition-all duration-[2000ms] ease-out ${colors.glow} ${colors.opacity}`}
      />
      {/* Secondary orb — barely visible */}
      <div
        className={`absolute bottom-0 left-0 w-[40vw] h-[40vh] rounded-full blur-[100px] transition-all duration-[2000ms] ease-out ${colors.glow} opacity-10`}
      />
      {/* Center subtle glow */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vw] h-[80vh] rounded-full blur-[150px] transition-all duration-[3000ms] ease-out ${colors.glow} opacity-5`}
      />
      {/* Grid overlay — very faint */}
      <div
        className="absolute inset-0 opacity-[0.008]"
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
