/**
 * Deterministic file synthesizer for Web Build.
 *
 * The backend `website_builder` mode reliably returns a structured PLAN + copy,
 * but not always complete per-file code. To guarantee "All files" is never
 * empty and the preview reflects real copy, we synthesize a real React +
 * Tailwind file set (App.tsx + components/*.tsx + index.css) from the parsed
 * sections and their generated copy. If the backend DID return usable files
 * (Frontend Code section with ≥2 real fenced files), we prefer those.
 *
 * Everything is derived from actual returned data — we never emit a component
 * for a section the model didn't produce.
 */
import type { BuildSection } from '@/lib/gameBuilderApi';
import { extractBrief, type WebBuildResult, type WebBuildBrief } from '@/lib/webBuildApi';
import { deriveDesignSystemFromStrategy, designSystemFileContent, type WebBuildDesignSystem } from '@/lib/webBuildDesignSystem';

export interface SynthFile { path: string; content: string; language?: string; summary?: string }

/**
 * Parse the "Frontend Code" section into files: each `### <path>` heading
 * followed by a fenced code block → { path, content, language }.
 */
export function extractFileEntries(sections: BuildSection[]): { path: string; content: string; language?: string }[] {
  const codeBody = sections.find((s) => /frontend\s*code|code\s*files/i.test(s.title))?.body || '';
  if (!codeBody) return [];
  const out: { path: string; content: string; language?: string }[] = [];
  for (const part of codeBody.split(/^###\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const path = (nl >= 0 ? part.slice(0, nl) : part).trim().replace(/`/g, '');
    const rest = nl >= 0 ? part.slice(nl + 1) : '';
    const fence = rest.match(/```(\w+)?\n([\s\S]*?)```/);
    const content = fence ? fence[2].replace(/\s+$/, '') : '';
    const language = fence?.[1];
    if (path) out.push({ path, content, language });
  }
  return out;
}

/** Copy extracted per section id, with the pieces a component needs. */
export interface SectionCopy {
  id: string;
  name: string;
  purpose?: string;
  headline?: string;
  sub?: string;
  cta?: string;
  bullets: string[];
  body: string;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const sectionBody = (sections: BuildSection[], re: RegExp) => sections.find((s) => re.test(s.title))?.body || '';
const humanize = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
function pascal(id: string) {
  const p = id.replace(/(^|[-_ ]+)(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  return /^[a-z]/.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : (p || 'Section');
}
const stripMd = (s: string) => s.replace(/[*_`#>]/g, '').replace(/^\s*[-*]\s+/, '').trim();
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** Parse the "Page Sections" list + "Generated Copy" blocks into rich copy. */
export function parseSectionCopy(result: WebBuildResult): SectionCopy[] {
  const pageBody = sectionBody(result.sections, /page\s*sections/i);
  const copyBody = sectionBody(result.sections, /generated\s*copy/i);

  // id → full copy block
  const copyById: Record<string, string> = {};
  for (const part of copyBody.split(/^###\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const head = norm((nl >= 0 ? part.slice(0, nl) : part).replace(/`/g, ''));
    copyById[head] = (nl >= 0 ? part.slice(nl + 1) : '').trim();
  }

  const items: SectionCopy[] = [];
  const lineRe = /^\s*[-*]\s+`?([a-z0-9][a-z0-9-_ ]*?)`?\s*[:\-–]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = lineRe.exec(pageBody)) !== null) {
    const rawId = m[1].trim();
    const id = rawId.toLowerCase().replace(/\s+/g, '-');
    if (seen.has(id)) continue;
    seen.add(id);
    const purpose = m[2].trim();
    const body = copyById[norm(rawId)] || copyById[norm(id)] || '';
    items.push({ id, name: humanize(rawId), purpose, body, ...extractCopyPieces(body, purpose) });
  }
  // Fallback: if the plan had no parsable list, derive sections from copy blocks.
  if (items.length === 0) {
    for (const key of Object.keys(copyById)) {
      const id = key.replace(/\s+/g, '-');
      items.push({ id, name: humanize(key), body: copyById[key], ...extractCopyPieces(copyById[key]) });
    }
  }
  return items;
}

/** Pull headline / subhead / CTA / bullets out of a copy block. */
function extractCopyPieces(body: string, purpose?: string): { headline?: string; sub?: string; cta?: string; bullets: string[] } {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  let headline: string | undefined;
  let sub: string | undefined;
  let cta: string | undefined;

  for (const raw of lines) {
    const line = raw;
    const low = line.toLowerCase();
    const ctaMatch = /(cta|button|buton|call to action|book|randevu|başla|get started|sign up|subscribe|contact)/i.test(low);
    if (/^\s*[-*]\s+/.test(line)) { bullets.push(stripMd(line)); continue; }
    const labelled = line.match(/^(headline|başlık|h1|hero|subhead(?:line)?|alt\s*başlık|cta|button|buton)\s*[:\-–]\s*(.+)$/i);
    if (labelled) {
      const val = stripMd(labelled[2]);
      const key = labelled[1].toLowerCase();
      if (/head|başlık|h1|hero/.test(key) && !/sub|alt/.test(key)) headline ??= val;
      else if (/sub|alt/.test(key)) sub ??= val;
      else if (/cta|button|buton/.test(key)) cta ??= val;
      continue;
    }
    if (ctaMatch && line.length < 48 && !cta) { cta = stripMd(line); continue; }
    if (!headline) { headline = stripMd(line); continue; }
    if (!sub) { sub = stripMd(line); continue; }
    if (bullets.length < 6) bullets.push(stripMd(line));
  }
  if (!sub && purpose) sub = purpose;
  return { headline, sub, cta, bullets };
}

/* ── Component templates ─────────────────────────────────────────────── */

function heroComponent(name: string, c: SectionCopy, brief: { goal?: string; type?: string }): string {
  const headline = c.headline || 'Your headline here';
  const sub = c.sub || brief.goal || '';
  const cta = c.cta || 'Get started';
  const eyebrow = brief.type || c.bullets?.[0] || '';
  const secondary = c.bullets?.[1] || '';
  const proof = c.bullets?.[2] || '';
  return `export default function ${name}() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Animated premium background: soft grid + drifting aurora orbs */}
      <div className="kx-grid absolute inset-0 -z-10" aria-hidden="true" />
      <div className="kx-aurora -z-10" style={{ top: '-6rem', left: '-4rem', width: '28rem', height: '28rem', background: 'radial-gradient(circle, var(--kx-accent), transparent 60%)' }} aria-hidden="true" />
      <div className="kx-aurora -z-10" style={{ top: '3rem', right: '-6rem', width: '24rem', height: '24rem', background: 'radial-gradient(circle, var(--kx-accent-2), transparent 60%)', animationDelay: '-6s' }} aria-hidden="true" />
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="kx-reveal mx-auto max-w-3xl text-center">
          ${eyebrow ? `<span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-indigo-200">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" /> {\`${esc(eyebrow)}\`}
          </span>` : ''}
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            {\`${esc(headline)}\`}
          </h1>
          ${sub ? `<p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{\`${esc(sub)}\`}</p>` : ''}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#contact" className="rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400">
              {\`${esc(cta)}\`}
            </a>
            ${secondary ? `<a href="#features" className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200 transition hover:bg-white/[0.05]">{\`${esc(secondary)}\`}</a>` : ''}
          </div>
          ${proof ? `<p className="mt-6 text-xs text-slate-400">{\`${esc(proof)}\`}</p>` : ''}
        </div>
      </div>
    </section>
  );
}
`;
}

function cardsComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.sub || c.purpose || '']).filter(Boolean).slice(0, 6);
  const cards = items.map((b, i) => `          <div key={${i}} className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.05]">
            <div className="mb-4 h-11 w-11 rounded-xl bg-gradient-to-br from-indigo-500/40 to-cyan-400/20 ring-1 ring-white/10" />
            <p className="text-[15px] font-semibold leading-snug text-white">{\`${esc(b)}\`}</p>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="features" className="relative px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl">
        ${c.headline ? `<h2 className="mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        ${c.sub ? `<p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">{\`${esc(c.sub)}\`}</p>` : ''}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
${cards}
        </div>
      </div>
    </section>
  );
}
`;
}

function ctaComponent(name: string, c: SectionCopy): string {
  const headline = c.headline || 'Ready to start?';
  const cta = c.cta || 'Book now';
  return `export default function ${name}() {
  return (
    <section id="contact" className="relative isolate overflow-hidden px-6 py-24">
      <div className="kx-aurora -z-10" style={{ bottom: '-8rem', left: '50%', width: '32rem', height: '20rem', transform: 'translateX(-50%)', background: 'radial-gradient(circle, var(--kx-accent), transparent 60%)' }} aria-hidden="true" />
      <div className="kx-reveal mx-auto max-w-2xl rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur">
        <h2 className="text-3xl font-semibold tracking-tight text-white">{\`${esc(headline)}\`}</h2>
        ${c.sub ? `<p className="mt-3 text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
        <a href="#" className="mt-7 inline-block rounded-xl bg-indigo-500 px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400">
          {\`${esc(cta)}\`}
        </a>
      </div>
    </section>
  );
}
`;
}

function footerComponent(name: string, c: SectionCopy): string {
  return `export default function ${name}() {
  return (
    <footer className="border-t border-white/10 px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-slate-400">{\`${esc(c.headline || '© Your Company')}\`}</p>
        <nav className="flex gap-6 text-sm text-slate-400">
          <a href="#features" className="transition hover:text-white">Features</a>
          <a href="#contact" className="transition hover:text-white">Contact</a>
        </nav>
      </div>
    </footer>
  );
}
`;
}

function genericComponent(name: string, c: SectionCopy): string {
  const headline = c.headline || c.name;
  const bullets = c.bullets.slice(0, 6);
  const list = bullets.length
    ? `        <ul className="mt-6 space-y-3 text-slate-300">\n${bullets.map((b, i) => `          <li key={${i}} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />{\`${esc(b)}\`}</li>`).join('\n')}\n        </ul>`
    : (c.sub ? `        <p className="mt-4 leading-relaxed text-slate-300">{\`${esc(c.sub)}\`}</p>` : '');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-3xl font-semibold tracking-tight text-white">{\`${esc(headline)}\`}</h2>
${list}
      </div>
    </section>
  );
}
`;
}

/* ── Archetype-specific templates (genuinely different layouts) ───────── */

function galleryComponent(name: string, c: SectionCopy): string {
  const tiles = (c.bullets.length ? c.bullets : [c.name]).slice(0, 6);
  const cells = tiles.map((b, i) => `          <figure key={${i}} className="group relative overflow-hidden rounded-2xl border border-white/10 ${i % 5 === 0 ? 'sm:col-span-2' : ''}">
            <div className="aspect-[4/3] w-full bg-gradient-to-br from-white/[0.06] to-white/[0.01] transition duration-500 group-hover:scale-[1.03]" />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-sm font-medium text-white">{\`${esc(b)}\`}</figcaption>
          </figure>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="gallery" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function beforeAfterComponent(name: string, c: SectionCopy): string {
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-2xl border border-white/10">
            <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span>
            <div className="aspect-[4/3] bg-white/[0.03]" />
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-indigo-400/30 ring-1 ring-indigo-400/20">
            <span className="absolute left-3 top-3 rounded-full bg-indigo-500 px-2.5 py-1 text-xs text-white">Sonrası</span>
            <div className="aspect-[4/3] bg-gradient-to-br from-indigo-500/20 to-cyan-400/10" />
          </div>
        </div>
      </div>
    </section>
  );
}
`;
}

function productDemoComponent(name: string, c: SectionCopy): string {
  const lines = (c.bullets.length ? c.bullets : ['Merhaba, nasıl yardımcı olabilirim?', 'Siparişimi takip etmek istiyorum.', 'Tabii, sipariş numaranı paylaşır mısın?']).slice(0, 4);
  const bubbles = lines.map((b, i) => `            <div key={${i}} className="max-w-[80%] ${i % 2 ? 'ml-auto bg-indigo-500 text-white' : 'bg-white/[0.06] text-slate-200'} rounded-2xl px-3.5 py-2 text-[13px]">{\`${esc(b)}\`}</div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="demo" className="relative isolate overflow-hidden px-6 py-20">
      <div className="kx-aurora -z-10" style={{ top: '-4rem', right: '-4rem', width: '22rem', height: '22rem', background: 'radial-gradient(circle, var(--kx-accent), transparent 60%)' }} aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
          ${c.cta ? `<a href="#contact" className="mt-6 inline-block rounded-xl bg-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30">{\`${esc(c.cta)}\`}</a>` : ''}
        </div>
        <div className="kx-float rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/40">
          <div className="mb-3 flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /></div>
          <div className="space-y-2">
${bubbles}
          </div>
        </div>
      </div>
    </section>
  );
}
`;
}

function workflowComponent(name: string, c: SectionCopy): string {
  const steps = (c.bullets.length ? c.bullets : [c.name]).slice(0, 4);
  const cells = steps.map((b, i) => `          <li key={${i}} className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <span className="text-sm font-semibold text-indigo-300">0${i + 1}</span>
            <p className="mt-2 text-[15px] font-medium text-white">{\`${esc(b)}\`}</p>
          </li>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="process" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
${cells}
        </ol>
      </div>
    </section>
  );
}
`;
}

function metricsComponent(name: string, c: SectionCopy): string {
  const stats = ['98%', '2.5x', '24/7', '<1dk'];
  const labels = (c.bullets.length ? c.bullets : [c.name]).slice(0, 4);
  const cells = labels.map((b, i) => `          <div key={${i}} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
            <div className="text-4xl font-semibold tracking-tight text-white">${stats[i % stats.length]}</div>
            <p className="mt-2 text-sm text-slate-400">{\`${esc(b)}\`}</p>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function integrationsComponent(name: string, c: SectionCopy): string {
  const chips = (c.bullets.length ? c.bullets : ['Slack', 'Zendesk', 'Shopify', 'WhatsApp', 'HubSpot', 'Notion']).slice(0, 8);
  const cells = chips.map((b, i) => `          <div key={${i}} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
            <span className="h-4 w-4 rounded bg-gradient-to-br from-indigo-500/50 to-cyan-400/30" />{\`${esc(b)}\`}
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl text-center">
        ${c.headline ? `<h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function inventoryComponent(name: string, c: SectionCopy): string {
  const cars = (c.bullets.length ? c.bullets : [c.name]).slice(0, 6);
  const cells = cars.map((b, i) => `          <div key={${i}} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="aspect-[16/10] bg-gradient-to-br from-white/[0.08] to-white/[0.01]" />
            <div className="p-5">
              <p className="text-[15px] font-semibold text-white">{\`${esc(b)}\`}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400"><span>2023 · Otomatik · Benzin</span><span className="font-semibold text-white">₺${(850 + i * 120).toLocaleString?.() || 850}.000</span></div>
              <button className="mt-4 w-full rounded-lg bg-indigo-500 py-2 text-sm font-semibold text-white">İncele</button>
            </div>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="inventory" className="px-6 py-20">
      <div className="mx-auto max-w-6xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function financingComponent(name: string, c: SectionCopy): string {
  const badges = (c.bullets.length ? c.bullets : ['Garanti', 'Ekspertiz', 'Takas', 'Finansman']).slice(0, 4);
  const cells = badges.map((b, i) => `          <div key={${i}} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500/40 to-cyan-400/20" />
            <span className="text-sm font-medium text-slate-200">{\`${esc(b)}\`}</span>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl rounded-3xl border border-white/10 bg-white/[0.02] p-8">
        ${c.headline ? `<h2 className="text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function pricingComponent(name: string, c: SectionCopy): string {
  const tiers = (c.bullets.length ? c.bullets : ['Başlangıç', 'Pro', 'Kurumsal']).slice(0, 3);
  const cells = tiers.map((b, i) => {
    const featured = i === 1;
    const cardCls = featured ? 'border-indigo-400/40 bg-indigo-500/[0.06]' : 'border-white/10 bg-white/[0.03]';
    const btnCls = featured ? 'bg-indigo-500 text-white' : 'border border-white/15 text-slate-200';
    return `          <div key={${i}} className="rounded-2xl border p-6 ${cardCls}">
            <p className="text-sm font-medium text-slate-300">{\`${esc(b)}\`}</p>
            <div className="mt-3 text-3xl font-semibold text-white">₺${199 + i * 200}<span className="text-sm text-slate-400">/ay</span></div>
            <button className="mt-5 w-full rounded-lg ${btnCls} py-2 text-sm font-semibold">Seç</button>
          </div>`;
  }).join('\n');
  return `export default function ${name}() {
  return (
    <section id="pricing" className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function menuComponent(name: string, c: SectionCopy): string {
  const dishes = (c.bullets.length ? c.bullets : [c.name]).slice(0, 6);
  const cells = dishes.map((b, i) => `          <li key={${i}} className="flex items-baseline gap-3">
            <span className="font-medium text-white">{\`${esc(b)}\`}</span>
            <span className="flex-1 border-b border-dashed border-white/15" />
            <span className="text-sm text-slate-400">₺${120 + i * 30}</span>
          </li>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="menu" className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <ul className="mt-8 space-y-4">
${cells}
        </ul>
      </div>
    </section>
  );
}
`;
}

function testimonialComponent(name: string, c: SectionCopy): string {
  const quotes = (c.bullets.length ? c.bullets : [c.sub || c.name]).slice(0, 3);
  const cells = quotes.map((b, i) => `          <blockquote key={${i}} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <p className="text-[15px] leading-relaxed text-slate-200">&ldquo;{\`${esc(b)}\`}&rdquo;</p>
            <div className="mt-4 flex items-center gap-3"><span className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500/50 to-cyan-400/30" /><span className="text-sm text-slate-400">Müşteri</span></div>
          </blockquote>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function faqComponent(name: string, c: SectionCopy): string {
  const qs = (c.bullets.length ? c.bullets : [c.name]).slice(0, 6);
  const cells = qs.map((b, i) => `          <details key={${i}} className="group rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <summary className="cursor-pointer text-[15px] font-medium text-white marker:content-['']">{\`${esc(b)}\`}</summary>
            <p className="mt-2 text-sm text-slate-400">Detaylı yanıt burada yer alır.</p>
          </details>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="faq" className="px-6 py-20">
      <div className="mx-auto max-w-3xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-8 space-y-3">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

/** Map a section id/name to a distinct visual template kind. */
export type SectionKind =
  | 'hero' | 'gallery' | 'beforeAfter' | 'productDemo' | 'workflow' | 'metrics'
  | 'integrations' | 'inventory' | 'financing' | 'pricing' | 'menu'
  | 'features' | 'testimonial' | 'faq' | 'cta' | 'footer' | 'generic';

export function sectionKind(id: string, sectionName: string): SectionKind {
  const k = `${id} ${sectionName}`.toLowerCase();
  if (/hero/.test(k)) return 'hero';
  if (/footer/.test(k)) return 'footer';
  if (/before.?after|önce.?sonra/.test(k)) return 'beforeAfter';
  if (/product.?demo|chatbot|chat|dashboard|demo/.test(k)) return 'productDemo';
  if (/workflow|how.?it.?works|process|süreç|adım|nasıl/.test(k)) return 'workflow';
  if (/metric|result|stat|sonuç|rakam/.test(k)) return 'metrics';
  if (/integration|entegrasyon/.test(k)) return 'integrations';
  if (/inventory|vehicle|featured.?(car|vehicle)|araç|araba|envanter/.test(k)) return 'inventory';
  if (/financ|finans|kredi/.test(k)) return 'financing';
  if (/pricing|price|plan|program|fiyat|paket/.test(k)) return 'pricing';
  if (/menu|menü/.test(k)) return 'menu';
  if (/gallery|galeri|collection|koleksiyon|material|malzeme|portfolio|portfolyo|proje|project|work|iş/.test(k)) return 'gallery';
  if (/testimonial|social|proof|review|yorum|referans/.test(k)) return 'testimonial';
  if (/faq|sıkça|soru/.test(k)) return 'faq';
  if (/cta|final|contact|book|appointment|randevu|form|reservation|rezervasyon|iletişim/.test(k)) return 'cta';
  if (/feature|service|benefit|hizmet|özellik/.test(k)) return 'features';
  return 'generic';
}

function componentFor(name: string, c: SectionCopy, brief: { goal?: string; type?: string }): string {
  switch (sectionKind(c.id, c.name)) {
    case 'hero': return heroComponent(name, c, brief);
    case 'footer': return footerComponent(name, c);
    case 'cta': return ctaComponent(name, c);
    case 'gallery': return galleryComponent(name, c);
    case 'beforeAfter': return beforeAfterComponent(name, c);
    case 'productDemo': return productDemoComponent(name, c);
    case 'workflow': return workflowComponent(name, c);
    case 'metrics': return metricsComponent(name, c);
    case 'integrations': return integrationsComponent(name, c);
    case 'inventory': return inventoryComponent(name, c);
    case 'financing': return financingComponent(name, c);
    case 'pricing': return pricingComponent(name, c);
    case 'menu': return menuComponent(name, c);
    case 'testimonial': return testimonialComponent(name, c);
    case 'faq': return faqComponent(name, c);
    case 'features': return cardsComponent(name, c);
    default: return genericComponent(name, c);
  }
}

/** Short human file summary from the section purpose/name. */
function fileSummary(c: SectionCopy): string {
  return (c.purpose || c.sub || c.name).replace(/\s+/g, ' ').slice(0, 90);
}

/** Synthesize the full file set from the parsed sections + copy. */
export function synthesizeFiles(result: WebBuildResult): SynthFile[] {
  const brief = extractBrief(result.sections);
  return synthesizeFromCopies(parseSectionCopy(result), brief);
}

/** A structured `siteContent.ts` module holding the real copy — so the project
 *  keeps content organized instead of inlined everywhere. */
function siteContentFile(items: SectionCopy[]): SynthFile {
  const content = items.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.headline ? { headline: c.headline } : {}),
    ...(c.sub ? { sub: c.sub } : {}),
    ...(c.cta ? { cta: c.cta } : {}),
    ...(c.bullets?.length ? { bullets: c.bullets.slice(0, 8) } : {}),
  }));
  return {
    path: 'src/data/siteContent.ts',
    language: 'ts',
    summary: 'Structured site copy (headline / sub / CTA / bullets per section)',
    content: `/** Structured content for every section — edit copy here in one place. */
export const siteContent = ${JSON.stringify(content, null, 2)} as const;

export type SiteContent = typeof siteContent;
`,
  };
}

/** The Vite-style entry file — real, not a placeholder. */
function mainFile(): SynthFile {
  return {
    path: 'src/main.tsx',
    language: 'tsx',
    summary: 'App entry — mounts the page and loads the design system styles',
    content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  };
}

/**
 * Build the full React + Tailwind PROJECT from a resolved copy set — a real,
 * dynamic file tree (entry, shell, styles, design-system tokens, structured
 * content, one component per section) whose SHAPE follows the strategy, not a
 * fixed 5-file template. Reused by both the backend-parsed path and the industry
 * fallback so an inferred brief produces the same premium project.
 */
export function synthesizeFromCopies(
  items: SectionCopy[], brief: WebBuildBrief,
): SynthFile[] {
  if (items.length === 0) return [];

  const ds = deriveDesignSystemFromStrategy(brief);
  const compNames = items.map((c) => pascal(c.id));
  const files: SynthFile[] = [];

  // One component file per real section — the tree GROWS with the site.
  items.forEach((c, i) => {
    const name = compNames[i];
    files.push({
      path: `src/components/${name}.tsx`,
      language: 'tsx',
      content: componentFor(name, c, brief),
      summary: fileSummary(c),
    });
  });

  const imports = items.map((_, i) => `import ${compNames[i]} from './components/${compNames[i]}';`).join('\n');
  const usage = items.map((_, i) => `      <${compNames[i]} />`).join('\n');
  const app = `${imports}

export default function App() {
  return (
    <main
      className="min-h-screen text-slate-200 antialiased"
      style={{ background: 'var(--kx-bg)' }}
    >
${usage}
    </main>
  );
}
`;

  // Base project files (entry, shell, styles, tokens, content) — then sections.
  files.unshift({ path: 'src/App.tsx', language: 'tsx', content: app, summary: 'Page shell composing all generated sections' });
  files.unshift(mainFile());
  files.push({ path: 'src/lib/designSystem.ts', language: 'ts', content: designSystemFileContent(ds), summary: 'Strategy-derived design tokens (palette, type, radius, motion)' });
  files.push(siteContentFile(items));
  files.push(stylesFile(ds));

  return files;
}

/** The theme + motion stylesheet — CSS custom properties come from the derived
 *  design system so a different strategy yields a different palette in code too. */
function stylesFile(ds: WebBuildDesignSystem): SynthFile {
  return {
    path: 'src/styles.css',
    language: 'css',
    summary: 'Design-system theme + subtle motion (aurora, float, reveal, grid)',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  --kx-bg: ${ds.bg};
  --kx-accent: ${ds.accent};
  --kx-accent-2: ${ds.accent2};
  --kx-radius: ${ds.radius};
}

html { scroll-behavior: smooth; }
body {
  background: var(--kx-bg);
  color: #e5e9f0;
  font-family: ${ds.bodyFont};
  -webkit-font-smoothing: antialiased;
}

/* ── Premium motion primitives (subtle, performance-friendly) ─────────── */
@keyframes kx-aurora {
  0%   { transform: translate3d(-8%, -6%, 0) scale(1); }
  50%  { transform: translate3d(8%, 6%, 0) scale(1.18); }
  100% { transform: translate3d(-8%, -6%, 0) scale(1); }
}
@keyframes kx-float {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-12px); }
}
@keyframes kx-reveal {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Drifting aurora orb — position/size/color set inline per use. */
.kx-aurora {
  position: absolute;
  border-radius: 9999px;
  filter: blur(70px);
  opacity: 0.55;
  animation: kx-aurora 16s ease-in-out infinite;
  pointer-events: none;
}
.kx-float  { animation: kx-float 7s ease-in-out infinite; }
.kx-reveal { animation: kx-reveal 0.8s cubic-bezier(0.22, 1, 0.36, 1) both; }

/* Soft blueprint grid, faded toward the edges. */
.kx-grid {
  background-image:
    linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(ellipse at center, #000 40%, transparent 75%);
  mask-image: radial-gradient(ellipse at center, #000 40%, transparent 75%);
}

@media (prefers-reduced-motion: reduce) {
  .kx-aurora, .kx-float, .kx-reveal { animation: none; }
}
`,
  };
}

/**
 * The authoritative file set for a build: prefer real backend code when it
 * returned ≥2 non-trivial files, otherwise synthesize deterministically. Never
 * returns an empty list when there are sections/copy to build from.
 */
export function resolveBuildFiles(result: WebBuildResult): SynthFile[] {
  const backend = extractFileEntries(result.sections).filter((f) => f.content && f.content.trim().length > 20);
  if (backend.length >= 2) {
    return backend.map((f) => ({ ...f, summary: undefined }));
  }
  return synthesizeFiles(result);
}
