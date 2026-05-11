import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';

import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';

SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('markdown', markdown);

interface CodeBlockProps {
  language?: string;
  children: string;
}

const LANG_MAP: Record<string, string> = {
  '': 'text',
  'text': 'text',
  'js': 'javascript',
  'jsx': 'jsx',
  'ts': 'typescript',
  'tsx': 'tsx',
  'py': 'python',
  'sh': 'bash',
  'shell': 'bash',
  'bash': 'bash',
  'yml': 'yaml',
  'md': 'markdown',
};

export default function CodeBlock({ language = 'text', children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lang = LANG_MAP[language.toLowerCase()] || language.toLowerCase();
  const displayLang = lang === 'text' ? 'plaintext' : lang;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customStyle: any = {
    ...vscDarkPlus,
    'pre[class*="language-"]': {
      background: 'transparent',
      margin: 0,
      padding: '14px 0',
      fontSize: '13px',
      lineHeight: '1.7',
      borderRadius: 0,
    },
    'code[class*="language-"]': {
      background: 'transparent',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1.7',
    },
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-white/[0.04] bg-[#0a0a0e] group/code">
      {/* Header - minimal, monochrome */}
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-white/[0.015] border-b border-white/[0.03]">
        <span className="text-[11px] text-slate-700 uppercase tracking-wider">
          {displayLang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] transition-all duration-150 rounded"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <div className="px-3.5 overflow-x-auto">
        {lang === 'text' ? (
          <pre className="py-3.5">
            <code className="text-[13px] font-mono text-slate-300 leading-relaxed whitespace-pre">
              {children}
            </code>
          </pre>
        ) : (
          <SyntaxHighlighter
            language={lang}
            style={customStyle}
            PreTag="div"
            wrapLines={false}
          >
            {children}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
