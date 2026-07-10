import { type ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { VisualModule } from '@/lib/webBuildLayoutPlan';
import { detectMessageLanguage } from '@/lib/locale';

/**
 * Reusable STRUCTURAL visual modules for Web Build.
 *
 * These are not decorative panels or blank rectangles — each renders a real,
 * legible metaphor (a live dashboard, an access pass, a catalog index, a
 * floorplan, a product on a pedestal, a framed editorial image, a reservation
 * form, a process timeline, a before/after comparison, a topographic terrain).
 * The layout plan picks ONE as the primary module; hero compositions and key
 * sections embed it, so the visual language changes with the strategy.
 *
 * Colors come from the preview root CSS vars (--acc / --acc2), so a module reads
 * correctly against any strategy palette.
 */
/** Build language for the module's few STRUCTURAL fallback words (never real
 *  copy). Inferred from the passed labels when the caller does not pin one, so a
 *  Turkish build never shows an English structural fallback and vice-versa. */
type PLang = 'en' | 'tr';
const ML = (lang: PLang, en: string, tr: string): string => (lang === 'tr' ? tr : en);
const inferLang = (labels?: string[]): PLang =>
  detectMessageLanguage((labels || []).filter(Boolean).join(' ')) === 'tr' ? 'tr' : 'en';

export interface VisualModuleProps {
  kind: VisualModule;
  labels?: string[];
  className?: string;
  /** Compact variant for tight hero columns / section insets. */
  compact?: boolean;
  /** Build language for structural fallback words (inferred from labels if absent). */
  lang?: PLang;
}

const Frame = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`relative overflow-hidden rounded-[var(--pr)] border border-[color:var(--bd)] bg-[var(--sf)] ${className}`}>{children}</div>
);

const take = (labels: string[] | undefined, n: number, fallback: string[]): string[] => {
  const src = (labels && labels.filter(Boolean).length ? labels.filter(Boolean) : fallback);
  return Array.from({ length: n }, (_, i) => src[i % src.length]);
};

function DataDashboard({ labels, compact }: { labels?: string[]; compact?: boolean }) {
  const bars = [58, 82, 46, 94, 70, 88];
  const tiles = take(labels, 3, ['Aktif', 'Dönüşüm', 'Büyüme']);
  // No fabricated KPIs — each tile shows a real (or structural) label above a
  // neutral, non-numeric indicator bar, so the dashboard reads as a data surface
  // without inventing metrics.
  return (
    <Frame className="p-4 shadow-2xl shadow-black/40">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="ml-auto h-2 w-16 rounded-full bg-white/10" />
      </div>
      <div className={`grid gap-3 ${compact ? '' : 'sm:grid-cols-3'}`}>
        {tiles.map((tl, i) => (
          <div key={i} className="rounded-xl border border-[color:var(--bd)] bg-[var(--sf)] p-3">
            <div className="truncate text-[11px] font-medium text-slate-200">{tl}</div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${52 + (i * 17) % 40}%`, background: i % 2 ? 'var(--acc2)' : 'var(--acc)', opacity: 0.85 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-24 items-end gap-2 rounded-xl border border-[color:var(--bd)] bg-black/20 p-3">
        {bars.map((h, i) => (
          <motion.span
            key={i} className="flex-1 rounded-t"
            style={{ background: i % 2 ? 'var(--acc2)' : 'var(--acc)', opacity: 0.9 }}
            initial={{ height: 0 }} whileInView={{ height: `${h}%` }} viewport={{ once: true }}
            transition={{ duration: 0.7, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </div>
      <svg aria-hidden viewBox="0 0 300 60" className="mt-3 h-10 w-full" preserveAspectRatio="none">
        <polyline points="0,48 50,30 100,38 150,16 200,26 250,8 300,18" fill="none" stroke="var(--acc)" strokeWidth="2" />
      </svg>
    </Frame>
  );
}

function MembershipPass({ labels }: { labels?: string[] }) {
  const tier = (labels && labels[0]) || 'Membership';
  const holder = (labels && labels[1]) || 'Access · 2026';
  return (
    <Frame className="p-5">
      <div className="rounded-[var(--pr)] border border-[color:var(--bd)] p-5" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 24%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-white/70">Member</div>
            <div className="mt-1 text-lg font-semibold text-white">{tier}</div>
          </div>
          <span className="h-9 w-9 rounded-lg border border-white/20 bg-white/10" />
        </div>
        <div className="mt-8 flex items-end justify-between">
          <span className="text-xs text-white/80">{holder}</span>
          <div className="flex h-8 items-end gap-[3px]">
            {[3, 6, 2, 7, 4, 6, 2, 5, 3, 7, 2, 6].map((h, i) => <span key={i} className="w-[3px] bg-white/80" style={{ height: `${h * 3}px` }} />)}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function CatalogArchive({ labels, compact }: { labels?: string[]; compact?: boolean }) {
  const tiles = take(labels, compact ? 4 : 6, ['Koleksiyon', 'Arşiv', 'Seri', 'Edisyon', 'Parça', 'İndeks']);
  const reduce = useReducedMotion();
  // A real archive plate: document sheet with metadata rule lines + a small
  // curation seal — not an empty gradient. Structural only; no fake IDs/counts.
  return (
    <Frame className="p-4">
      <div className={`grid gap-2.5 ${compact ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {tiles.map((tl, i) => (
          <figure key={i} className="group relative overflow-hidden rounded-lg border border-[color:var(--bd)]">
            <div className="relative aspect-square w-full transition duration-500 group-hover:scale-[1.03]" style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), transparent)' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }}>
              <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.6 }}>
                {[26, 38, 50, 62].map((y, k) => <line key={k} x1="16" y1={y} x2={k % 2 ? 66 : 84} y2={y} stroke="rgba(255,255,255,0.28)" strokeWidth="1.6" />)}
                <circle cx="78" cy="24" r="8" fill="none" stroke="var(--acc)" strokeWidth="1.6" />
                <rect x="16" y="78" width="34" height="5" rx="2" fill="var(--acc)" opacity="0.55" />
              </svg>
            </div>
            <figcaption className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] font-medium text-white">{tl}</figcaption>
          </figure>
        ))}
      </div>
      {/* Restrained archive scan — a slow highlight rule, gated by reduced-motion. */}
      {!reduce && (
        <motion.div
          aria-hidden className="pointer-events-none absolute inset-x-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--acc), transparent)', top: 0 }}
          animate={{ top: ['4%', '96%', '4%'], opacity: [0, 0.5, 0] }} transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </Frame>
  );
}

function SpatialFloorplan() {
  return (
    <Frame className="p-4">
      <svg aria-hidden viewBox="0 0 320 220" className="h-full w-full" style={{ minHeight: 200 }}>
        <rect x="8" y="8" width="304" height="204" rx="8" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="150" y1="8" x2="150" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="8" y1="130" x2="312" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="220" y1="130" x2="220" y2="212" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <rect x="26" y="150" width="60" height="40" rx="4" fill="color-mix(in srgb, var(--acc) 22%, transparent)" stroke="var(--acc)" />
        <circle cx="220" cy="66" r="26" fill="none" stroke="var(--acc2)" strokeWidth="2" />
        <rect x="40" y="30" width="70" height="8" rx="4" fill="rgba(255,255,255,0.14)" />
        <text x="60" y="176" fill="var(--acc)" fontSize="11" fontFamily="var(--hf)">A</text>
        <text x="232" y="70" fill="var(--acc2)" fontSize="11" fontFamily="var(--hf)">B</text>
      </svg>
    </Frame>
  );
}

/** Concept-specific STRUCTURAL fallback labels for a product/chat demo surface —
 *  used only when the section's own copy is thin. Not claims: they name surfaces
 *  (chat, routing, knowledge base, handoff, integrations, security), never metrics. */
const CHAT_FALLBACK_LABELS = (lang: PLang): string[] => [
  ML(lang, 'Chat experience', 'Sohbet deneyimi'),
  ML(lang, 'Answer routing', 'Yanıt yönlendirme'),
  ML(lang, 'Knowledge base', 'Bilgi tabanı'),
  ML(lang, 'Support handoff', 'Destek devri'),
  ML(lang, 'Channel integrations', 'Kanal entegrasyonları'),
  ML(lang, 'Security controls', 'Güvenlik kontrolleri'),
];

/* ── Demo-surface copy guard (Phase 9C-3) — a tiny, self-contained display-only
 *  cleanup for the few generic labels that can reach the module's own surfaces.
 *  The real repair happens on the section items (Fixer sanitizeDemoSurfaceCopy);
 *  this is a last-line guard so tabs/chips never show template filler. Honest. */
const DEMO_LABEL_MAP = (lang: PLang): Record<string, string> => ({
  'fast & reliable': ML(lang, 'Product & policy answers', 'Ürün ve politika yanıtları'),
  'fast and reliable': ML(lang, 'Product & policy answers', 'Ürün ve politika yanıtları'),
  'made for your goals': ML(lang, 'Question to recommendation', 'Sorudan öneriye'),
  'simple to start': ML(lang, 'Catalog & support flows', 'Katalog ve destek akışları'),
  'premium quality': ML(lang, 'Calm, branded experience', 'Sakin, markalı deneyim'),
  'learn more': ML(lang, 'See chat flow', 'Sohbet akışını gör'),
  'get started': ML(lang, 'Try the demo', 'Demoyu dene'),
  'process': ML(lang, 'Shopper flow', 'Alışverişçi akışı'),
  'discovery': ML(lang, 'Understands the question', 'Soruyu anlar'),
  'plan': ML(lang, 'Finds the right product', 'Doğru ürünü bulur'),
  'case studies': ML(lang, 'Use cases', 'Kullanım senaryoları'),
  'testimonials': ML(lang, 'Customer questions', 'Müşteri soruları'),
});
const cleanDemoLabel = (label: string, lang: PLang): string => {
  const map = DEMO_LABEL_MAP(lang);
  return map[(label || '').trim().toLowerCase().replace(/\s+/g, ' ')] || label;
};

/** A concept sample conversation for an AI storefront assistant demo (Phase 9C-3).
 *  Sample / front-end-only — no real AI/catalog/policy lookup, no fabricated proof. */
const STOREFRONT_SAMPLE_FLOW = (lang: PLang): Array<{ assistant: boolean; text: string }> => [
  { assistant: false, text: ML(lang, 'Do you have a lightweight jacket for rainy commutes?', 'Yağmurlu işe gidişler için hafif bir ceketiniz var mı?') },
  { assistant: true, text: ML(lang, 'I can suggest a water-resistant option and compare sizes from the sample catalog.', 'Su geçirmez bir seçenek önerip örnek katalogdan bedenleri karşılaştırabilirim.') },
  { assistant: false, text: ML(lang, 'What about returns?', 'Peki ya iadeler?') },
  { assistant: true, text: ML(lang, 'The sample policy says returns are accepted within the store’s stated window.', 'Örnek politika, iadelerin mağazanın belirttiği süre içinde kabul edildiğini söylüyor.') },
];

/** Real labels first, then concept fallbacks — de-duped — so the mockup always has
 *  enough distinct surfaces to compose without ever repeating or fabricating. */
function chatLabels(labels: string[] | undefined, lang: PLang): string[] {
  const real = (labels || []).map((x) => (x || '').trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...real, ...CHAT_FALLBACK_LABELS(lang)]) {
    const k = x.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

/** A small book/knowledge glyph (structural, no text/counts). */
const KbGlyph = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="var(--acc)" strokeWidth="1.4">
    <path d="M2.5 3.2c1.8-.8 3.5-.8 5 0v9c-1.5-.8-3.2-.8-5 0zM13.5 3.2c-1.8-.8-3.5-.8-5 0v9c1.5-.8 3.2-.8 5 0z" />
  </svg>
);
/** A handoff/route glyph (arrow into a person). */
const HandoffGlyph = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="var(--acc)" strokeWidth="1.4">
    <path d="M1.5 8h6M5 5.5 7.8 8 5 10.5" /><circle cx="11.5" cy="5.5" r="2" /><path d="M8.6 13c.3-1.8 1.5-3 2.9-3s2.6 1.2 2.9 3" />
  </svg>
);

/* ── ProductShowcase — a REAL, premium, front-end-only product / chat-flow demo
 * surface (Phase 8B). Replaces the old floating gradient square. Composed purely
 * from CSS/SVG/React: a soft app-window frame + step rail + a live-looking chat
 * column (message bubbles from the section's own labels), a knowledge-base source
 * card, a support-handoff/routing card, integration chips and a preview-only input
 * row. Everything is STRUCTURAL — no fabricated numbers, metrics, logos or
 * testimonials — and it inherits the strategy palette via --acc/--acc2/--sf/--bd/
 * --pr, with a proper compact variant for tight hero columns. */
function ProductShowcase({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = useReducedMotion();
  const lg = lang || inferLang(labels);
  // Phase 9C-3: clean any generic template labels that reached this module before
  // composing the surfaces (last-line display guard; real fix is on section items).
  const items = chatLabels(labels, lg).map((x) => cleanDemoLabel(x, lg));
  const tabs = items.slice(0, compact ? 3 : 4);
  const kbLabel = items[2] || ML(lg, 'Knowledge base', 'Bilgi tabanı');
  const handoffLabel = items[3] || ML(lg, 'Support handoff', 'Destek devri');
  const chips = items.slice(4, 4 + (compact ? 2 : 3));
  // Phase 9C-3: an ecommerce/storefront chat demo shows a real sample shopper↔
  // assistant flow (front-end-only, honest) instead of bubbles built from structural
  // labels. Requires an actual COMMERCE signal so a non-ecommerce assistant does not
  // get the storefront/returns flow.
  const isChatCommerceDemo = /shop|store|storefront|product|order|return|catalog|shopper|checkout|\bcart\b|retail|mağaza|ürün|sipariş|iade|e-?ticaret|e-?commerce|ecommerce/i.test((labels || []).join(' '));
  const bubbles = (isChatCommerceDemo
    ? STOREFRONT_SAMPLE_FLOW(lg)
    : [
        { assistant: true, text: items[0] },
        { assistant: false, text: items[1] },
        { assistant: true, text: items[2] },
      ]
  ).filter((b) => b.text).slice(0, compact ? 2 : (isChatCommerceDemo ? 4 : 3));

  const renderBubble = (assistant: boolean, text: string, i: number): ReactElement => {
    const body = (
      <div className={`flex items-end ${assistant ? 'justify-start' : 'justify-end'}`}>
        {assistant && <span aria-hidden className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: 'var(--acc)' }}>◆</span>}
        <div
          className={`max-w-[80%] px-3 py-2 text-[12px] leading-snug ${assistant ? 'rounded-2xl rounded-bl-sm text-slate-100' : 'rounded-2xl rounded-br-sm text-white'}`}
          style={assistant ? { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)' } : { background: 'var(--acc)' }}
        >{text}</div>
      </div>
    );
    return reduce ? <div key={i}>{body}</div> : (
      <motion.div key={i} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}>{body}</motion.div>
    );
  };

  return (
    <Frame className="shadow-2xl shadow-black/40">
      {/* App-window chrome */}
      <div className="flex items-center gap-1.5 border-b border-[color:var(--bd)] px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <div className="ml-2 flex h-6 flex-1 items-center rounded-md border border-[color:var(--bd)] bg-black/20 px-2.5 text-[10px] text-slate-400">
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--acc)' }} />
          {ML(lg, 'Preview', 'Önizleme')}
        </div>
        <span className="rounded-full border border-[color:var(--bd)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/50">{ML(lg, 'Demo', 'Demo')}</span>
      </div>

      <div className={`relative grid gap-3 p-3 ${compact ? '' : 'sm:grid-cols-[8.5rem_1fr]'}`}>
        {/* Soft top glow inside the surface (structural, not a placeholder blob). */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24" style={{ background: 'radial-gradient(120% 80% at 70% 0%, color-mix(in srgb, var(--acc) 16%, transparent), transparent 70%)' }} />

        {/* Step rail (hidden in compact) */}
        {!compact && (
          <aside className="relative z-10 hidden flex-col gap-1.5 sm:flex">
            {tabs.map((t, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${i === 0 ? 'text-white' : 'text-slate-400'}`}
                style={i === 0 ? { borderColor: 'color-mix(in srgb, var(--acc) 45%, transparent)', background: 'color-mix(in srgb, var(--acc) 12%, transparent)' } : { borderColor: 'var(--bd)', background: 'rgba(255,255,255,0.02)' }}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.3)' }} />
                <span className="truncate">{t}</span>
              </div>
            ))}
          </aside>
        )}

        {/* Chat / product-flow column */}
        <div className="relative z-10 min-w-0 space-y-2.5">
          {bubbles.map((b, i) => renderBubble(b.assistant, b.text, i))}

          {/* Honest handoff note for the sample storefront flow (front-end-only). */}
          {isChatCommerceDemo && !compact && (
            <p className="pl-8 text-[10px] leading-snug text-slate-500">{ML(lg, 'Complex requests can be handed to your support team.', 'Karmaşık talepler destek ekibinize devredilebilir.')}</p>
          )}

          {/* Typing indicator — three pulsing dots, structural, motion-gated. */}
          <div className="flex items-center gap-1 pl-8">
            {[0, 1, 2].map((i) => (reduce
              ? <span key={i} className="h-1.5 w-1.5 rounded-full bg-white/25" />
              : <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/40" animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }} />))}
          </div>

          {/* Knowledge-base source card + support-handoff card */}
          {!compact && (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200"><KbGlyph /><span className="truncate">{kbLabel}</span></div>
                <div className="mt-2 space-y-1"><span className="block h-1.5 w-full rounded-full bg-white/10" /><span className="block h-1.5 w-3/4 rounded-full bg-white/10" /></div>
              </div>
              <div className="rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200"><HandoffGlyph /><span className="truncate">{handoffLabel}</span></div>
                <div className="mt-2 flex items-center gap-1">
                  {[0, 1].map((k) => <span key={k} className="h-5 w-5 rounded-full border border-white/15 bg-white/5" />)}
                  <span className="ml-1 h-1.5 flex-1 rounded-full bg-white/10" />
                </div>
              </div>
            </div>
          )}

          {/* Integration chips (dot + label — no logos) */}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--bd)] bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: i % 2 ? 'var(--acc2)' : 'var(--acc)' }} />
                  <span className="truncate">{c}</span>
                </span>
              ))}
            </div>
          )}

          {/* Preview-only input row (non-interactive; no submission) */}
          <div className="mt-0.5 flex items-center gap-2 rounded-full border border-[color:var(--bd)] bg-black/20 px-3 py-2">
            <span className="truncate text-[12px] text-slate-500">{ML(lg, 'Ask anything', 'Bir şey sorun')}…</span>
            <span aria-hidden className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: 'var(--acc)', boxShadow: '0 6px 16px -8px var(--acc)' }}>↑</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function EditorialStory({ labels }: { labels?: string[] }) {
  const caption = (labels && labels[0]) || '';
  return (
    <Frame className="p-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 22%, transparent), color-mix(in srgb, var(--acc2) 12%, transparent))' }}>
        <svg aria-hidden viewBox="0 0 200 250" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.5 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <path key={i} d={`M0 ${40 + i * 34} C 60 ${10 + i * 34}, 150 ${80 + i * 34}, 200 ${40 + i * 34}`} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
          ))}
        </svg>
        <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] tracking-widest text-white/80">EDITORIAL</span>
      </div>
      {caption && <p className="mt-3 px-1 text-[13px] leading-snug text-slate-300">{caption}</p>}
    </Frame>
  );
}

function ReservationForm({ labels }: { labels?: string[] }) {
  const cta = (labels && labels[0]) || 'Rezervasyon';
  const reduce = useReducedMotion();
  return (
    <Frame className="p-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[11px] text-slate-400">Tarih</div>
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 8 }).map((_, i) => (i === 3 && !reduce)
              ? <motion.span key={i} className="flex h-7 items-center justify-center rounded text-[11px] text-white" style={{ background: 'var(--acc)' }} animate={{ boxShadow: ['0 0 0 0 color-mix(in srgb, var(--acc) 60%, transparent)', '0 0 0 6px transparent'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}>{i + 12}</motion.span>
              : <span key={i} className={`flex h-7 items-center justify-center rounded text-[11px] ${i === 3 ? 'text-white' : 'text-slate-400'}`} style={i === 3 ? { background: 'var(--acc)' } : { background: 'rgba(255,255,255,0.04)' }}>{i + 12}</span>)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-slate-400">Kişi</div>
          <div className="flex gap-1">{['2', '4', '6'].map((n, i) => <span key={i} className={`flex h-7 flex-1 items-center justify-center rounded text-[11px] ${i === 0 ? 'text-white' : 'text-slate-400'}`} style={i === 0 ? { background: 'var(--acc2)' } : { background: 'rgba(255,255,255,0.04)' }}>{n}</span>)}</div>
          <div className="mb-1 mt-3 text-[11px] text-slate-400">Saat</div>
          <div className="flex gap-1">{['19:00', '20:30'].map((n, i) => <span key={i} className="flex h-7 flex-1 items-center justify-center rounded bg-white/[0.04] text-[11px] text-slate-300">{n}</span>)}</div>
        </div>
      </div>
      <div className="mt-4 flex h-10 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{cta}</div>
    </Frame>
  );
}

function TimelineProcess({ labels }: { labels?: string[] }) {
  const steps = take(labels, 4, ['Keşif', 'Tasarım', 'Uygulama', 'Teslim']);
  const reduce = useReducedMotion();
  return (
    <Frame className="p-5">
      <ol className="relative space-y-4 pl-6">
        <span aria-hidden className="absolute left-[9px] top-1 h-[calc(100%-0.5rem)] w-px bg-white/12" />
        {/* The progress line draws in over the steps when motion is allowed. */}
        {!reduce && (
          <motion.span
            aria-hidden className="absolute left-[9px] top-1 w-px origin-top" style={{ background: 'var(--acc)' }}
            initial={{ height: 0 }} whileInView={{ height: 'calc(100% - 0.5rem)' }} viewport={{ once: true }} transition={{ duration: 1.2, ease: 'easeInOut' }}
          />
        )}
        {steps.map((st, i) => (
          <li key={i} className="relative">
            {(i === 0 && !reduce)
              ? <motion.span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black" style={{ background: 'var(--acc)' }} animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}>{i + 1}</motion.span>
              : <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black" style={{ background: 'var(--acc)' }}>{i + 1}</span>}
            <p className="text-[13px] font-medium text-white">{st}</p>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function Comparison() {
  const reduce = useReducedMotion();
  return (
    <Frame className="relative grid grid-cols-2">
      <div className="relative border-r border-[color:var(--bd)]">
        <span className="absolute left-2 top-2 z-10 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-slate-300">Önce</span>
        <div className="relative aspect-[3/4]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }}>
          <svg aria-hidden viewBox="0 0 100 130" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.4 }}>{[30, 60, 90].map((y, k) => <line key={k} x1="14" y1={y} x2="86" y2={y} stroke="rgba(255,255,255,0.22)" strokeWidth="1.4" />)}</svg>
        </div>
      </div>
      <div className="relative">
        <span className="absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10px] text-white" style={{ background: 'var(--acc)' }}>Sonra</span>
        <div className="relative aspect-[3/4]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))' }}>
          <svg aria-hidden viewBox="0 0 100 130" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity: 0.55 }}>{[24, 48, 72, 96].map((y, k) => <path key={k} d={`M6 ${y} C 34 ${y - 10}, 66 ${y + 10}, 94 ${y}`} fill="none" stroke={k % 2 ? 'var(--acc)' : 'rgba(255,255,255,0.2)'} strokeWidth="1.4" />)}</svg>
        </div>
      </div>
      {/* Reveal divider that sweeps between before/after when motion is allowed. */}
      {!reduce && (
        <motion.span
          aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: 'linear-gradient(180deg, transparent, var(--acc), transparent)' }}
          animate={{ opacity: [0.35, 1, 0.35] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </Frame>
  );
}

function ContourTerrain() {
  const reduce = useReducedMotion();
  return (
    <Frame className="p-0">
      <div className="relative aspect-[4/3] w-full" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 20%, transparent), color-mix(in srgb, var(--acc2) 10%, transparent))' }}>
        <svg aria-hidden viewBox="0 0 400 300" preserveAspectRatio="none" className="h-full w-full" style={{ opacity: 0.6 }}>
          {Array.from({ length: 8 }).map((_, i) => {
            const d = `M0 ${34 + i * 32} C 110 ${6 + i * 32}, 290 ${86 + i * 32}, 400 ${40 + i * 32}`;
            const stroke = i % 3 === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.16)';
            // Slow organic drift on alternating contour lines — never a tech pulse.
            return reduce
              ? <path key={i} d={d} fill="none" stroke={stroke} strokeWidth="1" />
              : <motion.path key={i} d={d} fill="none" stroke={stroke} strokeWidth="1" animate={{ opacity: [0.45, 0.9, 0.45] }} transition={{ duration: 7 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: i * 0.25 }} />;
          })}
          {/* Botanical leaf curves + material swatches, structural only. */}
          <path d="M60 250 C 90 200, 120 200, 150 250" fill="none" stroke="var(--acc2)" strokeWidth="1.4" style={{ opacity: 0.5 }} />
          <path d="M250 260 C 280 210, 310 210, 340 260" fill="none" stroke="var(--acc2)" strokeWidth="1.4" style={{ opacity: 0.5 }} />
        </svg>
        <div className="absolute bottom-2 left-2 flex gap-1.5">
          {['var(--acc)', 'var(--acc2)', 'rgba(255,255,255,0.35)'].map((c, k) => <span key={k} className="h-4 w-4 rounded-full border border-white/20" style={{ background: c }} />)}
        </div>
      </div>
    </Frame>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SIGNATURE VISUALS (Phase 9E-1) — concept-specific, CSS/SVG/React-only visual
 * modules the Visual Signature Plan can select so a build reads as art-directed
 * instead of a stack of generic cards. HARD RULES for every module below:
 *   • no external images, no image/video API, no network calls
 *   • no real logos, no fake metrics, no fake customer names/testimonials
 *   • decorative SVG is aria-hidden; motion is gated on prefers-reduced-motion
 *   • all copy is illustrative/sample — never a real backend/catalog/policy claim
 * They inherit the strategy palette via --acc/--acc2/--sf/--bd/--pr. ══════════ */

/** Small trust glyphs (shield / key / checklist) — illustrative, not certifications. */
const ShieldGlyph = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="var(--acc)" strokeWidth="1.4">
    <path d="M8 1.6 13 3.4v4.2c0 3.2-2.2 5.6-5 6.8-2.8-1.2-5-3.6-5-6.8V3.4z" /><path d="M5.7 8 7.4 9.7 10.6 6.3" />
  </svg>
);
const KeyGlyph = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="var(--acc)" strokeWidth="1.4">
    <circle cx="5" cy="6" r="3" /><path d="M7.2 8.2 13 14M11 12l1.6-1.6M12.4 13.4 14 11.8" />
  </svg>
);
const CheckGlyph = () => (
  <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="var(--acc)" strokeWidth="1.4">
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" /><path d="M5.4 8.2 7.2 10l3.4-3.6" />
  </svg>
);

/** A pulsing connection dot (motion-gated). */
function PulseDot({ reduce, color = 'var(--acc)', delay = 0 }: { reduce: boolean; color?: string; delay?: number }) {
  return reduce
    ? <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    : <motion.span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} animate={{ opacity: [0.35, 1, 0.35], scale: [0.85, 1.15, 0.85] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay }} />;
}

/* ── ChatFlowRailVisual — shopper → assistant → recommendation → policy →
 * handoff, as a legible staged rail. Uses the same honest storefront sample flow
 * as ProductShowcase (front-end-only; no real AI/catalog/policy lookup). ── */
function ChatFlowRailVisual({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = !!useReducedMotion();
  const lg = lang || inferLang(labels);
  const flow = STOREFRONT_SAMPLE_FLOW(lg).slice(0, compact ? 2 : 4);
  const recTitle = ML(lg, 'Recommended for you', 'Sizin için önerilen');
  const policyTitle = ML(lg, 'Policy answer', 'Politika yanıtı');
  const handoff = ML(lg, 'Handoff to a human', 'İnsana devir');
  return (
    <Frame className="shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1.5 border-b border-[color:var(--bd)] px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
        <span className="ml-2 text-[10px] uppercase tracking-wider text-white/45">{ML(lg, 'Storefront chat flow', 'Mağaza sohbet akışı')}</span>
        <span className="ml-auto rounded-full border border-[color:var(--bd)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-white/50">{ML(lg, 'Demo', 'Demo')}</span>
      </div>
      <div className="relative space-y-2.5 p-3.5">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20" style={{ background: 'radial-gradient(120% 80% at 70% 0%, color-mix(in srgb, var(--acc) 14%, transparent), transparent 70%)' }} />
        {flow.map((b, i) => {
          const body = (
            <div className={`flex items-end ${b.assistant ? 'justify-start' : 'justify-end'}`}>
              {b.assistant && <span aria-hidden className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: 'var(--acc)' }}>◆</span>}
              <div className={`max-w-[82%] px-3 py-2 text-[12px] leading-snug ${b.assistant ? 'rounded-2xl rounded-bl-sm text-slate-100' : 'rounded-2xl rounded-br-sm text-white'}`}
                style={b.assistant ? { background: 'rgba(255,255,255,0.05)', border: '1px solid var(--bd)' } : { background: 'var(--acc)' }}>{b.text}</div>
            </div>
          );
          return reduce ? <div key={i} className="relative z-10">{body}</div>
            : <motion.div key={i} className="relative z-10" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}>{body}</motion.div>;
        })}
        {!compact && (
          <div className="relative z-10 grid grid-cols-2 gap-2.5 pt-1">
            {/* Product recommendation card — abstract media + title/price BARS (no fake numbers). */}
            <div className="rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2.5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-200"><span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--acc)' }} /><span className="truncate">{recTitle}</span></div>
              <div className="flex gap-2">
                <span aria-hidden className="h-10 w-10 shrink-0 rounded-lg" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 40%, transparent), color-mix(in srgb, var(--acc2) 22%, transparent))' }} />
                <div className="min-w-0 flex-1 space-y-1.5 pt-1"><span className="block h-1.5 w-3/4 rounded-full bg-white/12" /><span className="block h-1.5 w-1/3 rounded-full" style={{ background: 'var(--acc)' }} /></div>
              </div>
            </div>
            {/* Policy answer card — sourced from a sample policy, honest bars. */}
            <div className="rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2.5">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-200"><KbGlyph /><span className="truncate">{policyTitle}</span></div>
              <div className="space-y-1.5"><span className="block h-1.5 w-full rounded-full bg-white/10" /><span className="block h-1.5 w-2/3 rounded-full bg-white/10" /></div>
            </div>
          </div>
        )}
        {/* Handoff chip */}
        <div className="relative z-10 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--bd)] bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-300"><HandoffGlyph /><span className="truncate">{handoff}</span><PulseDot reduce={reduce} color="var(--acc2)" /></span>
        </div>
      </div>
    </Frame>
  );
}

/* ── ProductCardRailVisual — a rail of recommendation cards (abstract media +
 * title/price BARS, never fabricated numbers/logos). For catalog/marketplace. ── */
function ProductCardRailVisual({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = useReducedMotion();
  const lg = lang || inferLang(labels);
  const names = take(labels, compact ? 3 : 5, [
    ML(lg, 'Featured', 'Öne çıkan'), ML(lg, 'New arrival', 'Yeni gelen'), ML(lg, 'Best match', 'En iyi eşleşme'),
    ML(lg, 'On sale', 'İndirimde'), ML(lg, 'Editor’s pick', 'Editör seçimi'),
  ]);
  return (
    <Frame className="p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/45">
        <span>{ML(lg, 'Product rail', 'Ürün rayı')}</span>
        <span aria-hidden className="h-px flex-1" style={{ background: 'var(--bd)' }} />
      </div>
      <div className="flex gap-2.5 overflow-hidden">
        {names.map((n, i) => {
          const card = (
            <div className="w-1/3 shrink-0 rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2" style={i === 0 ? { borderColor: 'color-mix(in srgb, var(--acc) 45%, transparent)' } : undefined}>
              <span aria-hidden className="mb-2 block h-16 w-full rounded-lg" style={{ background: i === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 42%, transparent), color-mix(in srgb, var(--acc2) 22%, transparent))' : 'rgba(255,255,255,0.04)' }} />
              <p className="truncate text-[11px] font-medium text-slate-200">{n}</p>
              <div className="mt-1.5 flex items-center gap-1.5"><span className="h-1.5 w-8 rounded-full" style={{ background: 'var(--acc)' }} /><span className="h-1.5 w-5 rounded-full bg-white/12" /></div>
            </div>
          );
          return reduce ? <div key={i} className="w-1/3 shrink-0">{card}</div>
            : <motion.div key={i} className="w-1/3 shrink-0" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}>{card}</motion.div>;
        })}
      </div>
    </Frame>
  );
}

/* ── IntegrationOrbitVisual — a central hub with abstract labelled nodes on an
 * orbit (generic labels like Store / Catalog / Helpdesk / Email — NEVER real
 * brand logos). Orbit ring + pulsing connection dots. ── */
function IntegrationOrbitVisual({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = !!useReducedMotion();
  const lg = lang || inferLang(labels);
  const nodes = take(labels, compact ? 4 : 5, [
    ML(lg, 'Store', 'Mağaza'), ML(lg, 'Catalog', 'Katalog'), ML(lg, 'Helpdesk', 'Yardım Masası'),
    ML(lg, 'Email', 'E-posta'), ML(lg, 'Payments', 'Ödemeler'),
  ]).slice(0, compact ? 4 : 5);
  const R = 78; const cx = 130; const cy = 108;
  const ring = (
    <svg aria-hidden viewBox="0 0 260 216" className="h-full w-full" style={{ opacity: 0.9 }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--bd)" strokeWidth="1" strokeDasharray="3 5" />
      <circle cx={cx} cy={cy} r={R * 0.62} fill="none" stroke="var(--bd)" strokeWidth="1" />
      {nodes.map((_, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * R; const y = cy + Math.sin(a) * R;
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--bd)" strokeWidth="1" />;
      })}
    </svg>
  );
  return (
    <Frame className="p-0">
      <div className="relative aspect-[6/5] w-full">
        {reduce ? <div className="absolute inset-0">{ring}</div>
          : <motion.div className="absolute inset-0" animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}>{ring}</motion.div>}
        {/* Central hub */}
        <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl border text-white" style={{ borderColor: 'color-mix(in srgb, var(--acc) 50%, transparent)', background: 'color-mix(in srgb, var(--acc) 16%, transparent)' }}>
          <span aria-hidden className="text-lg">◆</span>
        </div>
        {/* Nodes (counter-rotate not needed; labels stay upright since only ring rotates) */}
        {nodes.map((n, i) => {
          const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const leftPct = 50 + (Math.cos(a) * R / 260) * 100;
          const topPct = 50 + (Math.sin(a) * R / 216) * 100;
          return (
            <div key={i} className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-[color:var(--bd)] bg-[var(--sf)] px-2 py-1 text-[10px] text-slate-200 shadow-lg shadow-black/30" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
              <PulseDot reduce={reduce} color={i % 2 ? 'var(--acc2)' : 'var(--acc)'} delay={i * 0.25} />
              <span className="truncate">{n}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── TrustControlStackVisual — honest trust controls (data handling / access /
 * content safety) as a control stack. Illustrative only — NO SOC2/ISO/fake
 * compliance badges. ── */
function TrustControlStackVisual({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = !!useReducedMotion();
  const lg = lang || inferLang(labels);
  const rows: Array<{ glyph: ReactElement; title: string; note: string }> = [
    { glyph: <ShieldGlyph />, title: ML(lg, 'Data handling', 'Veri işleme'), note: ML(lg, 'Sample data stays on the front-end demo.', 'Örnek veri ön-yüz demosunda kalır.') },
    { glyph: <KeyGlyph />, title: ML(lg, 'Access control', 'Erişim kontrolü'), note: ML(lg, 'Role-based access is illustrated, not enforced.', 'Rol tabanlı erişim gösterilir, uygulanmaz.') },
    { glyph: <CheckGlyph />, title: ML(lg, 'Content safety', 'İçerik güvenliği'), note: ML(lg, 'Answers are grounded in the sample policy.', 'Yanıtlar örnek politikaya dayandırılır.') },
  ].slice(0, compact ? 2 : 3);
  const custom = (labels || []).filter(Boolean);
  return (
    <Frame className="p-3.5">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/45">
        <span>{ML(lg, 'Trust controls', 'Güven kontrolleri')}</span>
        <span aria-hidden className="h-px flex-1" style={{ background: 'var(--bd)' }} />
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const row = (
            <div className="flex items-start gap-2.5 rounded-xl border border-[color:var(--bd)] bg-white/[0.02] p-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--acc) 12%, transparent)' }}>{r.glyph}</span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-100">{custom[i] || r.title}<PulseDot reduce={reduce} delay={i * 0.3} /></p>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{r.note}</p>
              </div>
            </div>
          );
          return reduce ? <div key={i}>{row}</div>
            : <motion.div key={i} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}>{row}</motion.div>;
        })}
      </div>
      <p className="mt-2.5 text-[10px] leading-snug text-slate-500">{ML(lg, 'Illustrative front-end controls — not a compliance certification.', 'Açıklayıcı ön-yüz kontrolleri — bir uyumluluk sertifikası değil.')}</p>
    </Frame>
  );
}

/* ── CodeRainVisual — faint falling monospace columns behind a small terminal
 * panel. For developer/tools/code concepts. ── */
function CodeRainVisual({ labels, compact }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = useReducedMotion();
  const cmds = take(labels, compact ? 2 : 4, ['build', 'test', 'deploy', 'run']).map((s) => s.toLowerCase().replace(/[^a-z0-9\-_. ]/gi, '').trim() || 'run');
  const cols = compact ? 6 : 10;
  return (
    <Frame className="p-0">
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <svg aria-hidden viewBox="0 0 320 200" className="absolute inset-0 h-full w-full" style={{ opacity: 0.22 }}>
          {Array.from({ length: cols }).map((_, c) => {
            const x = 12 + c * (296 / cols);
            const glyphs = Array.from({ length: 8 }).map((_, r) => (
              <text key={r} x={x} y={18 + r * 22} fontFamily="monospace" fontSize="12" fill={c % 3 === 0 ? 'var(--acc)' : 'rgba(255,255,255,0.5)'}>{['0', '1', '{', '}', '<', '/', '>', ';'][(c + r) % 8]}</text>
            ));
            return reduce ? <g key={c}>{glyphs}</g>
              : <motion.g key={c} animate={{ y: [-22, 22] }} transition={{ duration: 3 + (c % 4), repeat: Infinity, ease: 'linear', delay: c * 0.2 }}>{glyphs}</motion.g>;
          })}
        </svg>
        {/* Terminal panel */}
        <div className="absolute inset-x-4 bottom-4 rounded-xl border border-[color:var(--bd)] bg-black/50 p-2.5 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white/20" /><span className="h-2 w-2 rounded-full bg-white/20" /><span className="h-2 w-2 rounded-full bg-white/20" /></div>
          {cmds.map((c, i) => (
            <p key={i} className="font-mono text-[11px] leading-relaxed"><span style={{ color: 'var(--acc)' }}>$</span> <span className="text-slate-300">{c}</span>{i === cmds.length - 1 && !reduce && <motion.span className="ml-0.5 inline-block h-3 w-1.5 align-middle" style={{ background: 'var(--acc)' }} animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />}</p>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ── TimelineRailVisual — a staged rail of steps (concept flow / shopper flow /
 * support handoff timeline). Steps from real labels, else the motif. ── */
function TimelineRailVisual({ labels, compact, lang }: { labels?: string[]; compact?: boolean; lang?: PLang }) {
  const reduce = !!useReducedMotion();
  const lg = lang || inferLang(labels);
  const steps = take(labels, compact ? 3 : 4, [
    ML(lg, 'Ask', 'Sor'), ML(lg, 'Recommend', 'Öner'), ML(lg, 'Answer', 'Yanıtla'), ML(lg, 'Handoff', 'Devret'),
  ]).slice(0, compact ? 3 : 4);
  return (
    <Frame className="p-4">
      <div className="relative">
        <span aria-hidden className="absolute left-3 top-3 h-[calc(100%-1.5rem)] w-px" style={{ background: 'var(--bd)' }} />
        {!reduce && <motion.span aria-hidden className="absolute left-3 top-3 w-px" style={{ background: 'var(--acc)' }} initial={{ height: 0 }} whileInView={{ height: 'calc(100% - 1.5rem)' }} viewport={{ once: true }} transition={{ duration: 1.1, ease: 'easeInOut' }} />}
        <ol className="space-y-3.5">
          {steps.map((s, i) => (
            <li key={i} className="relative flex items-center gap-3 pl-8">
              <span className="absolute left-0 flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold" style={i === 0 ? { borderColor: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 18%, transparent)', color: '#fff' } : { borderColor: 'var(--bd)', color: 'rgba(255,255,255,0.6)' }}>{i + 1}</span>
              <span className="truncate text-[13px] text-slate-200">{s}</span>
              {i === 0 && <PulseDot reduce={reduce} />}
            </li>
          ))}
        </ol>
      </div>
    </Frame>
  );
}

/** Dispatch a Visual Signature Plan visual type → a signature module. Returns
 *  null for an unknown/opt-out type so callers fall back to the generic module. */
export type SignatureVisualType = string;
const SIGNATURE_VISUALS: Record<string, (p: { labels?: string[]; compact?: boolean; lang?: PLang }) => ReactElement> = {
  'chat-flow': (p) => <ChatFlowRailVisual {...p} />,
  'chat-flow-rail': (p) => <ChatFlowRailVisual {...p} />,
  'product-flow': (p) => <ProductCardRailVisual {...p} />,
  'product-card-rail': (p) => <ProductCardRailVisual {...p} />,
  'integration-orbit': (p) => <IntegrationOrbitVisual {...p} />,
  'integration-constellation': (p) => <IntegrationOrbitVisual {...p} />,
  'trust-control-stack': (p) => <TrustControlStackVisual {...p} />,
  'code-rain': (p) => <CodeRainVisual {...p} />,
  'timeline-rail': (p) => <TimelineRailVisual {...p} />,
  'handoff-timeline': (p) => <TimelineRailVisual {...p} />,
};

/** True when a signature module exists for this visual type. */
export function hasSignatureVisual(visualType?: string): boolean {
  return !!visualType && !!SIGNATURE_VISUALS[visualType];
}

/** Render a signature visual by type, or null when none matches (caller falls
 *  back to the generic VisualModule). Isolated: never throws on a bad type. */
export function SignatureVisual({ visualType, labels, className = '', compact = false, lang }: {
  visualType?: string; labels?: string[]; className?: string; compact?: boolean; lang?: PLang;
}) {
  const Render = visualType ? SIGNATURE_VISUALS[visualType] : undefined;
  if (!Render) return null;
  return <div className={className}>{Render({ labels, compact, lang })}</div>;
}

const MODULES: Record<VisualModule, (p: { labels?: string[]; compact?: boolean; lang?: PLang }) => ReactElement> = {
  'data-dashboard': (p) => <DataDashboard {...p} />,
  'membership-pass': (p) => <MembershipPass labels={p.labels} />,
  'catalog-archive': (p) => <CatalogArchive {...p} />,
  'spatial-floorplan': () => <SpatialFloorplan />,
  'product-showcase': (p) => <ProductShowcase {...p} />,
  'editorial-story': (p) => <EditorialStory labels={p.labels} />,
  'reservation-form': (p) => <ReservationForm labels={p.labels} />,
  'timeline-process': (p) => <TimelineProcess labels={p.labels} />,
  comparison: () => <Comparison />,
  'contour-terrain': () => <ContourTerrain />,
};

export default function VisualModule({ kind, labels, className = '', compact = false, lang }: VisualModuleProps) {
  const Render = MODULES[kind] || MODULES['contour-terrain'];
  return <div className={className}>{Render({ labels, compact, lang })}</div>;
}
