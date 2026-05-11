import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Paperclip, Search, Brain, Image as ImageIcon,
  Sparkles, BarChart3, ShoppingBag, Rocket,
  Code, Volume2, X, Globe, Wrench, TrendingUp,
} from 'lucide-react';

export interface ComposerTool {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  chip: string;
  placeholder: string;
  category: string;
  soon?: boolean;
}

export const COMPOSER_TOOLS: ComposerTool[] = [
  // Research
  { id: 'web', label: 'Search Web', description: 'Real-time web search', icon: Globe, chip: 'Web Search', placeholder: 'Ask KorvixAI to search the web for...', category: 'Research' },
  { id: 'research', label: 'Deep Research', description: 'Multi-source research', icon: Brain, chip: 'Deep Research', placeholder: 'Ask KorvixAI to research deeply about...', category: 'Research' },
  // Analysis
  { id: 'chart', label: 'Create Chart', description: 'Data visualizations', icon: BarChart3, chip: 'Chart', placeholder: 'Describe the data you want to visualize...', category: 'Analysis' },
  { id: 'market', label: 'Analyze Market', description: 'Financial analysis', icon: TrendingUp, chip: 'Market Analysis', placeholder: 'Ask KorvixAI to analyze the market for...', category: 'Analysis' },
  { id: 'product', label: 'Product Research', description: 'E-commerce intelligence', icon: ShoppingBag, chip: 'Product Research', placeholder: 'Ask KorvixAI to research products...', category: 'Analysis' },
  // Code & Content
  { id: 'code', label: 'Code Mode', description: 'Coding assistant', icon: Code, chip: 'Code Mode', placeholder: 'Write, debug, or refactor code...', category: 'Code & Content' },
  { id: 'attach', label: 'Attach File', description: 'Upload a document', icon: Paperclip, chip: 'File', placeholder: 'Describe what you want to do with this file...', category: 'Code & Content' },
  // Generate
  { id: 'generate', label: 'Generate Image', description: 'Create from text', icon: Sparkles, chip: 'Image Gen', placeholder: 'Describe the image you want to generate...', category: 'Generate', soon: true },
  { id: 'image', label: 'Analyze Image', description: 'Upload and analyze', icon: ImageIcon, chip: 'Image', placeholder: 'Describe what to analyze in the image...', category: 'Generate', soon: true },
  { id: 'voice', label: 'Voice Input', description: 'Speak your message', icon: Volume2, chip: 'Voice', placeholder: 'Speak your message...', category: 'Generate', soon: true },
  // Business
  { id: 'startup', label: 'Startup Scanner', description: 'Discover opportunities', icon: Rocket, chip: 'Startup Scan', placeholder: 'Ask KorvixAI to scan startups in...', category: 'Business' },
  { id: 'shopify', label: 'Shopify Task', description: 'E-commerce automation', icon: Wrench, chip: 'Shopify', placeholder: 'Describe the Shopify task you need...', category: 'Business', soon: true },
];

const CATEGORIES = ['Research', 'Analysis', 'Code & Content', 'Generate', 'Business'];

interface ComposerToolsProps {
  onSelectTool: (tool: ComposerTool) => void;
}

export default function ComposerTools({ onSelectTool }: ComposerToolsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
          open
            ? 'bg-white/[0.06] text-white rotate-45'
            : 'text-slate-600 hover:text-slate-400 hover:bg-white/[0.04]'
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
            className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-white/[0.06] bg-[#0c0c10] shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.03]">
              <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Tools</span>
              <button onClick={() => setOpen(false)} className="text-slate-700 hover:text-slate-400 transition-colors p-0.5 rounded">
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Grouped tools */}
            <div className="p-2 space-y-3 max-h-[360px] overflow-y-auto scrollbar-thin">
              {CATEGORIES.map((category) => {
                const tools = COMPOSER_TOOLS.filter((t) => t.category === category);
                return (
                  <div key={category}>
                    <div className="text-[9px] font-semibold text-slate-700 uppercase tracking-wider px-2 mb-1">
                      {category}
                    </div>
                    <div className="space-y-0.5">
                      {tools.map((tool) => (
                        <button
                          key={tool.id}
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
                            <tool.icon className="h-3 w-3 text-slate-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                              {tool.label}
                              {tool.soon && (
                                <span className="text-[8px] px-1 py-[1px] rounded bg-white/[0.03] text-slate-700 border border-white/[0.03]">Soon</span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-600 leading-tight">{tool.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
