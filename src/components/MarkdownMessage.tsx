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
        // Headings
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-white mt-4 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-white mt-4 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold text-white mt-3 mb-1.5">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h4>
        ),

        // Paragraphs
        p: ({ children }) => (
          <p className="text-sm text-slate-300 leading-relaxed mb-3 last:mb-0">{children}</p>
        ),

        // Lists
        ul: ({ children }) => (
          <ul className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-3 ml-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="text-sm text-slate-300 list-decimal list-inside space-y-1 mb-3 ml-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed">{children}</li>
        ),

        // Inline code
        code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : 'text';
          const codeString = String(children).replace(/\n$/, '');

          if (match) {
            return <CodeBlock language={language}>{codeString}</CodeBlock>;
          }

          return (
            <code
              className="px-1.5 py-0.5 rounded-md bg-white/10 text-cyan-300 text-xs font-mono"
              {...props}
            >
              {children}
            </code>
          );
        },

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-cyan-500/40 pl-4 my-3 text-slate-400 italic">
            {children}
          </blockquote>
        ),

        // Horizontal rule
        hr: () => <hr className="my-4 border-white/10" />,

        // Links
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
          >
            {children}
          </a>
        ),

        // Strong / Bold
        strong: ({ children }) => (
          <strong className="font-semibold text-white">{children}</strong>
        ),

        // Emphasis / Italic
        em: ({ children }) => (
          <em className="italic text-slate-200">{children}</em>
        ),

        // Tables
        table: ({ children }) => (
          <div className="overflow-x-auto my-3">
            <table className="w-full text-sm text-left text-slate-300 border border-white/10 rounded-lg overflow-hidden">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-white/5 text-slate-200 text-xs uppercase">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2.5 font-semibold border-b border-white/10">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2 border-b border-white/5">{children}</td>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>
        ),

        // Strikethrough
        del: ({ children }) => (
          <del className="line-through text-slate-500">{children}</del>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
