import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, Lock } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  externalValue?: string;
  onExternalValueChange?: (value: string) => void;
}

export default function ChatInput({ onSend, disabled, externalValue, onExternalValueChange }: ChatInputProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const setValue = onExternalValueChange || setInternalValue;

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
    <div>
      <div
        className={`relative flex items-end gap-1.5 rounded-[20px] bg-white/[0.03] border p-2 md:p-2.5 transition-all duration-300 ${
          isFocused
            ? 'border-[#7EA6BF]/25 bg-white/[0.05] shadow-[0_0_0_1px_rgba(126, 166, 191,0.06),0_0_20px_-5px_rgba(126, 166, 191,0.08)]'
            : 'border-white/[0.07] hover:border-white/[0.12]'
        }`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8 text-[#7F8FA3] hover:text-white hover:bg-white/[0.06] rounded-[10px] transition-all duration-200"
        >
          <Paperclip className="h-[15px] w-[15px]" />
        </Button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Message KorvixAI..."
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent text-[14px] text-white placeholder:text-[#7F8FA3] resize-none outline-none min-h-[20px] max-h-[200px] py-[7px] leading-[1.5] disabled:opacity-50 transition-opacity"
        />

        <Button
          variant="ghost"
          size="icon"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="shrink-0 h-8 w-8 bg-[#7EA6BF]/15 text-[#7EA6BF] hover:bg-[#7EA6BF]/25 hover:text-[#8FB4CC] disabled:opacity-25 disabled:hover:bg-[#7EA6BF]/15 rounded-[10px] transition-all duration-200"
        >
          <Send className="h-[15px] w-[15px]" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2.5 mt-2">
        <p className="text-center text-[10px] text-[#7F8FA3]">KorvixAI can make mistakes. Verify important information.</p>
        <span className="hidden sm:inline text-[#A9B7C6]">|</span>
        <div className="flex items-center gap-1 text-[10px] text-[#7F8FA3]">
          <Lock className="h-2.5 w-2.5" />
          <span>Your chats are private to your session</span>
        </div>
      </div>
    </div>
  );
}
