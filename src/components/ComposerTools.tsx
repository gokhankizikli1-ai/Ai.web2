import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, Brain, BarChart3, ShoppingBag,
  Code, X, TrendingUp,
  Camera, FolderOpen,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

export interface ComposerTool {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  chip: string;
  placeholder: string;
  category: string;
  soon?: boolean;
  /** Hidden from the visible tools menu (capability still exists — e.g. web
   *  search now runs AUTOMATICALLY via backend intent detection, so it no
   *  longer needs a manual button). The entry stays in the array so any
   *  consumer that looks a tool up by id/chip keeps working. */
  hidden?: boolean;
  /** i18n keys for the visible menu (fall back to label/description). */
  labelKey?: string;
  descKey?: string;
}

// The composer tool registry. Web / Chart / Market / Product are kept here
// (their ids/chips are still referenced) but marked `hidden` — the public
// chat menu only surfaces Deep Research + Code Mode. Web/live research is
// invoked automatically by the backend when a query needs current info, so
// a manual "Search Web" button is unnecessary noise.
export const COMPOSER_TOOLS: ComposerTool[] = [
  { id: 'web',      label: 'Search Web',       description: 'Real-time web search',     icon: Search,     chip: 'Web Search',       placeholder: 'Ask KorvixAI to search the web for...',        category: 'Tools', hidden: true },
  { id: 'research', label: 'Deep Research',    description: 'Multi-source research',    icon: Brain,      chip: 'Deep Research',    placeholder: 'Ask KorvixAI to research deeply about...',     category: 'Tools', labelKey: 'deepResearch', descKey: 'toolDeepResearchDesc' },
  { id: 'chart',    label: 'Create Chart',     description: 'Data visualizations',      icon: BarChart3,  chip: 'Chart',            placeholder: 'Describe the data you want to visualize...',   category: 'Tools', hidden: true },
  { id: 'market',   label: 'Analyze Market',   description: 'Financial analysis',       icon: TrendingUp, chip: 'Market Analysis',  placeholder: 'Ask KorvixAI to analyze the market for...',    category: 'Tools', hidden: true },
  { id: 'product',  label: 'Product Research', description: 'E-commerce intelligence',  icon: ShoppingBag,chip: 'Product Research', placeholder: 'Ask KorvixAI to research products...',         category: 'Tools', hidden: true },
  { id: 'code',     label: 'Code Mode',        description: 'Coding assistant',         icon: Code,       chip: 'Code Mode',        placeholder: 'Write, debug, or refactor code...',            category: 'Tools', labelKey: 'toolCodeMode', descKey: 'toolCodeModeDesc' },
];

/** The tools actually shown in the public composer menu. */
export const VISIBLE_COMPOSER_TOOLS = COMPOSER_TOOLS.filter((t) => !t.hidden);

interface ComposerToolsProps {
  onSelectTool:   (tool: ComposerTool) => void;
  // Phase 9 fix — attachments live in the SAME + menu as tools so the
  // composer has exactly one "+" button. Each callback opens a hidden
  // <input> owned by PremiumComposer.
  onAttachPhoto?:  () => void;
  onAttachCamera?: () => void;
  onAttachFile?:   () => void;
  disabled?:       boolean;
}

export default function ComposerTools({
  onSelectTool,
  onAttachPhoto,
  onAttachCamera,
  onAttachFile,
  disabled,
}: ComposerToolsProps) {
  const { t } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleEsc);
    }
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const showAttachments =
    Boolean(onAttachPhoto || onAttachCamera || onAttachFile);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Attach or use tool"
        title="Attach or use tool"
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-30 ${
          open
            ? 'bg-white/[0.06] text-white rotate-45'
            : 'text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.04]'
        }`}
      >
        <Plus className="h-4 w-4 transition-transform duration-200" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-white/[0.06] bg-[#171C24] shadow-2xl overflow-hidden z-50"
            style={{ backdropFilter: 'blur(24px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.03]">
              <span className="text-[10px] font-semibold text-[#94A3B8] uppercase tracking-wider">{t('attachAndTools')}</span>
              <button onClick={() => setOpen(false)} className="text-[#94A3B8] hover:text-[#CBD5E1] transition-colors p-0.5 rounded" aria-label="Close menu">
                <X className="h-3 w-3" />
              </button>
            </div>

            <div className="p-2 space-y-3 max-h-[420px] overflow-y-auto scrollbar-thin">
              {/* Attachments — only rendered when the parent wired the
                  callbacks (i.e. PremiumComposer). Other consumers of
                  ComposerTools get a tools-only menu, unchanged. */}
              {showAttachments && (
                <div>
                  <div className="text-[9px] font-semibold text-[#94A3B8] uppercase tracking-wider px-2 mb-1">
                    {t('attachmentsHeader')}
                  </div>
                  <div className="space-y-0.5">
                    {onAttachCamera && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onAttachCamera(); setOpen(false); }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 hover:bg-white/[0.03]"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3B82F6]/[0.08] border border-[#3B82F6]/[0.12]">
                          <Camera className="h-3 w-3 text-[#3B82F6]/80" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-300">{t('attachTakePhoto')}</div>
                        </div>
                      </button>
                    )}
                    {onAttachFile && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { onAttachFile(); setOpen(false); }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 hover:bg-white/[0.03]"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#3B82F6]/[0.08] border border-[#3B82F6]/[0.12]">
                          <FolderOpen className="h-3 w-3 text-[#3B82F6]/80" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-300">{t('attachChooseFiles')}</div>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Tools — only the publicly-visible tools (Deep Research,
                  Code Mode). Web/live research runs automatically. */}
              <div>
                <div className="text-[9px] font-semibold text-[#94A3B8] uppercase tracking-wider px-2 mb-1">
                  {t('tools')}
                </div>
                <div className="space-y-0.5">
                  {VISIBLE_COMPOSER_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (!tool.soon) onSelectTool(tool);
                        setOpen(false);
                      }}
                      disabled={tool.soon}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all duration-150 ${
                        tool.soon
                          ? 'opacity-30 cursor-not-allowed'
                          : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.03] border border-white/[0.04]">
                        <tool.icon className="h-3 w-3 text-[#94A3B8]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                          {tool.labelKey ? t(tool.labelKey) : tool.label}
                          {tool.soon && (
                            <span className="text-[8px] px-1 py-[1px] rounded bg-white/[0.03] text-[#94A3B8] border border-white/[0.03]">{t('comingSoon')}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#94A3B8] leading-tight">{tool.descKey ? t(tool.descKey) : tool.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
