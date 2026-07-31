import { Crown } from 'lucide-react';
import { useBillingPlan } from '@/hooks/useBillingPlan';

/**
 * Top-right plan badge. Reads the ONE authoritative, account-scoped plan source
 * (useBillingPlan → GET /v2/billing/me) — the SAME source the sidebar account
 * card and credit display use, so they can never disagree and never show a
 * previous account's plan. Renders nothing while the plan is unknown/loading
 * (never a misleading Free/Pro). Owner-session status is shown separately by
 * OwnerModeChip — it does not affect this badge.
 */
export default function PremiumBadge() {
  const { planKey: plan } = useBillingPlan();

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
