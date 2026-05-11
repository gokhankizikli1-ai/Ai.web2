import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Command } from 'lucide-react';
import ComposerTools, { type ComposerTool } from './ComposerTools';
import ToolChips from './ToolChips';

interface PremiumComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  activeTools: ComposerTool[];
  onAddTool: (tool: ComposerTool) => void;
  onRemoveTool: (tool: ComposerTool) => void;
  externalValue?: string;
  onExternalValueChange?: (value: string) => void;
}

export default function PremiumComposer({
  onSend,
  disabled,
  activeTools,
  onAddTool,
  onRemoveTool,
  externalValue,
  onExternalValueChange,
}: PremiumComposerProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const setValue = onExternalValueChange || setInternalValue;

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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

  const handleToolSelect = useCallback((tool: ComposerTool) => {
    onAddTool(tool);
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) el.focus();
    }, 50);
  }, [onAddTool]);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Tool Chips */}
      <ToolChips tools={activeTools} onRemove={onRemoveTool} />

      {/* Flat composer - no glow */}
      <div
        className={`relative rounded-2xl bg-white/[0.015] border transition-all duration-200 ${
          isFocused
            ? 'border-white/[0.1] bg-white/[0.025]'
            : 'border-white/[0.05] hover:border-white/[0.07]'
        }`}
      >
        {/* Top bar */}
        <div className="flex items-center gap-1 px-3 pt-2 pb-1">
          <ComposerTools onSelectTool={handleToolSelect} />
          {activeTools.length === 0 && (
            <span className="text-[11px] text-slate-700 ml-1.5">Add tool</span>
          )}
        </div>

        {/* Textarea */}
        <div className="px-3 pb-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={activeTools.length > 0
              ? `Using ${activeTools.map((t) => t.chip).join(', ')}...`
              : 'Message KorvixAI...'
            }
            rows={1}
            disabled={disabled}
            className="w-full bg-transparent text-[14px] text-white placeholder:text-slate-700 resize-none outline-none min-h-[28px] max-h-[200px] py-1 leading-[1.6] disabled:opacity-40 transition-opacity"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <div className="flex items-center gap-1 text-[11px] text-slate-700">
            <Command className="h-2.5 w-2.5" />
            <span>K to focus</span>
          </div>

          <motion.button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            whileTap={{ scale: 0.94 }}
            className={`flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-200 ${
              value.trim() && !disabled
                ? 'bg-white/[0.08] text-white hover:bg-white/[0.12]'
                : 'bg-white/[0.02] text-slate-700'
            } disabled:opacity-30`}
          >
            <Send className="h-[14px] w-[14px]" />
          </motion.button>
        </div>
      </div>

      {/* Trust footer */}
      <div className="flex items-center justify-center mt-2">
        <span className="text-[11px] text-slate-700">KorvixAI can make mistakes. Verify important information.</span>
      </div>
    </div>
  );
}
