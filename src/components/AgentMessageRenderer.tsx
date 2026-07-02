import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ListTree, FileCode2, ListChecks, Wand2, Sparkles, FolderTree, Layers, Lightbulb } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════
   Phase 3.7 — Structured agent-response renderer.
   ═══════════════════════════════════════════════════════════════════
   The orchestrator returns markdown with second-level headers
   (## Plan, ## <Specialist Name>, ## Intent, ## Design direction,
   ## Component architecture, ## File structure,
   ## Implementation plan, ## Code skeleton, ## Next actions,
   ## Recommendation). Rendering this as a single paragraph dump
   loses the structure and makes the agent feel like a chatbot.

   This component splits the content on `## ` headers and renders
   each section as a small card with a contextual icon. Inside each
   card the body is rendered via react-markdown + remark-gfm so
   bullet lists, numbered steps, inline code, fenced code blocks,
   and tables all get the right typography.

   Falls back gracefully:
     - If no `## ` headers are detected, the whole content renders
       as a single markdown block (legacy /chat replies, simple
       conversational answers).
     - If content is empty, renders nothing (caller decides whether
       to show a typing indicator instead — avoids the "empty bubble"
       UX bug from Phase 3.6).
   ═══════════════════════════════════════════════════════════════════ */

export interface AgentMessageRendererProps {
  content: string;
  /** When true, suppresses the empty-state render so the caller's
   *  typing indicator owns the visual slot. */
  isStreaming?: boolean;
}

interface Section {
  heading: string;
  body:    string;
}

/** Split a markdown string on top-level `## ` headers. Anything
 *  before the first `## ` becomes a leading "unsectioned" body
 *  (rare — supervisor output always opens with ## Plan, but be
 *  defensive). */
function splitOnH2(md: string): { lead: string; sections: Section[] } {
  // Use a regex that captures the heading line + everything until
  // the next heading line (or end of input). Multiline anchors so
  // `^` matches each line start.
  const re = /^##\s+(.+?)\s*$/gm;
  const matches: { heading: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    matches.push({
      heading: m[1].trim(),
      start:   m.index,
      end:     m.index + m[0].length,
    });
  }
  if (matches.length === 0) {
    return { lead: md, sections: [] };
  }
  const lead = md.slice(0, matches[0].start).trim();
  const sections: Section[] = matches.map((mt, i) => {
    const nextStart = i + 1 < matches.length ? matches[i + 1].start : md.length;
    return {
      heading: mt.heading,
      body:    md.slice(mt.end, nextStart).trim(),
    };
  });
  return { lead, sections };
}

/** Pick an accent icon + colour for a section based on its heading.
 *  Frontend Engineer's 7-section format + Supervisor's 3 sections
 *  all have stable header names — the icon makes the card scannable. */
function iconFor(heading: string): { Icon: typeof ListTree; tone: string } {
  const h = heading.toLowerCase();
  if (h.startsWith('plan'))                 return { Icon: Lightbulb, tone: 'text-[#7890A3]/70' };
  if (h.startsWith('intent'))               return { Icon: Wand2,     tone: 'text-[#7890A3]/70' };
  if (h.startsWith('design'))               return { Icon: Sparkles,  tone: 'text-[#7890A3]/70' };
  if (h.startsWith('component'))            return { Icon: ListTree,  tone: 'text-[#7890A3]/70' };
  if (h.startsWith('file'))                 return { Icon: FolderTree,tone: 'text-[#7890A3]/70' };
  if (h.startsWith('implementation'))       return { Icon: Layers,    tone: 'text-[#7890A3]/70' };
  if (h.startsWith('code'))                 return { Icon: FileCode2, tone: 'text-[#7890A3]/70' };
  if (h.startsWith('next'))                 return { Icon: ListChecks,tone: 'text-[#7890A3]/70' };
  if (h.startsWith('recommendation'))       return { Icon: Lightbulb, tone: 'text-[#7890A3]/70' };
  // Specialist sections (## Coder, ## Researcher, ## Frontend Engineer …)
  // get a neutral icon — the bot avatar already implies "agent".
  return { Icon: Sparkles, tone: 'text-white/50' };
}

/** Custom react-markdown renderers that match KorvixAI's compact
 *  glass-card aesthetic. Tailwind utility classes only — no extra
 *  CSS files. */
const mdComponents = {
  p:  ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[12px] text-white/75 leading-relaxed mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-[12px] text-white/70 leading-relaxed mb-2 last:mb-0 ml-3 list-disc marker:text-white/30 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-[12px] text-white/70 leading-relaxed mb-2 last:mb-0 ml-4 list-decimal marker:text-white/30 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="pl-1">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="text-white/90 font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="text-white/80 italic">{children}</em>
  ),
  // Inline code: subtle pill. Fenced code: full block with monospaced
  // styling. react-markdown passes a `inline` prop on the `code`
  // renderer so we can distinguish.
  code: ({ inline, className, children, ...rest }: {
    inline?: boolean; className?: string; children?: React.ReactNode;
  }) => {
    if (inline) {
      return (
        <code className="px-1 py-0.5 rounded text-[11px] font-mono text-[#7890A3]/90 bg-[#52677A]/[0.06] border border-[#52677A]/[0.08]" {...rest}>
          {children}
        </code>
      );
    }
    // For fenced code blocks the parent `pre` already wraps; this
    // renderer styles the inner <code>.
    return (
      <code className={`block text-[11px] font-mono text-white/85 leading-snug ${className || ''}`} {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="rounded-lg p-2.5 mb-2 last:mb-0 overflow-x-auto scrollbar-thin"
      style={{
        background: 'rgba(8,11,17,0.6)',
        border: '1px solid rgba(255,255,255,0.04)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.015)',
      }}>
      {children}
    </pre>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[13px] font-semibold text-white/85 mb-1.5 mt-1 first:mt-0">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    // h2 inside a section body is unusual (we already split on h2)
    // but kept for safety — render as a smaller sub-heading.
    <h4 className="text-[12px] font-semibold text-white/75 mb-1 mt-1.5 first:mt-0">{children}</h4>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="text-[11.5px] font-semibold text-white/70 mb-1 mt-1.5 first:mt-0">{children}</h4>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-[#52677A]/30 pl-2.5 my-1.5 text-[11.5px] text-white/55 italic">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto scrollbar-thin mb-2 last:mb-0">
      <table className="w-full text-[11px] text-white/70 border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-white/10 px-2 py-1 text-left font-semibold text-white/80">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-white/[0.04] px-2 py-1 align-top">{children}</td>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer noopener"
       className="text-[#7890A3]/80 hover:text-[#7890A3] underline decoration-[#52677A]/30 underline-offset-2">
      {children}
    </a>
  ),
  hr: () => <hr className="border-white/[0.04] my-2.5" />,
};

export default function AgentMessageRenderer({ content, isStreaming }: AgentMessageRendererProps) {
  const parsed = useMemo(() => splitOnH2(content || ''), [content]);

  // Empty + not actively streaming → render nothing so the bubble
  // collapses. Callers should show a typing indicator separately
  // during the fetch/first-token window. This is the "no empty
  // bubble" guarantee from Phase 3.7.
  if (!content || !content.trim()) {
    if (isStreaming) {
      // Still streaming but no content yet — show a subtle three-dot
      // pulse INSIDE the bubble so the layout stays stable.
      return (
        <div className="flex items-center gap-1 py-1">
          <span className="w-1 h-1 rounded-full bg-white/30 animate-pulse" />
          <span className="w-1 h-1 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: '120ms' }} />
          <span className="w-1 h-1 rounded-full bg-white/30 animate-pulse" style={{ animationDelay: '240ms' }} />
        </div>
      );
    }
    return null;
  }

  // No `## ` headers in the content — fall back to a single
  // markdown block. This covers legacy /chat replies and short
  // conversational answers from the supervisor (greeting, etc.).
  if (parsed.sections.length === 0) {
    return (
      <div className="text-[12px] text-white/75 leading-relaxed">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={mdComponents as never}
        >
          {parsed.lead}
        </ReactMarkdown>
      </div>
    );
  }

  // Structured output — render each h2 section as its own card.
  return (
    <div className="space-y-2">
      {parsed.lead && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={mdComponents as never}
        >
          {parsed.lead}
        </ReactMarkdown>
      )}
      {parsed.sections.map((sec, i) => {
        const { Icon, tone } = iconFor(sec.heading);
        return (
          <div key={`${sec.heading}-${i}`} className="rounded-lg p-2.5"
            style={{
              background: 'rgba(255,255,255,0.012)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`h-3 w-3 shrink-0 ${tone}`} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/55">
                {sec.heading}
              </span>
            </div>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={mdComponents as never}
            >
              {sec.body || '*(no content)*'}
            </ReactMarkdown>
          </div>
        );
      })}
    </div>
  );
}
