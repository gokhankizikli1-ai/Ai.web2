import { Link } from 'react-router';
import { useLanguageStore } from '@/stores/languageStore';
import BrandLogo from '@/components/BrandLogo';
import { FOOTER_COLUMNS } from '@/lib/marketingNav';

/**
 * Shared marketing footer — four real columns (Product / Resources / Company /
 * Legal & trust) rendered from the single public-IA source of truth in
 * `@/lib/marketingNav`.
 *
 * Honesty rules kept from the previous footer and enforced by
 * `marketingNav.test.ts`:
 *   • every destination is a REGISTERED PUBLIC route with real content —
 *     no `href="#"`, no placeholder, no authenticated-only surface;
 *   • no invented social accounts, no support email, no company address,
 *     no "Status" page (there is no real status source in this repository);
 *   • labels resolve through the centralized `t()` system (en / tr / de).
 *
 * "Contact" and "Careers" are still deliberately absent: the repository exposes
 * no verified contact channel and no open roles, and inventing either is not
 * allowed. The Help Center under Resources is the honest self-service answer.
 */
export default function Footer() {
  const { t } = useLanguageStore();

  return (
    <footer className="border-t border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep)] pb-8 pt-16 text-[color:var(--mkt-deep-body)]">
      <div className="mkt-wrap">
        <div className="grid gap-10 md:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(120px,1fr))] md:gap-8">
          <div className="max-w-[34ch]">
            <BrandLogo tone="onDark" wordSize={17} markSize={28} />
            <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
              {t('footerTagline')}
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.titleKey} aria-label={t(col.titleKey)}>
              <h2 className="mb-3.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[color:var(--mkt-deep-muted)]">
                {t(col.titleKey)}
              </h2>
              <ul className="m-0 list-none space-y-2.5 p-0">
                {col.items.map((item) => (
                  <li key={`${col.titleKey}-${item.to}-${item.labelKey}`}>
                    <Link
                      to={item.to}
                      className="text-[13px] text-[color:var(--mkt-deep-body)] transition-colors hover:text-white"
                    >
                      {t(item.labelKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-6">
          <span className="text-[12px] text-[color:var(--mkt-deep-muted)]">
            &copy; {new Date().getFullYear()} KorvixAI. {t('footerRights')}
          </span>
          <span className="text-[12px] text-[color:var(--mkt-deep-muted)]">
            {t('footerEarlyAccess')}
          </span>
        </div>
      </div>
    </footer>
  );
}
