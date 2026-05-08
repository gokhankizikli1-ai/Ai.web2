import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';
import CodeBlock from './CodeBlock';

interface MarkdownMessageProps {
  content: string;
}

const components: Components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="text-xl font-bold text-white mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="text-lg font-semibold text-white mt-4 mb-2">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-base font-semibold text-white mt-3 mb-1.5">{children}</h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h4 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h4>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-sm text-slate-300 leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-3 ml-1">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="text-sm text-slate-300 list-decimal list-inside space-y-1 mb-3 ml-1">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  code: ({ className, children }: { className?: string; children?: ReactNode }) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';
    const codeString = String(children).replace(/\n$/, '');

    if (match) {
      return <CodeBlock language={language}>{codeString}</CodeBlock>;
    }

    return (
      <code className="px-1.5 py-0.5 rounded-md bg-white/10 text-cyan-300 text-xs font-mono">
        {children}
      </code>
    );
  },
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-l-2 border-cyan-500/40 pl-4 my-3 text-slate-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-white/10" />,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic text-slate-200">{children}</em>
  ),
  table: ({ children }: { children?: ReactNode }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm text-left text-slate-300 border border-white/10 rounded-lg overflow-hidden">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-white/5 text-slate-200 text-xs uppercase">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="px-4 py-2.5 font-semibold border-b border-white/10">{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="px-4 py-2 border-b border-white/5">{children}</td>
  ),
  tr: ({ children }: { children?: ReactNode }) => (
    <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>
  ),
  del: ({ children }: { children?: ReactNode }) => (
    <del className="line-through text-slate-500">{children}</del>
  ),
};

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
