import { Sparkles } from 'lucide-react';

export default function PremiumBadge() {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 px-2.5 py-0.5 text-xs font-medium text-amber-400 animate-glow-pulse">
      <Sparkles className="h-3 w-3" />
      PRO
    </div>
  );
}
