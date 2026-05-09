import { User, Sparkles, Pin, PinOff } from 'lucide-react';
import { useStreamingText } from '@/hooks/useStreamingText';
import MarkdownMessage from './MarkdownMessage';
import MessageActions from './MessageActions';
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
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const { displayedText, isComplete } = useStreamingText(content, 12, shouldAnimate);
  const displayContent = shouldAnimate ? displayedText : content;

  return (
    <div
      className={`group/message flex gap-3.5 ${
        isUser ? 'flex-row-reverse animate-slide-in-right' : 'animate-slide-in-left'
      }`}
    >
      {/* Avatar */}
      <div
        className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] mt-0.5 transition-transform duration-300 group-hover/message:scale-105 ${
          isUser
            ? 'bg-slate-700/50 border border-white/[0.05]'
            : 'bg-gradient-to-br from-cyan-400 to-blue-600 shadow-md shadow-cyan-500/12'
        }`}
      >
        {isUser ? (
          <User className="h-[14px] w-[14px] text-slate-300" />
        ) : (
          <Sparkles className="h-[14px] w-[14px] text-white" />
        )}
      </div>

      {/* Content */}
      <div className="max-w-[85%] md:max-w-[75%] min-w-0 flex flex-col">
        {/* Bubble */}
        <div
          className={`${
            isUser
              ? 'rounded-[18px] rounded-tr-[6px] bg-blue-600/[0.1] border border-blue-500/[0.1] text-slate-200 px-[18px] py-[14px] message-shadow'
              : 'rounded-[18px] rounded-tl-[6px] bg-white/[0.025] border border-white/[0.05] text-slate-300 px-[18px] py-[14px] message-shadow hover:border-white/[0.07] transition-colors duration-300'
          }`}
        >
          {isUser ? (
            <div className="text-[14px] leading-[1.7] whitespace-pre-wrap">{displayContent}</div>
          ) : (
            <>
              {shouldAnimate && !isComplete ? (
                <div className="text-[14px] leading-[1.7] whitespace-pre-wrap">
                  {displayContent}
                  <span className="inline-block w-[2px] h-[18px] ml-[3px] bg-cyan-400/70 animate-caret-blink align-middle rounded-full" />
                </div>
              ) : (
                <MarkdownMessage content={displayContent} />
              )}
            </>
          )}
        </div>

        {/* Actions row */}
        {!isUser && isComplete && (
          <div className="flex items-center gap-2 mt-1 pl-1">
            <MessageActions content={content} onRegenerate={onRegenerate} />

            {/* Pin button */}
            {onPin && (
              <button
                onClick={() => onPin(fullMessage)}
                className={`flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10px] transition-all duration-200 ${
                  isPinned
                    ? 'text-cyan-400 bg-cyan-500/10'
                    : 'text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] opacity-0 group-hover/message:opacity-100'
                }`}
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                {isPinned ? 'Pinned' : 'Pin'}
              </button>
            )}
          </div>
        )}

        {/* Response quality actions */}
        {!isUser && onResponseAction && (
          <div className="pl-1">
            <ResponseActions onAction={onResponseAction} />
          </div>
        )}
      </div>
    </div>
  );
}
