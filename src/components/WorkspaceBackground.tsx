import type { ReactNode } from 'react';

interface WorkspaceBackgroundProps {
  type: 'startup' | 'ecommerce' | 'trading' | 'research' | 'coding' | 'creative' | 'study' | 'default';
  children: ReactNode;
}

const GRADIENTS: Record<string, string> = {
  startup: 'radial-gradient(ellipse at 50% 0%, rgba(59, 130, 246,0.04) 0%, transparent 60%)',
  ecommerce: 'radial-gradient(ellipse at 80% 0%, rgba(52,211,153,0.04) 0%, transparent 60%)',
  trading: 'radial-gradient(ellipse at 50% 50%, rgba(74,222,128,0.02) 0%, transparent 70%)',
  research: 'radial-gradient(ellipse at 20% 0%, rgba(96, 165, 250,0.04) 0%, transparent 60%)',
  coding: 'radial-gradient(ellipse at 50% 0%, rgba(96,165,250,0.04) 0%, transparent 60%)',
  creative: 'radial-gradient(ellipse at 30% 20%, rgba(59, 130, 246,0.03) 0%, transparent 60%)',
  study: 'radial-gradient(ellipse at 50% 0%, rgba(59, 130, 246,0.04) 0%, transparent 60%)',
  default: 'none',
};

export default function WorkspaceBackground({ type, children }: WorkspaceBackgroundProps) {
  const gradient = GRADIENTS[type] || GRADIENTS.default;

  return (
    <div className="relative min-h-screen">
      {/* Subtle background glow */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{ background: gradient }}
      />
      {/* Trading grid overlay */}
      {type === 'trading' && (
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-[0.015]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(74,222,128,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(74,222,128,0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      )}
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
