import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      padding: '16px 0',
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
    <div className="my-3 rounded-xl overflow-hidden border border-white/[0.07] bg-[#0c0c14] message-shadow group/code">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.02] border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider ml-2">
            {displayLang}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5 px-2 text-[11px] text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all duration-200 rounded-md"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>

      {/* Code */}
      <div className="px-4 overflow-x-auto">
        {lang === 'text' ? (
          <pre className="py-4">
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
