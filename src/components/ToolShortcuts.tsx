import { motion } from 'framer-motion';
import {
  Lightbulb, Search, Code, BarChart3, ListTodo,
  Compass, TrendingUp, Rocket, ShoppingBag,
} from 'lucide-react';

export interface ToolShortcut {
  id: string;
  label: string;
  icon: typeof Lightbulb;
  prompt: string;
  color: string;
}

const SHORTCUTS: ToolShortcut[] = [
  { id: 'explain', label: 'Explain', icon: Lightbulb, prompt: 'Explain this clearly: ', color: 'hover:text-cyan-400 hover:bg-cyan-500/[0.05] hover:border-cyan-500/[0.1]' },
  { id: 'research', label: 'Research', icon: Search, prompt: 'Research this topic in depth: ', color: 'hover:text-violet-400 hover:bg-violet-500/[0.05] hover:border-violet-500/[0.1]' },
  { id: 'code', label: 'Code', icon: Code, prompt: 'Write code for: ', color: 'hover:text-emerald-400 hover:bg-emerald-500/[0.05] hover:border-emerald-500/[0.1]' },
  { id: 'analyze', label: 'Analyze', icon: BarChart3, prompt: 'Analyze this in detail: ', color: 'hover:text-amber-400 hover:bg-amber-500/[0.05] hover:border-amber-500/[0.1]' },
  { id: 'plan', label: 'Plan', icon: ListTodo, prompt: 'Create a plan for: ', color: 'hover:text-blue-400 hover:bg-blue-500/[0.05] hover:border-blue-500/[0.1]' },
  { id: 'create', label: 'Create', icon: Compass, prompt: 'Create: ', color: 'hover:text-rose-400 hover:bg-rose-500/[0.05] hover:border-rose-500/[0.1]' },
  { id: 'trade', label: 'Trade', icon: TrendingUp, prompt: 'Analyze the trading opportunity for: ', color: 'hover:text-green-400 hover:bg-green-500/[0.05] hover:border-green-500/[0.1]' },
  { id: 'startup', label: 'Startup', icon: Rocket, prompt: 'Evaluate this startup idea: ', color: 'hover:text-purple-400 hover:bg-purple-500/[0.05] hover:border-purple-500/[0.1]' },
  { id: 'ecommerce', label: 'Ecommerce', icon: ShoppingBag, prompt: 'Research this product/market: ', color: 'hover:text-orange-400 hover:bg-orange-500/[0.05] hover:border-orange-500/[0.1]' },
];

interface ToolShortcutsProps {
  activeTools: string[];
  onSelect: (shortcut: ToolShortcut) => void;
}

export default function ToolShortcuts({ activeTools, onSelect }: ToolShortcutsProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1 px-1">
      {SHORTCUTS.map((shortcut) => {
        const isActive = activeTools.includes(shortcut.id);
        return (
          <motion.button
            key={shortcut.id}
            onClick={() => onSelect(shortcut)}
            whileTap={{ scale: 0.95 }}
            className={`shrink-0 flex items-center gap-1 rounded-lg border px-2 py-[3px] text-[10px] font-medium transition-all duration-200 ${
              isActive
                ? 'bg-white/[0.06] text-white border-white/[0.1]'
                : `text-slate-600 border-white/[0.03] ${shortcut.color}`
            }`}
          >
            <shortcut.icon className="h-2.5 w-2.5" />
            {shortcut.label}
          </motion.button>
        );
      })}
    </div>
  );
}
