import { User, Sparkles } from 'lucide-react';
import { useStreamingText } from '@/hooks/useStreamingText';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  shouldAnimate?: boolean;
}

export default function MessageBubble({ role, content, shouldAnimate = false }: MessageBubbleProps) {
  const isUser = role === 'user';
  const { displayedText, isComplete } = useStreamingText(content, 15, shouldAnimate);

  const displayContent = shouldAnimate ? displayedText : content;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} animate-fade-in`}>
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
      <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? 'rounded-tr-none bg-blue-600/20 border border-blue-500/20 text-slate-200'
          : 'rounded-tl-none bg-white/5 text-slate-300'
      }`}>
        {displayContent}
        {shouldAnimate && !isComplete && (
          <span className="inline-block w-2 h-4 ml-1 bg-cyan-400/80 animate-caret-blink align-middle" />
        )}
      </div>
    </div>
  );
}
