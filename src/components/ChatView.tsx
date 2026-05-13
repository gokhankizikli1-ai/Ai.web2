import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from '@/components/MessageBubble';
import TypingIndicator from '@/components/TypingIndicator';
import EmptyWorkspace from '@/components/EmptyWorkspace';
import PremiumComposer from '@/components/PremiumComposer';
import ToolShortcuts from '@/components/ToolShortcuts';
import type { ToolShortcut } from '@/components/ToolShortcuts';
import type { ComposerTool } from '@/components/ComposerTools';
import type { Message, WorkspaceTab } from '@/types';
import { AlertTriangle, RefreshCw } from 'lucide-react';
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
  workspace?: WorkspaceTab;
}

export default function ChatView({
  messages, isLoading, error, inputText,
  onSend, onRetry, onSetInput, onTogglePin, pinnedMessages,
  onHoverAction, workspace = 'chat',
}: ChatViewProps) {
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ComposerTool[]>([]);
  const [activeShortcutIds, setActiveShortcutIds] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLen = useRef(messages.length);

  // Track which message is the latest assistant (for response chips)
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  // Auto-scroll: only gentle scroll, never aggressive push
  useEffect(() => {
    if (messages.length > prevMessagesLen.current) {
      // New message added — gentle scroll
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      prevMessagesLen.current = messages.length;
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  // Track latest assistant message for stream animation
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && !isLoading) {
      setAnimatedMessageId(lastMsg.id);
    }
  }, [messages, isLoading]);

  const handleSend = useCallback((msg: string) => {
    let finalMsg = msg;
    if (activeTools.length > 0) {
      const toolNames = activeTools.map((t) => t.chip).join(', ');
      finalMsg = `[Using: ${toolNames}]\n${msg}`;
    }
    onSend(finalMsg);
    onSetInput('');
    setActiveTools([]);
  }, [onSend, onSetInput, activeTools]);

  const insertInput = useCallback((text: string) => {
    onSetInput(text);
    setTimeout(() => {
      const el = composerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); }
    }, 50);
  }, [onSetInput]);

  const isPinned = useCallback((msgId: string) => pinnedMessages.some((m) => m.id === msgId), [pinnedMessages]);

  const isEmptyState = messages.length === 0 && !error && !isLoading;

  const addTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => prev.find((t) => t.id === tool.id) ? prev : [...prev, tool]);
  }, []);

  const removeTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => prev.filter((t) => t.id !== tool.id));
  }, []);

  const handleShortcut = useCallback((shortcut: ToolShortcut) => {
    setActiveShortcutIds((prev) => prev.includes(shortcut.id) ? prev.filter((id) => id !== shortcut.id) : [...prev, shortcut.id]);
    insertInput(shortcut.prompt);
  }, [insertInput]);

  const handleEmptySend = useCallback((msg: string) => onSend(msg), [onSend]);

  const handleRetry = useCallback(() => onRetry(), [onRetry]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {isEmptyState ? (
          /* Empty state with suggestions */
          <div className="flex flex-col h-full">
            <div className="flex-1 flex items-center justify-center px-4">
              <EmptyWorkspace onSend={handleEmptySend} workspace={workspace} compact />
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {/* Message turns with comfortable spacing */}
            <div className="space-y-5">
              <AnimatePresence mode="popLayout" initial={false}>
                {messages.map((message, index) => (
                  <motion.div
                    key={message.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <MessageBubble
                      role={message.role}
                      content={message.content}
                      fullMessage={message}
                      shouldAnimate={message.id === animatedMessageId}
                      isPinned={isPinned(message.id)}
                      onPin={onTogglePin}
                      onRegenerate={message.role === 'assistant' ? handleRetry : undefined}
                      onResponseAction={message.role === 'assistant' ? insertInput : undefined}
                      onHoverAction={message.role === 'assistant' ? onHoverAction : undefined}
                      isLatestAssistant={index === lastAssistantIndex}
                      isGenerating={isLoading && index === lastAssistantIndex}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Inline typing indicator — part of the flow, NOT an overlay */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <TypingIndicator />
                </motion.div>
              )}

              {/* Inline error — part of the flow */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2.5 pl-[36px]"
                >
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-red-500/10">
                    <AlertTriangle className="h-3 w-3 text-red-400/60" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-red-500/[0.02] border border-red-500/[0.06] px-4 py-2.5 max-w-[85%]">
                    <p className="text-[12px] text-red-300/70 mb-2">{error}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRetry}
                      className="h-6 gap-1.5 text-[11px] text-red-400/60 hover:text-red-300 hover:bg-red-500/[0.06] rounded-lg px-2"
                    >
                      <RefreshCw className="h-3 w-3" /> Retry
                    </Button>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Bottom spacer for scroll target */}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>

      {/* Input area — always visible */}
      <div ref={composerRef} className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1 bg-[#0a0a0a]/60 backdrop-blur-xl">
        {isEmptyState && (
          <div className="max-w-3xl mx-auto mb-1.5">
            <ToolShortcuts activeTools={activeShortcutIds} onSelect={handleShortcut} />
          </div>
        )}
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
    </div>
  );
}
