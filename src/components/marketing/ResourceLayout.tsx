import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Languages } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Shared furniture for the public resource / trust pages (docs, tutorials,
 * changelog, help, security, regional privacy, legal).
 *
 * These pages are typographic, not promotional: a calm header, a readable
 * measure, and — where the long-form body is English-only — an honest,
 * LOCALIZED notice saying so, rather than silently mixing languages.
 */

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0 text-[12.5px] text-[color:var(--mkt-muted)]">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 opacity-50" />}
            {item.to ? (
              <Link to={item.to} className="hover:text-[color:var(--mkt-ink)]">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-[color:var(--mkt-ink)]">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ResourceHeader({
  eyebrow,
  title,
  lead,
  breadcrumb,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  breadcrumb?: { label: string; to?: string }[];
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-[color:var(--mkt-border)] bg-[color:var(--mkt-surface)]">
      <div className="mkt-wrap py-14 sm:py-16">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        {eyebrow && <span className="mkt-eyebrow">{eyebrow}</span>}
        <h1 className="mkt-h1 mt-3 text-[clamp(28px,4vw,44px)]">{title}</h1>
        {lead && <p className="mkt-lead max-w-[64ch]">{lead}</p>}
        {children}
      </div>
    </header>
  );
}

/**
 * Localized notice for pages whose long-form body ships in English only.
 * Deliberately quiet, and deliberately present — a reader should never have to
 * discover the language gap by scrolling into it.
 */
export function EnglishOnlyNotice() {
  const { lang, t } = useLanguageStore();
  if (lang === 'en') return null;
  return (
    <p className="mkt-chip mt-6 h-auto whitespace-normal py-1.5 text-left leading-relaxed">
      <Languages aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {t('mktEnglishOnly')}
    </p>
  );
}

/** Sticky in-page navigation for long resource pages. */
export function OnThisPage({
  label,
  items,
  basePath,
}: {
  label: string;
  items: { id: string; title: string }[];
  basePath: string;
}) {
  return (
    <nav aria-label={label} className="lg:sticky lg:top-28">
      <p className="mkt-mono mb-3 uppercase tracking-[0.09em] text-[color:var(--mkt-faint)]">{label}</p>
      <ul className="m-0 list-none space-y-1 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={`${basePath}#${item.id}`}
              className="block rounded-lg px-2.5 py-1.5 text-[13.5px] text-[color:var(--mkt-muted)] transition-colors hover:bg-[color:var(--mkt-section)] hover:text-[color:var(--mkt-ink)]"
            >
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Two-column resource body: sticky nav on the left, content on the right. */
export function ResourceBody({
  nav,
  children,
}: {
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mkt-wrap py-14">
      <div className={nav ? 'grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14' : ''}>
        {nav && <div className="hidden lg:block">{nav}</div>}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
