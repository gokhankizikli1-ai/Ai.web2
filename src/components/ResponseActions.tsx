import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lightbulb, TrendingUp, FileText, Zap,
  Bookmark, BookmarkCheck,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { scopedKey, migrateGlobalToScope } from '@/lib/storageScope';

// Phase 14D — saved prompts are per identity; legacy global data is claimed into
// the current scope once, and logout no longer wipes it (isolation is structural).
const SAVED_PROMPTS_KEY = 'korvix_saved_prompts';

export interface ResponseAction {
  id: string;
  /** i18n keys — resolved at render so chips follow the selected language. */
  labelKey: string;
  descKey: string;
  icon: typeof Lightbulb;
  prompt: string;
}

export const RESPONSE_ACTIONS: ResponseAction[] = [
  { id: 'explain', labelKey: 'actionExplainMore', icon: Lightbulb, prompt: 'Can you explain that in more detail?', descKey: 'actionExplainDesc' },
  { id: 'examples', labelKey: 'actionShowExamples', icon: FileText, prompt: 'Can you provide some concrete examples?', descKey: 'actionExamplesDesc' },
  { id: 'simplify', labelKey: 'actionSimplify', icon: Zap, prompt: 'Can you simplify that for a beginner?', descKey: 'actionSimplifyDesc' },
  { id: 'action', labelKey: 'actionItems', icon: TrendingUp, prompt: 'What are the specific action items from this?', descKey: 'actionItemsDesc' },
];

export function useSavedPrompts() {
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      migrateGlobalToScope(SAVED_PROMPTS_KEY);
      return JSON.parse(localStorage.getItem(scopedKey(SAVED_PROMPTS_KEY)) || '[]');
    } catch { return []; }
  });
  const toggle = (id: string) => {
    setSaved((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      try { localStorage.setItem(scopedKey(SAVED_PROMPTS_KEY), JSON.stringify(next)); } catch { /* ignore */ }
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
  const { t } = useLanguageStore();
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
              onHoverAction?.(t(action.labelKey), action.prompt);
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
              {t(action.labelKey)}
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
