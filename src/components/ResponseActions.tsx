import { ArrowDown, ArrowUp, FileText, List, Languages } from 'lucide-react';

interface ResponseActionsProps {
  onAction: (action: string) => void;
}

const actions = [
  { id: 'shorter', label: 'Shorter', icon: ArrowDown, prompt: 'Make this response shorter and more concise.' },
  { id: 'detailed', label: 'More detail', icon: ArrowUp, prompt: 'Provide a more detailed and comprehensive response.' },
  { id: 'example', label: 'Example', icon: FileText, prompt: 'Give me a concrete example to illustrate this.' },
  { id: 'step', label: 'Step-by-step', icon: List, prompt: 'Break this down into clear step-by-step instructions.' },
  { id: 'translate', label: 'Translate', icon: Languages, prompt: 'Translate this to ' },
];

export default function ResponseActions({ onAction }: ResponseActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 mt-2.5">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.prompt)}
          className="flex items-center gap-1 rounded-md bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.08] px-2 py-[3px] text-[10px] text-slate-500 hover:text-slate-300 transition-all duration-200"
        >
          <action.icon className="h-2.5 w-2.5" />
          {action.label}
        </button>
      ))}
    </div>
  );
}
