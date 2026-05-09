import { useState, useEffect, useMemo } from 'react';
import { Command } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export default function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [query, commands]);

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
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) {
          item.action();
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, filtered, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[20vh] bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl border border-white/[0.08] bg-[#0f0f16] shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.04]">
          <Command className="h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-[14px] text-white placeholder:text-slate-600 outline-none"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex items-center rounded-md bg-white/[0.05] border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-500 font-mono">
            ESC
          </kbd>
        </div>

        {/* Commands */}
        <div className="max-h-[320px] overflow-y-auto scrollbar-thin py-1.5">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-slate-600 text-[13px]">No commands found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              onClick={() => {
                item.action();
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-100 ${
                i === selectedIndex ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/[0.02]'
              }`}
            >
              <span className={i === selectedIndex ? 'text-cyan-400' : 'text-slate-600'}>
                {item.icon}
              </span>
              <span className="flex-1 text-[13px] font-medium">{item.label}</span>
              {item.shortcut && (
                <kbd className="hidden sm:inline-flex rounded bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-600 font-mono">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.04] text-[10px] text-slate-700">
          <span>{filtered.length} commands</span>
          <div className="flex items-center gap-3">
            <span>Navigate <kbd className="font-mono bg-white/[0.04] px-1 rounded">↑↓</kbd></span>
            <span>Select <kbd className="font-mono bg-white/[0.04] px-1 rounded">↵</kbd></span>
          </div>
        </div>
      </div>
    </div>
  );
}
