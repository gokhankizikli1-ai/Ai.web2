import { useState } from 'react';
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MessageActionsProps {
  content: string;
  onRegenerate?: () => void;
}

export default function MessageActions({ content, onRegenerate }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  const handleLike = () => {
    setLiked((prev) => !prev);
    setDisliked(false);
  };

  const handleDislike = () => {
    setDisliked((prev) => !prev);
    setLiked(false);
  };

  return (
    <div className="flex items-center gap-0.5 mt-2.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="h-7 gap-1.5 px-2 text-[11px] text-[#858B99] hover:text-slate-300 hover:bg-white/[0.06] rounded-md transition-all duration-200"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
            <span className="text-[#4ADE80]">Copied</span>
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
          className="h-7 gap-1.5 px-2 text-[11px] text-[#858B99] hover:text-slate-300 hover:bg-white/[0.06] rounded-md transition-all duration-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Regenerate</span>
        </Button>
      )}

      <div className="w-px h-4 bg-white/[0.06] mx-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={handleLike}
        className={`h-7 w-7 p-0 rounded-md transition-all duration-200 ${
          liked ? 'text-[#4ADE80] bg-[#4ADE80]/10' : 'text-[#858B99] hover:text-slate-300 hover:bg-white/[0.06]'
        }`}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={handleDislike}
        className={`h-7 w-7 p-0 rounded-md transition-all duration-200 ${
          disliked ? 'text-[#F87171] bg-[#F87171]/10' : 'text-[#858B99] hover:text-slate-300 hover:bg-white/[0.06]'
        }`}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
