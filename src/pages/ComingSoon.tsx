import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';

interface ComingSoonProps {
  title: string;
  description?: string;
  pageType?: 'blog' | 'careers' | 'contact' | 'pricing' | 'legal';
}

/**
 * Placeholder surface for the two legacy public paths (`/blog`, `/careers`).
 * Nothing links to them; they stay registered so an old external link resolves.
 *
 * Two things changed here:
 *   • It used to render the AUTHENTICATED app navigation (Chat / Web Build /
 *     Labs), which advertised app-only surfaces to logged-out visitors on a
 *     public route. It now uses the public marketing shell like every other
 *     public page.
 *   • It used to print an invented "ETA" per page type ("Q2 2026", "Hiring
 *     soon") that nothing backs — and that quietly went stale. Removed; the copy
 *     now points at the real destinations that do exist.
 */
export default function ComingSoon({ title, description, pageType = 'blog' }: ComingSoonProps) {
  const { t } = useLanguageStore();

  const messages: Record<string, string> = {
    blog: 'There is no blog yet. Product updates are published in the changelog, and the documentation covers how each part of Korvix works.',
    careers: 'There are no open roles listed at the moment.',
    contact: 'There is no staffed support desk yet. The Help Center covers the common questions.',
    pricing: 'Plans and the current pricing state are on the pricing page.',
    legal: 'The privacy policy, terms, cookie policy and acceptable use policy are all published.',
  };

  return (
    <MarketingPage title={title}>
      <ResourceHeader
        title={title}
        lead={description || messages[pageType] || messages.blog}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: title }]}
      />
      <ResourceBody>
        <div className="flex flex-wrap gap-5">
          <Link to="/changelog" className="mkt-textlink">
            {t('navChangelog')}
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link to="/docs" className="mkt-textlink">
            {t('navDocs')}
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link to="/help" className="mkt-textlink">
            {t('navHelp')}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
