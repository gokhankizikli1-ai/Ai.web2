import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Lightbulb, TrendingUp, FileText, Zap,
  Bookmark, BookmarkCheck,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  scopedKey, claimLegacyGlobal, quarantineLegacyGlobal, dropLegacyGlobal,
} from '@/lib/storageScope';

// Phase 14D — saved prompts are per identity; logout no longer wipes them
// (isolation is structural). Phase 14D.2 — legacy GLOBAL prompts are claimed by
// at most one authenticated owner and UNIONED into that owner's scope.
const SAVED_PROMPTS_KEY = 'korvix_saved_prompts';

/** A saved-prompts value is an array of primitive string ids. */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Claim + merge legacy GLOBAL saved prompts into the current owner's scope
 * (Phase 14D.2). Union semantics: scoped order first, then unique legacy ids —
 * never duplicated. Malformed legacy JSON is quarantined (not discarded);
 * malformed scoped data is never overwritten. Only the marker owner runs; guests
 * and other users no-op. Idempotent — the global key is removed only after a
 * successful scoped write, so a repeat pass finds nothing to claim.
 */
function migrateSavedPrompts(): void {
  const claim = claimLegacyGlobal(SAVED_PROMPTS_KEY);
  if (!claim) return;

  let legacy: unknown;
  try { legacy = JSON.parse(claim.raw); } catch { legacy = undefined; }
  if (!isStringArray(legacy)) {
    // Unparseable / unknown-shape legacy → owner-scoped quarantine, then drop.
    if (quarantineLegacyGlobal(SAVED_PROMPTS_KEY, claim.raw)) dropLegacyGlobal(SAVED_PROMPTS_KEY);
    return;
  }

  let scoped: string[] = [];
  const scopedRaw = localStorage.getItem(claim.scopedKey);
  if (scopedRaw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(scopedRaw); } catch { return; } // malformed scoped — never overwrite
    if (!isStringArray(parsed)) return;                       // unknown scoped shape — never overwrite
    scoped = parsed;
  }

  const seen = new Set(scoped);
  const merged = [...scoped];
  for (const id of legacy) if (!seen.has(id)) { seen.add(id); merged.push(id); }

  try { localStorage.setItem(claim.scopedKey, JSON.stringify(merged)); }
  catch { return; }                                           // quota — leave global for retry
  dropLegacyGlobal(SAVED_PROMPTS_KEY);
}

// Browser-only, fire-and-forget: claim + union legacy GLOBAL saved prompts into
// the boot identity's scope at module load, so the rightful owner's migration
// completes at boot rather than only when a chat surface renders. Guests /
// non-owners no-op; idempotent. Never blocks paint.
if (typeof window !== 'undefined') {
  try { migrateSavedPrompts(); } catch { /* private mode — skip */ }
}

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
      migrateSavedPrompts();
      const parsed: unknown = JSON.parse(localStorage.getItem(scopedKey(SAVED_PROMPTS_KEY)) || '[]');
      return isStringArray(parsed) ? parsed : [];
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
