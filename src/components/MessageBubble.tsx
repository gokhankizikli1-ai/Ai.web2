import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Sparkles, Pin, PinOff, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ResponseActions from './ResponseActions';
import { useToast } from '@/hooks/useToast';
import type { Message } from '@/types';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  fullMessage: Message;
  shouldAnimate?: boolean;
  isPinned?: boolean;
  onPin?: (msg: Message) => void;
  onRegenerate?: () => void;
  onResponseAction?: (action: string) => void;
  onHoverAction?: (action: string, prompt: string) => void;
  isLatestAssistant?: boolean;
  isGenerating?: boolean;
}

const markdownComponents = {
  code({ inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : '';
    if (!inline && lang) {
      return (
        <div className="my-3 rounded-xl overflow-hidden border border-white/[0.06] shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
            <span className="text-[10px] text-slate-600 font-mono">{lang}</span>
            <button
              onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
              className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
            >
              Copy
            </button>
          </div>
          <SyntaxHighlighter
            language={lang}
            style={vscDarkPlus}
            customStyle={{ margin: 0, background: 'transparent', fontSize: '12px', lineHeight: '1.6' }}
            codeTagProps={{ style: { fontSize: '12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      );
    }
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-white/[0.06] text-cyan-300/80 text-[12px] font-mono" {...props}>
        {children}
      </code>
    );
  },
  p({ children }: any) {
    return <p className="text-[13px] leading-[1.65] mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }: any) {
    return <ul className="text-[13px] list-disc pl-4 mb-2 space-y-0.5">{children}</ul>;
  },
  ol({ children }: any) {
    return <ol className="text-[13px] list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>;
  },
  li({ children }: any) {
    return <li className="text-[13px] leading-[1.6]">{children}</li>;
  },
  h1({ children }: any) {
    return <h1 className="text-[15px] font-semibold text-white mt-4 mb-2">{children}</h1>;
  },
  h2({ children }: any) {
    return <h2 className="text-[14px] font-semibold text-white mt-3.5 mb-1.5">{children}</h2>;
  },
  h3({ children }: any) {
    return <h3 className="text-[13px] font-medium text-white mt-3 mb-1">{children}</h3>;
  },
  blockquote({ children }: any) {
    return <blockquote className="border-l-2 border-cyan-500/20 pl-3 my-2 text-slate-400 italic">{children}</blockquote>;
  },
  hr() {
    return <hr className="my-3 border-white/[0.04]" />;
  },
  table({ children }: any) {
    return <div className="overflow-x-auto my-2"><table className="w-full text-[12px] border-collapse">{children}</table></div>;
  },
  thead({ children }: any) {
    return <thead className="bg-white/[0.02]">{children}</thead>;
  },
  th({ children }: any) {
    return <th className="text-left px-2.5 py-1.5 text-slate-400 font-medium border-b border-white/[0.06]">{children}</th>;
  },
  td({ children }: any) {
    return <td className="px-2.5 py-1.5 border-b border-white/[0.03] text-slate-300">{children}</td>;
  },
  a({ href, children }: any) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400/70 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-400/20 hover:decoration-cyan-400/50 transition-colors">
        {children}
      </a>
    );
  },
  strong({ children }: any) {
    return <strong className="text-slate-200 font-medium">{children}</strong>;
  },
  em({ children }: any) {
    return <em className="text-slate-400 italic">{children}</em>;
  },
};

export default function MessageBubble({
  role, content, fullMessage, shouldAnimate = false, isPinned = false,
  onPin, onRegenerate, onResponseAction, onHoverAction,
  isLatestAssistant = false, isGenerating = false,
}: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayedContent, setDisplayedContent] = useState(shouldAnimate ? '' : content);
  const isShort = content.length < 80 && !content.includes('\n') && !content.includes('```');

  // Stream-in animation for latest assistant message
  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedContent(content);
      return;
    }
    let index = 0;
    const chunkSize = Math.max(1, Math.floor(content.length / 40));
    const interval = setInterval(() => {
      index += chunkSize;
      if (index >= content.length) {
        setDisplayedContent(content);
        clearInterval(interval);
      } else {
        setDisplayedContent(content.slice(0, index));
      }
    }, 25);
    return () => clearInterval(interval);
  }, [shouldAnimate, content]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    addToast('Copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  }, [content, addToast]);

  const formatTime = (date: Date) =>
    new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (role === 'system') return null;

  // ─── User message ───
  if (role === 'user') {
    return (
      <div className="flex justify-end py-1">
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="group max-w-[85%] md:max-w-[75%] lg:max-w-[65%]"
        >
          <div className={`rounded-2xl rounded-tr-sm ${isShort ? 'px-4 py-2' : 'px-4 py-2.5'} bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.08] transition-all duration-200 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]`}>
            <p className="text-[13px] text-slate-200 leading-relaxed whitespace-pre-wrap">{content}</p>
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="text-[10px] text-slate-700">{formatTime(fullMessage.timestamp)}</span>
            <button onClick={handleCopy} className="p-0.5 rounded text-slate-700 hover:text-slate-400 transition-colors">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── Assistant message ───
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-2.5 py-1 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Avatar */}
      <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-600/20 border border-cyan-500/10 mt-0.5 shadow-[0_0_8px_-2px_rgba(34,211,238,0.08)]">
        <Sparkles className="h-3 w-3 text-cyan-400/70" />
      </div>

      <div className="flex-1 min-w-0 max-w-[90%] md:max-w-[85%] lg:max-w-[80%]">
        {/* Bubble */}
        <div
          className={`rounded-2xl rounded-tl-sm border transition-all duration-200 ${
            isShort
              ? 'px-4 py-2.5 bg-transparent border-transparent hover:border-white/[0.04] hover:bg-white/[0.01]'
              : 'px-4 py-3 bg-white/[0.01] border-transparent hover:border-white/[0.05] hover:bg-white/[0.02] shadow-[0_1px_6px_-2px_rgba(0,0,0,0.15)]'
          }`}
        >
          <div ref={contentRef} className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {displayedContent}
            </ReactMarkdown>
          </div>

          {/* Streaming cursor */}
          {shouldAnimate && displayedContent.length < content.length && (
            <motion.span
              className="inline-block w-[2px] h-4 bg-cyan-400/50 ml-0.5 align-middle"
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
          )}
        </div>

        {/* Action row — shows on hover, hidden during generation */}
        {!isGenerating && (
          <div className={`flex items-center gap-0.5 mt-1.5 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] transition-all"
              title="Copy"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>

            {onPin && (
              <button
                onClick={() => onPin(fullMessage)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-700 hover:text-amber-400 hover:bg-amber-500/[0.03] transition-all"
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                {isPinned ? <PinOff className="h-3 w-3 text-amber-400" /> : <Pin className="h-3 w-3" />}
              </button>
            )}

            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] transition-all"
                title="Regenerate"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}

            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-700 hover:text-emerald-400 hover:bg-emerald-500/[0.03] transition-all">
              <ThumbsUp className="h-3 w-3" />
            </button>

            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-700 hover:text-red-400 hover:bg-red-500/[0.03] transition-all">
              <ThumbsDown className="h-3 w-3" />
            </button>

            <span className="text-[10px] text-slate-800 ml-1">{formatTime(fullMessage.timestamp)}</span>
          </div>
        )}

        {/* Response action chips — only on latest completed assistant message */}
        {isLatestAssistant && !isGenerating && onResponseAction && (
          <div className="mt-2.5">
            <ResponseActions onAction={onResponseAction} onHoverAction={onHoverAction} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
