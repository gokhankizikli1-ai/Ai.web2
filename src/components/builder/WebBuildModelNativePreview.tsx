import { Component, useMemo, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { SandpackProvider, SandpackLayout, SandpackPreview, type SandpackFiles, type SandpackSetup } from '@codesandbox/sandpack-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * ISOLATED runtime Preview of the validated model-native React project (Phase 12D).
 *
 * The generated TSX/TS/CSS files are runtime DATA, not modules of this app, so they
 * are NEVER executed inside the Korvix React tree. They run only inside Sandpack's
 * sandboxed preview iframe. There is no eval / new Function / dangerouslySetInnerHTML
 * / document.write / dynamic <script> injection / Babel-or-Tailwind CDN / custom TSX
 * interpreter here, and no auth/profile/spec/raw-response is passed into the sandbox.
 *
 * The sandbox receives only: the validated files (read-only), two preview-only
 * Tailwind/PostCSS infrastructure files, and a bounded static dependency map pinned to
 * the repository's own version ranges. A structurally-valid project is NOT proof it
 * compiles — Sandpack's own compile/runtime error overlay stays visible so failures
 * are shown honestly rather than masked by the legacy renderer.
 */
export interface WebBuildModelNativePreviewProps {
  files: WebBuildFile[];
  mode?: 'embedded' | 'standalone';
}

/* Bounded static runtime dependency map — the packages Phase 12C accepts, pinned to
 * the repository's OWN version ranges (never "latest", never an undeclared package).
 * The host-only @codesandbox/sandpack-react is deliberately absent. */
const SANDBOX_DEPENDENCIES: Record<string, string> = {
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  'framer-motion': '^12.38.0',
  'lucide-react': '^0.562.0',
  clsx: '^2.1.1',
  'tailwind-merge': '^3.4.0',
  recharts: '^2.15.4',
  'class-variance-authority': '^0.7.1',
  cmdk: '^1.1.1',
  'date-fns': '^4.1.0',
  'embla-carousel-react': '^8.6.0',
  'input-otp': '^1.4.2',
  'next-themes': '^0.4.6',
  'react-day-picker': '^9.13.0',
  'react-hook-form': '^7.70.0',
  'react-markdown': '^10.1.0',
  'react-resizable-panels': '^4.2.2',
  'react-router': '^7.6.1',
  'react-syntax-highlighter': '^16.1.1',
  'remark-gfm': '^4.0.1',
  sonner: '^2.0.7',
  vaul: '^1.1.2',
  zod: '^4.3.5',
  zustand: '^5.0.13',
  '@hookform/resolvers': '^5.2.2',
  '@radix-ui/react-accordion': '^1.2.12',
  '@radix-ui/react-alert-dialog': '^1.1.15',
  '@radix-ui/react-aspect-ratio': '^1.1.8',
  '@radix-ui/react-avatar': '^1.1.11',
  '@radix-ui/react-checkbox': '^1.3.3',
  '@radix-ui/react-collapsible': '^1.1.12',
  '@radix-ui/react-context-menu': '^2.2.16',
  '@radix-ui/react-dialog': '^1.1.15',
  '@radix-ui/react-dropdown-menu': '^2.1.16',
  '@radix-ui/react-hover-card': '^1.1.15',
  '@radix-ui/react-label': '^2.1.8',
  '@radix-ui/react-menubar': '^1.1.16',
  '@radix-ui/react-navigation-menu': '^1.2.14',
  '@radix-ui/react-popover': '^1.1.15',
  '@radix-ui/react-progress': '^1.1.8',
  '@radix-ui/react-radio-group': '^1.3.8',
  '@radix-ui/react-scroll-area': '^1.2.10',
  '@radix-ui/react-select': '^2.2.6',
  '@radix-ui/react-separator': '^1.1.8',
  '@radix-ui/react-slider': '^1.3.6',
  '@radix-ui/react-slot': '^1.2.4',
  '@radix-ui/react-switch': '^1.2.6',
  '@radix-ui/react-tabs': '^1.1.13',
  '@radix-ui/react-toggle': '^1.1.10',
  '@radix-ui/react-toggle-group': '^1.1.11',
  '@radix-ui/react-tooltip': '^1.2.8',
  // Preview-only build toolchain. Sandpack 2.20.0 does NOT install
  // customSetup.devDependencies inside the sandbox, so these must be RUNTIME
  // dependencies for the generated project's Tailwind directives + PostCSS pipeline
  // to be processed. Versions match the repository's own devDependency ranges;
  // Tailwind is compiled inside the sandbox via the config files below, never a CDN.
  tailwindcss: '^3.4.19',
  postcss: '^8.5.6',
  autoprefixer: '^10.4.23',
  typescript: '~5.9.3',
};

/* Preview-only infrastructure files. They are added ONLY to the Sandpack virtual
 * project — never to payload.files / All Files — and never overwrite a model path. */

/* Phase 12F.3 — STABLE Tailwind SEMANTIC-TOKEN contract for the Preview runtime.
 *
 * The generated project can only ship tsx/ts/css files (the validator rejects a .js
 * tailwind.config), and the Phase 12A spec labels its palette with SEMANTIC names
 * (background/foreground/text/muted/surface/border/primary/secondary/accent/…), so the
 * model naturally emits utilities like `bg-background`, `text-text`, `border-border`.
 * Tailwind's default palette has NO such colors, so with an empty `theme.extend` those
 * utilities silently produced nothing and the Preview rendered UNSTYLED native controls.
 *
 * Each token below maps to `hsl(var(--<token>, <fallback-channels>) / <alpha-value>)`:
 *   • if the generated styles.css defines the shadcn-style channel var, its theme WINS;
 *   • otherwise the coherent fallback (neutral shadcn "light") renders — never unstyled.
 * The `/ <alpha-value>` form keeps opacity modifiers (bg-muted/50, bg-primary/20) working.
 * These are compiled INSIDE the sandbox by the pinned tailwindcss dep — never a CDN.
 *
 * KEEP IN SYNC with webBuildFrontendValidation.ts SUPPORTED_SEMANTIC_TOKENS. */
const SEMANTIC_TOKEN_FALLBACKS: Record<string, string> = {
  background: '0 0% 100%',
  foreground: '222.2 84% 4.9%',
  text: '222.2 84% 4.9%',
  card: '0 0% 100%',
  'card-foreground': '222.2 84% 4.9%',
  popover: '0 0% 100%',
  'popover-foreground': '222.2 84% 4.9%',
  primary: '222.2 47.4% 11.2%',
  'primary-foreground': '210 40% 98%',
  secondary: '210 40% 96.1%',
  'secondary-foreground': '222.2 47.4% 11.2%',
  muted: '210 40% 96.1%',
  'muted-foreground': '215.4 16.3% 46.9%',
  accent: '210 40% 96.1%',
  'accent-foreground': '222.2 47.4% 11.2%',
  accent2: '199 89% 48%',
  destructive: '0 84.2% 60.2%',
  'destructive-foreground': '210 40% 98%',
  border: '214.3 31.8% 91.4%',
  input: '214.3 31.8% 91.4%',
  ring: '222.2 84% 4.9%',
  surface: '0 0% 100%',
  'surface-foreground': '222.2 84% 4.9%',
};

/** Build the nested Tailwind `colors` object literal: `foreground`/`primary-foreground`
 *  collapse into `{ primary: { DEFAULT, foreground } }`; standalone tokens stay flat. */
function buildSemanticColorsLiteral(): string {
  const colorExpr = (token: string): string =>
    `'hsl(var(--${token}, ${SEMANTIC_TOKEN_FALLBACKS[token]}) / <alpha-value>)'`;
  const flat: string[] = [];
  const nested = new Map<string, string[]>();
  for (const token of Object.keys(SEMANTIC_TOKEN_FALLBACKS)) {
    const dash = token.indexOf('-');
    if (dash > 0 && token.slice(dash + 1) === 'foreground') {
      const base = token.slice(0, dash);
      const entries = nested.get(base) || [];
      entries.push(`foreground: ${colorExpr(token)}`);
      nested.set(base, entries);
    } else {
      // A base that also has a *-foreground becomes a nested object with a DEFAULT.
      flat.push(token);
    }
  }
  const lines: string[] = [];
  for (const token of flat) {
    const fg = nested.get(token);
    if (fg && fg.length) {
      lines.push(`      '${token}': { DEFAULT: ${colorExpr(token)}, ${fg.join(', ')} },`);
      nested.delete(token);
    } else {
      lines.push(`      '${token}': ${colorExpr(token)},`);
    }
  }
  // Any *-foreground whose base was not a color token on its own (none today) stays flat.
  for (const [base, fg] of nested) {
    lines.push(`      '${base}': { ${fg.join(', ')} },`);
  }
  return lines.join('\n');
}

const TAILWIND_CONFIG_CODE = [
  'module.exports = {',
  "  content: ['./src/**/*.{js,jsx,ts,tsx}'],",
  '  theme: {',
  '    extend: {',
  '      colors: {',
  buildSemanticColorsLiteral(),
  '      },',
  '    },',
  '  },',
  '  plugins: [],',
  '};',
  '',
].join('\n');

const POSTCSS_CONFIG_CODE = [
  'module.exports = {',
  '  plugins: {',
  '    tailwindcss: {},',
  '    autoprefixer: {},',
  '  },',
  '};',
  '',
].join('\n');

/** Required entry files that must be present + non-empty before a sandbox can start. */
const REQUIRED_ENTRY_PATHS = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];

/** Normalize a payload path ('src/App.tsx') to a Sandpack virtual path ('/src/App.tsx'). */
function toVirtualPath(p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * Local error boundary around the Sandpack integration. If the Sandpack React
 * component itself throws while constructing the sandbox, the failure is contained
 * here with an honest message — we never fall back to the legacy section renderer
 * after claiming the model-native source is active. (Sandpack's OWN in-iframe
 * compile/runtime overlay handles generated-code errors and stays visible.)
 */
class SandpackErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') console.error('WebBuildModelNativePreview: Sandpack integration failed', error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default function WebBuildModelNativePreview({ files, mode = 'embedded' }: WebBuildModelNativePreviewProps) {
  const { lang } = useLanguageStore();
  const list = useMemo(() => (Array.isArray(files) ? files.filter((f): f is WebBuildFile => !!f && typeof f.path === 'string' && typeof f.content === 'string') : []), [files]);

  // Precondition: the required entry files must exist and be non-empty. The Phase 12C
  // consumption gate should already guarantee this; if not, show an honest error
  // rather than silently switching to the legacy preview.
  const hasEntryFiles = useMemo(() => {
    const byPath = new Map(list.map((f) => [f.path, f]));
    return REQUIRED_ENTRY_PATHS.every((p) => {
      const f = byPath.get(p);
      return !!f && f.content.trim().length > 0;
    });
  }, [list]);

  // Read-only Sandpack virtual file map + preview-only infrastructure. Model content
  // is passed byte-for-byte; infra files never overwrite a model-native path.
  const virtualFiles = useMemo<SandpackFiles>(() => {
    const vf: SandpackFiles = {};
    for (const f of list) vf[toVirtualPath(f.path)] = { code: f.content, readOnly: true };
    if (!vf['/tailwind.config.js']) vf['/tailwind.config.js'] = { code: TAILWIND_CONFIG_CODE, readOnly: true, hidden: true };
    if (!vf['/postcss.config.js']) vf['/postcss.config.js'] = { code: POSTCSS_CONFIG_CODE, readOnly: true, hidden: true };
    return vf;
  }, [list]);

  const customSetup = useMemo<SandpackSetup>(() => ({
    entry: '/src/main.tsx',
    dependencies: SANDBOX_DEPENDENCIES,
  }), []);

  // Embedded: at least 560px, sized for the existing 70vh drawer. Standalone: fill the
  // viewport below the Korvix browser chrome. The generated site controls its own
  // full-width layout inside the iframe.
  const containerStyle: CSSProperties = mode === 'standalone'
    ? { height: 'calc(100vh - 44px)', minHeight: 480, width: '100%' }
    : { height: '70vh', minHeight: 560, width: '100%' };

  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);

  if (!hasEntryFiles) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-12 text-center" style={mode === 'standalone' ? containerStyle : undefined}>
        <p className="text-[14px] font-semibold text-white">
          {L('Model-native preview could not start', 'Model-native önizleme başlatılamadı')}
        </p>
        <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#94A3B8]">
          {L(
            'The generated project is missing a required entry file (src/main.tsx, src/App.tsx or src/styles.css). The validated files remain available in All Files.',
            'Oluşturulan projede gerekli bir giriş dosyası (src/main.tsx, src/App.tsx veya src/styles.css) eksik. Doğrulanmış dosyalar Tüm Dosyalar’da kullanılabilir.',
          )}
        </p>
      </div>
    );
  }

  const boundaryFallback = (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-12 text-center" style={mode === 'standalone' ? containerStyle : undefined}>
      <p className="text-[14px] font-semibold text-white">
        {L('Model-native preview could not start.', 'Model-native önizleme başlatılamadı.')}
      </p>
      <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#94A3B8]">
        {L(
          'The validated files remain available in All Files.',
          'Doğrulanmış dosyalar Tüm Dosyalar’da kullanılabilir.',
        )}
      </p>
    </div>
  );

  return (
    <SandpackErrorBoundary fallback={boundaryFallback}>
      <div style={containerStyle}>
        <SandpackProvider
          theme="dark"
          template="react-ts"
          files={virtualFiles}
          customSetup={customSetup}
        >
          <SandpackLayout style={{ height: '100%', width: '100%', border: 'none', borderRadius: 0 }}>
            <SandpackPreview
              showNavigator={false}
              showOpenInCodeSandbox={false}
              showOpenNewtab={false}
              showRefreshButton
              showSandpackErrorOverlay
              style={{ height: '100%', width: '100%' }}
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </SandpackErrorBoundary>
  );
}
