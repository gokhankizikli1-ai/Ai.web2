import { Sparkles } from 'lucide-react';

export default function PremiumBadge() {
  return (
    <div className="inline-flex items-center gap-[5px] rounded-full bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/15 px-2.5 py-[3px] text-[10px] font-semibold text-amber-400/90 tracking-wide uppercase">
      <Sparkles className="h-[10px] w-[10px]" />
      Pro
    </div>
  );
}
