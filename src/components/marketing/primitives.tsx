import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useReveal } from '@/components/marketing/useReveal';
import { useLanguageStore } from '@/stores/languageStore';
import {
  GithubLogo, SlackLogo, VercelLogo, GmailLogo, GoogleCalendarLogo,
} from '@/components/connectors/BrandLogos';
import type { ConnectorId } from '@/lib/marketingNav';

/**
 * Small shared building blocks for the public pages.
 *
 * These are deliberately thin: the visual language lives in the marketing
 * stylesheet, and each section composes it. Keeping the heading/reveal/mark
 * primitives here is what stops ten sections from re-implementing the same
 * eyebrow markup, the same observer, and the same brand-mark switch.
 */

/** Wraps children in a one-shot entrance reveal (see `useReveal`). */
export function Reveal({
  children,
  delay,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useReveal<HTMLDivElement>({ delay });
  return (
    <div ref={ref} className={`mkt-reveal ${className}`}>
      {children}
    </div>
  );
}

/** Eyebrow + heading + optional lead, with consistent editorial rhythm. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  className = '',
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={`${align === 'center' ? 'mx-auto text-center' : ''} ${className}`}>
      {eyebrow && <span className="mkt-eyebrow">{eyebrow}</span>}
      <h2 className={`mkt-h2 ${align === 'center' ? 'mx-auto' : ''}`}>{title}</h2>
      {lead && <p className={`mkt-sub ${align === 'center' ? 'mx-auto' : ''}`}>{lead}</p>}
    </div>
  );
}

/** The five real connector marks, addressed by id. Decorative by default. */
export function ConnectorMark({ id, size = 18 }: { id: ConnectorId; size?: number }) {
  switch (id) {
    case 'github': return <GithubLogo size={size} />;
    case 'slack': return <SlackLogo size={size} />;
    case 'vercel': return <VercelLogo size={size} />;
    case 'gmail': return <GmailLogo size={size} />;
    case 'calendar': return <GoogleCalendarLogo size={size} />;
    default: return null;
  }
}

/** A quiet "read more" link with the shared arrow treatment. */
export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mkt-textlink">
      {children}
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}

/**
 * The illustrative marker used on every composed product visual. Product
 * visuals on this site are marketing compositions of REAL Korvix surfaces and
 * capabilities — this label keeps that explicit instead of implying a
 * screenshot of live data.
 */
export function IllustrativeTag({
  className = '',
  tone = 'deep',
}: {
  className?: string;
  /** `deep` sits on a dark product panel; `light` on a porcelain surface. */
  tone?: 'deep' | 'light';
}) {
  const { t } = useLanguageStore();
  const toneCls = tone === 'light'
    ? 'border-[color:var(--mkt-border-strong)] text-[color:var(--mkt-faint)]'
    : 'border-white/15 text-[color:var(--mkt-deep-muted)]';
  return (
    <span
      className={`mkt-mono rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.08em] ${toneCls} ${className}`}
    >
      {t('mktIllustrative')}
    </span>
  );
}
