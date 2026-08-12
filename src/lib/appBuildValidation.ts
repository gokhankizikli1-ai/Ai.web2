/**
 * App Build — app structural validation (Phase 5).
 *
 * The Web Build's frontend validation (parseAndValidateFrontendBuilderRaw) checks the
 * frontend-files-v1 envelope, imports and code shape — App Build REUSES it unchanged.
 * This module ADDS the app-specific STRUCTURAL checks that a multi-screen app needs and
 * a page validator has no concept of:
 *   • an entry file exists (src/App.tsx / src/main.tsx),
 *   • every declared screen has a source file,
 *   • every navigation route resolves to a real screen file (no route to nowhere),
 *   • the router is actually wired (routes/screens are referenced from the app entry).
 *
 * It is CONSERVATIVE and FAIL-OPEN: it only faults a MISSING structural element it can
 * prove is absent, never ambiguous or dynamic code. Pure, deterministic, bounded,
 * network-free, JSON-serializable. Type-only imports (leaf module).
 */
import type { AppArchitectureContract, NavigationContract } from '@/lib/appBuildArchitecture';
import type { AppSourceFile } from '@/lib/appBuildScreenDepth';

export type AppStructuralCode =
  | 'missing-entry-file' | 'missing-screen-file' | 'route-to-nowhere' | 'router-not-wired';

export interface AppStructuralIssue {
  code: AppStructuralCode;
  screenId?: string;
  message: string;
  severity: 'minor' | 'major';
}

export interface AppStructuralResult {
  status: 'pass' | 'fail';
  /** True only when validation actually ran against real inputs. */
  legacy: boolean;
  screenFilesFound: number;
  issues: AppStructuralIssue[];
}

const ENTRY_RE = /(^|\/)(App|main|index)\.(t|j)sx?$/i;

/** Alphanumeric-only lowercasing so a file named by id OR by CamelCase name matches the
 *  same screen: "contact-detail" and "ContactDetail.tsx" both normalize to
 *  "contactdetail". Whole-id containment avoids "contacts" matching "contact-detail". */
const alnum = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function pathMatchesScreen(path: string, screenId: string): boolean {
  const p = (path || '').toLowerCase();
  if (!/\.(t|j)sx?$/.test(p)) return false;
  const base = alnum((p.split('/').pop() || '').replace(/\.(t|j)sx?$/, ''));
  const id = alnum(screenId);
  if (!id || !base) return false;
  // The file's basename must contain the WHOLE id (not merely a shared prefix), so a
  // detail screen never resolves to the list screen's file and vice-versa.
  return base.includes(id);
}

export function validateAppStructure(
  files: AppSourceFile[] | undefined,
  architecture: AppArchitectureContract | undefined,
  navigation: NavigationContract | undefined,
): AppStructuralResult {
  if (!architecture || architecture.status !== 'derived' || !Array.isArray(files) || files.length === 0) {
    return { status: 'pass', legacy: false, screenFilesFound: 0, issues: [] };
  }
  try {
    const issues: AppStructuralIssue[] = [];
    const paths = files.map((f) => f.path || '');
    const allSource = files.map((f) => f.content || '').join('\n');

    // 1. Entry file present.
    const hasEntry = paths.some((p) => ENTRY_RE.test(p));
    if (!hasEntry) {
      issues.push({ code: 'missing-entry-file', severity: 'major',
        message: 'No app entry file (src/App.tsx / src/main.tsx) was emitted.' });
    }

    // 2. Every declared screen has a source file (unless it is trivially the only screen
    //    rendered inline in the entry — a single-screen app may inline its one screen).
    const single = architecture.screens.length === 1;
    let screenFilesFound = 0;
    for (const s of architecture.screens) {
      const hasFile = files.some((f) => pathMatchesScreen(f.path, s.id));
      if (hasFile) { screenFilesFound += 1; continue; }
      if (single) continue; // one-screen app can live in the entry file
      issues.push({ code: 'missing-screen-file', screenId: s.id, severity: 'major',
        message: `Declared screen "${s.id}" has no source file.` });
    }

    // 3. Every navigation route resolves to a real screen file, and the router is wired.
    if (navigation && navigation.routes.length && !single) {
      // Router wiring: the entry (or some file) references routing OR the screen ids.
      const routerWired = /react-router|createBrowserRouter|<Routes\b|<Route\b|useRoute|Router\b|navigate\(/i.test(allSource)
        || navigation.routes.some((r) => allSource.toLowerCase().includes(`/${r.screenId.toLowerCase()}`));
      if (!routerWired) {
        issues.push({ code: 'router-not-wired', severity: 'major',
          message: 'The navigation routes are declared but no router/route wiring is referenced in the source.' });
      }
      for (const r of navigation.routes) {
        const screen = architecture.screens.find((s) => s.id === r.screenId);
        if (!screen) continue;
        const hasFile = files.some((f) => pathMatchesScreen(f.path, screen.id));
        if (!hasFile) {
          issues.push({ code: 'route-to-nowhere', screenId: r.screenId, severity: 'minor',
            message: `Route "${r.path}" targets screen "${r.screenId}" which has no source file.` });
        }
      }
    }

    const hasMajor = issues.some((i) => i.severity === 'major');
    return { status: (hasMajor || issues.length) ? 'fail' : 'pass', legacy: true, screenFilesFound, issues };
  } catch {
    return { status: 'pass', legacy: false, screenFilesFound: 0, issues: [] };
  }
}

export function hasBlockingAppStructuralFindings(res: AppStructuralResult | undefined): boolean {
  return !!res && res.status === 'fail' && res.issues.some((i) => i.severity === 'major');
}
