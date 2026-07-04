import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router';
import MessageBubble from '@/components/MessageBubble';
import TypingIndicator from '@/components/TypingIndicator';
import EmptyWorkspace from '@/components/EmptyWorkspace';
import PremiumComposer from '@/components/PremiumComposer';
import { KorvixModeChips, KorvixModePill } from '@/components/KorvixModeChips';
import type { ComposerTool } from '@/components/ComposerTools';
import type { AttachedAsset, Message, ToolActivity, WorkspaceTab } from '@/types';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { looksLikeResearchAsk } from '@/lib/chatTitles';
import { type KorvixMode, detectBuilderIntent } from '@/lib/korvixMode';

interface ChatViewProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  inputText: string;
  /** Phase 10 fix — currently-running backend tool (e.g. github_repo)
   *  surfaced as a chip while the LLM stream is still waiting for the
   *  tool's output. Null when no tool is in flight. */
  toolActivity?: ToolActivity | null;
  // Phase 9 — onSend carries the attached assets so the chat hook can
  // persist them on the user Message AND forward the ids to
  // /v2/chat/stream. Empty array = text-only turn. Returns a boolean
  // resolving to whether the send actually persisted on the backend
  // (false = composer keeps its chips so the user can retry without
  // re-attaching the file).
  onSend: (message: string, attachments?: AttachedAsset[]) => Promise<boolean>;
  onRetry: () => void;
  onSetInput: (text: string) => void;
  onTogglePin: (msg: Message) => void;
  pinnedMessages: Message[];
  onHoverAction?: (action: string, prompt: string) => void;
  workspace?: WorkspaceTab;
}

export default function ChatView({
  messages, isLoading, error, inputText, toolActivity,
  onSend, onRetry, onSetInput, onTogglePin, pinnedMessages,
  onHoverAction, workspace,
}: ChatViewProps) {
  const navigate = useNavigate();
  const [activeTools, setActiveTools] = useState<ComposerTool[]>([]);
  // Builder-home mode selection (Chat / Website / App / Game). `null` = nothing
  // picked → intent is auto-detected on send; 'chat' = explicit stay-in-chat.
  const [builderMode, setBuilderMode] = useState<KorvixMode | null>(null);
  // The unified builder home only replaces the *normal Chat* empty state.
  const isChatHome = workspace === 'chat' || workspace === undefined;
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

  // Replay-bug fix: no client-side typewriter animation state at all.
  // Server streaming fills the active bubble live; completed and
  // hydrated messages render statically (see MessageBubble). This
  // removes the post-completion / post-refresh re-stream entirely.

  const handleSend = useCallback(async (
    msg: string,
    attachments: AttachedAsset[] = [],
  ): Promise<boolean> => {
    // ── Builder routing ──────────────────────────────────────────────
    // If a build mode is selected (or intent clearly points to one), route
    // the RAW prompt to the matching builder instead of answering in chat.
    // Explicit 'chat' or an unclear prompt stays in normal Chat.
    const raw = msg.trim();
    if (raw && attachments.length === 0) {
      const target = builderMode ?? detectBuilderIntent(raw);
      if (target === 'website' || target === 'app') {
        navigate(`/tools/website-builder?prompt=${encodeURIComponent(raw)}&mode=${target}`);
        return true;
      }
      if (target === 'game') {
        navigate(`/tools/game-builder?prompt=${encodeURIComponent(raw)}`);
        return true;
      }
    }

    let finalMsg = msg;
    if (activeTools.length > 0) {
      const toolNames = activeTools.map((t) => t.chip).join(', ');
      finalMsg = `[Using: ${toolNames}]\n${msg}`;
    }
    // Phase 9 fix — await the send so the composer can keep its chips
    // when the backend refuses or the network drops. The composer
    // clears chips only when ok === true.
    const ok = await onSend(finalMsg, attachments);
    if (ok) {
      onSetInput('');
      setActiveTools([]);
    }
    return ok;
  }, [onSend, onSetInput, activeTools, builderMode, navigate]);

  const insertInput = useCallback((text: string) => {
    onSetInput(text);
    setTimeout(() => {
      const el = composerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;
      if (el) { el.focus(); }
    }, 50);
  }, [onSetInput]);

  // Toggle a home mode. Selecting the active one again returns to neutral
  // (auto-detect). Never inserts text into the composer.
  const handleSelectMode = useCallback((mode: KorvixMode) => {
    setBuilderMode((prev) => (prev === mode ? null : mode));
    setTimeout(() => {
      const el = composerRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;
      el?.focus();
    }, 50);
  }, []);

  const isPinned = useCallback((msgId: string) => pinnedMessages.some((m) => m.id === msgId), [pinnedMessages]);

  // Honest research-activity labels: when the pending turn LOOKS like a
  // research ask, the typing indicator cycles generic research steps
  // (no URLs are invented — real sources appear after the answer).
  const researchAsk = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return looksLikeResearchAsk(messages[i].content);
    }
    return false;
  }, [messages]);

  const isEmptyState = messages.length === 0 && !error && !isLoading;

  const addTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => prev.find((t) => t.id === tool.id) ? prev : [...prev, tool]);
  }, []);

  const removeTool = useCallback((tool: ComposerTool) => {
    setActiveTools((prev) => prev.filter((t) => t.id !== tool.id));
  }, []);

  const handleRetry = useCallback(() => onRetry(), [onRetry]);

  // The composer element — identical whether centered (empty home) or docked
  // at the bottom (active conversation). The selected build-mode pill rides
  // inside it via topSlot.
  const modePill = isChatHome && builderMode && builderMode !== 'chat'
    ? <KorvixModePill mode={builderMode} onRemove={() => setBuilderMode(null)} />
    : undefined;
  const composer = (
    <PremiumComposer
      onSend={handleSend}
      disabled={isLoading}
      activeTools={activeTools}
      onAddTool={addTool}
      onRemoveTool={removeTool}
      externalValue={inputText}
      onExternalValueChange={onSetInput}
      topSlot={modePill}
    />
  );

  // ── Kimi-style centered start screen — ONLY on an empty normal Chat. The
  // hero + composer + mode chips sit as one centered group; there is no bottom
  // composer, so nothing is duplicated. The first message flips this to the
  // normal feed + docked composer below.
  if (isChatHome && isEmptyState) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col items-center justify-center px-3 md:px-4">
          <div ref={composerRef} className="w-full max-w-3xl py-8">
            <div className="mb-7 flex justify-center">
              <EmptyWorkspace builder />
            </div>
            {composer}
            <div className="mt-3">
              <KorvixModeChips selected={builderMode} onSelect={handleSelectMode} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {isEmptyState ? (
          /* Non-chat workspace empty state — classic centered orb. */
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
                {messages.map((message, index) => {
                  const isStreamingThis = isLoading && index === lastAssistantIndex;
                  // Assistant messages NEVER layout-animate — not while
                  // streaming (framer would re-measure every token and nudge
                  // the list, reading as flicker) and not on completion (a
                  // final layout pass looks like the answer "re-loading").
                  // The bubble grows in place and settles exactly once. Only
                  // user messages keep position animation for send polish.
                  const useLayout = message.role === 'user' && !isStreamingThis ? 'position' : false;
                  return (
                  <motion.div
                    key={message.id}
                    layout={useLayout}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <MessageBubble
                      role={message.role}
                      content={message.content}
                      fullMessage={message}
                      shouldAnimate={false}
                      isPinned={isPinned(message.id)}
                      onPin={onTogglePin}
                      onRegenerate={message.role === 'assistant' ? handleRetry : undefined}
                      onResponseAction={message.role === 'assistant' ? insertInput : undefined}
                      onHoverAction={message.role === 'assistant' ? onHoverAction : undefined}
                      isLatestAssistant={index === lastAssistantIndex}
                      isGenerating={isLoading && index === lastAssistantIndex}
                    />
                  </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Phase 10 fix — tool activity chip. Shows BEFORE the
                  typing indicator while a backend tool (github_repo,
                  browser_fetch, etc.) is fetching data. Replaces the
                  typing indicator while present so the user sees one
                  coherent "what the AI is doing" surface. */}
              <AnimatePresence>
                {toolActivity && isLoading && (
                  <motion.div
                    key={`tool-${toolActivity.toolId}-${toolActivity.status}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="flex items-center gap-2 py-1"
                  >
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border bg-white/[0.02]"
                         style={{
                           borderColor: toolActivity.status === 'failed'
                             ? 'rgba(248,113,113,0.20)'
                             : toolActivity.status === 'completed'
                               ? 'rgba(52,211,153,0.20)'
                               : 'rgba(59,130,246,0.25)',
                         }}>
                      {toolActivity.status === 'running' && (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                          className="h-2.5 w-2.5 rounded-full border-2 border-[#3B82F6]/40 border-t-[#3B82F6]"
                          aria-label="working"
                        />
                      )}
                      {toolActivity.status === 'completed' && (
                        <div className="h-2 w-2 rounded-full bg-[#4ADE80]" aria-label="completed" />
                      )}
                      {toolActivity.status === 'failed' && (
                        <div className="h-2 w-2 rounded-full bg-[#F87171]" aria-label="failed" />
                      )}
                      <span className="text-[11px] text-slate-300">{toolActivity.label}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inline typing indicator — part of the flow, NOT an overlay.
                  Phase 7 polish: only render during the initial latency
                  window (between user sending the message and the first
                  streaming token arriving). Once an assistant placeholder
                  exists, the in-bubble cursor in MessageBubble carries
                  the streaming UI — rendering a second indicator below
                  it produces the "duplicated" feel the polish brief
                  called out. The exit animation handles the settle.
                  Phase 10 fix — suppress while a tool chip is showing so
                  the user sees one coherent activity indicator. */}
              <AnimatePresence>
                {isLoading && !hasStreamingPlaceholder && !toolActivity && (
                  <motion.div
                    key="typing-indicator"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <TypingIndicator
                      labels={researchAsk
                        ? ['Searching web…', 'Reading sources…', 'Extracting relevant points…', 'Preparing answer…']
                        : undefined}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Inline error — part of the flow */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2.5"
                >
                  <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-[#F87171]/10">
                    <AlertTriangle className="h-3 w-3 text-[#F87171]/60" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-[#F87171]/[0.02] border border-[#F87171]/[0.06] px-4 py-2.5 max-w-[85%]">
                    <p className="text-[12px] text-[#F87171]/70 mb-2">{error}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRetry}
                      className="h-6 gap-1.5 text-[11px] text-[#F87171]/60 hover:text-[#F87171] hover:bg-[#F87171]/[0.06] rounded-lg px-2"
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

      {/* Input area — docked bottom composer once a conversation exists. */}
      <div ref={composerRef} className="shrink-0 px-3 md:px-4 pb-3 md:pb-4 pt-1" style={{ background: 'transparent' }}>
        {composer}
      </div>
    </div>
  );
}
