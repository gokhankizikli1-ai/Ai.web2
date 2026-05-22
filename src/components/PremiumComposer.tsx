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

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Tool Chips */}
      <ToolChips tools={activeTools} onRemove={onRemoveTool} />

      {/* Premium composer with focus glow */}
      <motion.div
        animate={{
          boxShadow: isFocused
            ? '0 0 0 1px rgba(255,255,255,0.08), 0 0 20px -4px rgba(34,211,238,0.06)'
            : '0 0 0 1px transparent, 0 1px 3px rgba(0,0,0,0.1)',
        }}
        transition={{ duration: 0.2 }}
        className={`relative rounded-2xl border transition-all duration-300 ${
          isFocused
            ? 'border-cyan-500/15'
            : 'border-white/[0.05] hover:border-white/[0.07]'
        }`}
        style={{
          background: isFocused ? 'rgba(27,34,48,0.6)' : 'rgba(27,34,48,0.4)',
          backdropFilter: 'blur(20px)',
          boxShadow: isFocused
            ? '0 0 24px -6px rgba(34,211,238,0.08), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 4px 16px -8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)',
        }}
      >
        {/* Top bar — tools */}
        <div className="flex items-center gap-1 px-3 pt-2 pb-1">
          <ComposerTools onSelectTool={handleToolSelect} />
          {activeTools.length === 0 && (
            <span className="text-[11px] text-[#64748B] ml-1.5">Add tool</span>
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
            className="w-full bg-transparent text-[14px] text-slate-200 placeholder:text-slate-600/40 resize-none outline-none min-h-[28px] max-h-[200px] py-1 leading-[1.6] disabled:opacity-40 transition-opacity"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <div className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(148,163,184,0.2)' }}>
            <Command className="h-2.5 w-2.5" />
            <span>K to focus</span>
          </div>

          {/* Premium send button */}
          <motion.button
            onClick={handleSubmit}
            disabled={!canSend}
            whileHover={canSend ? { scale: 1.06 } : {}}
            whileTap={canSend ? { scale: 0.92 } : {}}
            animate={{
              backgroundColor: canSend ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
              boxShadow: canSend
                ? '0 0 12px -2px rgba(34,211,238,0.15)'
                : 'none',
            }}
            transition={{ duration: 0.2 }}
            className={`flex items-center justify-center h-8 w-8 rounded-xl transition-all duration-200 ${
              canSend
                ? 'text-white hover:text-cyan-300'
                : 'text-[#64748B]'
            } disabled:opacity-30`}
          >
            <Send className="h-[15px] w-[15px]" />
          </motion.button>
        </div>
      </motion.div>

      {/* Trust footer */}
      <div className="flex items-center justify-center mt-2">
        <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.2)' }}>KorvixAI can make mistakes. Verify important information.</span>
      </div>
    </div>
  );
}
