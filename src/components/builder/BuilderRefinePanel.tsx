// BuilderRefinePanel — the post-generation edit/refine layer shared by
// Website Builder and App Builder. Turns a one-shot generated result into
// something the user can keep shaping: a natural-language edit instruction,
// quick-edit chips for common asks, and structured settings (brand name,
// accent color, density, layout, CTA text) — all funneled through ONE
// "Apply update" action that hands the host page a typed patch. The host
// decides how to apply it (rebuild locally, or re-run the orchestrator with
// an enhanced prompt) — this component owns no build logic of its own.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wand2, Settings2, Copy, Eye, Pencil, Check, ChevronDown, Sparkles,
} from 'lucide-react';
import {
  COLOR_DIRECTIONS, DENSITIES, LAYOUT_TYPES, summarizeAnswers, type DesignBriefAnswers,
} from '@/lib/designBrief';
import DesignDirectionBadge from './DesignDirectionBadge';
import type { BuilderPalette } from './promptCategory';

export interface RefinePatch {
  /** Free-text edit instruction — folded into the enhanced rebuild prompt. Empty when only settings changed. */
  instruction: string;
  brandName?: string;
  colorDirection?: string;
  density?: string;
  layoutType?: string;
  ctaText?: string;
}

export interface QuickEdit {
  label: string;
  /** A structured, unambiguous change — applied immediately on click. */
  patch?: Partial<Omit<RefinePatch, 'instruction'>>;
  /** An ambiguous change — seeds the instruction textarea for the user to refine before applying. */
  instruction?: string;
}

export const WEBSITE_QUICK_EDITS: QuickEdit[] = [
  { label: 'Change brand name', instruction: 'Change the brand name to something more specific and premium for this product.' },
  { label: 'Adjust colors' },
  { label: 'Rewrite hero', instruction: 'Rewrite the hero headline and subheadline to be sharper and more specific to this product.' },
  { label: 'Make dashboard denser', patch: { density: 'Data Heavy' } },
  { label: 'Add pricing', instruction: 'Add a pricing section with realistic tiers for this product.' },
  { label: 'Add FAQ', instruction: 'Add an FAQ section addressing the most common objections.' },
  { label: 'More premium', instruction: 'Make this feel more premium overall — richer visuals, sharper and more confident copy.' },
  { label: 'More minimal', patch: { density: 'Clean' } },
];

export const APP_QUICK_EDITS: QuickEdit[] = [
  { label: 'Change app name', instruction: 'Change the app name to something more specific and premium for this product.' },
  { label: 'Adjust accent palette' },
  { label: 'Denser dashboard', patch: { density: 'Data Heavy' } },
  { label: 'More minimal', patch: { density: 'Clean' } },
  { label: 'Emphasize a different module', instruction: 'Shift emphasis toward the single most important module for this product.' },
  { label: 'More premium copy tone', instruction: 'Make the copy tone feel more premium and confident throughout.' },
];

interface BuilderRefinePanelProps {
  accent: string;
  accent2?: string;
  palette: BuilderPalette;
  categoryLabel: string;
  brief: DesignBriefAnswers;
  brandName: string;
  brandLabel?: string;
  /** Omit to hide the CTA-text setting row (not every surface exposes one). */
  ctaText?: string;
  quickEdits?: QuickEdit[];
  onApply: (patch: RefinePatch) => void;
  busy?: boolean;
}

type Tab = 'refine' | 'settings';

export default function BuilderRefinePanel({
  accent, accent2, palette, categoryLabel, brief, brandName, brandLabel = 'Brand name',
  ctaText, quickEdits = WEBSITE_QUICK_EDITS, onApply, busy = false,
}: BuilderRefinePanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('refine');
  const [instruction, setInstruction] = useState('');
  const [draftBrand, setDraftBrand] = useState(brandName);
  const [draftColor, setDraftColor] = useState(brief.colorDirection);
  const [draftDensity, setDraftDensity] = useState(brief.density);
  const [draftLayout, setDraftLayout] = useState(brief.layoutType);
  const [draftCta, setDraftCta] = useState(ctaText || '');
  const [copied, setCopied] = useState(false);

  useEffect(() => setDraftBrand(brandName), [brandName]);
  useEffect(() => setDraftColor(brief.colorDirection), [brief.colorDirection]);
  useEffect(() => setDraftDensity(brief.density), [brief.density]);
  useEffect(() => setDraftLayout(brief.layoutType), [brief.layoutType]);
  useEffect(() => setDraftCta(ctaText || ''), [ctaText]);

  const hasSettingsChange =
    draftBrand !== brandName || draftColor !== brief.colorDirection ||
    draftDensity !== brief.density || draftLayout !== brief.layoutType ||
    (ctaText !== undefined && draftCta !== ctaText);
  const canApply = instruction.trim().length > 0 || hasSettingsChange;

  const openTo = (t: Tab) => { setOpen(true); setTab(t); };

  const handleChip = (qe: QuickEdit) => {
    if (busy) return;
    if (qe.patch) { onApply({ instruction: '', ...qe.patch }); return; }
    if (qe.instruction) { setInstruction(qe.instruction); openTo('refine'); return; }
    openTo('settings');
  };

  const handleApply = () => {
    if (!canApply || busy) return;
    const patch: RefinePatch = { instruction: instruction.trim() };
    if (draftBrand !== brandName) patch.brandName = draftBrand;
    if (draftColor !== brief.colorDirection) patch.colorDirection = draftColor;
    if (draftDensity !== brief.density) patch.density = draftDensity;
    if (draftLayout !== brief.layoutType) patch.layoutType = draftLayout;
    if (ctaText !== undefined && draftCta !== ctaText) patch.ctaText = draftCta;
    onApply(patch);
    setInstruction('');
  };

  const handleCopy = async () => {
    const summary = `${brandName} — ${summarizeAnswers(brief)}`;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fail silently, no crash.
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.05] flex-wrap">
        <DesignDirectionBadge categoryLabel={categoryLabel} designSummary={summarizeAnswers(brief)} palette={palette} />
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton icon={Pencil} label="Edit build" active={open && tab === 'refine'} onClick={() => openTo('refine')} accent={accent} />
          <ToolbarButton icon={Wand2} label="Refine" active={open && tab === 'refine'} onClick={() => openTo('refine')} accent={accent} />
          <ToolbarButton icon={Settings2} label="Settings" active={open && tab === 'settings'} onClick={() => openTo('settings')} accent={accent} />
          <ToolbarButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} onClick={handleCopy} accent={accent} />
          <ToolbarButton icon={Eye} label="Preview" onClick={() => setOpen(false)} accent={accent} />
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
            title={open ? 'Collapse' : 'Expand'}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="p-4 space-y-4">
              {/* Quick edits */}
              <div className="flex flex-wrap gap-1.5">
                {quickEdits.map((qe) => (
                  <button
                    key={qe.label}
                    onClick={() => handleChip(qe)}
                    disabled={busy}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] border bg-white/[0.02] text-slate-300 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ borderColor: `${accent}30` }}
                  >
                    {qe.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] border border-white/[0.04] p-0.5 w-fit">
                <TabButton label="Refine" active={tab === 'refine'} onClick={() => setTab('refine')} />
                <TabButton label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
              </div>

              {tab === 'refine' ? (
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Tell Korvix what to change in this build…"
                  rows={3}
                  className="w-full px-3.5 py-3 rounded-xl bg-black/20 border text-[13px] text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none transition-colors"
                  style={{ borderColor: `${accent}30` }}
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={brandLabel}>
                    <input
                      value={draftBrand}
                      onChange={(e) => setDraftBrand(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg bg-black/20 border border-white/[0.06] text-[13px] text-slate-200 focus:outline-none"
                    />
                  </Field>
                  {ctaText !== undefined && (
                    <Field label="CTA text">
                      <input
                        value={draftCta}
                        onChange={(e) => setDraftCta(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-black/20 border border-white/[0.06] text-[13px] text-slate-200 focus:outline-none"
                      />
                    </Field>
                  )}
                  <Field label="Accent color / palette">
                    <ChipRow options={COLOR_DIRECTIONS} value={draftColor} onChange={setDraftColor} accent={accent} />
                  </Field>
                  <Field label="Visual density">
                    <ChipRow options={DENSITIES} value={draftDensity} onChange={setDraftDensity} accent={accent} />
                  </Field>
                  <Field label="Layout style">
                    <ChipRow options={LAYOUT_TYPES} value={draftLayout} onChange={setDraftLayout} accent={accent} />
                  </Field>
                </div>
              )}

              <button
                onClick={handleApply}
                disabled={!canApply || busy}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent2 || accent})`, color: '#05060a' }}
              >
                <Sparkles className="w-4 h-4" /> {busy ? 'Applying…' : 'Apply update'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolbarButton({
  icon: Icon, label, active, onClick, accent,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; active?: boolean; onClick: () => void; accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
      style={{
        color: active ? accent : '#94a3b8',
        background: active ? `${accent}18` : 'transparent',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
        active ? 'bg-white/[0.06] text-white' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      {children}
    </div>
  );
}

function ChipRow({
  options, value, onChange, accent,
}: {
  options: readonly string[]; value: string; onChange: (v: string) => void; accent: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="px-2.5 py-1 rounded-md text-[11px] border transition-all"
            style={isActive
              ? { background: `${accent}22`, borderColor: `${accent}55`, color: '#fff' }
              : { background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.07)', color: '#94a3b8' }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
