import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from '@/components/MessageBubble';
import TypingIndicator from '@/components/TypingIndicator';
import EmptyWorkspace from '@/components/EmptyWorkspace';
import PremiumComposer from '@/components/PremiumComposer';
import ToolShortcuts from '@/components/ToolShortcuts';
import type { ToolShortcut } from '@/components/ToolShortcuts';
import type { ComposerTool } from '@/components/ComposerTools';
import type { Message, WorkspaceTab } from '@/types';
import { Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatViewProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  inputText: string;
  onSend: (message: string) => void;
  onRetry: () => void;
  onSetInput: (text: string) => void;
  onTogglePin: (msg: Message) => void;
  pinnedMessages: Message[];
  onHoverAction?: (action: string, prompt: string) => void;
  title: string;
  workspace?: WorkspaceTab;
}

export default function ChatView({
  messages, isLoading, error, inputText,
  onSend, onRetry, onSetInput, onTogglePin, pinnedMessages,
  onHoverAction, title, workspace = 'chat',
}: ChatViewProps) {
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ComposerTool[]>([]);
  const [activeShortcutIds, setActiveShortcutIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 80);
    return () => clearTimeout(timer);
  }, [messages, isLoading, error]);

  // Track latest assistant message for animation
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage && lastMessage.role === 'assistant' && !isLoading) {
      if (animatedMessageId !== lastMessage.id) setAnimatedMessageId(lastMessage.id);
    }
  }, [lastMessage, isLoading, animatedMessageId]);

  const handleSend = useCallback((msg: string) => {
    let finalMsg = msg;
    if (activeTools.length > 0) {
      const toolNames = activeTools.map((t) => t.chip).join(', ');
      finalMsg = `[Using: ${toolNames}]\n${msg}`;
    }
    onSend(finalMsg);
    onSetInput('');
  }, [onSend, onSetInput, activeTools]);

  const insertInput = useCallback((text: string) => {
    onSetInput(text);
    setTimeout(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); el.scrollTop = el.scrollHeight; }
    }, 50);
  }, [onSetInput]);

  const isPinned = useCallback((msgId: string) => pinnedMessages.some((m) => m.id === msgId), [pinnedMessages]);

  const isEmptyState = messages.length === 0 && !error && !isLoading;
  const isOnboarding = isEmptyState && title === 'New Conversation';

  // Tool management
  const addTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => {
      if (prev.find((t) => t.id === tool.id)) return prev;
      return [...prev, tool];
    });
  }, []);

  const removeTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => prev.filter((t) => t.id !== tool.id));
  }, []);

  // Shortcut handling
  const handleShortcut = useCallback((shortcut: ToolShortcut) => {
    setActiveShortcutIds((prev) => {
      const exists = prev.includes(shortcut.id);
      if (exists) return prev.filter((id) => id !== shortcut.id);
      return [...prev, shortcut.id];
    });
    insertInput(shortcut.prompt);
  }, [insertInput]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isOnboarding ? (
          <EmptyWorkspace onSend={handleSend} workspace={workspace} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            <AnimatePresence mode="popLayout">
              {messages.map((message, i) => (
                <motion.div
                  key={message.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
                >
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    fullMessage={message}
                    shouldAnimate={message.id === animatedMessageId}
                    isPinned={isPinned(message.id)}
                    onPin={onTogglePin}
                    onRegenerate={message.role === 'assistant' ? () => {} : undefined}
                    onResponseAction={message.role === 'assistant' ? insertInput : undefined}
                    onHoverAction={message.role === 'assistant' ? onHoverAction : undefined}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Loading state */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 shadow-lg shadow-cyan-500/10">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.07] transition-colors">
                  <TypingIndicator />
                </div>
              </motion.div>
            )}

            {/* Error state */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/10">
                  <AlertTriangle className="h-3 w-3 text-red-400" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-red-500/[0.04] border border-red-500/[0.08] px-5 py-3.5 max-w-[85%] md:max-w-[75%]">
                  <p className="text-[13px] text-red-300/80 mb-3">{error}</p>
                  <Button variant="ghost" size="sm" onClick={onRetry}
                    className="h-7 gap-2 text-[11px] text-red-400/70 hover:text-red-300 hover:bg-red-500/[0.08] rounded-lg">
                    <RefreshCw className="h-3.5 w-3.5" />Try Again
                  </Button>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </div>

      {/* Input area */}
      {!isOnboarding && (
        <div className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1 bg-[#0a0a0a]/60 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto mb-1.5">
            <ToolShortcuts activeTools={activeShortcutIds} onSelect={handleShortcut} />
          </div>
          <PremiumComposer
            onSend={handleSend}
            disabled={isLoading}
            activeTools={activeTools}
            onAddTool={addTool}
            onRemoveTool={removeTool}
            externalValue={inputText}
            onExternalValueChange={onSetInput}
          />
        </div>
      )}
    </div>
  );
}
