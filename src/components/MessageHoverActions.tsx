import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Wand2, ArrowRight, Lightbulb, Languages,
  ListTodo, Code2, Rocket, Check,
} from 'lucide-react';

interface MessageHoverActionsProps {
  content: string;
  onAction: (action: string, prompt: string) => void;
  isVisible: boolean;
}

const ACTIONS = [
  { id: 'copy', label: 'Copy', icon: Copy, prompt: '' },
  { id: 'improve', label: 'Improve', icon: Wand2, prompt: 'Improve and refine the following content to make it clearer and more impactful:\n\n' },
  { id: 'continue', label: 'Continue', icon: ArrowRight, prompt: 'Continue and expand on the following:\n\n' },
  { id: 'simplify', label: 'Explain Simpler', icon: Lightbulb, prompt: 'Explain the following in simpler terms that anyone can understand:\n\n' },
  { id: 'translate', label: 'Translate', icon: Languages, prompt: 'Translate the following into Spanish, French, and Japanese:\n\n' },
  { id: 'plan', label: 'Turn into Plan', icon: ListTodo, prompt: 'Convert the following into a structured action plan with steps and timelines:\n\n' },
  { id: 'code', label: 'Convert to Code', icon: Code2, prompt: 'Convert the following logic into clean, production-ready code:\n\n' },
  { id: 'pitch', label: 'Startup Pitch', icon: Rocket, prompt: 'Turn the following into a compelling startup pitch for investors:\n\n' },
];

export default function MessageHoverActions({ content, onAction, isVisible }: MessageHoverActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const handleAction = (actionId: string) => {
    if (actionId === 'copy') {
      handleCopy();
      return;
    }
    const action = ACTIONS.find((a) => a.id === actionId);
    if (action) {
      onAction(actionId, action.prompt + content);
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-0.5 px-0.5 py-1"
        >
          {ACTIONS.map((action) => (
            <motion.button
              key={action.id}
              onClick={() => handleAction(action.id)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-[#7F8FA3] hover:text-[#7EA6BF] hover:bg-[#7EA6BF]/[0.06] transition-all duration-150 border border-transparent hover:border-[#7EA6BF]/10"
              title={action.label}
            >
              {action.id === 'copy' && copied ? (
                <Check className="h-2.5 w-2.5 text-[#6F8F7A]" />
              ) : (
                <action.icon className="h-2.5 w-2.5" />
              )}
              <span className="hidden sm:inline">{action.id === 'copy' && copied ? 'Copied' : action.label}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
