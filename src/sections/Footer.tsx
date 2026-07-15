import { Link } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { getLandingHref, type NavTarget } from '@/lib/landingNav';
import BrandLogo from '@/components/BrandLogo';

/**
 * Shared marketing footer — v8 "Ink" dark style.
 *
 * Routing rule (see src/lib/landingNav.ts): for a logged-OUT visitor
 * every product / resource / company link resolves to /signup — no
 * footer link opens the app. Legal links (Privacy, Terms, Security)
 * stay public. Logged-IN users get the real in-app destinations.
 */

type FooterItem = { label: string; target?: NavTarget };

const productLinks: FooterItem[] = [
  { label: 'Workspace', target: 'workspace' },
  { label: 'Startup Radar', target: 'startup' },
  { label: 'Ecommerce Builder', target: 'ecommerce' },
  { label: 'Game Builder', target: 'game' },
  { label: 'Agents', target: 'agents' },
];
const resourceLinks: FooterItem[] = [
  { label: 'Features', target: 'features' },
  { label: 'Pricing', target: 'pricing' },
  { label: 'Use cases', target: 'use-cases' },
  { label: 'Changelog' }, // no page yet → plain label
];
const companyLinks: FooterItem[] = [
  { label: 'About', target: 'about' },
  { label: 'Contact via Chat', target: 'contact' },
];
const legalLinks: FooterItem[] = [
  { label: 'Privacy', target: 'privacy' },
  { label: 'Terms', target: 'terms' },
  { label: 'Security' }, // no page yet → plain label (still public)
];

function FooterColumn({ title, links, isAuthed }: { title: string; links: FooterItem[]; isAuthed: boolean }) {
  return (
    <div>
      <h5 className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6C7A88]">{title}</h5>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            {l.target ? (
              <Link to={getLandingHref(l.target, isAuthed)} className="text-[13px] text-[#93A3B5] transition-colors hover:text-[#F5F7FA]">
                {l.label}
              </Link>
            ) : (
              <span className="text-[13px] text-[#5A6774]">{l.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const { isAuthenticated } = useAuthStore();

  return (
    <footer className="border-t border-[#28323D] bg-[#0A0D11] pt-14 pb-6">
      <div className="mx-auto max-w-6xl px-7">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-[1.7fr_1fr_1fr_1fr_1fr] md:gap-8">
          <div className="col-span-2 md:col-span-1">
            <BrandLogo tone="onDark" />
            <p className="mt-3.5 max-w-[30ch] text-[12.5px] leading-relaxed text-[#93A3B5]">
              One AI workspace for researching markets, validating ideas, and turning evidence into work.
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} isAuthed={isAuthenticated} />
          <FooterColumn title="Resources" links={resourceLinks} isAuthed={isAuthenticated} />
          <FooterColumn title="Company" links={companyLinks} isAuthed={isAuthenticated} />
          <FooterColumn title="Legal" links={legalLinks} isAuthed={isAuthenticated} />
        </div>

        {/* Phase 14I.1 — the X / LinkedIn / GitHub icons previously pointed at
            dead `href="#"` placeholders (they only jumped to the top of the
            page). No real KorvixAI social destinations exist in the repo/config,
            and inventing handles is not allowed, so the social row is removed
            rather than shipping dead links. Re-add here with real HTTPS targets
            (target="_blank" rel="noopener noreferrer") once accounts exist. */}
        <div className="mt-9 flex items-center border-t border-white/[0.06] pt-6">
          <span className="text-[12px] text-[#4C5967]">
            &copy; {new Date().getFullYear()} KorvixAI. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
}
