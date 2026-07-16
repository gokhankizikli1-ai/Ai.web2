import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { useLanguageStore } from '@/stores/languageStore';
import { LEGAL_DOCS, type LegalDocId } from './legalContent';

/**
 * Shared public legal / policy page (Phase 14I.2).
 *
 * One data-driven shell renders every policy document (Privacy, Terms, Cookie,
 * KVKK, Acceptable Use) from `legalContent.ts`, so we don't copy-paste a layout
 * per page. It reuses the existing public/marketing chrome — the shared
 * `Navbar` and `Footer` and the same dark surface + prose treatment as
 * `AboutPage` — so these routes look native to the marketing site and never
 * pull in authenticated app chrome (no BottomNav; the route is listed in
 * App.tsx's PUBLIC_ROUTE_PREFIXES).
 *
 * All fixed copy is resolved through the centralized `t()` locale system
 * (en / tr / de). There is no inline locale branching here.
 */
export default function LegalPage({ doc: docId }: { doc: LegalDocId }) {
  const { t } = useLanguageStore();
  const doc = LEGAL_DOCS[docId];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar surface="dark" />
      <main className="pt-28 pb-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          {/* Breadcrumb back to the public landing */}
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('legalBackHome')}
          </Link>

          <h1 className="mb-3 text-3xl font-bold text-white sm:text-4xl">
            {t(doc.titleKey)}
          </h1>
          <p className="mb-8 text-[13px] text-slate-500">{t('legalUpdated')}</p>

          <p className="mb-12 max-w-[68ch] leading-relaxed text-slate-300">
            {t(doc.introKey)}
          </p>

          <div className="space-y-10">
            {doc.sections.map((section) => (
              <section key={section.heading} aria-labelledby={section.heading}>
                <h2
                  id={section.heading}
                  className="mb-3 text-xl font-semibold text-white"
                >
                  {t(section.heading)}
                </h2>
                {section.body?.map((key) => (
                  <p
                    key={key}
                    className="mb-3 max-w-[68ch] text-[15px] leading-relaxed text-slate-400 last:mb-0"
                  >
                    {t(key)}
                  </p>
                ))}
                {section.list && (
                  <ul className="mt-2 max-w-[68ch] list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-slate-400">
                    {section.list.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
