import { useMemo } from 'react';
import type { ReactNode } from 'react';
import CodeBlock from './CodeBlock';

interface MarkdownMessageProps {
  content: string;
}

function parseInline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch   = remaining.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*/);
    const italicMatch = remaining.match(/^([\s\S]*?)\*([\s\S]+?)\*/);
    const codeMatch   = remaining.match(/^([\s\S]*?)`([^`]+)`/);
    const linkMatch   = remaining.match(/^([\s\S]*?)\[([^\]]+)\]\(([^)]+)\)/);
    const strikeMatch = remaining.match(/^([\s\S]*?)~~([\s\S]+?)~~/);

    type Candidate = { type: string; match: RegExpMatchArray; end: number };
    const candidates: Candidate[] = (
      [
        boldMatch   && { type: 'bold',   match: boldMatch,   end: boldMatch[0].length },
        italicMatch && { type: 'italic', match: italicMatch, end: italicMatch[0].length },
        codeMatch   && { type: 'code',   match: codeMatch,   end: codeMatch[0].length },
        linkMatch   && { type: 'link',   match: linkMatch,   end: linkMatch[0].length },
        strikeMatch && { type: 'strike', match: strikeMatch, end: strikeMatch[0].length },
      ] as (Candidate | false)[]
    ).filter((c): c is Candidate => Boolean(c));

    if (candidates.length === 0) {
      result.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const earliest = candidates.reduce((a, b) =>
      a.match[1].length <= b.match[1].length ? a : b
    );

    const before = earliest.match[1];
    if (before) result.push(<span key={key++}>{before}</span>);

    switch (earliest.type) {
      case 'bold':
        result.push(<strong key={key++} className="font-semibold text-white">{earliest.match[2]}</strong>);
        break;
      case 'italic':
        result.push(<em key={key++} className="italic text-slate-200">{earliest.match[2]}</em>);
        break;
      case 'code':
        result.push(
          <code key={key++} className="px-1.5 py-0.5 rounded-md bg-white/10 text-cyan-300 text-xs font-mono">
            {earliest.match[2]}
          </code>
        );
        break;
      case 'link':
        result.push(
          <a key={key++} href={earliest.match[3]} target="_blank" rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors">
            {earliest.match[2]}
          </a>
        );
        break;
      case 'strike':
        result.push(<del key={key++} className="line-through text-slate-500">{earliest.match[2]}</del>);
        break;
    }

    remaining = remaining.slice(earliest.end);
  }

  return result;
}

function parseMarkdown(content: string): ReactNode[] {
  const lines = content.split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(<CodeBlock key={key++} language={lang}>{codeLines.join('\n')}</CodeBlock>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={key++} className="my-4 border-white/10" />);
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = parseInline(headingMatch[2]);
      const cls: Record<number, string> = {
        1: 'text-xl font-bold text-white mt-4 mb-2',
        2: 'text-lg font-semibold text-white mt-4 mb-2',
        3: 'text-base font-semibold text-white mt-3 mb-1.5',
        4: 'text-sm font-semibold text-white mt-2 mb-1',
      };
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
      nodes.push(<Tag key={key++} className={cls[level]}>{text}</Tag>);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote key={key++} className="border-l-2 border-cyan-500/40 pl-4 my-3 text-slate-400 italic">
          {parseInline(quoteLines.join(' '))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: ReactNode[] = [];
      let li = 0;
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(<li key={li++} className="leading-relaxed">{parseInline(lines[i].replace(/^[-*+]\s/, ''))}</li>);
        i++;
      }
      nodes.push(
        <ul key={key++} className="text-sm text-slate-300 list-disc list-inside space-y-1 mb-3 ml-1">
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: ReactNode[] = [];
      let li = 0;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={li++} className="leading-relaxed">{parseInline(lines[i].replace(/^\d+\.\s/, ''))}</li>);
        i++;
      }
      nodes.push(
        <ol key={key++} className="text-sm text-slate-300 list-decimal list-inside space-y-1 mb-3 ml-1">
          {items}
        </ol>
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !/^[-*+]\s/.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      nodes.push(
        <p key={key++} className="text-sm text-slate-300 leading-relaxed mb-3 last:mb-0">
          {parseInline(paraLines.join(' '))}
        </p>
      );
    }
  }

  return nodes;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  const rendered = useMemo(() => parseMarkdown(content), [content]);
  return <div>{rendered}</div>;
}
