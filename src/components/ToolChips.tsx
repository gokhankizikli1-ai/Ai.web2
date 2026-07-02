import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { ComposerTool } from './ComposerTools';

interface ToolChipsProps {
  tools: ComposerTool[];
  onRemove: (tool: ComposerTool) => void;
}

export default function ToolChips({ tools, onRemove }: ToolChipsProps) {
  if (tools.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2 px-1">
      <AnimatePresence>
        {tools.map((tool) => (
          <motion.div
            key={tool.id}
            initial={{ opacity: 0, scale: 0.96, y: 2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-[3px]"
          >
            <tool.icon className="h-3 w-3 text-[#94A3B8]" />
            <span className="text-[11px] text-[#CBD5E1]">{tool.chip}</span>
            <button
              onClick={() => onRemove(tool)}
              className="text-[#94A3B8] hover:text-[#CBD5E1] transition-colors p-0.5 rounded"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
