import MarketingPage from '@/components/marketing/MarketingPage';
import { EnglishOnlyNotice, ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { CHANGELOG, CHANGELOG_HISTORY_START } from '@/content/changelog';

/**
 * Changelog. Entries are derived from the repository's real merged history —
 * real dates, real capability changes, no invented releases and no version
 * numbers (the product does not publish versions).
 *
 * The page states the limit of what it can speak to: the available history
 * starts on a known date, so this is "notable recent releases", not a complete
 * product history. That is the honest alternative to fabricating a timeline.
 */
export default function ChangelogPage() {
  const { t, lang } = useLanguageStore();
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    try {
      return new Intl.DateTimeFormat(lang, {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
      }).format(d);
    } catch {
      return iso;
    }
  };

  return (
    <MarketingPage title={t('chgTitle')} description={t('chgMeta')}>
      <ResourceHeader
        eyebrow={t('navResources')}
        title={t('chgTitle')}
        lead={t('chgLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navChangelog') }]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody>
        <div className="max-w-[76ch]">
          <p className="mkt-chip h-auto whitespace-normal py-2 text-left leading-relaxed">
            {t('chgScopeNote', { date: fmt(CHANGELOG_HISTORY_START) })}
          </p>

          <ol className="m-0 mt-10 list-none p-0">
            {CHANGELOG.map((entry) => (
              <li
                key={`${entry.date}-${entry.title}`}
                className="grid gap-2 border-l border-[color:var(--mkt-border)] pb-10 pl-6 last:pb-0 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-6"
              >
                <div className="relative">
                  <span
                    className="absolute -left-[26px] top-1.5 h-2 w-2 rounded-full"
                    style={{ background: 'var(--mkt-brand)' }}
                    aria-hidden="true"
                  />
                  <time
                    dateTime={entry.date}
                    className="mkt-mono block text-[11.5px] text-[color:var(--mkt-faint)]"
                  >
                    {fmt(entry.date)}
                  </time>
                  <span className="mt-1.5 inline-block rounded-md border border-[color:var(--mkt-border)] px-2 py-0.5 text-[11px] text-[color:var(--mkt-muted)]">
                    {entry.tag}
                  </span>
                </div>
                <div>
                  <h2 className="m-0 text-[16.5px] font-semibold text-[color:var(--mkt-ink)]">
                    {entry.title}
                  </h2>
                  <p className="m-0 mt-2 text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                    {entry.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
