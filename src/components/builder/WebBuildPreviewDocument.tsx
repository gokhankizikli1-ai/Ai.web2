import { motion } from 'framer-motion';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * A REAL, premium rendered approximation of the generated landing page — dark,
 * modern, animated — mirroring the aesthetic the file synthesizer produces
 * (aurora hero, glow cards, gradient CTAs). It renders the ACTUAL generated copy
 * (headline, sub, CTA, service/feature cards, testimonials, appointment form,
 * footer). Subtle, performance-friendly motion via Framer Motion. Shared by the
 * in-app preview drawer and the standalone /preview/web-build/:runId route.
 */
type Brief = { type?: string; audience?: string; goal?: string; style?: string };

const cat = (s: WebBuildSectionItem) => {
  const k = `${s.id} ${s.name}`.toLowerCase();
  if (/hero/.test(k)) return 'hero';
  if (/footer/.test(k)) return 'footer';
  if (/cta|final|contact|book|appointment|randevu|form/.test(k)) return 'cta';
  if (/feature|service|benefit|pricing|plan|process|step|how|testimonial|social|proof|review|faq/.test(k)) return 'cards';
  return 'generic';
};
const isAppointment = (s: WebBuildSectionItem) =>
  /contact|book|appointment|randevu|form|reservation|rezervasyon/.test(`${s.id} ${s.name}`.toLowerCase());

/** A drifting aurora orb (subtle premium background motion). */
function Orb({ color, style, delay = 0 }: { color: string; style: React.CSSProperties; delay?: number }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute rounded-full"
      style={{ filter: 'blur(70px)', opacity: 0.5, background: `radial-gradient(circle, ${color}, transparent 60%)`, ...style }}
      animate={{ x: [0, 26, 0], y: [0, 18, 0], scale: [1, 1.18, 1] }}
      transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay }}
    />
  );
}

function Hero({ s, brief }: { s: WebBuildSectionItem; brief: Brief }) {
  const title = s.headline || s.copyPreview?.split(/[.!?\n]/)[0] || brief.type || '';
  const sub = s.sub || brief.goal || '';
  const cta = s.cta || '';
  const eyebrow = brief.type || s.bullets?.[0];
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.045) 1px,transparent 1px)',
          backgroundSize: '44px 44px',
          WebkitMaskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)',
          maskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)',
        }}
      />
      <Orb color="#6366f1" style={{ top: '-6rem', left: '-4rem', width: '28rem', height: '28rem' }} />
      <Orb color="#22d3ee" style={{ top: '3rem', right: '-6rem', width: '24rem', height: '24rem' }} delay={-6} />
      <motion.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-28"
      >
        {eyebrow && (
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />{eyebrow}
          </span>
        )}
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
        {sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{sub}</p>}
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {cta && <span className="rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30">{cta}</span>}
          {s.bullets?.[1] && <span className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{s.bullets[1]}</span>}
        </div>
        {s.bullets?.[2] && <p className="mt-6 text-xs text-slate-400">{s.bullets[2]}</p>}
      </motion.div>
    </section>
  );
}

function Cards({ s }: { s: WebBuildSectionItem }) {
  const items = (s.bullets?.length ? s.bullets : [s.sub || s.purpose || ''].filter(Boolean)).slice(0, 6);
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        {(s.headline || s.name) && <h2 className="mx-auto max-w-2xl text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">{s.headline || s.name}</h2>}
        {s.sub && <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">{s.sub}</p>}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:-translate-y-1 hover:border-white/20"
            >
              <div className="mb-4 h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500/40 to-cyan-400/20 ring-1 ring-white/10" />
              <p className="text-[15px] font-semibold leading-snug text-white">{b}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonial({ s }: { s: WebBuildSectionItem }) {
  const quote = s.headline || s.sub || s.bullets?.[0] || s.copyPreview || '';
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <p className="text-lg font-medium leading-relaxed text-slate-100">“{quote}”</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500/50 to-cyan-400/30" />
          <div className="text-left">
            <div className="text-sm font-semibold text-white">{s.cta || s.name}</div>
            <div className="text-xs text-slate-400">{s.purpose || ''}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppointmentForm({ s }: { s: WebBuildSectionItem }) {
  const cta = s.cta || s.name;
  return (
    <section id="contact" className="relative isolate overflow-hidden px-6 py-20">
      <Orb color="#6366f1" style={{ bottom: '-8rem', left: '50%', width: '32rem', height: '18rem', transform: 'translateX(-50%)' }} />
      <div className="mx-auto max-w-xl">
        {(s.headline || s.name) && <h2 className="text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">{s.headline || s.name}</h2>}
        {s.sub && <p className="mt-3 text-center text-slate-300">{s.sub}</p>}
        <div className="mt-8 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur">
          <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
          <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
          <div className="h-11 rounded-lg border border-white/10 bg-white/[0.02]" />
          <div className="flex h-11 items-center justify-center rounded-lg bg-indigo-500 text-sm font-semibold text-white">{cta}</div>
        </div>
      </div>
    </section>
  );
}

function Cta({ s }: { s: WebBuildSectionItem }) {
  if (isAppointment(s)) return <AppointmentForm s={s} />;
  return (
    <section id="contact" className="relative isolate overflow-hidden px-6 py-20">
      <Orb color="#6366f1" style={{ bottom: '-8rem', left: '50%', width: '32rem', height: '18rem', transform: 'translateX(-50%)' }} />
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{s.headline || s.name}</h2>
        {s.sub && <p className="mt-3 text-slate-300">{s.sub}</p>}
        {s.cta && <span className="mt-6 inline-block rounded-xl bg-indigo-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30">{s.cta}</span>}
      </div>
    </section>
  );
}

function Generic({ s }: { s: WebBuildSectionItem }) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{s.headline || s.name}</h2>
        {s.sub && <p className="mt-4 leading-relaxed text-slate-300">{s.sub}</p>}
        {!!s.bullets?.length && (
          <ul className="mt-5 space-y-3 text-slate-300">
            {s.bullets.slice(0, 6).map((b, i) => (
              <li key={i} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />{b}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Footer({ s }: { s: WebBuildSectionItem }) {
  return (
    <footer className="border-t border-white/10 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-400">{s.headline || s.copyPreview || s.name}</p>
        <nav className="flex gap-6 text-sm text-slate-400">
          {(s.bullets?.length ? s.bullets.slice(0, 4) : [s.name]).map((b, i) => <span key={i}>{b}</span>)}
        </nav>
      </div>
    </footer>
  );
}

export default function WebBuildPreviewDocument({
  sectionItems, brief,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: Brief;
}) {
  return (
    <div className="bg-[#05070d] font-sans text-slate-200 antialiased">
      {sectionItems.map((s) => {
        switch (cat(s)) {
          case 'hero': return <Hero key={s.id} s={s} brief={brief} />;
          case 'footer': return <Footer key={s.id} s={s} />;
          case 'cta': return <Cta key={s.id} s={s} />;
          case 'cards':
            return /testimonial|social|proof|review/.test(`${s.id} ${s.name}`.toLowerCase())
              ? <Testimonial key={s.id} s={s} />
              : <Cards key={s.id} s={s} />;
          default: return <Generic key={s.id} s={s} />;
        }
      })}
    </div>
  );
}
