import { useLanguageStore } from '@/stores/languageStore';
import { Reveal, ArrowLink } from '@/components/marketing/primitives';

/**
 * Who Korvix is for — an editorial list, not four identical squares.
 *
 * Each entry answers one question: what would this person actually DO inside
 * Korvix? The steps are written from real surfaces (a project, chat with
 * research, Web/App Build, read-only connectors), so no audience is promised a
 * capability that does not exist — there is no "enterprise deployment", no SSO,
 * no team seats, because none of those ship today.
 */

const AUDIENCES = [
  { id: 'founders', titleKey: 'solFoundersTitle', leadKey: 'solFoundersLead', doKeys: ['solFoundersDo1', 'solFoundersDo2', 'solFoundersDo3'] },
  { id: 'developers', titleKey: 'solDevelopersTitle', leadKey: 'solDevelopersLead', doKeys: ['solDevelopersDo1', 'solDevelopersDo2', 'solDevelopersDo3'] },
  { id: 'product-teams', titleKey: 'solTeamsTitle', leadKey: 'solTeamsLead', doKeys: ['solTeamsDo1', 'solTeamsDo2', 'solTeamsDo3'] },
  { id: 'agencies', titleKey: 'solAgenciesTitle', leadKey: 'solAgenciesLead', doKeys: ['solAgenciesDo1', 'solAgenciesDo2', 'solAgenciesDo3'] },
];

export default function SolutionsSection() {
  const { t } = useLanguageStore();

  return (
    <section id="who-for" className="mkt-section" aria-labelledby="who-title">
      <div className="mkt-wrap">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-16">
          <div>
            <Reveal>
              <div className="lg:sticky lg:top-28">
                <span className="mkt-eyebrow">{t('solEyebrow')}</span>
                <h2 id="who-title" className="mkt-h2">{t('solTitle')}</h2>
                <p className="mkt-sub">{t('solLead')}</p>
                <div className="mt-6">
                  <ArrowLink to="/solutions">{t('solCta')}</ArrowLink>
                </div>
              </div>
            </Reveal>
          </div>

          <ol className="m-0 list-none p-0">
            {AUDIENCES.map((a, i) => (
              <li key={a.id} className="border-t border-[color:var(--mkt-border)] first:border-t-0">
                <Reveal delay={i * 60}>
                  <div className="py-8 first:pt-0">
                    <div className="flex items-baseline gap-4">
                      <span className="mkt-mono text-[12px] font-semibold text-[color:var(--mkt-faint)]">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="mkt-h3 text-[20px]">{t(a.titleKey)}</h3>
                    </div>
                    <p className="mt-2.5 max-w-[62ch] pl-[38px] text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                      {t(a.leadKey)}
                    </p>
                    <ul className="m-0 mt-4 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 pl-[38px]">
                      {a.doKeys.map((k) => (
                        <li
                          key={k}
                          className="flex items-center gap-2 text-[13px] text-[color:var(--mkt-muted)]"
                        >
                          <span
                            className="h-1 w-1 rounded-full"
                            style={{ background: 'var(--mkt-brand)' }}
                            aria-hidden="true"
                          />
                          {t(k)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
