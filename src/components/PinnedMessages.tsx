import { Pin, X, Sparkles } from 'lucide-react';
import type { Message } from '@/types';

interface PinnedMessagesProps {
  messages: Message[];
  onRemove: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

export default function PinnedMessages({ messages, onRemove, open, onToggle }: PinnedMessagesProps) {
  if (messages.length === 0) return null;

  return (
    <div className="border-b border-white/[0.04] bg-[#11151C]/50 backdrop-blur-sm">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-2 text-[11px] text-[#7F8FA3] hover:text-slate-300 transition-colors"
      >
        <Pin className="h-3 w-3" />
        <span className="font-medium">{messages.length} pinned</span>
        <span className="text-[#7F8FA3] ml-auto">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 animate-fade-in">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="flex items-start gap-2 rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5 group relative"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#7EA6BF]/80 to-[#9CBBD1]/80 mt-0.5">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <p className="text-[11px] text-[#A9B7C6] leading-relaxed line-clamp-3 flex-1 min-w-0">
                {msg.content}
              </p>
              <button
                onClick={() => onRemove(msg.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-[#7F8FA3] hover:text-[#C98282] hover:bg-[#C98282]/10"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
