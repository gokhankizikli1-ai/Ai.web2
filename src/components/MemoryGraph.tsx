import { useState, useRef, useEffect } from 'react';
import {
  Heart, Target, Sliders, UserCircle, FolderOpen,
  Lightbulb, MessageSquareText, Sparkles,
} from 'lucide-react';

interface MemoryNode {
  id: string;
  label: string;
  x: number;
  y: number;
  colorKey: string;
  connections: string[];
  hint: string;
}

/* ─── Human contextual memory nodes ─── */
const NODES: MemoryNode[] = [
  { id: 'core', label: 'You', x: 50, y: 48, colorKey: 'core', connections: ['goals', 'preferences', 'personality', 'projects'], hint: 'Your unique profile that KorvixAI remembers' },
  { id: 'goals', label: 'Goals', x: 22, y: 22, colorKey: 'warm', connections: [], hint: 'Building AI startup projects, launching products' },
  { id: 'preferences', label: 'Preferences', x: 78, y: 22, colorKey: 'cool', connections: [], hint: 'Dark mode, concise responses, English + Turkish' },
  { id: 'personality', label: 'Personality', x: 18, y: 68, colorKey: 'soft', connections: [], hint: 'Direct, analytical, curious, efficiency-focused' },
  { id: 'projects', label: 'Projects', x: 82, y: 68, colorKey: 'warm', connections: [], hint: 'Ecommerce store, trading bot, SaaS platform' },
  { id: 'interests', label: 'Interests', x: 30, y: 88, colorKey: 'cool', connections: [], hint: 'AI, finance, design, automation, startups' },
  { id: 'communication', label: 'Communication', x: 70, y: 88, colorKey: 'soft', connections: [], hint: 'Prefers short answers with bullet points' },
  { id: 'learning', label: 'Learning Focus', x: 50, y: 12, colorKey: 'core', connections: [], hint: 'AI systems, quantitative trading, growth marketing' },
];

const COLORS: Record<string, { bg: string; border: string; line: string; glow: string }> = {
  core:   { bg: 'rgba(59, 130, 246,0.12)', border: 'rgba(59, 130, 246,0.35)', line: 'rgba(59, 130, 246,0.22)', glow: 'rgba(59, 130, 246,0.15)' },
  warm:   { bg: 'rgba(59, 130, 246,0.10)', border: 'rgba(59, 130, 246,0.28)', line: 'rgba(59, 130, 246,0.18)', glow: 'rgba(59, 130, 246,0.12)' },
  cool:   { bg: 'rgba(96, 165, 250,0.10)', border: 'rgba(96, 165, 250,0.28)', line: 'rgba(96, 165, 250,0.18)', glow: 'rgba(96, 165, 250,0.12)' },
  soft:   { bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.28)', line: 'rgba(52,211,153,0.18)', glow: 'rgba(52,211,153,0.12)' },
};

const ICONS: Record<string, React.ElementType> = {
  core: Heart, goals: Target, preferences: Sliders, personality: UserCircle,
  projects: FolderOpen, interests: Lightbulb, communication: MessageSquareText, learning: Sparkles,
};

/* ─── Subtle energy particles along a line ─── */
function EnergyParticles({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full pointer-events-none"
          style={{
            background: 'rgba(59, 130, 246,0.35)',
            boxShadow: '0 0 4px rgba(59, 130, 246,0.3)',
            left: '50%',
            top: '50%',
            animation: `memoryEnergy 3s ease-in-out ${i * 1}s infinite`,
          }}
        />
      ))}
    </>
  );
}

export default function MemoryGraph() {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Ambient breathing state */
  const [breathPhase, setBreathPhase] = useState(0);
  useEffect(() => {
    let frame = 0;
    let raf: number;
    const animate = () => {
      frame++;
      setBreathPhase(Math.sin(frame * 0.02) * 0.5 + 0.5);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const hovered = NODES.find((n) => n.id === hoveredNode);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[280px] rounded-xl overflow-hidden select-none"
      style={{
        background: 'linear-gradient(180deg, rgba(27,34,48,0.3) 0%, rgba(13, 17, 23,0.4) 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 4px 16px rgba(0,0,0,0.1)',
      }}
    >
      {/* CSS animations */}
      <style>{`
        @keyframes memoryPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.3; }
          50% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        @keyframes memoryEnergy {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translate(60px, -30px) scale(0.6); opacity: 0; }
        }
      `}</style>

      {/* Ambient center glow — breathing */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: '50%', top: '48%',
          transform: 'translate(-50%, -50%)',
          width: `${120 + breathPhase * 20}px`,
          height: `${120 + breathPhase * 20}px`,
          background: `radial-gradient(circle, rgba(59, 130, 246,${0.04 + breathPhase * 0.03}) 0%, rgba(59, 130, 246,0.015) 45%, transparent 70%)`,
          transition: 'width 0.5s ease-out, height 0.5s ease-out',
          zIndex: 0,
        }}
      />

      {/* Center "You" pulse rings */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${NODES[0].x}%`, top: `${NODES[0].y}%`,
          width: '40px', height: '40px',
          borderRadius: '50%',
          border: '1px solid rgba(59, 130, 246,0.12)',
          animation: 'memoryPulse 3s ease-in-out infinite',
          zIndex: 1,
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${NODES[0].x}%`, top: `${NODES[0].y}%`,
          width: '40px', height: '40px',
          borderRadius: '50%',
          border: '1px solid rgba(59, 130, 246,0.08)',
          animation: 'memoryPulse 3s ease-in-out 1.5s infinite',
          zIndex: 1,
        }}
      />

      {/* SVG Connection lines */}
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
        {NODES.map((node) =>
          node.connections.map((targetId) => {
            const target = NODES.find((n) => n.id === targetId);
            if (!target) return null;
            const isConnectedToHover = hoveredNode === node.id || hoveredNode === targetId;
            const colors = COLORS[node.colorKey];

            return (
              <g key={`${node.id}-${targetId}`}>
                {/* Base line */}
                <line
                  x1={`${node.x}%`} y1={`${node.y}%`}
                  x2={`${target.x}%`} y2={`${target.y}%`}
                  stroke={isConnectedToHover ? colors.line : 'rgba(255,255,255,0.05)'}
                  strokeWidth={isConnectedToHover ? 2 : 0.8}
                  strokeLinecap="round"
                />
                {/* Glow line on hover */}
                {isConnectedToHover && (
                  <line
                    x1={`${node.x}%`} y1={`${node.y}%`}
                    x2={`${target.x}%`} y2={`${target.y}%`}
                    stroke={colors.glow}
                    strokeWidth={5}
                    strokeLinecap="round"
                    style={{ filter: 'blur(3px)', opacity: 0.4 }}
                  />
                )}
              </g>
            );
          })
        )}
      </svg>

      {/* Energy particles container */}
      {hoveredNode && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
          <EnergyParticles active={!!hoveredNode} />
        </div>
      )}

      {/* Nodes */}
      {NODES.map((node) => {
        const colors = COLORS[node.colorKey];
        const isHovered = hoveredNode === node.id;
        const isConnected = hovered?.connections.includes(node.id) || (hovered && node.connections.includes(hovered.id));
        const isCore = node.id === 'core';
        const IconComp = ICONS[node.id] || Sparkles;
        const shouldHighlight = isHovered || isConnected;

        return (
          <div
            key={node.id}
            className="absolute flex flex-col items-center gap-1 z-[3] cursor-default"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
          >
            {/* Hover glow */}
            {isHovered && (
              <div
                className="absolute -inset-3 rounded-2xl pointer-events-none"
                style={{
                  background: colors.glow,
                  filter: 'blur(10px)',
                  opacity: 0.5,
                  transition: 'opacity 0.2s ease',
                }}
              />
            )}

            {/* Connected glow (softer) */}
            {!isHovered && isConnected && (
              <div
                className="absolute -inset-2 rounded-xl pointer-events-none"
                style={{
                  background: colors.glow,
                  filter: 'blur(8px)',
                  opacity: 0.25,
                }}
              />
            )}

            {/* Node box */}
            <div
              className="relative flex items-center justify-center rounded-lg transition-all duration-200"
              style={{
                width: isCore ? 36 : 30,
                height: isCore ? 36 : 30,
                background: shouldHighlight ? colors.bg : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${shouldHighlight ? colors.border : 'rgba(255,255,255,0.07)'}`,
                boxShadow: isHovered
                  ? `0 0 16px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.06)`
                  : isConnected
                  ? `0 0 8px ${colors.glow}`
                  : 'none',
              }}
            >
              <IconComp
                style={{
                  width: isCore ? 16 : 13,
                  height: isCore ? 16 : 13,
                  color: isHovered
                    ? (isCore ? 'rgba(59, 130, 246,0.9)' : node.colorKey === 'warm' ? 'rgba(59, 130, 246,0.85)' : node.colorKey === 'cool' ? 'rgba(96, 165, 250,0.85)' : 'rgba(52,211,153,0.85)')
                    : isConnected
                    ? (isCore ? 'rgba(59, 130, 246,0.6)' : node.colorKey === 'warm' ? 'rgba(59, 130, 246,0.55)' : node.colorKey === 'cool' ? 'rgba(96, 165, 250,0.55)' : 'rgba(52,211,153,0.55)')
                    : (isCore ? 'rgba(59, 130, 246,0.45)' : 'rgba(203, 213, 225,0.35)'),
                  transition: 'color 0.2s ease',
                }}
              />
            </div>

            {/* Label */}
            <span
              className="text-[10px] font-medium whitespace-nowrap transition-colors duration-200"
              style={{
                color: isHovered ? 'rgba(255,255,255,0.9)' : isConnected ? 'rgba(203,213,225,0.6)' : isCore ? 'rgba(203,213,225,0.5)' : 'rgba(203, 213, 225,0.35)',
              }}
            >
              {node.label}
            </span>

            {/* Compact tooltip on hover */}
            {isHovered && (
              <div
                className="absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md z-20 pointer-events-none"
                style={{
                  background: 'rgba(17, 23, 34,0.98)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <p className="text-[10px] text-slate-200 font-medium whitespace-nowrap">{node.hint}</p>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
                  style={{ background: '#171C24', borderRight: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-2 left-2.5 flex items-center gap-2.5 z-[4]">
        {[
          { label: 'You', color: 'rgba(59, 130, 246,0.5)' },
          { label: 'Goals', color: 'rgba(59, 130, 246,0.4)' },
          { label: 'Style', color: 'rgba(96, 165, 250,0.4)' },
          { label: 'Traits', color: 'rgba(52,211,153,0.4)' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.color, boxShadow: `0 0 3px ${item.color}` }} />
            <span className="text-[9px] text-[#94A3B8]">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
