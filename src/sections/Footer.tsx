import { Link } from 'react-router';
import { useLanguageStore } from '@/stores/languageStore';
import BrandLogo from '@/components/BrandLogo';

/**
 * Shared marketing footer — v8 "Ink" dark style.
 *
 * Phase 14I.2 — the footer now advertises ONLY honest, public-facing
 * destinations. The previous "Product" and "Resources" columns linked to
 * owner-only / authenticated-only surfaces (Workspace, Startup Radar,
 * Ecommerce Builder, Game Builder, Agents — several gated by OwnerRoute) and to
 * pages that did not exist (Changelog, Security). Advertising those in the
 * public footer either leaked internal product architecture or produced links
 * that just funneled a logged-out visitor to /signup.
 *
 * Every link below points DIRECTLY to a real, registered PUBLIC route
 * (see src/App.tsx). No auth-conditional routing is needed anymore because
 * nothing in the footer is an app surface. All labels are resolved through the
 * centralized `t()` locale system (en / tr / de) — no hardcoded English.
 */

type FooterLink = { labelKey: string; to: string };

const companyLinks: FooterLink[] = [
  // About is a real public marketing route (/about). Contact is intentionally
  // omitted: the repository exposes no verified public contact channel (no
  // support email/form/address; the in-app assistant is an AI, not a support
  // desk), and inventing one is not allowed.
  { labelKey: 'footerAbout', to: '/about' },
];

const legalLinks: FooterLink[] = [
  { labelKey: 'legalNavPrivacy', to: '/privacy' },
  { labelKey: 'legalNavTerms', to: '/terms' },
  { labelKey: 'legalNavCookies', to: '/cookies' },
  { labelKey: 'legalNavKvkk', to: '/kvkk' },
  { labelKey: 'legalNavAup', to: '/acceptable-use' },
];

function FooterColumn({
  title,
  links,
  t,
}: {
  title: string;
  links: FooterLink[];
  t: (key: string) => string;
}) {
  return (
    <div>
      <h5 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6C7A88]">
        {title}
      </h5>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.labelKey}>
            <Link
              to={l.to}
              className="text-[13px] text-[#93A3B5] transition-colors hover:text-[#F5F7FA]"
            >
              {t(l.labelKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const { t } = useLanguageStore();

  return (
    <footer className="border-t border-[#28323D] bg-[#0A0D11] pt-14 pb-6">
      <div className="mx-auto max-w-6xl px-7">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[2fr_1fr_1fr] md:gap-8">
          <div className="col-span-2 md:col-span-1">
            <BrandLogo tone="onDark" />
            <p className="mt-3.5 max-w-[30ch] text-[12.5px] leading-relaxed text-[#93A3B5]">
              {t('footerTagline')}
            </p>
          </div>
          <FooterColumn title={t('footerCompany')} links={companyLinks} t={t} />
          <FooterColumn title={t('footerLegal')} links={legalLinks} t={t} />
        </div>

        {/* Phase 14I.1 — the X / LinkedIn / GitHub icons previously pointed at
            dead `href="#"` placeholders (they only jumped to the top of the
            page). No real KorvixAI social destinations exist in the repo/config,
            and inventing handles is not allowed, so the social row is removed
            rather than shipping dead links. Re-add here with real HTTPS targets
            (target="_blank" rel="noopener noreferrer") once accounts exist. */}
        <div className="mt-9 flex items-center border-t border-white/[0.06] pt-6">
          <span className="text-[12px] text-[#4C5967]">
            &copy; {new Date().getFullYear()} KorvixAI. {t('footerRights')}
          </span>
        </div>
      </div>
    </footer>
  );
}
