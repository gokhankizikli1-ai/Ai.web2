/**
 * Canonical internal FIELD-LABEL boundary — the SINGLE source of truth (Phase 1).
 *
 * The AI/spec pipeline structures copy under known field labels (Headline, Subheadline, …). A
 * generator can accidentally echo that label INTO the value ("Headline: Foo") or render it as
 * visible UI copy. Before this module the same rule lived as three independent regex copies
 * (webBuildApi, webBuildFrontendValidation, webBuildContentNarrative) kept in sync by comment.
 * This leaf module replaces all of them, defining ONE vocabulary and ONE set of operations:
 *
 *   • FIELD_LABEL_PREFIXES        — the known internal field-label vocabulary,
 *   • stripLeadingFieldLabel()    — strip a leading label prefix from an authoritative VALUE
 *                                    (used by required-copy / fidelity so "Headline: Foo" → "Foo"),
 *   • leadingFieldLabelOf()       — the label word a value starts with (or null),
 *   • detectLeakedFieldLabels()   — deterministically detect a leaked label prefix at the START of a
 *                                    rendered VISIBLE text node (plain text, string-literal
 *                                    expression, or a statically-resolvable const-backed value).
 *
 * NARROW BY DESIGN: only the known field-label words, immediately followed by a colon, at the START
 * of a value / text-node are treated as a label. Legitimate prose that merely contains a colon
 * ("Pricing: simple", "Note: important", "Status: operational") is NEVER matched — those words are
 * not in the vocabulary. Pure, dependency-free, deterministic, fail-open.
 */

/** Known internal field-label words (lowercased). Extend here ONLY — never re-declare elsewhere. */
export const FIELD_LABEL_PREFIXES = [
  'headline', 'subheadline', 'subtitle', 'eyebrow', 'cta', 'body', 'description', 'label',
] as const;

const ALT = FIELD_LABEL_PREFIXES.join('|');

/** Leading internal field-label prefix on an authoritative VALUE (start-anchored, incl. the colon). */
const LEADING_FIELD_LABEL_RE = new RegExp(`^\\s*(?:${ALT})\\s*:\\s*`, 'i');
/** Same, capturing the label word (no trailing whitespace consumption). */
const LEADING_FIELD_LABEL_CAP_RE = new RegExp(`^\\s*(${ALT})\\s*:`, 'i');

/**
 * Strip ONE leading internal field-label prefix from an authoritative copy value.
 *   "Headline: Foo" → "Foo";  "CTA: Book a Demo" → "Book a Demo";  "Pricing: simple" → unchanged.
 * Only the leading prefix is removed — later colons in the real copy are preserved
 * ("Subheadline: Ship faster: now" → "Ship faster: now"). Never throws.
 */
export function stripLeadingFieldLabel(s: string): string {
  return (s || '').replace(LEADING_FIELD_LABEL_RE, '');
}

/** True when the value BEGINS with a known internal field-label prefix. */
export function hasLeadingFieldLabel(s: string): boolean {
  return LEADING_FIELD_LABEL_CAP_RE.test(s || '');
}

/** The known field-label word a value starts with (lowercased), or null. */
export function leadingFieldLabelOf(s: string): string | null {
  const m = LEADING_FIELD_LABEL_CAP_RE.exec(s || '');
  return m ? m[1].toLowerCase() : null;
}

/* ── Leak detection at a rendered VISIBLE text-node start ─────────────────────── */

// A text-node boundary is a `>` (end of a JSX tag). Immediately after it, a leaked label can appear as:
//   • plain text:               >Headline: Foo
//   • a string-literal child:   >{'Headline: Foo'}   >{"Headline: Foo"}   >{`Headline: Foo`}
// Both are matched here. Attribute values (inside `<…>`) are never `>`-preceded, so never matched.
const NODE_DIRECT_RE = new RegExp(`>\\s*\\{?\\s*['"\`]?\\s*(${ALT})\\s*:`, 'gi');
// A const/let/var bound to a single string literal — for the statically-resolvable const-backed case.
const STRING_CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
// A text-node whose sole child is an identifier expression:  >{heroTitle}
const NODE_IDENT_RE = />\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g;

/** Collect `const NAME = '…'` string-literal bindings from a region (first binding per name wins). */
function collectStringConsts(src: string): Map<string, string> {
  const map = new Map<string, string>();
  let m: RegExpExecArray | null; let guard = 0;
  STRING_CONST_RE.lastIndex = 0;
  while ((m = STRING_CONST_RE.exec(src)) && guard < 400) { guard += 1; if (!map.has(m[1])) map.set(m[1], m[3]); }
  return map;
}

/**
 * Distinct internal field-label prefixes leaked as the START of a rendered VISIBLE text node in
 * `region`. `region` should be COMMENT-STRIPPED JSX/TS source (the caller owns comment/script/style
 * removal). Detects three deterministic, high-confidence forms:
 *   1. plain text node                     `<h1>Headline: Foo</h1>`
 *   2. start-of-node string literal        `<h1>{'Headline: Foo'}</h1>`
 *   3. const-backed identifier child       `const t = 'Headline: Foo'; <h1>{t}</h1>`
 * An unresolved dynamic expression (`<h1>{fn()}</h1>`, `<h1>{a + b}</h1>`) is NEVER flagged — no fake
 * evaluator, no speculative blocker. Returns lowercased label words. Pure, bounded, fail-open.
 */
export function detectLeakedFieldLabels(region: string): string[] {
  try {
    const src = region || '';
    const found = new Set<string>();
    let m: RegExpExecArray | null; let guard = 0;

    // (1)+(2) direct text-node / string-literal-expression starts.
    NODE_DIRECT_RE.lastIndex = 0;
    while ((m = NODE_DIRECT_RE.exec(src)) && guard < 800) { guard += 1; found.add(m[1].toLowerCase()); }

    // (3) const-backed identifier children, resolved to their string literal.
    const consts = collectStringConsts(src);
    if (consts.size) {
      guard = 0;
      NODE_IDENT_RE.lastIndex = 0;
      while ((m = NODE_IDENT_RE.exec(src)) && guard < 800) {
        guard += 1;
        const val = consts.get(m[1]);
        const lab = val ? leadingFieldLabelOf(val) : null;
        if (lab) found.add(lab);
      }
    }
    return [...found];
  } catch {
    return [];
  }
}
