import { useState, useRef, useEffect } from 'react';
import { Zap, Brain, Search, Palette, Code, GraduationCap, Check } from 'lucide-react';
import type { AIMode } from '@/types';

const MODES: { id: AIMode; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'fast', label: 'Fast', description: 'Quick responses, ideal for short queries', icon: <Zap className="h-3.5 w-3.5" /> },
  { id: 'deep-think', label: 'Deep Think', description: 'Thorough analysis and reasoning', icon: <Brain className="h-3.5 w-3.5" /> },
  { id: 'research', label: 'Research', description: 'Detailed research-backed responses', icon: <Search className="h-3.5 w-3.5" /> },
  { id: 'creative', label: 'Creative', description: 'Imaginative writing and ideation', icon: <Palette className="h-3.5 w-3.5" /> },
  { id: 'coding', label: 'Coding', description: 'Optimized for code and technical tasks', icon: <Code className="h-3.5 w-3.5" /> },
  { id: 'study', label: 'Study', description: 'Educational explanations and learning', icon: <GraduationCap className="h-3.5 w-3.5" /> },
];

interface AIModeSelectorProps {
  currentMode: AIMode;
  onModeChange: (mode: AIMode) => void;
}

export default function AIModeSelector({ currentMode, onModeChange }: AIModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = MODES.find((m) => m.id === currentMode) || MODES[0];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.1] px-2.5 py-[5px] transition-all duration-200"
        title={`Mode: ${current.label}`}
      >
        <span className="text-cyan-400/70">{current.icon}</span>
        <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">{current.label}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-52 rounded-xl border border-white/[0.08] bg-[#0f0f16] backdrop-blur-xl shadow-2xl z-50 py-1.5 animate-fade-in">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => {
                onModeChange(mode.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 ${
                currentMode === mode.id
                  ? 'bg-white/[0.05] text-white'
                  : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
              }`}
            >
              <span className={currentMode === mode.id ? 'text-cyan-400' : 'text-slate-600'}>
                {mode.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium flex items-center gap-1.5">
                  {mode.label}
                  {currentMode === mode.id && (
                    <Check className="h-3 w-3 text-cyan-400" />
                  )}
                </div>
                <div className="text-[10px] text-slate-600 leading-tight">{mode.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
