import { useState, useEffect } from 'react';
import {
  ShoppingCart, Calculator, ShieldAlert, Megaphone, Info,
  TrendingUp, Users, Swords, ChevronRight,
} from 'lucide-react';

/**
 * E-commerce / Dropshipping Intelligence — Phase 3 increment 2.
 *
 * A research FRAMEWORK + honest margin/risk math from the user's OWN
 * inputs. No live product/trend/supplier/competition data is fetched —
 * those sections route structured prompts into chat. Nothing fabricated;
 * arithmetic uses only the numbers the user entered.
 */
const LS_KEY = 'korvix.ecom.v1';

interface EcomState {
  product: string; niche: string;
  sell: string; cogs: string; ship: string; ad: string; feePct: string;
  saturation: number; adPolicy: number; shipComplex: number; returns: number; differentiation: number;
}
const DEFAULT: EcomState = {
  product: '', niche: '', sell: '', cogs: '', ship: '', ad: '', feePct: '3',
  saturation: 3, adPolicy: 3, shipComplex: 3, returns: 3, differentiation: 3,
};

function load(): EcomState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT;
}
const num = (s: string) => { const v = Number(s); return Number.isFinite(v) && v >= 0 ? v : 0; };

// Hoisted (stable identity) so inputs never lose focus on re-render.
function NumField({ label, value, ph, inputMode = 'decimal', onChange }: {
  label: string; value: string; ph?: string; inputMode?: 'decimal' | 'text'; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[9px] text-slate-600 block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
        inputMode={inputMode}
        className="w-full h-8 px-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-emerald-500/20 transition-all"
      />
    </div>
  );
}

function RiskSlider({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-1">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-400">{value}/5</span>
      </div>
      <input
        type="range" min={1} max={5} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500/70"
      />
    </div>
  );
}

const ROUTE_TAIL =
  '\n\nBe a senior e-commerce operator: concise, structured, actionable. ' +
  'Do NOT fabricate sales, trends, supplier, or competition numbers — ' +
  'if live product data is required, say so and give a validation method instead. ' +
  'Ask one clarifying question only if essential.';

export default function EcommercePanel({ onRunPrompt }: { onRunPrompt?: (p: string) => void }) {
  const [s, setS] = useState<EcomState>(load);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  const set = (patch: Partial<EcomState>) => setS((prev) => ({ ...prev, ...patch }));

  const sell = num(s.sell), cogs = num(s.cogs), ship = num(s.ship), ad = num(s.ad);
  const fees = sell * num(s.feePct) / 100;
  const totalCost = cogs + ship + fees + ad;
  const contribution = sell - totalCost;
  const marginPct = sell > 0 ? (contribution / sell) * 100 : 0;
  const maxAd = sell - cogs - ship - fees;
  const hasMoney = sell > 0 && (cogs > 0 || ship > 0 || ad > 0);

  const riskRaw = (s.saturation + s.adPolicy + s.shipComplex + s.returns) - s.differentiation; // -1..19
  const risk = Math.max(0, Math.min(100, Math.round(((riskRaw + 1) / 20) * 100)));
  const riskLabel = risk >= 66 ? 'High' : risk >= 40 ? 'Medium' : 'Low';
  const riskCls = risk >= 66 ? 'text-red-400' : risk >= 40 ? 'text-amber-400' : 'text-emerald-400';

  const recommendation = !hasMoney
    ? 'Enter your price and costs to get a margin-based read.'
    : marginPct < 15
      ? 'Margins look too thin — rework pricing/COGS before spending on ads.'
      : riskLabel === 'High'
        ? 'Elevated risk on your own assessment — validate demand and de-risk before committing budget.'
        : marginPct >= 25
          ? 'Workable on your inputs — validate real demand with a small test budget before scaling.'
          : 'Borderline — tighten margins or lower risk, then test small. Not a recommendation to spend.';

  const ctx = () => [
    s.product && `Product: ${s.product}`,
    s.niche && `Niche: ${s.niche}`,
    sell > 0 && `Sell ${sell}, COGS ${cogs}, ship ${ship}, fees ${fees.toFixed(2)}, ad/order ${ad} → margin ${marginPct.toFixed(1)}%`,
    `Self-assessed risk ${risk}/100 (${riskLabel})`,
  ].filter(Boolean).join('\n');

  const route = (prompt: string) =>
    onRunPrompt?.(prompt + (ctx() ? `\n\nContext (user inputs, not live data):\n${ctx()}` : '') + ROUTE_TAIL);

  const routeBtn = (label: string, prompt: string, Icon: typeof TrendingUp) => (
    <button
      onClick={() => route(prompt)}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 hover:border-emerald-500/20 hover:bg-emerald-500/[0.03] transition-all"
    >
      <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5 text-emerald-400/70" />{label}</span>
      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
    </button>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShoppingCart className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[12px] font-medium text-slate-300">E-commerce / Dropshipping research</span>
      </div>

      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <NumField label="Product idea" value={s.product} ph="e.g. posture-correction brace" inputMode="text" onChange={(v) => set({ product: v })} />
        <NumField label="Niche / audience" value={s.niche} ph="e.g. desk workers, back pain" inputMode="text" onChange={(v) => set({ niche: v })} />
      </div>

      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 space-y-3">
        <div className="flex items-center gap-2"><Calculator className="w-3.5 h-3.5 text-slate-500" /><span className="text-[12px] font-medium text-slate-300">Pricing &amp; margin</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <NumField label="Sell price" value={s.sell} ph="0" onChange={(v) => set({ sell: v })} />
          <NumField label="COGS" value={s.cogs} ph="0" onChange={(v) => set({ cogs: v })} />
          <NumField label="Shipping" value={s.ship} ph="0" onChange={(v) => set({ ship: v })} />
          <NumField label="Ad cost / order" value={s.ad} ph="0" onChange={(v) => set({ ad: v })} />
          <NumField label="Fees %" value={s.feePct} ph="3" onChange={(v) => set({ feePct: v })} />
        </div>
        {hasMoney ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded-lg bg-white/[0.02]"><p className="text-[9px] text-slate-600">Contribution</p><p className={`text-[13px] font-medium ${contribution >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{contribution.toFixed(2)}</p></div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]"><p className="text-[9px] text-slate-600">Margin %</p><p className={`text-[13px] font-medium ${marginPct >= 20 ? 'text-emerald-400' : marginPct >= 10 ? 'text-amber-400' : 'text-red-400'}`}>{marginPct.toFixed(1)}%</p></div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]"><p className="text-[9px] text-slate-600">Max ad / order</p><p className="text-[13px] font-medium text-white">{maxAd.toFixed(2)}</p></div>
            <div className="p-2.5 rounded-lg bg-white/[0.02]"><p className="text-[9px] text-slate-600">Total cost</p><p className="text-[13px] font-medium text-white">{totalCost.toFixed(2)}</p></div>
          </div>
        ) : (
          <p className="text-[10px] text-slate-600">Enter price &amp; costs — figures are computed from your inputs only.</p>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><ShieldAlert className="w-3.5 h-3.5 text-slate-500" /><span className="text-[12px] font-medium text-slate-300">Risk score</span></div>
          <span className={`text-[12px] font-semibold ${riskCls}`}>{risk}/100 · {riskLabel}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          <RiskSlider label="Market saturation" value={s.saturation} onChange={(v) => set({ saturation: v })} />
          <RiskSlider label="Ad-policy sensitivity" value={s.adPolicy} onChange={(v) => set({ adPolicy: v })} />
          <RiskSlider label="Shipping complexity" value={s.shipComplex} onChange={(v) => set({ shipComplex: v })} />
          <RiskSlider label="Expected return rate" value={s.returns} onChange={(v) => set({ returns: v })} />
          <RiskSlider label="Your differentiation (higher = better)" value={s.differentiation} onChange={(v) => set({ differentiation: v })} />
        </div>
        <p className="text-[10px] text-slate-600">Derived from your own assessment — not market data.</p>
      </div>

      <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] p-4">
        <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-1">Launch read</p>
        <p className="text-[12px] text-slate-300 leading-relaxed">{recommendation}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[9px] uppercase tracking-wide text-slate-600">Analyze with AI (routes to chat)</p>
        {routeBtn('Demand analysis framework', 'Give me a demand-validation framework for this product (how to test cheaply, signals to check).', TrendingUp)}
        {routeBtn('Competition analysis structure', 'Give me a structured competition-analysis approach for this product (what to map, how to find it).', Swords)}
        {routeBtn('Audience analysis structure', 'Define the target audience and a structured audience-research approach for this product.', Users)}
        {routeBtn('Generate ad angles', 'Generate 6 distinct ad angles for this product, each with the emotional driver and a sample hook.', Megaphone)}
        {routeBtn('Full e-commerce analysis', 'Run a full structured e-commerce assessment of this product: demand approach, competition approach, audience, pricing/margin read, risk, and a launch recommendation.', ShoppingCart)}
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
        <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Live product research source not connected yet — no trends, sales, supplier or
          competition data is fetched. Margin/risk use only your inputs; AI analyses are
          guidance, not live data.
        </p>
      </div>
    </div>
  );
}
