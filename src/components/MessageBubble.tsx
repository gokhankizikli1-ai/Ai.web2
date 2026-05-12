import { useState } from 'react';
import { User, Sparkles, Pin, PinOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { useStreamingText } from '@/hooks/useStreamingText';
import MarkdownMessage from './MarkdownMessage';
import MessageActions from './MessageActions';
import MessageHoverActions from './MessageHoverActions';
import ResponseActions from './ResponseActions';
import type { Message } from '@/types';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  fullMessage: Message;
  shouldAnimate?: boolean;
  isPinned?: boolean;
  onPin?: (msg: Message) => void;
  onRegenerate?: () => void;
  onResponseAction?: (action: string) => void;
  onHoverAction?: (action: string, prompt: string) => void;
  // Wired only when fullMessage.isError === true.
  onRetry?: () => void;
}

export default function MessageBubble({
  role,
  content,
  fullMessage,
  shouldAnimate = false,
  isPinned = false,
  onPin,
  onRegenerate,
  onResponseAction,
  onHoverAction,
  onRetry,
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const isError = !isUser && !!fullMessage.isError;
  const { displayedText, isComplete } = useStreamingText(content, 15, shouldAnimate);
  const displayContent = shouldAnimate ? displayedText : content;
  const [showHoverActions, setShowHoverActions] = useState(false);

  // Error bubble — distinct red styling, inline Try Again, no copy /
  // regenerate / hover actions. The user always sees a clear failure
  // state right under their prompt, with diagnostic detail (endpoint,
  // status, reason) embedded in the content so they (or a tester) can
  // immediately see what went wrong without opening devtools.
  if (isError) {
    return (
      <div className="group/message flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5 bg-red-500/10 border border-red-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400/80" />
        </div>
        <div className="max-w-[90%] md:max-w-[80%] min-w-0 flex flex-col">
          <div className="rounded-2xl rounded-tl-sm bg-red-500/[0.04] border border-red-500/[0.10] px-5 py-3.5">
            <pre className="text-[12.5px] leading-[1.65] text-red-200/85 whitespace-pre-wrap font-sans m-0">{content}</pre>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-red-300/85 bg-red-500/[0.08] hover:bg-red-500/[0.12] hover:text-red-200 border border-red-500/15 transition-all"
              >
                <RefreshCw className="h-3 w-3" />
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/message flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
      onMouseEnter={() => setShowHoverActions(true)}
      onMouseLeave={() => setShowHoverActions(false)}
    >
      {/* Avatar */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5 transition-all duration-200 ${
          isUser
            ? 'bg-white/[0.03] border border-white/[0.06]'
            : 'bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-500/15 shadow-[0_0_8px_-2px_rgba(34,211,238,0.08)]'
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-cyan-400/80" />
        )}
      </div>

      {/* Content */}
      <div className="max-w-[85%] md:max-w-[75%] min-w-0 flex flex-col">
        {/* Bubble */}
        <div
          className={`${
            isUser
              ? 'rounded-2xl rounded-tr-sm bg-white/[0.03] border border-white/[0.06] text-slate-200 px-5 py-3.5 hover:border-white/[0.08] transition-all duration-200'
              : 'rounded-2xl rounded-tl-sm bg-white/[0.015] border border-white/[0.04] text-slate-300 px-5 py-3.5 hover:border-white/[0.07] transition-all duration-200 group-hover/message:bg-white/[0.02]'
          }`}
        >
          {isUser ? (
            <div className="text-[14px] leading-[1.7] whitespace-pre-wrap">{displayContent}</div>
          ) : (
            <>
              {shouldAnimate && !isComplete ? (
                <div className="text-[14px] leading-[1.7] whitespace-pre-wrap">
                  {displayContent}
                  <span className="inline-block w-[2px] h-4 ml-1 bg-cyan-400/50 animate-caret-blink align-middle rounded-full" />
                </div>
              ) : (
                <MarkdownMessage content={displayContent} />
              )}
            </>
          )}
        </div>

        {/* Actions row */}
        {!isUser && isComplete && (
          <div className="flex items-center gap-1 mt-1 pl-1">
            <MessageActions content={content} onRegenerate={onRegenerate} />

            {onPin && (
              <button
                onClick={() => onPin(fullMessage)}
                className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-all duration-200 ${
                  isPinned
                    ? 'text-cyan-400/60 bg-cyan-500/[0.06]'
                    : 'text-slate-700 hover:text-cyan-400 hover:bg-cyan-500/[0.06] opacity-0 group-hover/message:opacity-100'
                }`}
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </button>
            )}
          </div>
        )}

        {/* Hover Actions */}
        {!isUser && onHoverAction && (
          <MessageHoverActions
            content={content}
            onAction={onHoverAction}
            isVisible={showHoverActions && isComplete}
          />
        )}

        {!isUser && onResponseAction && (
          <div className="pl-1 mt-0.5">
            <ResponseActions onAction={onResponseAction} />
          </div>
        )}
      </div>
    </div>
  );
}
