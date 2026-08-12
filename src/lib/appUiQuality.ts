/**
 * App UI-Quality static detection (UI Quality Phases 1–2).
 *
 * The SINGLE deterministic detector for premium-UI defects in a generated App Build. It does
 * NOT add a model call or a second quality engine — it produces bounded, ADVISORY findings that
 * the existing static validator threads into the one review/repair loop as deterministic
 * warnings. Every detector is conservative and evidence-based: it fires only on a strongly
 * provable pattern (a raw browser-default control in a themed app, a light popup surface in a
 * dark app, uniformly-dominant buttons, tab UI with no active state, a wall of identical KPI
 * cards) so a legitimate simple/utility UI is never over-policed.
 *
 * Pure, deterministic, source-text-only, network-free, bounded, fail-open (never throws).
 */

export interface AppUiQualityFinding {
  /** Stable warning code (maps to an existing review category downstream). */
  code: string;
  message: string;
  /** Real project files the finding references (bounded). */
  files: string[];
}

export interface AppUiSourceFile {
  path: string;
  content: string;
  language: string;
}

export interface AppUiQualityInput {
  files: AppUiSourceFile[];
  /** App type (e.g. 'utility', 'crm') — a minimal utility relaxes control-polish rules. */
  appType?: string;
  /** Shared visual-system colour mode — enables the dark-theme surface-mismatch check. */
  colorMode?: 'light' | 'dark' | 'mixed';
}

const MAX_FILES_PER_FINDING = 6;
const MAX_ELEMENTS_PER_FILE = 600; // element-scan safety bound per file

/** Source files that carry app UI (screens + components), excluding data/css. */
function uiFiles(files: AppUiSourceFile[]): AppUiSourceFile[] {
  return files.filter((f) =>
    (f.language === 'tsx' || f.language === 'ts' || f.language === 'jsx' || f.language === 'js') &&
    f.path !== 'src/main.tsx');
}

interface JsxElement {
  /** Element/component name as written (`select`, `button`, `Button`, `DropdownMenuContent`, …). */
  name: string;
  /** The FULL opening-tag attribute text (everything between the name and the closing `>`). */
  attrs: string;
}

/**
 * Bounded, JSX-AWARE opening-tag scanner. Unlike a `[^>]*` regex it captures the WHOLE opening
 * tag — including attributes that follow a `{(e) => …}` handler — by tracking brace depth and
 * string literals so a `>` inside a JSX expression (`=>`, `a > b`), a quoted string, or a nested
 * `{}` never terminates the tag early. It is NOT a full JSX parser (no dependency): on any
 * ambiguous / unterminated opening tag it FAILS OPEN — the element is skipped, never yielded — so
 * incomplete parsing can never produce a finding. Bounded by MAX_ELEMENTS_PER_FILE.
 */
function forEachElement(source: string, fn: (el: JsxElement) => void): void {
  let i = 0;
  let scanned = 0;
  const n = source.length;
  while (i < n && scanned < MAX_ELEMENTS_PER_FILE) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    const nameStart = lt + 1;
    const first = source[nameStart];
    // Only element opens (a letter) — skip `</…`, `<!…`, `<>` and `a < b` comparisons.
    if (!first || !/[A-Za-z]/.test(first)) { i = lt + 1; continue; }
    let j = nameStart;
    while (j < n && /[A-Za-z0-9._-]/.test(source[j])) j += 1;
    const name = source.slice(nameStart, j);
    // Scan attributes to the tag-closing '>' at brace-depth 0 and outside any string literal.
    let k = j;
    let depth = 0;
    let quote = '';
    let closed = -1;
    let guard = 0;
    while (k < n && guard < 20000) {
      guard += 1;
      const ch = source[k];
      if (quote) { if (ch === quote) quote = ''; k += 1; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; k += 1; continue; }
      if (ch === '{') { depth += 1; k += 1; continue; }
      if (ch === '}') { if (depth > 0) depth -= 1; k += 1; continue; }
      if (depth === 0 && ch === '>') { closed = k; break; }
      if (depth === 0 && ch === '<') break; // a new tag opened before this one closed → malformed
      k += 1;
    }
    if (closed < 0) { i = lt + 1; continue; } // fail open on ambiguous/unterminated tag
    let attrs = source.slice(j, closed);
    if (attrs.endsWith('/')) attrs = attrs.slice(0, -1); // self-closing
    fn({ name, attrs });
    scanned += 1;
    i = closed + 1;
  }
}

const hasClassName = (attrs: string): boolean => /\bclassName\s*=/.test(attrs);

/* ── 1) Raw native control in a themed (non-utility) app ─────────────────────────
 * A native <select> with NO className is a browser-default surface — acceptable in a minimal
 * utility, but in a themed app it opens an unstyled popup that breaks the design. The JSX-aware
 * scanner captures the whole opening tag, so a themed select whose className follows an arrow
 * handler (`onChange={(e) => …} className="…"`) is correctly treated as themed. Radix selects
 * (component `<Select…>`, not the native lowercase element) never match. */
export function detectRawNativeControls(input: AppUiQualityInput): AppUiQualityFinding[] {
  if ((input.appType || '') === 'utility') return [];
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    let raw = false;
    forEachElement(f.content, (el) => { if (el.name === 'select' && !hasClassName(el.attrs)) raw = true; });
    if (raw) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-native-control-theme',
    message: `raw browser-default <select> with no theme classes in a themed app (${hit.slice(0, 3).join(', ')}) — style the control from the design system (or use a Radix select) so it does not open an unstyled native surface`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/* ── 2) Light popup/surface inside a DARK app ────────────────────────────────────
 * A dark app must not open a white/near-white menu/dropdown/dialog surface. The light class must
 * live ON an actual popup-surface ELEMENT — a Radix/component surface (`*Content`, Popover,
 * Dialog, Sheet, Modal, Drawer, Listbox, Combobox) or a native element carrying role="menu"/
 * "listbox"/"dialog". A lucide `Menu` icon import or an unrelated `bg-white/10` badge no longer
 * matches, because a bare `menu` substring elsewhere in the file is never sufficient. */
const LIGHT_SURFACE_RE = /\bbg-(?:white|(?:gray|grey|slate|zinc|neutral|stone)-(?:50|100))\b|\bbg-\[#(?:fff|ffffff|f[0-9a-f]{2}|f[0-9a-f]{5})\]/i;
const SURFACE_NAME_RE = /(?:Content|Popover|Dialog|Sheet|Modal|Drawer|Listbox|Combobox)$/;
const SURFACE_ROLE_RE = /\brole\s*=\s*["'](?:menu|listbox|dialog)["']/i;
function isPopupSurface(el: JsxElement): boolean {
  return SURFACE_NAME_RE.test(el.name) || SURFACE_ROLE_RE.test(el.attrs);
}
export function detectLightSurfaceInDarkApp(input: AppUiQualityInput): AppUiQualityFinding[] {
  if (input.colorMode !== 'dark') return [];
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    let mismatch = false;
    forEachElement(f.content, (el) => {
      if (!mismatch && isPopupSurface(el) && LIGHT_SURFACE_RE.test(el.attrs)) mismatch = true;
    });
    if (mismatch) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-surface-theme-mismatch',
    message: `a light/white menu or dialog surface appears in a dark app (${hit.slice(0, 3).join(', ')}) — dropdown/menu/dialog surfaces must inherit the dark app palette, never a browser-default light surface`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/* ── 3) Flat button hierarchy (every action equally dominant) ─────────────────────
 * Each BUTTON (native `<button>` or a `*Button` component) is classified from its OWN attributes
 * only — a `border` class on a card or input can no longer suppress the finding, because only
 * button elements are inspected. Fires when there are enough dominant (strong-fill / primary
 * variant) buttons and NO subordinate (secondary/ghost/outline/muted) button — a real tier or an
 * ambiguous unstyled wrapper (classified 'neutral') never triggers it. */
const STRONG_FILL_RE = /\bbg-(?:blue|indigo|violet|purple|sky|cyan|primary|brand|emerald|green|teal|rose|red|orange|amber|fuchsia|pink)-(?:400|500|600|700)\b|\bbg-gradient-/i;
const VARIANT_DOMINANT_RE = /\bvariant\s*=\s*["'`]?(?:default|primary|destructive|solid|cta)\b/i;
const VARIANT_SUBORDINATE_RE = /\bvariant\s*=\s*["'`]?(?:secondary|ghost|outline|link|tertiary|subtle|muted)\b/i;
const SUBORDINATE_CLASS_RE = /\bbg-transparent\b|\bbg-(?:gray|grey|slate|zinc|neutral|stone)-(?:50|100|200)\b/i;
type ButtonWeight = 'dominant' | 'subordinate' | 'neutral';
function isButtonElement(name: string): boolean {
  return name === 'button' || name.endsWith('Button'); // native <button> or a *Button component
}
function classifyButton(attrs: string): ButtonWeight {
  if (VARIANT_SUBORDINATE_RE.test(attrs)) return 'subordinate';
  if (VARIANT_DOMINANT_RE.test(attrs)) return 'dominant';
  const strong = STRONG_FILL_RE.test(attrs);
  if (strong) return 'dominant';
  // A muted fill, transparent, or a border-only outline (with no strong fill) reads as subordinate.
  if (SUBORDINATE_CLASS_RE.test(attrs) || /\bborder\b/.test(attrs)) return 'subordinate';
  return 'neutral';
}
export function detectFlatButtonHierarchy(input: AppUiQualityInput): AppUiQualityFinding[] {
  let dominant = 0;
  let subordinate = 0;
  const files: string[] = [];
  for (const f of uiFiles(input.files)) {
    let fileDominant = 0;
    forEachElement(f.content, (el) => {
      if (!isButtonElement(el.name)) return;
      const w = classifyButton(el.attrs);
      if (w === 'dominant') { dominant += 1; fileDominant += 1; }
      else if (w === 'subordinate') subordinate += 1;
    });
    if (fileDominant) files.push(f.path);
  }
  // ≥3 dominant actions and NO subordinate action anywhere → no primary/secondary hierarchy.
  if (dominant >= 3 && subordinate === 0) {
    return [{
      code: 'app-button-hierarchy',
      message: `${dominant} buttons are all styled as an equally-dominant primary with no secondary/ghost tier — establish one dominant primary per view and subordinate the rest`,
      files: files.slice(0, MAX_FILES_PER_FINDING),
    }];
  }
  return [];
}

/* ── 4) Dead tabs (tab UI with no active-state tracking) ─────────────────────────
 * A file that renders tab markers (role="tab" / TabsTrigger / a Radix Tabs) but tracks no
 * active state (aria-selected / data-state / useState / active|selected tab / Radix <Tabs>) is
 * a dead tab strip that cannot switch. Working tabs carry at least one active-state signal. */
const TAB_MARKER_RE = /role=["']tab["']|<TabsTrigger\b|<TabsList\b/i;
const TAB_ACTIVE_RE = /aria-selected|data-state|useState|useReducer|active\s*Tab|selected\s*Tab|set\s*(?:Active|Selected|Tab)|<Tabs\b|value\s*=|defaultValue/i;
export function detectDeadTabs(input: AppUiQualityInput): AppUiQualityFinding[] {
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    if (TAB_MARKER_RE.test(f.content) && !TAB_ACTIVE_RE.test(f.content)) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-interaction-state-missing',
    message: `tab controls with no active-state tracking (${hit.slice(0, 3).join(', ')}) — wire a selected tab so switching a tab visibly changes the panel`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/* ── 5) Generic dashboard (a wall of identical KPI cards, no hierarchy) ───────────
 * (UI Quality Phase 2 — generic-dashboard protection.) Conservative: fires only when one file
 * repeats a KPI/stat card structure many times with no differentiating hierarchy. A legitimate
 * dashboard with a chart, table or varied composition does not match. */
export function detectGenericDashboard(input: AppUiQualityInput): AppUiQualityFinding[] {
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    const c = f.content;
    // Count repeated stat/KPI card cues.
    const kpiMatches = (c.match(/\.map\(/g) || []).length;
    const cardCues = (c.match(/\b(?:StatCard|KpiCard|MetricCard|stat-card|kpi-card|metric-card)\b/g) || []).length;
    const rawCardRepeat = (c.match(/rounded-\w+[^"']*\bp-\d[^"']*\bshadow/gi) || []).length;
    const hasHierarchy = /<(?:table|Chart|Recharts|LineChart|BarChart|AreaChart|PieChart|canvas|svg)\b/i.test(c)
      || /\b(?:col-span-2|row-span-2|lg:col-span|xl:col-span)\b/.test(c); // a featured, larger panel
    const manyIdenticalCards = cardCues >= 6 || rawCardRepeat >= 6;
    if (manyIdenticalCards && !hasHierarchy && kpiMatches <= 1) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-generic-dashboard-pattern',
    message: `a screen is a wall of near-identical KPI/stat cards with no hierarchy or supporting chart/table (${hit.slice(0, 3).join(', ')}) — give the surface a clear primary focus and vary card prominence`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/* ── 6) Navigation with no active-route indication (UI Quality Phase 3) ──────────
 * A file that renders a real navigation region (a <nav> / role="navigation") with multiple route
 * links but tracks NO active state (aria-current / NavLink / isActive / location.pathname / an
 * active-class cue) has no current-route indication. Conservative: requires a nav region AND ≥2
 * links AND zero active-state signals, so a simple single-link header never matches. */
const NAV_REGION_RE = /<nav\b|role=["']navigation["']/i;
const LINK_RE = /<NavLink\b|<Link\b|\bto=["']\/|href=["']\/(?![/])/gi;
const NAV_ACTIVE_RE = /aria-current|<NavLink\b|isActive|location\.pathname|usePathname|useLocation|data-active|\bactive(?:Route|Path|Tab|Item)\b|className=\{\(\{\s*isActive/i;
export function detectMissingNavActiveState(input: AppUiQualityInput): AppUiQualityFinding[] {
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    if (!NAV_REGION_RE.test(f.content)) continue;
    const links = (f.content.match(LINK_RE) || []).length;
    if (links >= 2 && !NAV_ACTIVE_RE.test(f.content)) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-navigation-active-state',
    message: `navigation renders multiple route links with no active/current-route indication (${hit.slice(0, 3).join(', ')}) — highlight the active route/tab/sidebar item so users know where they are`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/** Run every app UI-quality detector. Deterministic, bounded, fail-open. */
export function detectAppUiQuality(input: AppUiQualityInput): AppUiQualityFinding[] {
  try {
    return [
      ...detectRawNativeControls(input),
      ...detectLightSurfaceInDarkApp(input),
      ...detectFlatButtonHierarchy(input),
      ...detectDeadTabs(input),
      ...detectGenericDashboard(input),
      ...detectMissingNavActiveState(input),
    ];
  } catch {
    return [];
  }
}
