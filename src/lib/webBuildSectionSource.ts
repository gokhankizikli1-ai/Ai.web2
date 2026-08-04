/**
 * Web Build — shared SECTION-SOURCE correlation & extraction (authoritative, reusable).
 *
 * ONE source of truth for correlating each planned section id to its OWN rendered source region in
 * the generated project. Originally introduced with the page-composition acceptance (PR #561) and
 * extracted here so multiple deterministic analyzers (composition, premium visual system, …) share a
 * single robust extractor instead of copying fragile JSX-parsing logic.
 *
 * Correlation supports: many tagged section roots in ONE App.tsx/page file; one tagged section per
 * component; filename-correlated plain components; and the deterministic <section id> fallback. A
 * region is sliced from its own top-level section marker to the START of the NEXT top-level section
 * marker (or EOF) — never to a brace/quote/JSX boundary — so nested arrow functions, nested JSX,
 * nested braces, strings and template literals are NOT truncated. Deduplication is by
 * (file path + section id + matched source range), never by file path alone, so distinct sections
 * from one file are all collected. Ambiguous/missing extraction fails open for THAT section only.
 * Pure, network-free, deterministic. Bounded.
 */
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_SECTIONS = 24;
const MAX_FILE_CHARS = 80_000;
const MIN_UNIT_CHARS = 24;              // a correlated region must carry real markup to be judged
const MAX_MARKERS = MAX_SECTIONS * 3;   // per-file scan guard
const MAX_BACKSCAN = 2000;              // how far back to walk for a tagged element's opening '<'

export interface SectionSourceUnit { id: string; content: string; path: string; }

/* ── Small pure helpers (shared, so id-normalization is identical across analyzers) ── */
export function normId(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
export function anchorId(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section'; }
function baseName(p: string): string { const b = (p || '').split(/[\\/]/).pop() || ''; return b.replace(/\.[jt]sx?$/i, ''); }
/** Walk back from an attribute match to the '<' that opens its JSX element (bounded). */
function backToTag(s: string, i: number): number {
  for (let j = i; j >= 0 && i - j < MAX_BACKSCAN; j -= 1) { if (s.charCodeAt(j) === 60 /* '<' */) return j; }
  return i;
}

interface RawRegion { kind: 'korvix' | 'sectionId'; token: string; path: string; start: number; content: string; }

/** Extract per-SECTION source regions from ONE file. A monolithic page (many tagged section roots
 *  in one App.tsx) yields several regions; a single-section component yields one. Only markers that
 *  correlate to a real requested section act as boundaries, so an unrelated nested <section id> can
 *  never fragment a region. */
function fileRegions(file: FrontendGeneratedFile, sectionIdSet: Set<string>, anchorSet: Set<string>): RawRegion[] {
  const c = (file && file.content) || '';
  if (!c) return [];
  const bounds: Array<{ kind: 'korvix' | 'sectionId'; token: string; start: number }> = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  const kre = /data-korvix-section=["']([^"']+)["']/gi;
  while ((m = kre.exec(c)) && guard < MAX_MARKERS) {
    guard += 1;
    const norm = normId(m[1] || '');
    if (norm && sectionIdSet.has(norm)) bounds.push({ kind: 'korvix', token: norm, start: backToTag(c, m.index) });
  }
  const sre = /<section\b[^>]*\bid=["']([^"']+)["']/gi;
  guard = 0;
  while ((m = sre.exec(c)) && guard < MAX_MARKERS) {
    guard += 1;
    const anch = (m[1] || '').toLowerCase();
    if (anch && anchorSet.has(anch)) bounds.push({ kind: 'sectionId', token: anch, start: m.index });
  }
  if (!bounds.length) return [];
  bounds.sort((a, b) => a.start - b.start);
  // A <section id data-korvix-section> matches BOTH scans at the same tag start — keep the korvix one.
  const dedup: typeof bounds = [];
  for (const b of bounds) {
    const prev = dedup[dedup.length - 1];
    if (prev && b.start === prev.start) { if (prev.kind !== 'korvix' && b.kind === 'korvix') dedup[dedup.length - 1] = b; continue; }
    dedup.push(b);
  }
  return dedup.map((b, i) => {
    const rawEnd = i + 1 < dedup.length ? dedup[i + 1].start : c.length;
    const end = Math.min(rawEnd, b.start + MAX_FILE_CHARS);
    return { kind: b.kind, token: b.token, path: file.path, start: b.start, content: c.slice(b.start, end) };
  });
}

/** Correlate each requested section id to its OWN rendered source region. Returns bounded units in
 *  the given section-id order. Deduplicates by (file path + section id + matched source range) —
 *  never by file path alone. Ambiguous/missing extraction fails open for THAT section only. */
export function collectSectionUnits(files: FrontendGeneratedFile[] | undefined, sectionIds: string[]): SectionSourceUnit[] {
  const list = Array.isArray(files) ? files : [];
  const ids = (sectionIds || []).filter((s) => !!s).slice(0, MAX_SECTIONS);
  if (!list.length || !ids.length) return [];
  const sectionIdSet = new Set(ids.map((s) => normId(s)));
  const anchorSet = new Set(ids.map((s) => anchorId(s)));
  const korvixMap = new Map<string, RawRegion>();
  const sectionIdMap = new Map<string, RawRegion>();
  const filesWithBounds = new Set<string>();
  for (const f of list) {
    const regions = fileRegions(f, sectionIdSet, anchorSet);
    if (regions.length) filesWithBounds.add(f.path);
    for (const r of regions) {
      if (r.kind === 'korvix') { if (!korvixMap.has(r.token)) korvixMap.set(r.token, r); }
      else if (!sectionIdMap.has(r.token)) sectionIdMap.set(r.token, r);
    }
  }
  const valid = (s: string): boolean => { const t = (s || '').trim(); return t.length >= MIN_UNIT_CHARS && t.includes('<'); };
  const units: SectionSourceUnit[] = [];
  const claimedRegions = new Set<string>();     // `${path}@${start}` — a region is one section only
  const claimedFilenamePaths = new Set<string>();
  for (const id of ids) {
    // 1. data-korvix-section region · 2. deterministic <section id> region · 3. filename component.
    let region = korvixMap.get(normId(id));
    if (!region || !valid(region.content)) region = sectionIdMap.get(anchorId(id));
    if (region && valid(region.content)) {
      const key = `${region.path}@${region.start}`;
      if (!claimedRegions.has(key)) {
        claimedRegions.add(key);
        units.push({ id, content: region.content.slice(0, MAX_FILE_CHARS), path: region.path });
      }
      continue;   // correlated (or its region already claimed) — do not also grab a whole file
    }
    const nid = normId(id);
    // Filename-correlated PLAIN component only — never a multi-section page (it has its own markers).
    const file = list.find((f) => !claimedFilenamePaths.has(f.path) && !filesWithBounds.has(f.path)
      && normId(baseName(f.path)) === nid && valid(f.content || ''));
    if (file) {
      claimedFilenamePaths.add(file.path);
      units.push({ id, content: (file.content || '').slice(0, MAX_FILE_CHARS), path: file.path });
    }
    // else: fail open for THIS section — other correlated sections are still analyzed.
  }
  return units;
}
