import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lightbulb, TrendingUp, FileText, Zap,
  Bookmark, BookmarkCheck,
} from 'lucide-react';

export interface ResponseAction {
  id: string;
  label: string;
  icon: typeof Lightbulb;
  prompt: string;
  description: string;
}

export const RESPONSE_ACTIONS: ResponseAction[] = [
  { id: 'explain', label: 'Explain more', icon: Lightbulb, prompt: 'Can you explain that in more detail?', description: 'Deeper explanation' },
  { id: 'examples', label: 'Show examples', icon: FileText, prompt: 'Can you provide some concrete examples?', description: 'Practical examples' },
  { id: 'simplify', label: 'Simplify', icon: Zap, prompt: 'Can you simplify that for a beginner?', description: 'Simpler version' },
  { id: 'action', label: 'Action items', icon: TrendingUp, prompt: 'What are the specific action items from this?', description: 'Actionable steps' },
];

export function useSavedPrompts() {
  const [saved, setSaved] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('korvix_saved_prompts') || '[]'); } catch { return []; }
  });
  const toggle = (id: string) => {
    setSaved((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      localStorage.setItem('korvix_saved_prompts', JSON.stringify(next));
      return next;
    });
  };
  return { saved, toggle };
}

interface ResponseActionsProps {
  onAction: (action: string) => void;
  onHoverAction?: (action: string, prompt: string) => void;
  compact?: boolean;
}

export default function ResponseActions({ onAction, onHoverAction, compact = false }: ResponseActionsProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { saved, toggle: toggleSave } = useSavedPrompts();

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : ''}`}>
      {RESPONSE_ACTIONS.map((action, i) => {
        const isSaved = saved.includes(action.id);
        const isHovered = hoveredId === action.id;
        return (
          <motion.button
            key={action.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.04 }}
            onClick={() => onAction(action.prompt)}
            onMouseEnter={() => {
              setHoveredId(action.id);
              onHoverAction?.(action.label, action.prompt);
            }}
            onMouseLeave={() => setHoveredId(null)}
            className={`
              group flex items-center gap-1.5
              rounded-lg border border-white/[0.04] bg-white/[0.015]
              px-2.5 py-1
              transition-all duration-150
              hover:border-white/[0.08] hover:bg-white/[0.03]
              ${isHovered ? 'border-[#3B82F6]/20 bg-[#3B82F6]/[0.02]' : ''}
            `}
          >
            <action.icon className="h-3 w-3 text-[#94A3B8] group-hover:text-[#CBD5E1] transition-colors" />
            <span className="text-[11px] text-[#94A3B8] group-hover:text-slate-300 transition-colors">
              {action.label}
            </span>

            {/* Save star */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSave(action.id); }}
              className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {isSaved ? (
                <BookmarkCheck className="h-2.5 w-2.5 text-[#3B82F6]/70" />
              ) : (
                <Bookmark className="h-2.5 w-2.5 text-[#94A3B8] hover:text-[#94A3B8]" />
              )}
            </button>
          </motion.button>
        );
      })}
    </div>
  );
}
