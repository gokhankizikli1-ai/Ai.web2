import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  language?: string;
  children: string;
}

export default function CodeBlock({ language = 'text', children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail if clipboard API is unavailable
    }
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/10 bg-[#0d0d14]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/5">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5 px-2 text-xs text-slate-400 hover:text-white hover:bg-white/5"
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
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm font-mono text-slate-300 leading-relaxed whitespace-pre">
          {children}
        </code>
      </pre>
    </div>
  );
}
