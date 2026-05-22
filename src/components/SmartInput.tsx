import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Paperclip, Command, AtSign, Hash } from 'lucide-react';

interface SmartInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  externalValue?: string;
  onExternalValueChange?: (value: string) => void;
}

const SLASH_COMMANDS = [
  { command: '/code', label: 'Code Mode', description: 'Switch to coding assistant', insert: 'Write a function that ' },
  { command: '/explain', label: 'Explain', description: 'Explain like I am 5', insert: 'Explain this to me in simple terms: ' },
  { command: '/research', label: 'Deep Research', description: 'Comprehensive topic analysis', insert: 'Conduct a deep research analysis on: ' },
  { command: '/brainstorm', label: 'Brainstorm', description: 'Generate ideas', insert: 'Brainstorm ideas for: ' },
  { command: '/refactor', label: 'Refactor', description: 'Improve code quality', insert: 'Refactor this code to be cleaner: ' },
  { command: '/summarize', label: 'Summarize', description: 'Condense information', insert: 'Summarize the key points: ' },
  { command: '/translate', label: 'Translate', description: 'Multi-language translation', insert: 'Translate the following to Spanish: ' },
  { command: '/debug', label: 'Debug', description: 'Find and fix bugs', insert: 'Debug this code and explain the issue: ' },
];

const MENTIONS = [
  { name: 'CodeReviewer', label: 'Code Reviewer', description: 'Review code quality' },
  { name: 'ResearchAnalyst', label: 'Research Analyst', description: 'Deep topic research' },
  { name: 'DocWriter', label: 'Doc Writer', description: 'Generate documentation' },
  { name: 'TestEngineer', label: 'Test Engineer', description: 'Create test cases' },
  { name: 'SecurityAuditor', label: 'Security Auditor', description: 'Security analysis' },
];

export default function SmartInput({ onSend, disabled, externalValue, onExternalValueChange }: SmartInputProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const setValue = onExternalValueChange || setInternalValue;

  const filteredSlash = slashQuery
    ? SLASH_COMMANDS.filter((c) => c.command.includes(slashQuery) || c.label.toLowerCase().includes(slashQuery.toLowerCase()))
    : SLASH_COMMANDS;

  const filteredMentions = mentionQuery
    ? MENTIONS.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()) || m.label.toLowerCase().includes(mentionQuery.toLowerCase()))
    : MENTIONS;

  const handleSubmit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
    setShowSlashMenu(false);
    setShowMentionMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu || showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, (showSlashMenu ? filteredSlash : filteredMentions).length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (showSlashMenu && filteredSlash[selectedIndex]) {
          insertText(filteredSlash[selectedIndex].insert);
          setShowSlashMenu(false);
        } else if (showMentionMenu && filteredMentions[selectedIndex]) {
          insertText(`@${filteredMentions[selectedIndex].name} `);
          setShowMentionMenu(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const insertText = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) { setValue(text); return; }

    const start = textarea.selectionStart || 0;
    const before = value.slice(0, start);
    const after = value.slice(start);

    // Remove the trigger character(s)
    const cleanBefore = before.replace(/[/@][^\s]*$/, '');
    const newValue = cleanBefore + text + after;
    setValue(newValue);

    setTimeout(() => {
      const newPos = cleanBefore.length + text.length;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    }, 10);
  }, [value, setValue]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setValue(val);

    const cursorPos = e.target.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);
    const lastSlash = beforeCursor.lastIndexOf('/');
    const lastAt = beforeCursor.lastIndexOf('@');
    const lastSpace = beforeCursor.lastIndexOf(' ');

    if (lastSlash > lastSpace && lastSlash > lastAt) {
      const query = beforeCursor.slice(lastSlash + 1);
      if (!query.includes(' ')) {
        setSlashQuery(query);
        setShowSlashMenu(true);
        setShowMentionMenu(false);
        setSelectedIndex(0);
      }
    } else if (lastAt > lastSpace && lastAt > lastSlash) {
      const query = beforeCursor.slice(lastAt + 1);
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setShowMentionMenu(true);
        setShowSlashMenu(false);
        setSelectedIndex(0);
      }
    } else {
      setShowSlashMenu(false);
      setShowMentionMenu(false);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <div className="relative">
      {/* Slash command menu */}
      <AnimatePresence>
        {showSlashMenu && filteredSlash.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-white/[0.06] bg-[#171C24] backdrop-blur-xl shadow-2xl overflow-hidden z-30"
          >
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.03]">
              <Command className="h-3 w-3 text-slate-600" />
              <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">Commands</span>
            </div>
            <div className="max-h-[200px] overflow-y-auto scrollbar-thin py-1">
              {filteredSlash.map((cmd, i) => (
                <button
                  key={cmd.command}
                  onClick={() => { insertText(cmd.insert); setShowSlashMenu(false); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all ${
                    i === selectedIndex ? 'bg-white/[0.05] text-white' : 'text-slate-400 hover:bg-white/[0.02]'
                  }`}
                >
                  <span className="text-[11px] font-mono text-cyan-400/60 shrink-0">{cmd.command}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium">{cmd.label}</div>
                    <div className="text-[10px] text-slate-600">{cmd.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mention menu */}
      <AnimatePresence>
        {showMentionMenu && filteredMentions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-white/[0.06] bg-[#171C24] backdrop-blur-xl shadow-2xl overflow-hidden z-30"
          >
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.03]">
              <AtSign className="h-3 w-3 text-slate-600" />
              <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">Agents</span>
            </div>
            <div className="max-h-[200px] overflow-y-auto scrollbar-thin py-1">
              {filteredMentions.map((m, i) => (
                <button
                  key={m.name}
                  onClick={() => { insertText(`@${m.name} `); setShowMentionMenu(false); }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all ${
                    i === selectedIndex ? 'bg-white/[0.05] text-white' : 'text-slate-400 hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 shrink-0">
                    <Hash className="h-3.5 w-3.5 text-cyan-400/50" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium">{m.label}</div>
                    <div className="text-[10px] text-slate-600">{m.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input */}
      <div
        className={`relative flex items-end gap-1.5 rounded-[20px] bg-white/[0.03] border p-2 md:p-2.5 transition-all duration-300 ${
          isFocused && !showSlashMenu && !showMentionMenu
            ? 'border-cyan-500/25 bg-white/[0.05] shadow-[0_0_0_1px_rgba(34,211,238,0.06),0_0_20px_-5px_rgba(34,211,238,0.08)]'
            : 'border-white/[0.07] hover:border-white/[0.12]'
        } ${(showSlashMenu || showMentionMenu) ? 'border-cyan-500/20' : ''}`}
      >
        <button className="shrink-0 h-8 w-8 flex items-center justify-center text-slate-600 hover:text-white hover:bg-white/[0.06] rounded-[10px] transition-all">
          <Paperclip className="h-[15px] w-[15px]" />
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); setTimeout(() => { setShowSlashMenu(false); setShowMentionMenu(false); }, 200); }}
          placeholder="Message KorvixAI...  Type / for commands, @ for agents"
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent text-[14px] text-white placeholder:text-[#64748B] resize-none outline-none min-h-[20px] max-h-[200px] py-[7px] leading-[1.5] disabled:opacity-50 transition-opacity"
        />

        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="shrink-0 h-8 w-8 flex items-center justify-center bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25 hover:text-cyan-300 disabled:opacity-25 disabled:hover:bg-cyan-500/15 rounded-[10px] transition-all duration-200"
        >
          <Send className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  );
}
