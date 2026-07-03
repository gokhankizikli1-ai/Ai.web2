import type { WebBuildSectionItem } from '@/lib/webBuildPayload';

/**
 * A REAL rendered approximation of the generated landing page — not a grey
 * skeleton. It renders the actual generated copy (headline, subheadline, CTA,
 * service/feature cards, testimonials, an appointment/contact form, footer) as
 * a light-theme premium page, mirroring the categories the file synthesizer
 * uses (hero / cards / cta / footer / generic). Shared by the in-app preview
 * drawer and the standalone /preview/web-build route so both show the same
 * real page.
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

function Hero({ s, brief }: { s: WebBuildSectionItem; brief: Brief }) {
  const title = s.headline || s.copyPreview?.split(/[.!?\n]/)[0] || brief.type || '';
  const sub = s.sub || brief.goal || '';
  const cta = s.cta || '';
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white px-6 py-20 text-center sm:py-28">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-5xl">{title}</h1>
        {sub && <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{sub}</p>}
        <div className="mt-8 flex items-center justify-center gap-3">
          {cta && <span className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white shadow-sm">{cta}</span>}
          {s.bullets?.[0] && <span className="rounded-xl border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700">{s.bullets[0]}</span>}
        </div>
      </div>
    </section>
  );
}

function Cards({ s }: { s: WebBuildSectionItem }) {
  const items = (s.bullets?.length ? s.bullets : [s.sub || s.purpose || ''].filter(Boolean)).slice(0, 6);
  return (
    <section className="bg-slate-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        {(s.headline || s.name) && <h2 className="mb-10 text-center text-2xl font-semibold text-slate-900 sm:text-3xl">{s.headline || s.name}</h2>}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((b, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 h-10 w-10 rounded-lg bg-blue-100" />
              <p className="text-[15px] font-medium leading-snug text-slate-900">{b}</p>
            </div>
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
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-lg font-medium leading-relaxed text-slate-800">“{quote}”</p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <div className="h-9 w-9 rounded-full bg-slate-200" />
          <div className="text-left">
            <div className="text-sm font-semibold text-slate-900">{s.cta || s.name}</div>
            <div className="text-xs text-slate-500">{s.purpose || ''}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppointmentForm({ s }: { s: WebBuildSectionItem }) {
  const cta = s.cta || s.name;
  return (
    <section id="contact" className="bg-blue-600 px-6 py-16">
      <div className="mx-auto max-w-xl">
        {(s.headline || s.name) && <h2 className="text-center text-2xl font-semibold text-white sm:text-3xl">{s.headline || s.name}</h2>}
        {s.sub && <p className="mt-3 text-center text-blue-100">{s.sub}</p>}
        <div className="mt-8 space-y-3 rounded-2xl bg-white p-6 shadow-lg">
          <div className="h-11 rounded-lg border border-slate-200 bg-slate-50" />
          <div className="h-11 rounded-lg border border-slate-200 bg-slate-50" />
          <div className="h-11 rounded-lg border border-slate-200 bg-slate-50" />
          <div className="flex h-11 items-center justify-center rounded-lg bg-blue-600 text-sm font-medium text-white">{cta}</div>
        </div>
      </div>
    </section>
  );
}

function Cta({ s }: { s: WebBuildSectionItem }) {
  if (isAppointment(s)) return <AppointmentForm s={s} />;
  return (
    <section id="contact" className="bg-blue-600 px-6 py-16 text-center">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-2xl font-semibold text-white sm:text-3xl">{s.headline || s.name}</h2>
        {s.sub && <p className="mt-3 text-blue-100">{s.sub}</p>}
        {s.cta && <span className="mt-6 inline-block rounded-xl bg-white px-6 py-3 text-sm font-medium text-blue-700">{s.cta}</span>}
      </div>
    </section>
  );
}

function Generic({ s }: { s: WebBuildSectionItem }) {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-2xl font-semibold text-slate-900 sm:text-3xl">{s.headline || s.name}</h2>
        {s.sub && <p className="mt-4 text-slate-600">{s.sub}</p>}
        {!!s.bullets?.length && (
          <ul className="mt-5 space-y-2 text-slate-600">
            {s.bullets.slice(0, 6).map((b, i) => (
              <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />{b}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Footer({ s }: { s: WebBuildSectionItem }) {
  return (
    <footer className="border-t border-slate-200 bg-white px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-500">{s.headline || s.copyPreview || s.name}</p>
        <nav className="flex gap-6 text-sm text-slate-500">
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
    <div className="bg-white font-sans text-slate-900 antialiased">
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
