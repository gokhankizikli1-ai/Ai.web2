import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Sparkles, Bookmark, Settings,
  Download, ArrowRight, Home,
  TrendingUp, Building2, Terminal,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

const ICON_MAP: Record<string, React.ReactNode> = {
  'new-chat': <Sparkles className="h-4 w-4" />,
  'prompts': <Bookmark className="h-4 w-4" />,
  'settings': <Settings className="h-4 w-4" />,
  'export': <Download className="h-4 w-4" />,
  'trading': <TrendingUp className="h-4 w-4" />,
  'business': <Building2 className="h-4 w-4" />,
  'home': <Home className="h-4 w-4" />,
};

function PaletteIcon({ id, selected }: { id: string; selected: boolean }) {
  const icon = ICON_MAP[id];
  if (!icon) return <Terminal className="h-4 w-4 text-slate-600" />;
  return (
    <span className={selected ? 'text-[#52677A]' : 'text-slate-600'}>
      {icon}
    </span>
  );
}

export default function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Group commands by category
  const grouped = useMemo(() => {
    const filtered = !query
      ? commands
      : commands.filter((c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.category.toLowerCase().includes(query.toLowerCase())
        );

    const groups: Record<string, CommandItem[]> = {};
    filtered.forEach((c) => {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    });
    return groups;
  }, [query, commands]);

  const flatItems = useMemo(() => {
    const items: { item: CommandItem; category: string }[] = [];
    Object.entries(grouped).forEach(([category, groupItems]) => {
      groupItems.forEach((item) => items.push({ item, category }));
    });
    return items;
  }, [grouped]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[selectedIndex];
        if (item) {
          item.item.action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, flatItems, selectedIndex, onClose]);

  if (!open) return null;

  let globalIndex = 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[15vh] bg-[#0a0f1a]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] bg-[#171C24] shadow-2xl shadow-[#0a0f1a]/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.04]">
          <Search className="h-4.5 w-4.5 text-slate-600" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-[#64748B] outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[10px] text-slate-600 font-mono">
            ESC
          </kbd>
        </div>

        {/* Commands */}
        <div className="max-h-[380px] overflow-y-auto scrollbar-thin py-2">
          {flatItems.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <Search className="h-8 w-8 text-[#94A3B8] mb-3" />
              <p className="text-[13px] text-slate-600 mb-1">No commands found</p>
              <p className="text-[11px] text-[#94A3B8]">Try a different search term</p>
            </div>
          )}

          {Object.entries(grouped).map(([category, groupItems]) => {
            const groupStart = globalIndex;
            return (
              <div key={category} className="mb-1">
                <div className="px-5 py-1.5 flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">{category}</span>
                  <div className="flex-1 h-px bg-white/[0.03]" />
                </div>
                {groupItems.map((item) => {
                  const idx = groupStart + groupItems.indexOf(item);
                  if (groupItems.indexOf(item) === groupItems.length - 1) globalIndex = idx + 1;
                  const isSelected = idx === selectedIndex;

                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => {
                        item.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      initial={false}
                      animate={{
                        backgroundColor: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                        x: isSelected ? 0 : 0,
                      }}
                      transition={{ duration: 0.1 }}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors duration-100 ${
                        isSelected ? 'text-white' : 'text-slate-400 hover:text-slate-300'
                      }`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        isSelected ? 'bg-[#52677A]/10' : 'bg-white/[0.02]'
                      }`}>
                        <PaletteIcon id={item.id} selected={isSelected} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium">{item.label}</div>
                        {item.shortcut && (
                          <div className="text-[11px] text-slate-600">{item.shortcut}</div>
                        )}
                      </div>
                      {isSelected && (
                        <motion.div
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-center gap-1 text-slate-600"
                        >
                          <span className="text-[10px]">Open</span>
                          <ArrowRight className="h-3 w-3" />
                        </motion.div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.04] bg-white/[0.01]">
          <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-white/[0.04] px-1 rounded">↑↓</kbd> to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-white/[0.04] px-1 rounded">↵</kbd> to select
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-white/[0.04] px-1 rounded">ESC</kbd> close
            </span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
