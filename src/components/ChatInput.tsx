import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Paperclip } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <div className="border-t border-white/10 bg-[#0a0a0f]/80 backdrop-blur-xl p-4">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 focus-within:border-cyan-500/30 focus-within:bg-white/[0.07] transition-all">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 text-slate-500 hover:text-white hover:bg-white/5"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Velora AI..."
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 resize-none outline-none min-h-[20px] max-h-[200px] py-1.5"
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            className="shrink-0 h-8 w-8 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 hover:text-cyan-300 disabled:opacity-30 disabled:hover:bg-cyan-500/20"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-2">
          Velora AI can make mistakes. Consider checking important information.
        </p>
      </div>
    </div>
  );
}
