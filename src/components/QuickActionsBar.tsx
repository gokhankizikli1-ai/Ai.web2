import { Lightbulb, FileText, Code, ListTodo } from 'lucide-react';

interface QuickActionsBarProps {
  onSelect: (text: string) => void;
}

const chips = [
  { label: 'Explain',   icon: Lightbulb, prompt: 'Explain this clearly: ' },
  { label: 'Summarize', icon: FileText,  prompt: 'Summarize the key points: ' },
  { label: 'Code',      icon: Code,      prompt: 'Write code for: ' },
  { label: 'Plan',      icon: ListTodo,  prompt: 'Create a plan for: ' },
];

export default function QuickActionsBar({ onSelect }: QuickActionsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">
      {chips.map((chip) => (
        <button
          key={chip.label}
          onClick={() => onSelect(chip.prompt)}
          className="flex items-center gap-1 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/[0.08] px-2.5 py-[5px] text-[11px] text-slate-500 hover:text-slate-300 transition-all duration-200"
        >
          <chip.icon className="h-3 w-3" />
          {chip.label}
        </button>
      ))}
    </div>
  );
}
