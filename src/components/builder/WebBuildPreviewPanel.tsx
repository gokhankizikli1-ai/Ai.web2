import BrowserFrame from '@/components/builder/BrowserFrame';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * A polished, browser-style visual approximation of the generated site — hero,
 * CTA, feature/service cards, a testimonial/process band, and a footer, driven
 * by the real section list + copy previews. Not a live iframe; an honest
 * "preview summary" (labelled as such) so the user can see the shape.
 */
const ACCENT = '#60A5FA';

const has = (items: WebBuildSectionItem[], re: RegExp) => items.find((s) => re.test(s.id) || re.test(s.name.toLowerCase()));

export default function WebBuildPreviewPanel({
  sectionItems, brief, slug,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  slug?: string;
}) {
  const { t } = useLanguageStore();

  const hero = has(sectionItems, /hero/);
  const features = sectionItems.filter((s) => /feature|service|benefit|how|process|step/i.test(s.id) || /feature|service|benefit|how|process|step/i.test(s.name)).slice(0, 3);
  const social = has(sectionItems, /social|testimonial|proof|review/);
  const pricing = has(sectionItems, /pricing|plan/);
  const cta = has(sectionItems, /cta|final|contact|book|appointment/);

  const heroTitle = hero?.headline || hero?.copyPreview?.split(/[.!?\n]/)[0] || brief?.type || 'Your website';
  const heroSub = hero?.sub || hero?.purpose || brief?.goal || '';
  const heroCta = hero?.cta || cta?.cta || cta?.name || t('wbCardOpen');

  return (
    <div>
      <BrowserFrame url={slug || 'preview.korvix.build'} accentColor={ACCENT}>
        <div className="bg-[#0B0E14]">
          {/* Top nav sketch */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05]">
            <div className="h-2.5 w-16 rounded bg-white/[0.14]" />
            <div className="hidden sm:flex items-center gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-1.5 w-10 rounded bg-white/[0.06]" />)}
              <div className="h-5 w-16 rounded-md" style={{ background: `${ACCENT}33` }} />
            </div>
          </div>

          {/* Hero */}
          <div className="px-6 py-9 text-center">
            <div className="mx-auto max-w-md">
              <h3 className="text-[16px] font-semibold text-white leading-snug">{heroTitle}</h3>
              {heroSub && <p className="mt-2 text-[11.5px] text-[#94A3B8] leading-relaxed">{heroSub}</p>}
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="h-7 rounded-lg px-5 flex items-center text-[11px] font-medium text-[#05060a]" style={{ background: ACCENT }}>
                  {heroCta}
                </div>
                <div className="h-7 w-24 rounded-lg border border-white/[0.1]" />
              </div>
            </div>
          </div>

          {/* Feature / service cards */}
          {features.length > 0 && (
            <div className="px-6 pb-8 grid grid-cols-3 gap-3">
              {features.map((f) => (
                <div key={f.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="h-6 w-6 rounded-lg mb-2" style={{ background: `${ACCENT}22` }} />
                  <div className="text-[11px] font-medium text-slate-200 mb-1 truncate">{f.headline || f.name}</div>
                  {(f.sub || f.bullets?.[0] || f.copyPreview) ? (
                    <p className="text-[10px] text-[#94A3B8] leading-snug line-clamp-3">{f.sub || f.bullets?.[0] || f.copyPreview}</p>
                  ) : (
                    <>
                      <div className="h-1 w-full rounded bg-white/[0.06] mb-1" />
                      <div className="h-1 w-2/3 rounded bg-white/[0.04]" />
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Social proof / process band */}
          {social && (
            <div className="mx-6 mb-8 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-white/[0.08]" />
                <div className="flex-1">
                  <div className="h-1.5 w-full rounded bg-white/[0.06] mb-1.5" />
                  <div className="h-1.5 w-3/4 rounded bg-white/[0.04]" />
                </div>
              </div>
            </div>
          )}

          {/* Pricing sketch */}
          {pricing && (
            <div className="px-6 pb-8 grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`rounded-xl border p-3 ${i === 1 ? 'border-[#3B82F6]/40 bg-[#3B82F6]/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                  <div className="h-1.5 w-12 rounded bg-white/[0.1] mb-2" />
                  <div className="h-4 w-16 rounded bg-white/[0.12] mb-2" />
                  {[0, 1, 2].map((j) => <div key={j} className="h-1 w-full rounded bg-white/[0.05] mb-1" />)}
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-5 border-t border-white/[0.05] flex items-center justify-between">
            <div className="h-2 w-14 rounded bg-white/[0.08]" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-1.5 w-8 rounded bg-white/[0.05]" />)}
            </div>
          </div>
        </div>
      </BrowserFrame>
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
    </div>
  );
}
