import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, TrendingUp, Globe, FileText, Code,
  Zap, BarChart3, Search, Sparkles, Lightbulb,
} from 'lucide-react';

interface Suggestion {
  icon: typeof Brain;
  label: string;
  prompt: string;
  color: string;
  bg: string;
  border: string;
}

const CHAT_SUGGESTIONS: Suggestion[] = [
  { icon: Brain, label: 'Deep analysis', prompt: 'Analyze the implications of AI on software development in the next 5 years', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: Globe, label: 'Research', prompt: 'Research the latest developments in quantum computing and their practical applications', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: Code, label: 'Coding', prompt: 'Write a clean, production-ready React hook for real-time WebSocket data management', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: TrendingUp, label: 'Market', prompt: 'Analyze the current tech sector trends and identify potential investment opportunities', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: FileText, label: 'Document', prompt: 'Summarize the key points from this topic and create an executive summary format', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: BarChart3, label: 'Strategy', prompt: 'Create a step-by-step strategy for launching a SaaS product in the AI space', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
];

const RESEARCH_SUGGESTIONS: Suggestion[] = [
  { icon: Search, label: 'Deep dive', prompt: 'Conduct comprehensive research on the latest LLM architectures and their trade-offs', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: Globe, label: 'Sources', prompt: 'Find the most cited academic papers on transformer models from 2024', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
  { icon: Sparkles, label: 'Compare', prompt: 'Compare GPT-4, Claude, and Gemini across reasoning, coding, and creative tasks', color: 'text-[#8B5CF6]', bg: 'bg-[#8B5CF6]/[0.04]', border: 'border-[#8B5CF6]/10' },
];

interface SmartSuggestionsProps {
  variant?: 'chat' | 'research' | 'trading' | 'workspace';
  onSelect: (prompt: string) => void;
}

export default function SmartSuggestions({ variant = 'chat', onSelect }: SmartSuggestionsProps) {
  const suggestions = variant === 'research' ? RESEARCH_SUGGESTIONS : CHAT_SUGGESTIONS;
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto-rotate suggestions every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [suggestions.length]);

  return (
    <div className="w-full">
      {/* Rotating featured suggestion */}
      <div className="relative h-9 mb-3 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.button
            key={activeIndex}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            onClick={() => onSelect(suggestions[activeIndex].prompt)}
            className={`absolute inset-x-0 flex items-center gap-2 rounded-xl ${suggestions[activeIndex].bg} ${suggestions[activeIndex].border} border px-3 py-2 transition-all hover:bg-opacity-80 text-left`}
          >
            <Lightbulb className={`h-3 w-3 ${suggestions[activeIndex].color} shrink-0`} />
            <span className="text-[11px] text-[#B6BBC6] truncate flex-1">{suggestions[activeIndex].prompt}</span>
            <Zap className="h-3 w-3 text-[#858B99] shrink-0" />
          </motion.button>
        </AnimatePresence>
      </div>

      {/* Grid of suggestion cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {suggestions.slice(0, 6).map((s, i) => (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.25 }}
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(s.prompt)}
            className={`flex items-center gap-2 rounded-xl ${s.bg} ${s.border} border px-3 py-2.5 transition-all duration-200 hover:shadow-[0_0_12px_-3px_rgba(0,0,0,0.15)] text-left`}
          >
            <s.icon className={`h-3.5 w-3.5 ${s.color} shrink-0`} />
            <span className="text-[11px] text-[#B6BBC6]">{s.label}</span>
          </motion.button>
        ))}
      </div>

      {/* Dot indicators */}
      <div className="flex items-center justify-center gap-1 mt-3">
        {suggestions.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIndex(i)}
            className={`rounded-full transition-all duration-300 ${
              i === activeIndex ? 'w-4 h-1 bg-[#8B5CF6]/50' : 'w-1 h-1 bg-slate-800 hover:bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
