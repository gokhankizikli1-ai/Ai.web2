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
import {
  deriveLayoutPlan, layoutPlanFileContent, visualSystemTokens, sectionKind,
  type WebBuildLayoutPlan, type SectionKind, type SectionVariant, type VisualModule,
} from '@/lib/webBuildLayoutPlan';
import { deriveWebBuildArtIdentity, type WebBuildArtIdentity, type ArtRenderMode } from '@/lib/webBuildArtIdentity';

// Re-export the section classifier so existing importers keep working while the
// plan layer owns section semantics.
export { sectionKind };
export type { SectionKind };

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

function cardsComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.sub || c.purpose || '']).filter(Boolean).slice(0, 6);
  const cards = items.map((b, i) => `          <div key={${i}} className="kx-art-card group relative rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-[var(--kx-card-hover)]">
            <div className="mb-4 h-11 w-11 rounded-xl bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_40%,transparent),color-mix(in_srgb,var(--kx-accent-2)_20%,transparent))] ring-1 ring-white/10" />
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
      <div className="kx-reveal mx-auto max-w-2xl rounded-3xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-10 text-center backdrop-blur">
        <h2 className="text-3xl font-semibold tracking-tight text-white">{\`${esc(headline)}\`}</h2>
        ${c.sub ? `<p className="mt-3 text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
        <a href="#" className="mt-7 inline-block rounded-xl bg-[var(--kx-accent)] px-7 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:bg-[var(--kx-accent)]">
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
    <footer className="border-t border-[color:var(--kx-border)] px-6 py-12">
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
    ? `        <ul className="mt-6 space-y-3 text-slate-300">\n${bullets.map((b, i) => `          <li key={${i}} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kx-accent)]" />{\`${esc(b)}\`}</li>`).join('\n')}\n        </ul>`
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
  const cells = tiles.map((b, i) => `          <figure key={${i}} className="kx-art-card group relative overflow-hidden rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] ${i % 5 === 0 ? 'sm:col-span-2' : ''}">
            <div className="kx-art-media w-full bg-gradient-to-br from-white/[0.06] to-white/[0.01] transition duration-500 group-hover:scale-[1.03]" />
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
          <div className="relative overflow-hidden rounded-[var(--kx-radius)] border border-[color:var(--kx-border)]">
            <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-xs text-slate-300">Öncesi</span>
            <div className="aspect-[4/3] bg-[var(--kx-card)]" />
          </div>
          <div className="relative overflow-hidden rounded-[var(--kx-radius)] border border-[color-mix(in_srgb,var(--kx-accent)_30%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--kx-accent)_20%,transparent)]">
            <span className="absolute left-3 top-3 rounded-full bg-[var(--kx-accent)] px-2.5 py-1 text-xs text-white">Sonrası</span>
            <div className="aspect-[4/3] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_20%,transparent),color-mix(in_srgb,var(--kx-accent-2)_10%,transparent))]" />
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
  const bubbles = lines.map((b, i) => `            <div key={${i}} className="max-w-[80%] ${i % 2 ? 'ml-auto bg-[var(--kx-accent)] text-white' : 'bg-white/[0.06] text-slate-200'} rounded-[var(--kx-radius)] px-3.5 py-2 text-[13px]">{\`${esc(b)}\`}</div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section id="demo" className="relative isolate overflow-hidden px-6 py-20">
      <div className="kx-aurora -z-10" style={{ top: '-4rem', right: '-4rem', width: '22rem', height: '22rem', background: 'radial-gradient(circle, var(--kx-accent), transparent 60%)' }} aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2">
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
          ${c.cta ? `<a href="#contact" className="mt-6 inline-block rounded-xl bg-[var(--kx-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40">{\`${esc(c.cta)}\`}</a>` : ''}
        </div>
        <div className="kx-float rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-4 shadow-2xl shadow-black/40">
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
  const cells = steps.map((b, i) => `          <li key={${i}} className="kx-art-card relative rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-6">
            <span className="text-sm font-semibold text-[var(--kx-accent)]">0${i + 1}</span>
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
  const cells = labels.map((b, i) => `          <div key={${i}} className="rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-6 text-center">
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
  const cells = chips.map((b, i) => `          <div key={${i}} className="flex items-center justify-center gap-2 rounded-xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] px-4 py-3 text-sm text-slate-300">
            <span className="h-4 w-4 rounded bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_50%,transparent),color-mix(in_srgb,var(--kx-accent-2)_30%,transparent))]" />{\`${esc(b)}\`}
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
  const cells = cars.map((b, i) => `          <div key={${i}} className="overflow-hidden rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)]">
            <div className="aspect-[16/10] bg-gradient-to-br from-white/[0.08] to-white/[0.01]" />
            <div className="p-5">
              <p className="text-[15px] font-semibold text-white">{\`${esc(b)}\`}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400"><span>2023 · Otomatik · Benzin</span><span className="font-semibold text-white">₺${(850 + i * 120).toLocaleString?.() || 850}.000</span></div>
              <button className="mt-4 w-full rounded-lg bg-[var(--kx-accent)] py-2 text-sm font-semibold text-white">İncele</button>
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
  const cells = badges.map((b, i) => `          <div key={${i}} className="flex items-center gap-3 rounded-xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] px-4 py-3">
            <span className="h-9 w-9 rounded-lg bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_40%,transparent),color-mix(in_srgb,var(--kx-accent-2)_20%,transparent))]" />
            <span className="text-sm font-medium text-slate-200">{\`${esc(b)}\`}</span>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl rounded-3xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-8">
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
    const cardCls = featured ? 'border-[color-mix(in_srgb,var(--kx-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--kx-accent)_7%,transparent)]' : 'border-[color:var(--kx-border)] bg-[var(--kx-card)]';
    const btnCls = featured ? 'bg-[var(--kx-accent)] text-white' : 'border border-white/15 text-slate-200';
    return `          <div key={${i}} className="kx-art-card rounded-[var(--kx-radius)] border p-6 ${cardCls}">
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
  const cells = quotes.map((b, i) => `          <blockquote key={${i}} className="rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-6">
            <p className="text-[15px] leading-relaxed text-slate-200">&ldquo;{\`${esc(b)}\`}&rdquo;</p>
            <div className="mt-4 flex items-center gap-3"><span className="h-8 w-8 rounded-full bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_50%,transparent),color-mix(in_srgb,var(--kx-accent-2)_30%,transparent))]" /><span className="text-sm text-slate-400">Müşteri</span></div>
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
  const cells = qs.map((b, i) => `          <details key={${i}} className="kx-art-card group rounded-xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-4">
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

/* ── Plan-driven templates (hero compositions + section variants) ─────── */

/**
 * Generated hero background that FOLLOWS the strategy's visual-system motif — so
 * the generated code no longer always uses the same grid+aurora shell. Each motif
 * is a genuinely different, dark-safe construction (mirrors the preview Backdrop):
 * blueprint/dot-matrix for technical, editorial rules for archive/portfolio,
 * spotlight for luxury/trust, terrain for landscaping, diagonal for events, warm
 * veil for hospitality/community. Uses existing visual-system vocabulary only. */
function generatedHeroBg(plan: WebBuildLayoutPlan): string {
  const bg = plan.visualSystem.background;
  const orb = (pos: string, size: string, color: string, delay = '') =>
    `      <div className="kx-aurora -z-10" style={{ ${pos}, ${size}, background: 'radial-gradient(circle, ${color}, transparent 60%)'${delay ? `, animationDelay: '${delay}'` : ''} }} aria-hidden="true" />`;
  const grid = (op: number, size = 44) =>
    `      <div className="absolute inset-0 -z-10" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,${op}) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,${op}) 1px,transparent 1px)', backgroundSize: '${size}px ${size}px', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)', maskImage: 'radial-gradient(ellipse at center,#000 40%,transparent 75%)' }} aria-hidden="true" />`;
  switch (bg) {
    case 'blueprint':
      return `      <div className="absolute inset-0 -z-10" style={{ backgroundImage: 'linear-gradient(var(--kx-accent) 1px,transparent 1px),linear-gradient(90deg,var(--kx-accent) 1px,transparent 1px)', backgroundSize: '130px 130px', opacity: 0.12 }} aria-hidden="true" />\n${grid(0.06, 26)}`;
    case 'dot-matrix':
      return `      <div className="absolute inset-0 -z-10" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)', backgroundSize: '22px 22px', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 45%,transparent 80%)', maskImage: 'radial-gradient(ellipse at center,#000 45%,transparent 80%)' }} aria-hidden="true" />\n${orb("top: '-4rem'", "right: '-4rem', width: '22rem', height: '22rem'", 'var(--kx-accent)')}`;
    case 'editorial-rules':
      return `      <div className="absolute inset-y-0 left-[12%] -z-10 w-px bg-white/10" aria-hidden="true" />\n      <div className="absolute inset-y-0 right-[12%] -z-10 w-px bg-white/10" aria-hidden="true" />\n      <div className="absolute inset-x-0 top-24 -z-10 h-px bg-white/10" aria-hidden="true" />`;
    case 'spotlight':
      return `      <div className="absolute left-1/2 top-[-8rem] -z-10 h-[42rem] w-[46rem] -translate-x-1/2" style={{ background: 'radial-gradient(ellipse at center, color-mix(in srgb, var(--kx-accent) 34%, transparent), transparent 70%)' }} aria-hidden="true" />`;
    case 'terrain-lines':
      return `      <svg viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 -z-10 h-full w-full" style={{ opacity: 0.4 }} aria-hidden="true">{Array.from({ length: 9 }).map((_, i) => <path key={i} d={\`M0 \${40 + i * 40} C 300 \${i * 40}, 900 \${100 + i * 40}, 1200 \${40 + i * 40}\`} fill="none" stroke={i % 3 === 0 ? 'var(--kx-accent)' : 'rgba(255,255,255,0.14)'} strokeWidth="1" />)}</svg>`;
    case 'diagonal-split':
      return `      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true"><div className="absolute -inset-x-1/4 top-1/3 h-[60%] -rotate-6" style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--kx-accent) 20%, transparent), transparent)' }} /></div>\n${grid(0.03, 40)}`;
    case 'gradient-veil':
      return `      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--kx-accent) 14%, transparent), transparent 55%)' }} aria-hidden="true" />\n${orb("top: '2rem'", "right: '-6rem', width: '22rem', height: '22rem'", 'var(--kx-accent-2)', '-6s')}`;
    case 'flat-void':
      return `      <div className="absolute inset-0 -z-10" style={{ background: 'radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,0.5) 100%)' }} aria-hidden="true" />\n${orb("bottom: '-10rem'", "left: '20%', width: '24rem', height: '20rem'", 'var(--kx-accent)')}`;
    case 'mesh-duotone':
      return `${orb("top: '-8rem'", "left: '-6rem', width: '34rem', height: '34rem'", 'var(--kx-accent)')}\n${orb("bottom: '-10rem'", "right: '-6rem', width: '30rem', height: '30rem'", 'var(--kx-accent-2)', '-8s')}`;
    case 'aurora-grid':
    default:
      return `      <div className="kx-grid absolute inset-0 -z-10" aria-hidden="true" />\n${orb("top: '-6rem'", "left: '-4rem', width: '28rem', height: '28rem'", 'var(--kx-accent)')}\n${orb("top: '3rem'", "right: '-6rem', width: '24rem', height: '24rem'", 'var(--kx-accent-2)', '-6s')}`;
  }
}

/** Generated hero proof rail — concept-specific proof chips under the CTA, using
 *  the `.kx-art-proof` utility. Mirrors the preview's HeroProof. Empty when there
 *  is no proof (old builds stay clean). Chips are concise structural labels. */
function generatedHeroProof(art: WebBuildArtIdentity): string {
  const chips = art.proofRules.slice(0, 4);
  if (!chips.length) return '';
  const cells = chips.map((c) => `            <li className="kx-art-proof inline-flex items-center gap-1.5 border border-[color:var(--kx-border)] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300"><span className="h-1 w-1 rounded-full bg-[var(--kx-accent)]" />{\`${esc(c)}\`}</li>`).join('\n');
  return `          <ul className="mt-7 flex flex-wrap items-center gap-2">
${cells}
          </ul>`;
}

function heroCopyBits(c: SectionCopy, brief: { goal?: string; type?: string }) {
  return {
    headline: c.headline || 'Your headline here',
    sub: c.sub || brief.goal || '',
    cta: c.cta || 'Get started',
    eyebrow: brief.type || c.bullets?.[0] || '',
    secondary: c.bullets?.[1] || '',
    proof: c.bullets?.[2] || '',
  };
}

const ctaBlock = (cta: string, secondary: string) => `          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a href="#contact" className="rounded-xl bg-[var(--kx-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40">{\`${esc(cta)}\`}</a>
            ${secondary ? `<a href="#features" className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{\`${esc(secondary)}\`}</a>` : ''}
          </div>`;

/**
 * Hero component code that DIFFERS by heroComposition. Split/data/membership are
 * two-column; dashboard/catalog/event stack a wide module; immersive is
 * full-bleed; story is a 12-col editorial; centered/luxury are centered. Every
 * variant embeds the strategy's <VisualModule /> and the premium background.
 */
function heroComponentFor(
  name: string, c: SectionCopy, brief: { goal?: string; type?: string }, plan: WebBuildLayoutPlan,
  art: WebBuildArtIdentity,
): string {
  const b = heroCopyBits(c, brief);
  const mod = plan.primaryVisualModule;
  const eyebrow = b.eyebrow ? `<span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--kx-border)] bg-white/[0.04] px-3 py-1 text-xs font-medium text-[var(--kx-accent)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--kx-accent)]" /> {\`${esc(b.eyebrow)}\`}</span>` : '';
  const sub = (cls: string) => (b.sub ? `<p className="${cls}">{\`${esc(b.sub)}\`}</p>` : '');
  const composition = plan.heroComposition;
  // Strategy-specific background (not the fixed aurora shell) + concept proof rail.
  const bg = generatedHeroBg(plan);
  const proof = generatedHeroProof(art);

  const twoCol = (): string => `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="relative isolate overflow-hidden">
${bg}
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-2">
        <div className="kx-reveal">
          ${eyebrow}
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{\`${esc(b.headline)}\`}</h1>
          ${sub('mt-5 max-w-xl text-lg leading-relaxed text-slate-300')}
${ctaBlock(b.cta, b.secondary)}
${proof}
          ${b.proof ? `<p className="mt-6 text-xs text-slate-400">{\`${esc(b.proof)}\`}</p>` : ''}
        </div>
        <VisualModule kind="${mod}" />
      </div>
    </section>
  );
}
`;

  const stacked = (): string => `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="relative isolate overflow-hidden">
${bg}
      <div className="mx-auto max-w-5xl px-6 py-20 text-center sm:py-24">
        <div className="kx-reveal">
          ${eyebrow}
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">{\`${esc(b.headline)}\`}</h1>
          ${sub('mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-300')}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#contact" className="rounded-xl bg-[var(--kx-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40">{\`${esc(b.cta)}\`}</a>
            ${b.secondary ? `<a href="#features" className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{\`${esc(b.secondary)}\`}</a>` : ''}
          </div>
${proof}
        </div>
        <div className="mt-14"><VisualModule kind="${mod}" /></div>
      </div>
    </section>
  );
}
`;

  const immersive = (): string => `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="relative isolate flex min-h-[34rem] items-end overflow-hidden">
${bg}
      <div className="pointer-events-none absolute inset-0 scale-110 opacity-40" aria-hidden="true"><VisualModule kind="${mod}" /></div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-16">
        <div className="kx-reveal max-w-2xl">
          ${eyebrow}
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-6xl">{\`${esc(b.headline)}\`}</h1>
          ${sub('mt-5 max-w-xl text-lg leading-relaxed text-slate-200')}
${ctaBlock(b.cta, b.secondary)}
${proof}
        </div>
      </div>
    </section>
  );
}
`;

  const centered = (): string => `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="relative isolate overflow-hidden">
${bg}
      <div className="mx-auto max-w-3xl px-6 py-28 text-center sm:py-32">
        <div className="kx-reveal">
          ${eyebrow}
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">{\`${esc(b.headline)}\`}</h1>
          ${sub('mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300')}
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#contact" className="rounded-xl bg-[var(--kx-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40">{\`${esc(b.cta)}\`}</a>
            ${b.secondary ? `<a href="#features" className="rounded-xl border border-white/15 px-6 py-3 text-sm font-medium text-slate-200">{\`${esc(b.secondary)}\`}</a>` : ''}
          </div>
${proof}
        </div>
        <div className="mx-auto mt-12 max-w-md"><VisualModule kind="${mod}" /></div>
      </div>
    </section>
  );
}
`;

  const story = (): string => `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="relative isolate overflow-hidden">
${bg}
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 sm:py-24 lg:grid-cols-12">
        <div className="kx-reveal lg:col-span-7">
          ${eyebrow}
          <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">{\`${esc(b.headline)}\`}</h1>
${ctaBlock(b.cta, b.secondary)}
${proof}
        </div>
        <div className="lg:col-span-5">
          ${b.sub ? `<p className="border-l-2 border-[var(--kx-accent)] pl-5 text-lg leading-relaxed text-slate-300">{\`${esc(b.sub)}\`}</p>` : ''}
          <div className="mt-6"><VisualModule kind="${mod}" /></div>
        </div>
      </div>
    </section>
  );
}
`;

  switch (composition) {
    case 'split-editorial':
    case 'membership-application':
    case 'data-map':
    case 'asymmetric-visual':
      return twoCol();
    case 'dashboard-product':
    case 'catalog-collection':
    case 'event-experience':
      return stacked();
    case 'immersive-full-bleed':
      return immersive();
    case 'story-editorial':
      return story();
    case 'luxury-service':
    case 'centered':
    default:
      return centered();
  }
}

function editorialSplitComponent(name: string, c: SectionCopy, plan: WebBuildLayoutPlan): string {
  const items = (c.bullets.length ? c.bullets : [c.sub || c.name]).filter(Boolean).slice(0, 4);
  const list = items.map((b, i) => `          <li key={${i}} className="flex gap-3 text-[15px] text-slate-200"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kx-accent)]" />{\`${esc(b)}\`}</li>`).join('\n');
  return `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 max-w-lg leading-relaxed text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
          <ul className="mt-6 space-y-3">
${list}
          </ul>
        </div>
        <VisualModule kind="${plan.primaryVisualModule}" />
      </div>
    </section>
  );
}
`;
}

function proofStripComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.name]).slice(0, 4);
  const stats = ['4.9★', '12k+', '98%', '24/7'];
  const cells = items.map((b, i) => `          <div key={${i}} className="bg-[#0b0d12] p-6 text-center">
            <div className="text-3xl font-semibold tracking-tight text-white">${stats[i % stats.length]}</div>
            <p className="mt-2 text-sm text-slate-400">{\`${esc(b)}\`}</p>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-center text-2xl font-semibold tracking-tight text-white sm:text-3xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-white/5 lg:grid-cols-4">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function dashboardDataComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.name]).slice(0, 4);
  const cells = items.map((b, i) => `            <li key={${i}} className="rounded-xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] px-4 py-3 text-[13px] text-slate-200">{\`${esc(b)}\`}</li>`).join('\n');
  return `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 max-w-md leading-relaxed text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
          <ul className="mt-6 grid grid-cols-2 gap-3">
${cells}
          </ul>
        </div>
        <VisualModule kind="data-dashboard" />
      </div>
    </section>
  );
}
`;
}

function collectionArchiveComponent(name: string, c: SectionCopy): string {
  const rows = (c.bullets.length ? c.bullets : [c.name]).slice(0, 6);
  const cells = rows.map((b, i) => `          <div key={${i}} className="group flex items-center gap-5 py-5">
            <span className="w-8 text-sm tabular-nums text-slate-500">${String(i + 1).padStart(2, '0')}</span>
            <span className="kx-art-card h-12 w-16 shrink-0 rounded-md border border-[color:var(--kx-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_22%,transparent),transparent)]" />
            <span className="flex-1 text-[15px] font-medium text-white">{\`${esc(b)}\`}</span>
            <span className="text-slate-500 transition group-hover:translate-x-1">&rarr;</span>
          </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="mt-8 divide-y divide-white/10 border-y border-[color:var(--kx-border)]">
${cells}
        </div>
      </div>
    </section>
  );
}
`;
}

function quoteStoryComponent(name: string, c: SectionCopy): string {
  const quotes = (c.bullets.length ? c.bullets : [c.sub || c.name]).slice(0, 2);
  const cells = quotes.map((b, i) => `          <blockquote key={${i}} className="border-l-2 border-[var(--kx-accent)] pl-6">
            <p className="text-xl font-medium leading-relaxed text-white sm:text-2xl">&ldquo;{\`${esc(b)}\`}&rdquo;</p>
            <footer className="mt-4 flex items-center gap-3 text-sm text-slate-400"><span className="h-8 w-8 rounded-full bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kx-accent)_55%,transparent),color-mix(in_srgb,var(--kx-accent-2)_30%,transparent))]" />{\`${esc(c.headline || c.name)}\`}</footer>
          </blockquote>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl space-y-10">
${cells}
      </div>
    </section>
  );
}
`;
}

function showcaseComponent(name: string, c: SectionCopy, plan: WebBuildLayoutPlan): string {
  const mod = plan.primaryVisualModule === 'contour-terrain' ? 'product-showcase' : plan.primaryVisualModule;
  return `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <VisualModule kind="${mod}" />
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 max-w-lg leading-relaxed text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
          ${c.cta ? `<a href="#contact" className="mt-7 inline-block rounded-xl bg-[var(--kx-accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-black/40">{\`${esc(c.cta)}\`}</a>` : ''}
        </div>
      </div>
    </section>
  );
}
`;
}

function applicationFormComponent(name: string, c: SectionCopy, plan: WebBuildLayoutPlan): string {
  const mod = plan.primaryVisualModule === 'membership-pass' ? 'membership-pass' : 'reservation-form';
  const bits = (c.bullets || []).slice(0, 3).map((b, i) => `          <p key={${i}} className="mt-3 flex gap-2 text-sm text-slate-300"><span className="text-[var(--kx-accent)]">&#10003;</span>{\`${esc(b)}\`}</p>`).join('\n');
  return `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section id="contact" className="px-6 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          ${c.sub ? `<p className="mt-4 max-w-md leading-relaxed text-slate-300">{\`${esc(c.sub)}\`}</p>` : ''}
${bits}
        </div>
        <VisualModule kind="${mod}" />
      </div>
    </section>
  );
}
`;
}

function spatialComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.name]).slice(0, 4);
  const list = items.map((b, i) => `          <li key={${i}} className="flex gap-3 text-[15px] text-slate-200"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--kx-accent)]" />{\`${esc(b)}\`}</li>`).join('\n');
  return `import VisualModule from './VisualModule';

export default function ${name}() {
  return (
    <section className="px-6 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <VisualModule kind="spatial-floorplan" />
        <div>
          ${c.headline ? `<h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{\`${esc(c.headline)}\`}</h2>` : ''}
          <ul className="mt-6 space-y-3">
${list}
          </ul>
        </div>
      </div>
    </section>
  );
}
`;
}

/**
 * A real, self-contained <VisualModule /> component for the generated project —
 * renders the strategy's structural visual (dashboard, pass, catalog, floorplan,
 * showcase, editorial, reservation, timeline, comparison, terrain) with CSS/SVG
 * only. Imported by the hero + key sections so visuals are structural, not
 * decorative. Defaults to the plan's primary module.
 */
function visualModuleFileContent(primary: VisualModule): string {
  return `/**
 * Structural visual modules — real metaphors (not blank panels), CSS/SVG only.
 * The layout plan selects one as the primary module; hero + key sections embed it.
 */
type ModuleKind =
  | 'data-dashboard' | 'membership-pass' | 'catalog-archive' | 'spatial-floorplan'
  | 'product-showcase' | 'editorial-story' | 'reservation-form' | 'timeline-process'
  | 'comparison' | 'contour-terrain';

const frame = 'relative overflow-hidden rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] bg-[var(--kx-card)]';

function DataDashboard() {
  const bars = [58, 82, 46, 94, 70, 88];
  return (
    <div className={frame + ' p-4 shadow-2xl shadow-black/40'}>
      <div className="mb-3 grid grid-cols-3 gap-3">
        {['2.4k', '98%', '+37%'].map((s, i) => (
          <div key={i} className="rounded-xl border border-[color:var(--kx-border)] bg-[var(--kx-card)] p-3">
            <div className="text-lg font-semibold text-white">{s}</div>
            <div className="mt-0.5 h-2 w-12 rounded-full bg-white/10" />
          </div>
        ))}
      </div>
      <div className="flex h-24 items-end gap-2 rounded-xl border border-[color:var(--kx-border)] bg-black/20 p-3">
        {bars.map((h, i) => (
          <span key={i} className="flex-1 rounded-t" style={{ height: h + '%', background: i % 2 ? 'var(--kx-accent-2)' : 'var(--kx-accent)', opacity: 0.9 }} />
        ))}
      </div>
    </div>
  );
}

function MembershipPass() {
  return (
    <div className={frame + ' p-5'}>
      <div className="rounded-[var(--kx-radius)] border border-[color:var(--kx-border)] p-5" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--kx-accent) 24%, transparent), color-mix(in srgb, var(--kx-accent-2) 12%, transparent))' }}>
        <div className="text-[11px] uppercase tracking-widest text-white/70">Member</div>
        <div className="mt-1 text-lg font-semibold text-white">Access Pass</div>
        <div className="mt-8 flex items-end gap-[3px]">
          {[3, 6, 2, 7, 4, 6, 2, 5, 3, 7].map((h, i) => <span key={i} className="w-[3px] bg-white/80" style={{ height: h * 3 + 'px' }} />)}
        </div>
      </div>
    </div>
  );
}

function CatalogArchive() {
  return (
    <div className={frame + ' p-4'}>
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-lg border border-[color:var(--kx-border)]" style={{ background: i % 3 === 0 ? 'linear-gradient(135deg, color-mix(in srgb, var(--kx-accent) 26%, transparent), transparent)' : 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))' }} />
        ))}
      </div>
    </div>
  );
}

function SpatialFloorplan() {
  return (
    <div className={frame + ' p-4'}>
      <svg viewBox="0 0 320 220" className="h-full w-full" style={{ minHeight: 200 }} aria-hidden="true">
        <rect x="8" y="8" width="304" height="204" rx="8" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="150" y1="8" x2="150" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <line x1="8" y1="130" x2="312" y2="130" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
        <rect x="26" y="150" width="60" height="40" rx="4" fill="color-mix(in srgb, var(--kx-accent) 22%, transparent)" stroke="var(--kx-accent)" />
        <circle cx="220" cy="66" r="26" fill="none" stroke="var(--kx-accent-2)" strokeWidth="2" />
      </svg>
    </div>
  );
}

function ProductShowcase() {
  return (
    <div className={frame + ' flex items-center justify-center p-8'}>
      <div className="kx-float h-40 w-40 rounded-3xl border border-white/15 shadow-2xl shadow-black/50" style={{ background: 'linear-gradient(150deg, color-mix(in srgb, var(--kx-accent) 40%, #0b0d12), color-mix(in srgb, var(--kx-accent-2) 24%, #0b0d12))' }} />
    </div>
  );
}

function EditorialStory() {
  return (
    <div className={frame + ' p-3'}>
      <div className="aspect-[4/5] w-full rounded-xl" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--kx-accent) 22%, transparent), color-mix(in srgb, var(--kx-accent-2) 12%, transparent))' }} />
    </div>
  );
}

function ReservationForm() {
  return (
    <div className={frame + ' p-5'}>
      <div className="grid grid-cols-4 gap-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className="flex h-7 items-center justify-center rounded text-[11px] text-slate-300" style={{ background: i === 3 ? 'var(--kx-accent)' : 'rgba(255,255,255,0.04)', color: i === 3 ? '#fff' : undefined }}>{i + 12}</span>
        ))}
      </div>
      <div className="mt-4 flex h-10 items-center justify-center rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--kx-accent)' }}>Book</div>
    </div>
  );
}

function TimelineProcess() {
  return (
    <div className={frame + ' p-5'}>
      <ol className="relative space-y-4 pl-6">
        {['Discover', 'Design', 'Build', 'Deliver'].map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-black" style={{ background: 'var(--kx-accent)' }}>{i + 1}</span>
            <p className="text-[13px] font-medium text-white">{s}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Comparison() {
  return (
    <div className={frame + ' grid grid-cols-2'}>
      <div className="aspect-[3/4] border-r border-[color:var(--kx-border)]" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))' }} />
      <div className="aspect-[3/4]" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--kx-accent) 26%, transparent), color-mix(in srgb, var(--kx-accent-2) 14%, transparent))' }} />
    </div>
  );
}

function ContourTerrain() {
  return (
    <div className={frame}>
      <div className="aspect-[4/3] w-full" style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--kx-accent) 20%, transparent), color-mix(in srgb, var(--kx-accent-2) 10%, transparent))' }}>
        <svg viewBox="0 0 400 300" preserveAspectRatio="none" className="h-full w-full" style={{ opacity: 0.55 }} aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <path key={i} d={\`M0 \${34 + i * 32} C 110 \${6 + i * 32}, 290 \${86 + i * 32}, 400 \${40 + i * 32}\`} fill="none" stroke={i % 3 === 0 ? 'var(--kx-accent)' : 'rgba(255,255,255,0.14)'} strokeWidth="1" />
          ))}
        </svg>
      </div>
    </div>
  );
}

const MODULES: Record<ModuleKind, () => JSX.Element> = {
  'data-dashboard': DataDashboard,
  'membership-pass': MembershipPass,
  'catalog-archive': CatalogArchive,
  'spatial-floorplan': SpatialFloorplan,
  'product-showcase': ProductShowcase,
  'editorial-story': EditorialStory,
  'reservation-form': ReservationForm,
  'timeline-process': TimelineProcess,
  comparison: Comparison,
  'contour-terrain': ContourTerrain,
};

export default function VisualModule({ kind = '${primary}' }: { kind?: ModuleKind }) {
  const Render = MODULES[kind] || MODULES['${primary}'];
  return <Render />;
}
`;
}

/**
 * Choose the component template for a section from the LAYOUT PLAN, not just its
 * kind — so the generated code matches the preview's composition. The hero code
 * differs by heroComposition; content sections differ by their assigned variant.
 * The same "Page Sections" content therefore yields different component code for
 * a different strategy (Part 5).
 */
function componentFor(
  name: string, c: SectionCopy, brief: { goal?: string; type?: string }, plan: WebBuildLayoutPlan,
  art: WebBuildArtIdentity,
): string {
  const kind = sectionKind(c.id, c.name);
  if (kind === 'hero') return heroComponentFor(name, c, brief, plan, art);
  if (kind === 'footer') return footerComponent(name, c);
  const variant = plan.sectionVariants[c.id] || 'feature-grid';
  return variantComponentFor(name, c, plan, variant, kind);
}

/** Content-section template by composition variant. Falls back to the closest
 *  kind-specific template so nothing renders as a blank block. */
function variantComponentFor(
  name: string, c: SectionCopy, plan: WebBuildLayoutPlan, variant: SectionVariant, kind: SectionKind,
): string {
  switch (variant) {
    case 'editorial-split':    return editorialSplitComponent(name, c, plan);
    case 'proof-strip':        return proofStripComponent(name, c);
    case 'dashboard-data':     return kind === 'productDemo' ? productDemoComponent(name, c) : dashboardDataComponent(name, c);
    case 'catalog-grid':       return kind === 'menu' ? menuComponent(name, c) : galleryComponent(name, c);
    case 'collection-archive': return collectionArchiveComponent(name, c);
    case 'process-timeline':   return workflowComponent(name, c);
    case 'quote-story':        return quoteStoryComponent(name, c);
    case 'showcase':           return showcaseComponent(name, c, plan);
    case 'application-form':   return applicationFormComponent(name, c, plan);
    case 'spatial-floorplan':  return spatialComponent(name, c);
    case 'pricing-membership': return pricingComponent(name, c);
    case 'comparison':         return beforeAfterComponent(name, c);
    case 'faq-cta':            return kind === 'faq' ? faqComponent(name, c) : ctaComponent(name, c);
    case 'feature-grid':
    default:
      // Preserve a couple of kind-specific rich templates when the plan lands on
      // a plain grid but the content is clearly integrations/metrics/inventory.
      if (kind === 'integrations') return integrationsComponent(name, c);
      if (kind === 'metrics') return metricsComponent(name, c);
      if (kind === 'inventory') return inventoryComponent(name, c);
      if (kind === 'financing') return financingComponent(name, c);
      if (kind === 'testimonial') return testimonialComponent(name, c);
      // A section with no card bullets reads better as a heading + prose block
      // than as empty cards.
      if (!c.bullets.length) return genericComponent(name, c);
      return cardsComponent(name, c);
  }
}

/** Short human file summary from the section purpose/name. */
function fileSummary(c: SectionCopy): string {
  return (c.purpose || c.sub || c.name).replace(/\s+/g, ' ').slice(0, 90);
}

/** Synthesize the full file set from the parsed sections + copy. An optional
 *  `briefOverride` (the Art-Director-enriched brief) drives the palette/visual
 *  system so the generated files match the preview. */
export function synthesizeFiles(result: WebBuildResult, briefOverride?: WebBuildBrief): SynthFile[] {
  const brief = briefOverride || extractBrief(result.sections);
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
  items: SectionCopy[], brief: WebBuildBrief, planArg?: WebBuildLayoutPlan,
): SynthFile[] {
  if (items.length === 0) return [];

  const ds = deriveDesignSystemFromStrategy(brief);
  // The SAME layout plan the preview derives — hero composition + per-section
  // variant + primary visual module drive the generated component code, so the
  // All Files output matches the preview exactly (Part 7). App composes the plan
  // sequence; each component's shape follows its assigned variant.
  const plan = planArg || deriveLayoutPlan(brief, items.map((c) => ({ id: c.id, name: c.name })));
  // The SAME art render identity the preview uses — so the generated hero
  // background, proof rail and card surface language match the preview exactly.
  const art = deriveWebBuildArtIdentity(brief);
  const compNames = items.map((c) => pascal(c.id));
  const files: SynthFile[] = [];

  // One component file per real section — the tree GROWS with the site.
  items.forEach((c, i) => {
    const name = compNames[i];
    files.push({
      path: `src/components/${name}.tsx`,
      language: 'tsx',
      content: componentFor(name, c, brief, plan, art),
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
  files.push({ path: 'src/components/VisualModule.tsx', language: 'tsx', content: visualModuleFileContent(plan.primaryVisualModule), summary: `Structural visual module (${plan.primaryVisualModule})` });
  files.push({ path: 'src/lib/designSystem.ts', language: 'ts', content: designSystemFileContent(ds), summary: 'Strategy-derived design tokens (palette, type, radius, motion)' });
  files.push({ path: 'src/lib/layoutPlan.ts', language: 'ts', content: layoutPlanFileContent(plan), summary: `Layout plan (${plan.heroComposition} hero · ${plan.archetype})` });
  files.push(siteContentFile(items));
  files.push(stylesFile(ds, plan, art));

  return files;
}

/** Mode-specific CSS for the shared `.kx-art-*` utilities — the surface/media/
 *  proof language for the concept, emitted so the generated components (which use
 *  these classes) render the same identity as the preview. Additive over the
 *  visual-system radius; dark-safe; no light mode. */
function artUtilitiesCss(mode: ArtRenderMode): string {
  const card: Partial<Record<ArtRenderMode, string>> = {
    archive: 'border-radius: 0.25rem; border-left: 2px solid var(--kx-accent);',
    landscaping: 'border-radius: 1rem; overflow: hidden;',
    'trust-service': 'border-radius: 0.6rem; box-shadow: none;',
    hospitality: 'border-radius: 1rem;',
    marketplace: 'border-radius: 0.5rem;',
    industrial: 'border-radius: 0;',
    portfolio: 'border-radius: 0;',
  };
  const media: Partial<Record<ArtRenderMode, string>> = {
    archive: 'aspect-ratio: 3 / 4;',
    landscaping: 'aspect-ratio: 3 / 2;',
    marketplace: 'aspect-ratio: 1 / 1;',
    portfolio: 'aspect-ratio: 4 / 5;',
    'product-saas': 'aspect-ratio: 16 / 9;',
  };
  const proof: Partial<Record<ArtRenderMode, string>> = {
    archive: 'border-radius: 0.125rem;',
    industrial: 'border-radius: 0;',
    portfolio: 'border-radius: 0;',
    'trust-service': 'border-radius: 0.375rem;',
  };
  return `/* ── Art identity utilities (mode: ${mode}) — concept-specific surfaces. ── */
.kx-art-card { ${card[mode] || ''} }
.kx-art-media { aspect-ratio: 4 / 3; width: 100%; ${media[mode] || ''} }
.kx-art-proof { border-radius: 9999px; ${proof[mode] || ''} }
`;
}

/** The theme + motion stylesheet — CSS custom properties come from the derived
 *  design system AND the visual system (surface/border/shape), so a different
 *  strategy yields a different palette AND surface language in code too. The
 *  `.kx-panel` utility lets generated components share the strategy's surface. */
function stylesFile(ds: WebBuildDesignSystem, plan: WebBuildLayoutPlan, art: WebBuildArtIdentity): SynthFile {
  const vt = visualSystemTokens(plan.visualSystem);
  return {
    path: 'src/styles.css',
    language: 'css',
    summary: `Design + visual system (${plan.visualSystem.background} · ${plan.visualSystem.surface} surface · ${art.mode} identity)`,
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  --kx-bg: ${ds.bg};
  --kx-accent: ${ds.accent};
  --kx-accent-2: ${plan.visualSystem.accentMode === 'mono' ? ds.accent : ds.accent2};
  /* Surface language from the strategy's visual system (panel shape + treatment). */
  --kx-radius: ${vt.radius};
  --kx-fg: #f1f5f9;
  --kx-muted: #94a3b8;
  --kx-border: ${vt.border};
  --kx-card: ${vt.surfaceBg};
  --kx-card-hover: ${vt.surfaceHover};
  --kx-glow: color-mix(in srgb, var(--kx-accent) 45%, transparent);
}

/* Shared strategy surface — components use this so the whole site is coherent. */
.kx-panel {
  background: var(--kx-card);
  border: 1px solid var(--kx-border);
  border-radius: var(--kx-radius);
}
.kx-panel:hover { background: var(--kx-card-hover); }

${artUtilitiesCss(art.mode)}
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
 * The authoritative file set for a build. The BLUEPRINT-driven synthesizer is
 * authoritative so the All Files panel always matches what the preview renders
 * (same Page Blueprint — hero composition, section variants, visual module,
 * sequence, visual system): preview and files cannot disagree (Part 7). Backend
 * `Frontend Code` is only used as a fallback if synthesis yields nothing (e.g.
 * no parsable sections) — otherwise a uniform backend template would reintroduce
 * the very sameness this system removes.
 */
export function resolveBuildFiles(result: WebBuildResult, briefOverride?: WebBuildBrief): SynthFile[] {
  const synth = synthesizeFiles(result, briefOverride);
  if (synth.length > 0) return synth;
  const backend = extractFileEntries(result.sections).filter((f) => f.content && f.content.trim().length > 20);
  return backend.map((f) => ({ ...f, summary: undefined }));
}
