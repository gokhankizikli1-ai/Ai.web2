import { Link } from 'react-router';
import { Check } from 'lucide-react';
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

function WebFrame() {
  const { t } = useLanguageStore();
  return (
    <div className="mkt-panel mt-6">
      <div className="mkt-pchrome">
        <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
        <span className="title">{t('buildWebFrameUrl')}</span>
        <span className="ml-auto"><IllustrativeTag /></span>
      </div>
      <div className="space-y-3 p-4" aria-hidden="true">
        <div className="rounded-lg bg-[color:var(--mkt-deep-2)] p-4">
          <span className="mkt-pline mb-2 block" style={{ width: '46%', height: 11 }} />
          <span className="mkt-pline mb-1.5 block" style={{ width: '72%' }} />
          <span className="mkt-pline block" style={{ width: '58%' }} />
          <span
            className="mt-3 inline-block h-6 w-24 rounded-md"
            style={{ background: 'linear-gradient(180deg,#4f46e5,#4338ca)' }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-2.5">
              <span className="mb-2 block h-6 w-6 rounded-md bg-white/[0.08]" />
              <span className="mkt-pline mb-1 block" style={{ width: '80%' }} />
              <span className="mkt-pline block" style={{ width: '55%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppFrame() {
  const { t } = useLanguageStore();
  return (
    <div className="mkt-panel mt-6">
      <div className="mkt-pchrome">
        <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
        <span className="title">{t('buildAppFrameLabel')}</span>
        <span className="ml-auto"><IllustrativeTag /></span>
      </div>
      <div className="grid grid-cols-[86px_minmax(0,1fr)]" aria-hidden="true">
        <div className="space-y-2 border-r border-[color:var(--mkt-deep-line)] p-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5"
              style={i === 1 ? { background: 'rgba(79,70,229,0.18)' } : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: i === 1 ? 'var(--mkt-accent)' : '#3d4a68' }} />
              <span className="mkt-pline block" style={{ width: 34, height: 5 }} />
            </span>
          ))}
        </div>
        <div className="space-y-2.5 p-4">
          <span className="mkt-pline block" style={{ width: '40%', height: 10 }} />
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-2.5">
                <span className="mkt-pline mb-1.5 block" style={{ width: '70%' }} />
                <span className="mkt-pline block" style={{ width: '45%' }} />
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
