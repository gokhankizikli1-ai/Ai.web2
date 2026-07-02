import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-lg font-bold text-white mt-5 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold text-white mt-4 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[14px] font-semibold text-white mt-3 mb-1.5">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-[13px] font-semibold text-white mt-2 mb-1">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="text-[14px] text-[#CBD5E1] leading-[1.65] mb-3 last:mb-0">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="text-[14px] text-[#CBD5E1] list-disc list-inside space-y-1 mb-3 ml-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="text-[14px] text-[#CBD5E1] list-decimal list-inside space-y-1 mb-3 ml-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-[1.65]">{children}</li>
        ),
        code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
          const match = /language-(\w+)/.exec(className || '');
          const codeString = String(children).replace(/\n$/, '');

          if (match) {
            return <CodeBlock language={match[1]}>{codeString}</CodeBlock>;
          }

          return (
            <code className="px-[5px] py-[2px] rounded-md bg-white/[0.06] text-[#60A5FA]/90 text-[12px] font-mono border border-white/[0.05]">
              {children}
            </code>
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[#3B82F6]/30 pl-4 my-3 text-[#94A3B8] italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-4 border-white/[0.06]" />,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3B82F6]/80 hover:text-[#60A5FA] underline underline-offset-2 transition-colors"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-200">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-slate-300">{children}</em>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-xl border border-white/[0.06]">
            <table className="w-full text-[13px] text-left text-[#CBD5E1]">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-white/[0.03] text-slate-300 text-[11px] uppercase tracking-wider">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2 font-semibold border-b border-white/[0.06]">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2 border-b border-white/[0.03]">{children}</td>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-white/[0.015] transition-colors">{children}</tr>
        ),
        del: ({ children }) => (
          <del className="line-through text-[#94A3B8]">{children}</del>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
