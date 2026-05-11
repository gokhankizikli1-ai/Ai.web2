import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Brain, Zap, Target, Folder, Clock } from 'lucide-react';

interface MemoryNode {
  id: string;
  label: string;
  x: number;
  y: number;
  type: 'core' | 'workspace' | 'context' | 'recent';
  connections: string[];
}

const NODES: MemoryNode[] = [
  { id: 'core', label: 'Core Memory', x: 50, y: 50, type: 'core', connections: ['ws1', 'ws2', 'ctx1', 'ctx2'] },
  { id: 'ws1', label: 'Chat Workspace', x: 20, y: 25, type: 'workspace', connections: ['ctx1'] },
  { id: 'ws2', label: 'Trading Workspace', x: 80, y: 25, type: 'workspace', connections: ['ctx2'] },
  { id: 'ctx1', label: 'User Preferences', x: 15, y: 65, type: 'context', connections: ['recent1'] },
  { id: 'ctx2', label: 'Market Data', x: 85, y: 65, type: 'context', connections: ['recent2'] },
  { id: 'recent1', label: 'Recent Chat #1', x: 30, y: 85, type: 'recent', connections: [] },
  { id: 'recent2', label: 'Signal Analysis', x: 70, y: 85, type: 'recent', connections: [] },
];

const NODE_COLORS: Record<string, { bg: string; border: string; glow: string; text: string }> = {
  core: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', glow: 'shadow-cyan-500/10', text: 'text-cyan-400' },
  workspace: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', glow: 'shadow-violet-500/10', text: 'text-violet-400' },
  context: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'shadow-amber-500/10', text: 'text-amber-400' },
  recent: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', glow: 'shadow-emerald-500/10', text: 'text-emerald-400' },
};

function NodeIcon({ type }: { type: string }) {
  switch (type) {
    case 'core': return <Brain className="h-3 w-3" />;
    case 'workspace': return <Folder className="h-3 w-3" />;
    case 'context': return <Target className="h-3 w-3" />;
    case 'recent': return <Clock className="h-3 w-3" />;
    default: return <Zap className="h-3 w-3" />;
  }
}

export default function MemoryGraph() {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getNode = (id: string) => NODES.find((n) => n.id === id);

  return (
    <div className="relative w-full h-[260px] rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
      {/* SVG Connections */}
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
        {NODES.map((node) =>
          node.connections.map((targetId) => {
            const target = getNode(targetId);
            if (!target) return null;
            const isActive = activeNode === node.id || activeNode === targetId;
            return (
              <motion.line
                key={`${node.id}-${targetId}`}
                x1={`${node.x}%`}
                y1={`${node.y}%`}
                x2={`${target.x}%`}
                y2={`${target.y}%`}
                stroke={isActive ? 'rgba(34,211,238,0.2)' : 'rgba(255,255,255,0.03)'}
                strokeWidth={isActive ? 2 : 1}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            );
          })
        )}
      </svg>

      {/* Nodes */}
      {NODES.map((node) => {
        const colors = NODE_COLORS[node.type];
        const isActive = activeNode === node.id;
        const isConnected = activeNode && getNode(activeNode)?.connections.includes(node.id);

        return (
          <motion.button
            key={node.id}
            className={`absolute flex flex-col items-center gap-1 transition-all duration-300 ${isActive || isConnected ? 'z-10' : 'z-[2]'}`}
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onMouseEnter={() => setActiveNode(node.id)}
            onMouseLeave={() => setActiveNode(null)}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.bg} border ${colors.border} shadow-lg ${colors.glow} transition-all duration-300 ${
                isActive ? 'ring-2 ring-cyan-400/20 scale-110' : ''
              }`}
            >
              <span className={colors.text}>
                <NodeIcon type={node.type} />
              </span>
            </div>
            <span
              className={`text-[9px] font-medium transition-colors duration-300 whitespace-nowrap ${
                isActive ? 'text-white' : isConnected ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              {node.label}
            </span>

            {/* Pulse effect for active */}
            {isActive && (
              <motion.div
                className="absolute inset-0 rounded-lg border border-cyan-400/20"
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}
          </motion.button>
        );
      })}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex items-center gap-3 z-[3]">
        {Object.entries(NODE_COLORS).map(([type, colors]) => (
          <div key={type} className="flex items-center gap-1">
            <div className={`h-2 w-2 rounded-full ${colors.bg} border ${colors.border}`} />
            <span className="text-[8px] text-slate-700 capitalize">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
