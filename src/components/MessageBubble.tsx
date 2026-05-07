import { User, Sparkles } from 'lucide-react';
import { useStreamingText } from '@/hooks/useStreamingText';
import MarkdownMessage from './MarkdownMessage';
import MessageActions from './MessageActions';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  shouldAnimate?: boolean;
  onRegenerate?: () => void;
}

export default function MessageBubble({ role, content, shouldAnimate = false, onRegenerate }: MessageBubbleProps) {
  const isUser = role === 'user';
  const { displayedText, isComplete } = useStreamingText(content, 12, shouldAnimate);

  const displayContent = shouldAnimate ? displayedText : content;

  return (
    <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : ''} animate-fade-in`}>
      {/* Avatar */}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        isUser ? 'bg-slate-700' : 'bg-gradient-to-br from-cyan-400 to-blue-600'
      }`}>
        {isUser ? (
          <User className="h-4 w-4 text-slate-300" />
        ) : (
          <Sparkles className="h-4 w-4 text-white" />
        )}
      </div>

      {/* Bubble */}
      <div className={`max-w-[85%] md:max-w-[75%] ${
        isUser
          ? 'rounded-2xl rounded-tr-none bg-blue-600/20 border border-blue-500/20 text-slate-200 px-4 py-3'
          : 'rounded-2xl rounded-tl-none bg-white/5 text-slate-300 px-4 py-3'
      }`}>
        {isUser ? (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">{displayContent}</div>
        ) : (
          <>
            {shouldAnimate && !isComplete ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {displayContent}
                <span className="inline-block w-2 h-4 ml-1 bg-cyan-400/80 animate-caret-blink align-middle" />
              </div>
            ) : (
              <MarkdownMessage content={displayContent} />
            )}
            {isComplete && <MessageActions content={content} onRegenerate={onRegenerate} />}
          </>
        )}
      </div>
    </div>
  );
}
