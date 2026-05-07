import { useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MessageActionsProps {
  content: string;
  onRegenerate?: () => void;
}

export default function MessageActions({ content, onRegenerate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="h-7 gap-1.5 px-2 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/5"
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

      {onRegenerate && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          className="h-7 gap-1.5 px-2 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Regenerate</span>
        </Button>
      )}
    </div>
  );
}
