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

        <div className="mt-9 flex items-center justify-between border-t border-white/[0.06] pt-6">
          <span className="text-[12px] text-[#4C5967]">
            &copy; {new Date().getFullYear()} KorvixAI. All rights reserved.
          </span>
          <div className="flex items-center gap-3.5">
            <a href="#" aria-label="X" className="text-[#5A6774] transition-colors hover:text-[#D7DEE8]">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 16M20 4L4 20" /></svg>
            </a>
            <a href="#" aria-label="LinkedIn" className="text-[#5A6774] transition-colors hover:text-[#D7DEE8]">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4" /></svg>
            </a>
            <a href="#" aria-label="GitHub" className="text-[#5A6774] transition-colors hover:text-[#D7DEE8]">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6.3 3.6 5.3 3.9 5.3 3.9a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 3.9 10.3c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V22" /></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
