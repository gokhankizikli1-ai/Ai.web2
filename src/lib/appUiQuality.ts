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
const MAX_SCAN_PER_FILE = 400; // tag-scan safety bound per file

/** Source files that carry app UI (screens + components), excluding data/css. */
function uiFiles(files: AppUiSourceFile[]): AppUiSourceFile[] {
  return files.filter((f) =>
    (f.language === 'tsx' || f.language === 'ts' || f.language === 'jsx' || f.language === 'js') &&
    f.path !== 'src/main.tsx');
}

/** Iterate opening tags of a NATIVE (lowercase) HTML element, yielding the raw attribute
 *  string. Case-SENSITIVE on purpose: `<select>` is the native control, `<Select…>` is a
 *  themed React/Radix component and must never be mistaken for a raw browser-default control. */
function forEachTag(source: string, name: string, fn: (attrs: string) => void): void {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'g');
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(source)) && n < MAX_SCAN_PER_FILE) { n += 1; fn(m[1] || ''); }
}

const hasClassName = (attrs: string): boolean => /\bclassName\s*=/.test(attrs);

/* ── 1) Raw native control in a themed (non-utility) app ─────────────────────────
 * A native <select> with NO className is a browser-default surface — acceptable in a minimal
 * utility, but in a themed app it opens an unstyled popup that breaks the design. Radix-based
 * selects (no <select> tag) and themed native selects (<select className="…">) never match. */
export function detectRawNativeControls(input: AppUiQualityInput): AppUiQualityFinding[] {
  if ((input.appType || '') === 'utility') return [];
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    let raw = false;
    forEachTag(f.content, 'select', (attrs) => { if (!hasClassName(attrs)) raw = true; });
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
 * A dark app must not open a white/near-white menu/dropdown/dialog surface. Fires only when a
 * light background co-occurs with a surface keyword (menu/dropdown/popover/dialog/modal/sheet/
 * select) in the same file — precise, low false-positive. */
const LIGHT_SURFACE_RE = /\bbg-(?:white|(?:gray|grey|slate|zinc|neutral|stone)-(?:50|100))\b|\bbg-\[#(?:fff|ffffff|f\w{2}|f\w{5})\]/i;
const SURFACE_KEYWORD_RE = /dropdown|popover|menu|dialog|modal|\bsheet\b|listbox|combobox|<select\b|role=["'](?:menu|listbox|dialog)["']/i;
export function detectLightSurfaceInDarkApp(input: AppUiQualityInput): AppUiQualityFinding[] {
  if (input.colorMode !== 'dark') return [];
  const hit: string[] = [];
  for (const f of uiFiles(input.files)) {
    if (LIGHT_SURFACE_RE.test(f.content) && SURFACE_KEYWORD_RE.test(f.content)) hit.push(f.path);
  }
  if (!hit.length) return [];
  return [{
    code: 'app-surface-theme-mismatch',
    message: `a light/white menu or dialog surface appears in a dark app (${hit.slice(0, 3).join(', ')}) — dropdown/menu/dialog surfaces must inherit the dark app palette, never a browser-default light surface`,
    files: hit.slice(0, MAX_FILES_PER_FINDING),
  }];
}

/* ── 3) Flat button hierarchy (every action equally dominant) ─────────────────────
 * Aggregated across the app: when there are several strongly-filled buttons and NONE is a
 * subordinate secondary/ghost/outline, the UI has no primary/secondary hierarchy. Requires ≥4
 * dominant buttons and zero differentiation, so a small or already-tiered UI never matches. */
const STRONG_FILL_RE = /\bbg-(?:blue|indigo|violet|purple|sky|cyan|primary|brand|emerald|green|teal|rose|red|orange|amber|fuchsia|pink)-(?:400|500|600|700)\b|\bbg-gradient-/i;
const SUBORDINATE_RE = /\bbg-transparent\b|\bvariant\s*=\s*["'](?:secondary|ghost|outline|link|tertiary)["']|\bbg-(?:gray|grey|slate|zinc|neutral|stone)-(?:100|200|transparent)\b|\bborder\b(?![^"']*\bbg-(?:blue|indigo|violet|purple|primary))/i;
export function detectFlatButtonHierarchy(input: AppUiQualityInput): AppUiQualityFinding[] {
  let dominant = 0;
  let subordinate = 0;
  const files: string[] = [];
  for (const f of uiFiles(input.files)) {
    let fileDominant = 0;
    forEachTag(f.content, 'button', (attrs) => {
      if (STRONG_FILL_RE.test(attrs)) { dominant += 1; fileDominant += 1; }
      if (SUBORDINATE_RE.test(attrs)) subordinate += 1;
    });
    // Also count a subordinate cue anywhere in the file (variant props on <Button/> components).
    if (SUBORDINATE_RE.test(f.content)) subordinate += 1;
    if (fileDominant) files.push(f.path);
  }
  if (dominant >= 4 && subordinate === 0) {
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
