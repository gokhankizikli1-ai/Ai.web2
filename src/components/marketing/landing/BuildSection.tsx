import { Link } from 'react-router';
import { Check, ArrowLeft, Lock } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { Reveal, IllustrativeTag } from '@/components/marketing/primitives';
import ProductStory from '@/components/landing/ProductStory';

/**
 * Build — Web Build and App Build, presented as two distinct products rather
 * than one generic "AI builder" pitch, and deliberately NOT as two identical
 * feature cards: the section is a split composition where each side carries its
 * own miniature product frame.
 *
 * Accuracy: App Build produces a client-routed multi-screen React/Vite
 * application that runs in the browser (see src/lib/buildType.ts — "NOT React
 * Native/Expo — a web-hostable app"), so the copy says exactly that and never
 * implies native mobile output.
 *
 * The animated three-step walkthrough below is the EXISTING ProductStory
 * component (describe → generate → refine), reused rather than rebuilt: it is
 * already accessible, reduced-motion aware, and honest about which parts of the
 * delivery flow are still upcoming.
 */

/** The build preview's own chrome: a back control and the centred lock +
 *  address pill the standalone preview renders (src/pages/WebBuildPreview.tsx,
 *  where `preview.korvix.build` is the address shown until a build has a slug). */
function PreviewChrome() {
  const { t } = useLanguageStore();
  return (
    <div className="mkt-urlbar">
      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="mkt-urlpill">
        <Lock aria-hidden="true" className="h-2.5 w-2.5" />
        <span className="mkt-mono">{t('buildWebFrameUrl')}</span>
      </span>
      <IllustrativeTag />
    </div>
  );
}

/** Web Build output: the generated page as the preview renders it — eyebrow
 *  rule, headline, supporting line, one accent action, then the section cards
 *  the document builder lays out (src/components/builder/WebBuildPreviewDocument.tsx).
 *  Copy is withheld (lines, not words): the real page's words come from the
 *  visitor's own brief. */
function WebFrame() {
  return (
    <div className="mkt-panel mt-6">
      <PreviewChrome />
      <div className="space-y-3 p-4" aria-hidden="true">
        <div className="rounded-lg border border-[color:var(--mkt-deep-line)] bg-[color:var(--mkt-deep-2)] p-4">
          <span className="mb-3 flex items-center gap-2">
            <span className="block h-px w-5" style={{ background: 'var(--mkt-brand)' }} />
            <span className="mkt-pline block" style={{ width: 54, height: 5 }} />
          </span>
          <span className="mkt-pline mb-2 block" style={{ width: '64%', height: 12 }} />
          <span className="mkt-pline mb-1.5 block" style={{ width: '80%' }} />
          <span className="mkt-pline block" style={{ width: '52%' }} />
          <span
            className="mt-3.5 inline-block h-6 w-24 rounded-md"
            style={{ background: 'var(--mkt-brand-deep)' }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-2.5">
              <span
                className="mb-2 grid h-6 w-6 place-items-center rounded-md text-[11px] font-semibold"
                style={{ background: 'rgba(79,70,229,0.16)', color: '#c7d2fe' }}
              >
                ✓
              </span>
              <span className="mkt-pline mb-1 block" style={{ width: '80%' }} />
              <span className="mkt-pline block" style={{ width: '55%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** App Build output: a multi-screen React application running in the SAME
 *  browser preview — a planned screen list with client-side navigation, one
 *  screen open. It is deliberately not drawn as a phone: App Build produces a
 *  web-hostable SPA, not a native mobile app (src/lib/buildType.ts). Screen
 *  names are an example app's, matching the honesty note under the section. */
function AppFrame() {
  const { t } = useLanguageStore();
  const screens = ['buildAppScreen1', 'buildAppScreen2', 'buildAppScreen3', 'buildAppScreen4'];
  return (
    <div className="mkt-panel mt-6">
      <PreviewChrome />
      <div className="grid grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[132px_minmax(0,1fr)]">
        <div className="border-r border-[color:var(--mkt-deep-line)] p-3">
          <p className="mkt-mono m-0 mb-2 text-[9px] uppercase tracking-[0.1em] text-[color:var(--mkt-deep-muted)]">
            {t('buildAppFrameLabel')}
          </p>
          {screens.map((k, i) => (
            <div key={k} className="mkt-prow px-2 py-1.5 text-[11.5px]" data-active={i === 0 ? 'true' : undefined}
              style={i === 0 ? { background: 'rgba(79,70,229,0.16)', color: '#fff' } : undefined}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: i === 0 ? 'var(--mkt-brand)' : '#3d4a68' }}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{t(k)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2.5 p-4" aria-hidden="true">
          <div className="flex items-center justify-between">
            <span className="mkt-pline block" style={{ width: 92, height: 10 }} />
            <span className="mkt-pline block" style={{ width: 46, height: 16 }} />
          </div>
          <div className="divide-y divide-[color:var(--mkt-deep-line)] rounded-lg border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)]">
            {['72%', '58%', '65%'].map((w) => (
              <div key={w} className="flex items-center gap-2.5 px-3 py-2.5">
                <span className="h-5 w-5 shrink-0 rounded-md bg-white/[0.06]" />
                <span className="mkt-pline block" style={{ width: w, height: 5 }} />
                <span className="mkt-pline ml-auto block" style={{ width: 26, height: 5 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BuildColumn({
  titleKey, bodyKey, pointKeys, frame,
}: {
  titleKey: string;
  bodyKey: string;
  pointKeys: string[];
  frame: React.ReactNode;
}) {
  const { t } = useLanguageStore();
  return (
    <div>
      <h3 className="mkt-h3 text-[22px]">{t(titleKey)}</h3>
      <p className="mt-2.5 max-w-[46ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
        {t(bodyKey)}
      </p>
      <ul className="m-0 mt-4 list-none space-y-2 p-0">
        {pointKeys.map((k) => (
          <li key={k} className="flex items-start gap-2.5 text-[13.5px] text-[color:var(--mkt-body)]">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mkt-brand)]" />
            {t(k)}
          </li>
        ))}
      </ul>
      {frame}
    </div>
  );
}

export default function BuildSection() {
  const { t } = useLanguageStore();

  return (
    <section id="how-it-works" className="mkt-section" aria-labelledby="build-title">
      <div className="mkt-wrap">
        <Reveal>
          <div className="max-w-[64ch]">
            <span className="mkt-eyebrow">{t('buildEyebrow')}</span>
            <h2 id="build-title" className="mkt-h2">{t('buildTitle')}</h2>
            <p className="mkt-sub">{t('buildLead')}</p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <BuildColumn
              titleKey="buildWebTitle"
              bodyKey="buildWebBody"
              pointKeys={['buildWebP1', 'buildWebP2', 'buildWebP3']}
              frame={<WebFrame />}
            />
          </Reveal>
          <Reveal delay={90}>
            <BuildColumn
              titleKey="buildAppTitle"
              bodyKey="buildAppBody"
              pointKeys={['buildAppP1', 'buildAppP2', 'buildAppP3']}
              frame={<AppFrame />}
            />
          </Reveal>
        </div>

        <Reveal delay={60}>
          <p className="mt-8 max-w-[74ch] text-[12.5px] leading-relaxed text-[color:var(--mkt-faint)]">
            {t('buildHonestyNote')}{' '}
            <Link to="/product#web-build" className="underline underline-offset-2">
              {t('buildHonestyLink')}
            </Link>
          </p>
        </Reveal>
      </div>

      {/* Motion moment 3 — the existing three-step product walkthrough. */}
      <ProductStory />
    </section>
  );
}
