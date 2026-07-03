import { Crown } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useAuthStore } from '@/stores/authStore';
import { resolvePlanKey } from '@/lib/plan';

/**
 * Top-right plan badge. Reads the SAME plan source as the sidebar account
 * card (src/lib/plan.ts) so the two can never disagree. Renders nothing while
 * the plan is unknown (never a misleading "Free"). Owner-session status is
 * shown separately by OwnerModeChip — it does not affect this badge.
 */
export default function PremiumBadge() {
  const { settings } = useApp();
  const user = useAuthStore((s) => s.user);
  const plan = resolvePlanKey(user?.plan, settings.plan);

  if (!plan) return null;                 // unknown/loading → neutral (nothing)

  const isPaid = plan !== 'free';
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[10px] tracking-wide border ${
        isPaid
          ? 'bg-[#3B82F6]/[0.06] border-[#3B82F6]/15 text-[#60A5FA]'
          : 'bg-white/[0.02] border-white/[0.04] text-[#94A3B8]'
      }`}
    >
      {isPaid && <Crown className="w-2.5 h-2.5" />}
      {label}
    </div>
  );
}
