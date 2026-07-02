import { motion } from 'framer-motion';
import {
  Brain, Search, Code2, TrendingUp,
} from 'lucide-react';

export interface ToolShortcut {
  id: string;
  label: string;
  icon: typeof Brain;
  prompt: string;
  color: string;
}

const SHORTCUTS: ToolShortcut[] = [
  { id: 'deep-think', label: 'Deep Think', icon: Brain, prompt: 'Think deeply and analyze this thoroughly before answering: ', color: 'hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.05] hover:border-[#3B82F6]/[0.1]' },
  { id: 'research',   label: 'Research',   icon: Search,    prompt: 'Research this topic in depth: ', color: 'hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.05] hover:border-[#3B82F6]/[0.1]' },
  { id: 'code',       label: 'Coding',     icon: Code2,     prompt: 'Write clean, well-documented code for: ', color: 'hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.05] hover:border-[#3B82F6]/[0.1]' },
  { id: 'market',     label: 'Market',     icon: TrendingUp, prompt: 'Analyze market trends and signals for: ', color: 'hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.05] hover:border-[#3B82F6]/[0.1]' },
];

interface ToolShortcutsProps {
  activeTools: string[];
  onSelect: (shortcut: ToolShortcut) => void;
}

export default function ToolShortcuts({ activeTools, onSelect }: ToolShortcutsProps) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      {SHORTCUTS.map((shortcut) => {
        const isActive = activeTools.includes(shortcut.id);
        return (
          <motion.button
            key={shortcut.id}
            onClick={() => onSelect(shortcut)}
            whileTap={{ scale: 0.95 }}
            className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-[5px] text-[11px] font-medium transition-all duration-200 ${
              isActive
                ? 'bg-white/[0.06] text-white border-white/[0.1]'
                : `text-[#94A3B8] border-white/[0.03] ${shortcut.color}`
            }`}
          >
            <shortcut.icon className="h-3 w-3" />
            {shortcut.label}
          </motion.button>
        );
      })}
    </div>
  );
}
