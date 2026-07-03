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
import { extractBrief, type WebBuildResult } from '@/lib/webBuildApi';

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

function heroComponent(name: string, c: SectionCopy, brief: { goal?: string }): string {
  const headline = c.headline || 'Your headline here';
  const sub = c.sub || brief.goal || '';
  const cta = c.cta || 'Get started';
  return `export default function ${name}() {
  return (
    <section className="relative overflow-hidden px-6 py-24 sm:py-32 text-center">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          {\`${esc(headline)}\`}
        </h1>
        ${sub ? `<p className="mt-5 text-lg leading-relaxed text-slate-600">{\`${esc(sub)}\`}</p>` : ''}
        <div className="mt-8 flex items-center justify-center gap-3">
          <a href="#contact" className="rounded-xl bg-blue-600 px-6 py-3 text-white font-medium shadow-sm hover:bg-blue-700 transition-colors">
            {\`${esc(cta)}\`}
          </a>
        </div>
      </div>
    </section>
  );
}
`;
}

function cardsComponent(name: string, c: SectionCopy): string {
  const items = (c.bullets.length ? c.bullets : [c.sub || c.purpose || '']).filter(Boolean).slice(0, 6);
  const cards = items.map((b, i) => `        <div key={${i}} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-3 h-10 w-10 rounded-lg bg-blue-50" />
          <p className="text-[15px] font-medium text-slate-900">{\`${esc(b)}\`}</p>
        </div>`).join('\n');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20 bg-slate-50">
      <div className="mx-auto max-w-5xl">
        ${c.headline ? `<h2 className="text-3xl font-semibold text-slate-900 text-center mb-10">{\`${esc(c.headline)}\`}</h2>` : ''}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
    <section id="contact" className="px-6 py-20 text-center bg-blue-600">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-3xl font-semibold text-white">{\`${esc(headline)}\`}</h2>
        ${c.sub ? `<p className="mt-3 text-blue-100">{\`${esc(c.sub)}\`}</p>` : ''}
        <a href="#" className="mt-6 inline-block rounded-xl bg-white px-6 py-3 font-medium text-blue-700 hover:bg-blue-50 transition-colors">
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
    <footer className="px-6 py-12 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-sm text-slate-500">{\`${esc(c.headline || '© Your Company')}\`}</p>
        <nav className="flex gap-6 text-sm text-slate-500">
          <a href="#" className="hover:text-slate-900">Home</a>
          <a href="#contact" className="hover:text-slate-900">Contact</a>
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
    ? `        <ul className="mt-5 space-y-2 text-slate-600">\n${bullets.map((b, i) => `          <li key={${i}}>{\`${esc(b)}\`}</li>`).join('\n')}\n        </ul>`
    : (c.sub ? `        <p className="mt-4 text-slate-600">{\`${esc(c.sub)}\`}</p>` : '');
  return `export default function ${name}() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-3xl font-semibold text-slate-900">{\`${esc(headline)}\`}</h2>
${list}
      </div>
    </section>
  );
}
`;
}

function componentFor(name: string, c: SectionCopy, brief: { goal?: string }): string {
  const k = `${c.id} ${c.name}`.toLowerCase();
  if (/hero/.test(k)) return heroComponent(name, c, brief);
  if (/footer/.test(k)) return footerComponent(name, c);
  if (/cta|final|contact|book|appointment|randevu/.test(k)) return ctaComponent(name, c);
  if (/feature|service|benefit|pricing|plan|process|step|how|testimonial|social|proof|review|faq/.test(k)) return cardsComponent(name, c);
  return genericComponent(name, c);
}

/** Short human file summary from the section purpose/name. */
function fileSummary(c: SectionCopy): string {
  return (c.purpose || c.sub || c.name).replace(/\s+/g, ' ').slice(0, 90);
}

/** Synthesize the full file set from the parsed sections + copy. */
export function synthesizeFiles(result: WebBuildResult): SynthFile[] {
  const brief = extractBrief(result.sections);
  const items = parseSectionCopy(result);
  if (items.length === 0) return [];

  const compNames = items.map((c) => pascal(c.id));
  const files: SynthFile[] = [];

  items.forEach((c, i) => {
    const name = compNames[i];
    files.push({
      path: `components/${name}.tsx`,
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
    <main className="min-h-screen bg-white text-slate-900 antialiased">
${usage}
    </main>
  );
}
`;
  files.unshift({ path: 'App.tsx', language: 'tsx', content: app, summary: 'Page layout composing all sections' });

  files.push({
    path: 'index.css',
    language: 'css',
    content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  color-scheme: light;\n}\n\nhtml {\n  scroll-behavior: smooth;\n}\n`,
    summary: 'Tailwind base styles',
  });

  return files;
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
