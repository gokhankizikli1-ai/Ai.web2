import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from '@/components/MessageBubble';
import TypingIndicator from '@/components/TypingIndicator';
import EmptyWorkspace from '@/components/EmptyWorkspace';
import PremiumComposer from '@/components/PremiumComposer';
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
  onHoverAction,
}: ChatViewProps) {
  const [animatedMessageId, setAnimatedMessageId] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<ComposerTool[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLen = useRef(messages.length);

  // Track which message is the latest assistant (for response chips)
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  // Phase 7 polish — true while a streaming assistant placeholder
  // already exists. Used to suppress the standalone TypingIndicator
  // so we don't double-render "generating" UI (the in-bubble cursor
  // already shows the live stream).
  const hasStreamingPlaceholder = useMemo(() => {
    if (!isLoading) return false;
    const last = messages[messages.length - 1];
    return !!(last && last.role === 'assistant');
  }, [isLoading, messages]);

  // Latest assistant content length — drives the "follow scroll while
  // tokens stream" effect below. Changing the length triggers the
  // scroll check; the content STRING itself isn't a useful dep
  // because it changes by 1 char per token.
  const latestAssistantContentLen = useMemo(() => {
    if (lastAssistantIndex < 0) return 0;
    return messages[lastAssistantIndex]?.content?.length ?? 0;
  }, [messages, lastAssistantIndex]);

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

  // Phase 7 polish — content-aware scroll follow during streaming.
  // The message COUNT doesn't change while a placeholder fills with
  // tokens, so the auto-scroll above never fires mid-stream. Without
  // this, the user slowly drifts off-screen as content grows below
  // the viewport.
  //
  // Sticky-bottom heuristic: only follow when the user is within
  // STICK_THRESHOLD_PX of the bottom. If they scrolled up to re-read
  // earlier content, we leave them where they are — never yank.
  useEffect(() => {
    if (!isLoading) return;
    if (latestAssistantContentLen === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const STICK_THRESHOLD_PX = 120;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= STICK_THRESHOLD_PX) {
      // Use `auto` (not smooth) for streaming follow so the scroll
      // matches token cadence — `smooth` would queue up and jitter.
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [latestAssistantContentLen, isLoading]);

  // Phase 7 polish — settle scroll when streaming finishes. The
  // in-bubble TypingIndicator unmounts via AnimatePresence (~180ms
  // exit), causing the bubble to shrink by ~30px. Without this,
  // a user who was anchored at the bottom drifts up by that amount.
  // Mirrors the sticky-bottom heuristic of the streaming-follow
  // effect — only settle if the user is still near the bottom.
  useEffect(() => {
    if (isLoading) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const STICK_THRESHOLD_PX = 200;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= STICK_THRESHOLD_PX) {
      // Slight delay so the indicator's exit animation completes
      // BEFORE we re-anchor, otherwise scrollTo runs against the
      // pre-exit height and lands 30px short.
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

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

  const handleRetry = useCallback(() => onRetry(), [onRetry]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {isEmptyState ? (
          /* Empty state with suggestions */
          <div className="flex flex-col h-full">
            <div className="flex-1 flex items-center justify-center px-4">
              <EmptyWorkspace />
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

              {/* Inline typing indicator — part of the flow, NOT an overlay.
                  Phase 7 polish: only render during the initial latency
                  window (between user sending the message and the first
                  streaming token arriving). Once an assistant placeholder
                  exists, the in-bubble cursor in MessageBubble carries
                  the streaming UI — rendering a second indicator below
                  it produces the "duplicated" feel the polish brief
                  called out. The exit animation handles the settle. */}
              <AnimatePresence>
                {isLoading && !hasStreamingPlaceholder && (
                  <motion.div
                    key="typing-indicator"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <TypingIndicator />
                  </motion.div>
                )}
              </AnimatePresence>

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

      {/* Input area — floating glass, integrated with workspace */}
      <div ref={composerRef} className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1" style={{ background: 'transparent' }}>
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
