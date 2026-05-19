import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Zap, Target, Folder, Clock, X, ChevronRight } from 'lucide-react';

interface MemoryNode {
  id: string;
  label: string;
  x: number;
  y: number;
  type: 'core' | 'workspace' | 'context' | 'recent';
  connections: string[];
  description: string;
  items: string[];
}

const NODES: MemoryNode[] = [
  { id: 'core', label: 'Core Memory', x: 50, y: 50, type: 'core', connections: ['ws1', 'ws2', 'ctx1', 'ctx2'], description: 'Central knowledge hub connecting all workspace data.', items: ['User profile', 'System preferences', 'AI model config'] },
  { id: 'ws1', label: 'Chat Workspace', x: 20, y: 25, type: 'workspace', connections: ['ctx1'], description: 'Active chat sessions and conversation history.', items: ['12 active chats', '3 saved threads', 'Last: market analysis'] },
  { id: 'ws2', label: 'Trading Workspace', x: 80, y: 25, type: 'workspace', connections: ['ctx2'], description: 'Trading signals, watchlists, and market analysis.', items: ['8 watchlist items', '5 signals today', 'Sentiment: Bullish'] },
  { id: 'ctx1', label: 'User Preferences', x: 15, y: 65, type: 'context', connections: ['recent1'], description: 'Personal settings and preference memory.', items: ['Dark mode', 'Language: EN', 'Default: Deep Think'] },
  { id: 'ctx2', label: 'Market Data', x: 85, y: 65, type: 'context', connections: ['recent2'], description: 'Cached market data and indicator states.', items: ['BTC: $67,890', 'SPY: +0.4%', 'VIX: 14.2'] },
  { id: 'recent1', label: 'Recent Chat #1', x: 30, y: 85, type: 'recent', connections: [], description: 'Latest conversation about tech stocks.', items: ['Q: AAPL earnings?', 'A: Beat expectations...', 'Tokens: 1,240'] },
  { id: 'recent2', label: 'Signal Analysis', x: 70, y: 85, type: 'recent', connections: [], description: 'Latest trading signal generated.', items: ['ETH: Long signal', 'Entry: $3,450', 'Confidence: 78%'] },
];

const NODE_COLORS: Record<string, { bg: string; border: string; glow: string; text: string; line: string }> = {
  core: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', glow: 'shadow-cyan-500/10', text: 'text-cyan-400', line: 'rgba(34,211,238,0.2)' },
  workspace: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', glow: 'shadow-violet-500/10', text: 'text-violet-400', line: 'rgba(167,139,250,0.2)' },
  context: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', glow: 'shadow-amber-500/10', text: 'text-amber-400', line: 'rgba(251,191,36,0.2)' },
  recent: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', glow: 'shadow-emerald-500/10', text: 'text-emerald-400', line: 'rgba(52,211,153,0.2)' },
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
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getNode = (id: string) => NODES.find((n) => n.id === id);

  const handleNodeClick = (nodeId: string) => {
    setSelectedNode(selectedNode === nodeId ? null : nodeId);
    setActiveNode(nodeId);
  };

  return (
    <div className="relative w-full h-[260px] rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
      {/* SVG Connections — animated */}
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }}>
        {NODES.map((node) =>
          node.connections.map((targetId) => {
            const target = getNode(targetId);
            if (!target) return null;
            const isActive = activeNode === node.id || activeNode === targetId;
            const isHovered = hoveredNode === node.id || hoveredNode === targetId;
            const showGlow = isActive || isHovered;
            const colors = NODE_COLORS[node.type];

            return (
              <motion.line
                key={`${node.id}-${targetId}`}
                x1={`${node.x}%`}
                y1={`${node.y}%`}
                x2={`${target.x}%`}
                y2={`${target.y}%`}
                stroke={showGlow ? colors.line : 'rgba(255,255,255,0.03)'}
                strokeWidth={showGlow ? 2 : 1}
                strokeDasharray={showGlow ? '0' : '4 4'}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: 1,
                  opacity: showGlow ? 0.8 : 0.3,
                }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            );
          })
        )}
      </svg>

      {/* Nodes */}
      {NODES.map((node) => {
        const colors = NODE_COLORS[node.type];
        const isActive = activeNode === node.id;
        const isHovered = hoveredNode === node.id;
        const isConnected = activeNode && getNode(activeNode)?.connections.includes(node.id);
        const isSelected = selectedNode === node.id;

        return (
          <motion.button
            key={node.id}
            className={`absolute flex flex-col items-center gap-1 transition-all duration-300 ${isActive || isConnected ? 'z-10' : 'z-[2]'}`}
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
            onMouseEnter={() => { setHoveredNode(node.id); setActiveNode(node.id); }}
            onMouseLeave={() => { setHoveredNode(null); if (!selectedNode) setActiveNode(null); }}
            onClick={() => handleNodeClick(node.id)}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.95 }}
          >
            {/* Glow ring */}
            {(isHovered || isSelected) && (
              <motion.div
                className={`absolute -inset-2 rounded-xl ${colors.bg} blur-md`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            )}

            <div
              className={`relative flex h-8 w-8 items-center justify-center rounded-lg ${colors.bg} border ${colors.border} shadow-lg ${colors.glow} transition-all duration-300 ${
                isSelected ? 'ring-2 ring-cyan-400/30 scale-110' : isHovered ? 'ring-1 ring-white/10 scale-105' : ''
              }`}
            >
              <span className={colors.text}>
                <NodeIcon type={node.type} />
              </span>

              {/* Pulse for selected */}
              {isSelected && (
                <motion.div
                  className="absolute inset-0 rounded-lg border border-cyan-400/20"
                  animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}

              {/* Hover pulse */}
              {isHovered && !isSelected && (
                <motion.div
                  className="absolute inset-0 rounded-lg border border-white/10"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0, 0.2] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
            </div>

            {/* Label */}
            <span
              className={`text-[9px] font-medium transition-colors duration-300 whitespace-nowrap ${
                isSelected ? 'text-white' : isHovered ? 'text-slate-300' : isConnected ? 'text-slate-400' : 'text-slate-600'
              }`}
            >
              {node.label}
            </span>

            {/* Tooltip on hover */}
            <AnimatePresence>
              {isHovered && !isSelected && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-[#0e0e14] border border-white/[0.06] shadow-lg whitespace-nowrap z-20"
                >
                  <p className="text-[9px] text-slate-400">{node.description}</p>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#0e0e14] border-r border-b border-white/[0.06] rotate-45" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}

      {/* Click info panel */}
      <AnimatePresence>
        {selectedNode && (() => {
          const node = getNode(selectedNode);
          if (!node) return null;
          const colors = NODE_COLORS[node.type];

          return (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="absolute top-2 right-2 w-40 rounded-lg border border-white/[0.05] bg-[#0e0e14]/95 backdrop-blur-sm shadow-xl z-30 p-2.5"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-md ${colors.bg} border ${colors.border}`}>
                    <span className={colors.text}><NodeIcon type={node.type} /></span>
                  </div>
                  <span className="text-[11px] font-medium text-white">{node.label}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(null); }}
                  className="text-slate-600 hover:text-slate-400 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="text-[9px] text-slate-500 mb-2 leading-relaxed">{node.description}</p>
              <div className="space-y-1">
                {node.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9px] text-slate-400">
                    <ChevronRight className="h-2.5 w-2.5 text-slate-700" />
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

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
