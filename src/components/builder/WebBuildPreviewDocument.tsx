import { type ReactElement, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { sectionKind, type SectionKind } from '@/lib/webBuildFiles';
import { designTokensForBrief } from '@/lib/webBuildBrief';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * A REAL, premium rendered approximation of the generated site — dark, modern,
 * animated — that renders a DIFFERENT layout per section kind (gallery, product
 * demo, workflow, metrics, inventory, pricing, menu, …), driven by the same
 * `sectionKind` classifier the file synthesizer uses. So a landscaping site, an
 * AI-SaaS site, a furniture site and a dealership site look genuinely different,
 * not one template with swapped text. Renders the actual generated copy.
 */
type Brief = { type?: string; audience?: string; goal?: string; style?: string };
type S = WebBuildSectionItem;

const bulletsOf = (s: S) => (s.bullets?.length ? s.bullets : [s.sub || s.purpose || s.name].filter(Boolean));
const heading = (s: S) => s.headline || s.name;

function Orb({ color, style, delay = 0 }: { color: string; style: React.CSSProperties; delay?: number }) {
  return (
    <motion.div
      aria-hidden className="pointer-events-none absolute rounded-full"
      style={{ filter: 'blur(70px)', opacity: 0.5, background: `radial-gradient(circle, ${color}, transparent 60%)`, ...style }}
      animate={{ x: [0, 26, 0], y: [0, 18, 0], scale: [1, 1.18, 1] }}
      transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

const Reveal = ({ children, i = 0 }: { children: React.ReactNode; i?: number }) => (
  <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: i * 0.05 }}>
    {children}
  </motion.div>
);

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-center text-2xl font-semibold text-white sm:text-3xl" style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{children}</h2>
);

function Hero({ s, brief }: { s: S; brief: Brief }) {
  const title = s.headline || s.copyPreview?.split(/[.!?\n]/)[0] || brief.type || '';
  const eyebrow = brief.type || s.bullets?.[0];
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.045) 1px,transparent 1px)', backgroundSize: '44px 44px', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)', maskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)' }} />
      {/* Soft spotlight behind the headline for depth (industry accent) */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[52rem] -translate-x-1/2" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--acc) 22%, transparent), transparent 68%)' }} />
      <Orb color="var(--acc)" style={{ top: '-6rem', left: '-4rem', width: '28rem', height: '28rem' }} />
      <Orb color="var(--acc2)" style={{ top: '3rem', right: '-6rem', width: '24rem', height: '24rem' }} delay={-6} />
      <Orb color="var(--acc)" style={{ bottom: '-10rem', left: '30%', width: '22rem', height: '22rem' }} delay={-11} />
      {/* Seam that blends the hero into the first content section */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-black/50" />
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="relative mx-auto max-w-3xl px-6 py-24 text-center sm:py-28">
        {eyebrow && <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-white/80"><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--acc)' }} />{eyebrow}</span>}
        <h1 className="mt-5 text-3xl font-semibold text-white sm:text-5xl" style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{title}</h1>
        {(s.sub || brief.goal) && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{s.sub || brief.goal}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {s.cta && <span className="rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg" style={{ background: 'var(--acc)', boxShadow: '0 10px 30px -10px var(--acc)' }}>{s.cta}</span>}
          {s.bullets?.[1] && <span className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{s.bullets[1]}</span>}
        </div>
        {s.bullets?.[2] && <p className="mt-6 text-xs text-slate-400">{s.bullets[2]}</p>}
      </motion.div>
    </section>
  );
}

function Gallery({ s }: { s: S }) {
  const tiles = bulletsOf(s).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {tiles.map((b, i) => (
            <Reveal key={i} i={i}>
              <figure className={`group relative overflow-hidden rounded-2xl border border-white/10 ${i % 5 === 0 ? 'sm:col-span-2' : ''}`}>
                <div className="relative aspect-[4/3] w-full transition duration-500 group-hover:scale-[1.04]"><Contours tone={i % 3 === 0 ? 'accent' : 'muted'} /></div>
                <figcaption className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white">{b}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A reusable, intentional visual composition (never an empty block) —
 *  layered topographic contour lines + a soft accent wash. */
function Contours({ tone = 'muted' }: { tone?: 'muted' | 'accent' }) {
  const stroke = tone === 'accent' ? 'var(--acc)' : 'rgba(255,255,255,0.14)';
  const wash = tone === 'accent'
    ? 'linear-gradient(135deg, color-mix(in srgb, var(--acc) 26%, transparent), color-mix(in srgb, var(--acc2) 14%, transparent))'
    : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))';
  return (
    <div className="absolute inset-0" style={{ background: wash }}>
      <svg aria-hidden viewBox="0 0 400 300" preserveAspectRatio="none" className="h-full w-full" style={{ opacity: 0.5 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <path key={i} d={`M0 ${40 + i * 34} C 110 ${10 + i * 34}, 290 ${90 + i * 34}, 400 ${44 + i * 34}`} fill="none" stroke={stroke} strokeWidth="1" />
        ))}
      </svg>
    </div>
  );
}

function BeforeAfter({ s }: { s: S }) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-2xl border border-white/10"><span className="absolute left-3 top-3 z-10 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span><div className="relative aspect-[4/3]"><Contours tone="muted" /></div></div>
          <div className="relative overflow-hidden rounded-2xl border ring-1" style={{ borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)' }}><span className="absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-xs text-white" style={{ background: 'var(--acc)' }}>Sonrası</span><div className="relative aspect-[4/3]"><Contours tone="accent" /></div></div>
        </div>
      </div>
    </section>
  );
}

function ProductDemo({ s }: { s: S }) {
  const lines = (s.bullets?.length ? s.bullets : ['Merhaba, nasıl yardımcı olabilirim?', 'Siparişimi takip etmek istiyorum.', 'Tabii, sipariş numaranı paylaşır mısın?']).slice(0, 4);
  return (
    <section className="relative isolate overflow-hidden px-6 py-16">
      <Orb color="#6366f1" style={{ top: '-4rem', right: '-4rem', width: '22rem', height: '22rem' }} />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{heading(s)}</h2>
          {s.sub && <p className="mt-4 text-slate-300">{s.sub}</p>}
          {s.cta && <span className="mt-6 inline-block rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30">{s.cta}</span>}
        </div>
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/40">
          <div className="mb-3 flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /></div>
          <div className="space-y-2">
            {lines.map((b, i) => <div key={i} className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] ${i % 2 ? 'ml-auto bg-indigo-500 text-white' : 'bg-white/[0.06] text-slate-200'}`}>{b}</div>)}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Workflow({ s }: { s: S }) {
  const steps = bulletsOf(s).slice(0, 4);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <H2>{heading(s)}</H2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((b, i) => (
            <Reveal key={i} i={i}>
              <li className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><span className="text-sm font-semibold text-indigo-300">0{i + 1}</span><p className="mt-2 text-[15px] font-medium text-white">{b}</p></li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Metrics({ s }: { s: S }) {
  const stats = ['98%', '2.5x', '24/7', '<1dk'];
  const labels = bulletsOf(s).slice(0, 4);
  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-5xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {labels.map((b, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center"><div className="text-4xl font-semibold tracking-tight text-white">{stats[i % stats.length]}</div><p className="mt-2 text-sm text-slate-400">{b}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations({ s }: { s: S }) {
  const chips = (s.bullets?.length ? s.bullets : ['Slack', 'Zendesk', 'Shopify', 'WhatsApp', 'HubSpot', 'Notion']).slice(0, 8);
  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-5xl text-center">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {chips.map((b, i) => <div key={i} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"><span className="h-4 w-4 rounded bg-gradient-to-br from-indigo-500/50 to-cyan-400/30" />{b}</div>)}
        </div>
      </div>
    </section>
  );
}

function Inventory({ s }: { s: S }) {
  const cars = bulletsOf(s).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cars.map((b, i) => (
            <Reveal key={i} i={i}>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="relative aspect-[16/10]"><Contours tone={i % 2 === 0 ? 'accent' : 'muted'} /></div>
                <div className="p-5">
                  <p className="text-[15px] font-semibold text-white">{b}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400"><span>2023 · Otomatik · Benzin</span><span className="font-semibold text-white">₺{850 + i * 120}.000</span></div>
                  <div className="mt-4 rounded-lg bg-indigo-500 py-2 text-center text-sm font-semibold text-white">İncele</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Financing({ s }: { s: S }) {
  const badges = (s.bullets?.length ? s.bullets : ['Garanti', 'Ekspertiz', 'Takas', 'Finansman']).slice(0, 4);
  return (
    <section className="px-6 py-14">
      <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/[0.02] p-8">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {badges.map((b, i) => <div key={i} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"><span className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500/40 to-cyan-400/20" /><span className="text-sm font-medium text-slate-200">{b}</span></div>)}
        </div>
      </div>
    </section>
  );
}

function Pricing({ s }: { s: S }) {
  const tiers = (s.bullets?.length ? s.bullets : ['Başlangıç', 'Pro', 'Kurumsal']).slice(0, 3);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {tiers.map((b, i) => (
            <div key={i} className={`rounded-2xl border p-6 ${i === 1 ? 'border-indigo-400/40 bg-indigo-500/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
              <p className="text-sm font-medium text-slate-300">{b}</p>
              <div className="mt-3 text-3xl font-semibold text-white">₺{199 + i * 200}<span className="text-sm text-slate-400">/ay</span></div>
              <div className={`mt-5 rounded-lg py-2 text-center text-sm font-semibold ${i === 1 ? 'bg-indigo-500 text-white' : 'border border-white/15 text-slate-200'}`}>Seç</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Menu({ s }: { s: S }) {
  const dishes = bulletsOf(s).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{heading(s)}</h2>
        <ul className="mt-8 space-y-4">
          {dishes.map((b, i) => (
            <li key={i} className="flex items-baseline gap-3"><span className="font-medium text-white">{b}</span><span className="flex-1 border-b border-dashed border-white/15" /><span className="text-sm text-slate-400">₺{120 + i * 30}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Features({ s }: { s: S }) {
  const items = bulletsOf(s).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <H2>{heading(s)}</H2>
        {s.sub && <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">{s.sub}</p>}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b, i) => (
            <Reveal key={i} i={i}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 hover:border-white/20"><div className="mb-4 h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500/40 to-cyan-400/20 ring-1 ring-white/10" /><p className="text-[15px] font-semibold leading-snug text-white">{b}</p></div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonial({ s }: { s: S }) {
  const quotes = (s.bullets?.length ? s.bullets : [s.sub || s.name]).slice(0, 3);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <H2>{heading(s)}</H2>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {quotes.map((b, i) => (
            <blockquote key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"><p className="text-[15px] leading-relaxed text-slate-200">“{b}”</p><div className="mt-4 flex items-center gap-3"><span className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500/50 to-cyan-400/30" /><span className="text-sm text-slate-400">Müşteri</span></div></blockquote>
          ))}
        </div>
      </div>
    </section>
  );
}

function Faq({ s }: { s: S }) {
  const qs = bulletsOf(s).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{heading(s)}</h2>
        <div className="mt-6 space-y-3">
          {qs.map((b, i) => <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[15px] font-medium text-white">{b}</div>)}
        </div>
      </div>
    </section>
  );
}

function Cta({ s }: { s: S }) {
  const appt = /contact|book|appointment|randevu|form|reservation|rezervasyon/.test(`${s.id} ${s.name}`.toLowerCase());
  return (
    <section id="contact" className="relative isolate overflow-hidden px-6 py-20">
      <Orb color="var(--acc)" style={{ bottom: '-8rem', left: '50%', width: '32rem', height: '18rem', transform: 'translateX(-50%)' }} />
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur">
        <h2 className="text-2xl font-semibold text-white sm:text-3xl" style={{ fontFamily: 'var(--hf)', letterSpacing: 'var(--tr)' }}>{heading(s)}</h2>
        {s.sub && <p className="mt-3 text-slate-300">{s.sub}</p>}
        {appt ? (
          <div className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
            <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
            <div className="flex h-11 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--acc)' }}>{s.cta || heading(s)}</div>
          </div>
        ) : (
          s.cta && <span className="mt-6 inline-block rounded-xl px-7 py-3 text-sm font-semibold text-white shadow-lg" style={{ background: 'var(--acc)', boxShadow: '0 10px 30px -10px var(--acc)' }}>{s.cta}</span>
        )}
      </div>
    </section>
  );
}

function Footer({ s }: { s: S }) {
  return (
    <footer className="border-t border-white/10 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-400">{s.headline || s.copyPreview || s.name}</p>
        <nav className="flex gap-6 text-sm text-slate-400">{(s.bullets?.length ? s.bullets.slice(0, 4) : [s.name]).map((b, i) => <span key={i}>{b}</span>)}</nav>
      </div>
    </footer>
  );
}

const RENDERERS: Record<SectionKind, (p: { s: S; brief: Brief }) => ReactElement> = {
  hero: ({ s, brief }) => <Hero s={s} brief={brief} />,
  gallery: ({ s }) => <Gallery s={s} />,
  beforeAfter: ({ s }) => <BeforeAfter s={s} />,
  productDemo: ({ s }) => <ProductDemo s={s} />,
  workflow: ({ s }) => <Workflow s={s} />,
  metrics: ({ s }) => <Metrics s={s} />,
  integrations: ({ s }) => <Integrations s={s} />,
  inventory: ({ s }) => <Inventory s={s} />,
  financing: ({ s }) => <Financing s={s} />,
  pricing: ({ s }) => <Pricing s={s} />,
  menu: ({ s }) => <Menu s={s} />,
  features: ({ s }) => <Features s={s} />,
  testimonial: ({ s }) => <Testimonial s={s} />,
  faq: ({ s }) => <Faq s={s} />,
  cta: ({ s }) => <Cta s={s} />,
  footer: ({ s }) => <Footer s={s} />,
  generic: ({ s }) => <Features s={s} />,
};

export default function WebBuildPreviewDocument({
  sectionItems, brief,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: Brief;
}) {
  // Industry design system → CSS vars consumed by the sections below, so a
  // landscaping studio, a SaaS product and a dealership read differently
  // (typography personality, palette, rhythm) — not one universal template.
  const ds = designTokensForBrief(brief);
  const rootStyle = {
    background: ds.bg,
    fontFamily: ds.bodyFont,
    '--acc': ds.accent,
    '--acc2': ds.accent2,
    '--hf': ds.headingFont,
    '--tr': ds.tracking,
    '--rad': ds.radius,
  } as CSSProperties;
  return (
    <div className="text-slate-200 antialiased" style={rootStyle}>
      {sectionItems.map((s) => {
        const Render = RENDERERS[sectionKind(s.id, s.name)] || RENDERERS.generic;
        return <Render key={s.id} s={s} brief={brief} />;
      })}
    </div>
  );
}
