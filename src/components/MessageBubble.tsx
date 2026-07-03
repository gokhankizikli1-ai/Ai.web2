import { useState, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Pin, PinOff, Copy, Check, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ResponseActions from './ResponseActions';
import AssetChip from './AssetChip';
import MessageSources from './MessageSources';
import { useToast } from '@/hooks/useToast';
import { useLanguageStore } from '@/stores/languageStore';
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
            <span className="text-[10px] text-[#94A3B8] font-mono">{lang}</span>
            <button
              onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
              className="text-[10px] text-[#94A3B8] hover:text-[#CBD5E1] transition-colors"
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
      <code className="px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#60A5FA] text-[12px] font-mono" {...props}>
        {children}
      </code>
    );
  },
  p({ children }: any) {
    return <p className="text-[13.5px] leading-[1.7] text-[#DCE2EC] mb-2 last:mb-0">{children}</p>;
  },
  ul({ children }: any) {
    return <ul className="text-[13.5px] text-[#DCE2EC] list-disc pl-4 mb-2 space-y-0.5">{children}</ul>;
  },
  ol({ children }: any) {
    return <ol className="text-[13.5px] text-[#DCE2EC] list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>;
  },
  li({ children }: any) {
    return <li className="text-[13.5px] leading-[1.65] text-[#DCE2EC]">{children}</li>;
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
    return <blockquote className="border-l-2 border-[#3B82F6]/30 pl-3 my-2 text-[#CBD5E1] italic">{children}</blockquote>;
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
    return <th className="text-left px-2.5 py-1.5 text-[#CBD5E1] font-medium border-b border-white/[0.06]">{children}</th>;
  },
  td({ children }: any) {
    return <td className="px-2.5 py-1.5 border-b border-white/[0.03] text-slate-300">{children}</td>;
  },
  a({ href, children }: any) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#60A5FA] hover:text-[#60A5FA] underline underline-offset-2 decoration-[#3B82F6]/30 hover:decoration-[#3B82F6]/60 transition-colors">
        {children}
      </a>
    );
  },
  strong({ children }: any) {
    return <strong className="text-slate-200 font-medium">{children}</strong>;
  },
  em({ children }: any) {
    return <em className="text-[#CBD5E1] italic">{children}</em>;
  },
};

/** Memoized markdown body.
 *
 * Re-render / "replay" fix: the assistant bubble re-renders on every
 * parent state change — hover in/out, and (critically) the moment
 * `isGenerating` flips false on completion. ReactMarkdown + the Prism
 * SyntaxHighlighter are expensive to re-parse, and re-parsing identical
 * text is what read as the answer "flickering" or "soft-reloading"
 * after the stream settled. Memoizing on the exact markdown string means
 * a re-render with unchanged content reuses the already-parsed tree —
 * the completed message renders once and stays put. During streaming the
 * string changes each token, so live typing is unaffected. */
const MarkdownBody = memo(function MarkdownBody({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
});

/** Detect a trailing "Sources / Kaynaklar / References" block the model
 * appended and split it out so it renders as a compact collapsed control
 * under the answer instead of a wall of links inside it. Detection is
 * conservative: a heading-like line followed mostly by links. When
 * nothing matches, the message renders unchanged — never fabricated. */
function splitTrailingSources(content: string): { body: string; sources: string | null; count: number } {
  const lines = content.split('\n');
  let headingIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s{0,3}(#{1,4}\s*)?(\*\*)?\s*(sources?|kaynaklar|references|citations)(\s+used)?(\*\*)?\s*:?\s*$/i.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx < 0) return { body: content, sources: null, count: 0 };
  const tail = lines.slice(headingIdx + 1);
  const nonEmpty = tail.filter((l) => l.trim());
  if (nonEmpty.length === 0) return { body: content, sources: null, count: 0 };
  const linkish = nonEmpty.filter((l) => /https?:\/\/|\[[^\]]+\]\([^)]+\)/.test(l));
  if (linkish.length < Math.max(1, Math.ceil(nonEmpty.length * 0.5))) {
    return { body: content, sources: null, count: 0 };
  }
  return {
    body: lines.slice(0, headingIdx).join('\n').trimEnd(),
    sources: tail.join('\n').trim(),
    count: linkish.length,
  };
}

export default function MessageBubble({
  role, content, fullMessage, shouldAnimate = false, isPinned = false,
  onPin, onRegenerate, onResponseAction, onHoverAction,
  isLatestAssistant = false, isGenerating = false,
}: MessageBubbleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();
  const t = useLanguageStore((s) => s.t);
  const contentRef = useRef<HTMLDivElement>(null);
  const isShort = content.length < 80 && !content.includes('\n') && !content.includes('```');

  // Replay-bug fix: there is NO client-side typewriter. Server streaming
  // already fills the bubble token-by-token live (see useChat), so a
  // second client-side replay after completion was the "answer streams
  // again very fast" bug. We render `content` directly — actively
  // streaming messages update live, completed messages are static, and
  // history restored from localStorage never animates. `shouldAnimate`
  // is accepted for API compatibility but intentionally unused.
  void shouldAnimate;

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
          className="group max-w-[85%] md:max-w-[75%] lg:max-w-[65%] flex flex-col items-end"
        >
          {/* Phase 9 fix — attachments belong with the USER turn, not
              the assistant turn. Show them ABOVE the bubble so the
              composition (image + caption) reads top-down naturally
              and matches ChatGPT / Claude conventions. The previous
              implementation only rendered attachments on assistant
              messages — which never carry them — so user-attached
              images were invisible after send. */}
          {fullMessage.attachments && fullMessage.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5 justify-end">
              {fullMessage.attachments.map((att) => (
                <AssetChip
                  key={att.asset_id}
                  compact
                  asset={{
                    localId:   att.asset_id,
                    assetId:   att.asset_id,
                    filename:  att.filename,
                    mimeType:  att.mime_type,
                    sizeBytes: att.size_bytes,
                    publicUrl: att.public_url,
                    status:    'ready',
                    progress:  100,
                  }}
                />
              ))}
            </div>
          )}
          {content && (
            <div className={`rounded-2xl rounded-tr-sm ${isShort ? 'px-4 py-2' : 'px-4 py-2.5'} bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.08] transition-all duration-200 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.2)]`}>
              <p className="text-[13px] text-slate-200 leading-relaxed whitespace-pre-wrap">{content}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="text-[10px] text-[#94A3B8]">{formatTime(fullMessage.timestamp)}</span>
            <button onClick={handleCopy} className="p-0.5 rounded text-[#94A3B8] hover:text-[#CBD5E1] transition-colors">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ─── Assistant message ───
  // Split a trailing model-written sources block into a compact collapsed
  // control — only once generation is complete (partial content mid-stream
  // would make detection unstable).
  const { body, sources, count } = !isGenerating
    ? splitTrailingSources(content)
    : { body: content, sources: null, count: 0 };

  // Structured web sources (real backend `urls`) — rendered as a favicon
  // drawer under the bubble. When present they supersede any model-written
  // "Sources" text block so the drawer isn't duplicated.
  const structuredSources = !isGenerating ? (fullMessage.sources ?? []) : [];
  const hasStructuredSources = structuredSources.length > 0;
  const showSourcesLabel = t('sourceShowSources');
  const usedLabel = t('sourceUsed');

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex py-1 group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* No assistant avatar — clean ChatGPT/Claude-style flow; the
          typing indicator carries the activity state instead. */}
      <div className="flex-1 min-w-0 max-w-[92%] md:max-w-[88%] lg:max-w-[84%]">
        {/* Bubble */}
        <div
          className={`rounded-2xl rounded-tl-sm border transition-all duration-200 ${
            isShort
              ? 'px-4 py-2.5 bg-transparent border-transparent hover:border-white/[0.04] hover:bg-white/[0.01]'
              : 'px-4 py-3 bg-white/[0.01] border-transparent hover:border-white/[0.05] hover:bg-white/[0.02] shadow-[0_1px_6px_-2px_rgba(0,0,0,0.15)]'
          }`}
        >
          <div ref={contentRef} className="prose prose-invert prose-sm max-w-none">
            <MarkdownBody text={body} />
          </div>

          {/* Live streaming caret — shown ONLY while THIS message is the
              actively generating one. Server tokens fill the bubble live;
              the caret trails the text. It disappears the moment
              generation completes, so no post-completion replay. */}
          {isGenerating && isLatestAssistant && (
            <motion.span
              className="inline-block w-[2px] h-4 bg-[#60A5FA] ml-0.5 align-middle"
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
          )}
        </div>

        {/* Structured web sources — favicon drawer under the bubble.
            Never inline in the answer. Uses real backend `urls` only. */}
        {hasStructuredSources && (
          <MessageSources sources={structuredSources} showLabel={showSourcesLabel} usedLabel={usedLabel} />
        )}

        {/* Fallback: a model-written "Sources" text block (no structured
            metadata). Kept collapsed so the answer stays clean. */}
        {!hasStructuredSources && sources && (
          <details className="mt-1.5 group/sources">
            <summary className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[#CBD5E1] hover:text-[#F8FAFC] border border-[#253142] bg-white/[0.01] cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden transition-colors">
              {showSourcesLabel} · {count}
            </summary>
            <div className="mt-1.5 px-3 py-2 rounded-xl border border-[#253142] bg-white/[0.01] prose prose-invert prose-sm max-w-none">
              <MarkdownBody text={sources} />
            </div>
          </details>
        )}

        {/* Action row — shows on hover, hidden during generation */}
        {!isGenerating && (
          <div className={`flex items-center gap-0.5 mt-1.5 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#94A3B8] hover:text-[#CBD5E1] hover:bg-white/[0.03] transition-all"
              title="Copy"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>

            {onPin && (
              <button
                onClick={() => onPin(fullMessage)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#94A3B8] hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.06] transition-all"
                title={isPinned ? 'Unpin' : 'Pin'}
              >
                {isPinned ? <PinOff className="h-3 w-3 text-[#60A5FA]" /> : <Pin className="h-3 w-3" />}
              </button>
            )}

            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#94A3B8] hover:text-[#CBD5E1] hover:bg-white/[0.03] transition-all"
                title="Regenerate"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}

            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#94A3B8] hover:text-[#4ADE80] hover:bg-[#4ADE80]/[0.03] transition-all">
              <ThumbsUp className="h-3 w-3" />
            </button>

            <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[#94A3B8] hover:text-[#F87171] hover:bg-[#F87171]/[0.03] transition-all">
              <ThumbsDown className="h-3 w-3" />
            </button>

            <span className="text-[10px] text-[#CBD5E1] ml-1">{formatTime(fullMessage.timestamp)}</span>
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
