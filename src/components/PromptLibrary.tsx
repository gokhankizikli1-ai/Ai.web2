import { useState } from 'react';
import { Search, X, Bookmark } from 'lucide-react';
import { promptLibrary } from '@/data/promptLibrary';

interface PromptLibraryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
}

const categories = [...new Set(promptLibrary.map((p) => p.category))];

export default function PromptLibrary({ open, onClose, onSelect }: PromptLibraryProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  if (!open) return null;

  const filtered = promptLibrary.filter((p) => {
    const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
    const matchesQuery = !query || p.title.toLowerCase().includes(query.toLowerCase()) || p.content.toLowerCase().includes(query.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0a0f1a]/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] bg-[#171C24] shadow-2xl overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-[#52677A]" />
            <h3 className="text-sm font-semibold text-white">Prompt Library</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 rounded-md hover:bg-white/[0.05]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 focus-within:border-[#52677A]/20 transition-colors">
            <Search className="h-3.5 w-3.5 text-slate-600" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search prompts..."
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-slate-600 outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Categories */}
        <div className="flex items-center gap-1 px-5 pb-3 overflow-x-auto scrollbar-thin">
          <button
            onClick={() => setActiveCategory('All')}
            className={`shrink-0 rounded-lg px-2.5 py-[3px] text-[11px] font-medium transition-all duration-200 ${
              activeCategory === 'All' ? 'bg-white/[0.07] text-white border border-white/[0.08]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 rounded-lg px-2.5 py-[3px] text-[11px] font-medium transition-all duration-200 ${
                activeCategory === cat ? 'bg-white/[0.07] text-white border border-white/[0.08]' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Prompts list */}
        <div className="max-h-[320px] overflow-y-auto scrollbar-thin px-5 pb-5">
          <div className="space-y-1">
            {filtered.map((prompt) => (
              <button
                key={prompt.id}
                onClick={() => {
                  onSelect(prompt.content);
                  onClose();
                }}
                className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/[0.04] transition-all duration-150 group"
              >
                <div className="text-[13px] font-medium text-slate-300 group-hover:text-white transition-colors">
                  {prompt.title}
                </div>
                <div className="text-[11px] text-slate-600 truncate mt-0.5">{prompt.content}</div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-slate-600 text-[13px]">No prompts found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
