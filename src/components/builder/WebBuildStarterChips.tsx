import {
  Globe, Smartphone, FileText, Boxes, ShoppingBag, Briefcase, Store,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Web Build start-screen category chips — a Kimi-style row of build modes that
 * sits directly above the composer. Clicking a chip does NOT start a build; it
 * seeds the composer with a flexible starter so the user can describe any kind
 * of product (website, app, landing page, SaaS, store, portfolio, local
 * business) and keep editing before sending. Empty state only.
 */
type Cat = {
  icon: typeof Globe;
  en: string; tr: string;
  starterEn: string; starterTr: string;
};

const CATEGORIES: Cat[] = [
  { icon: Globe, en: 'Website Build', tr: 'Web Sitesi', starterEn: 'Build a website for ', starterTr: 'Şunun için web sitesi yap: ' },
  { icon: Smartphone, en: 'App Build', tr: 'Uygulama', starterEn: 'Build an app for ', starterTr: 'Şunun için uygulama yap: ' },
  { icon: FileText, en: 'Landing Page', tr: 'Açılış Sayfası', starterEn: 'Build a landing page for ', starterTr: 'Şunun için açılış sayfası yap: ' },
  { icon: Boxes, en: 'SaaS', tr: 'SaaS', starterEn: 'Build a SaaS product for ', starterTr: 'Şunun için SaaS ürünü yap: ' },
  { icon: ShoppingBag, en: 'Ecommerce', tr: 'E-Ticaret', starterEn: 'Build an online store for ', starterTr: 'Şunun için online mağaza yap: ' },
  { icon: Briefcase, en: 'Portfolio', tr: 'Portfolyo', starterEn: 'Build a portfolio site for ', starterTr: 'Şunun için portfolyo sitesi yap: ' },
  { icon: Store, en: 'Local Business', tr: 'Yerel İşletme', starterEn: 'Build a website for a local ', starterTr: 'Yerel işletme için web sitesi yap: ' },
];

export default function WebBuildStarterChips({ onPick }: { onPick: (starter: string) => void }) {
  const { lang } = useLanguageStore();
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-center gap-1.5">
      {CATEGORIES.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.en}
            type="button"
            onClick={() => onPick(lang === 'tr' ? c.starterTr : c.starterEn)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-[12px] text-[#CBD5E1] transition-colors hover:border-[#3B82F6]/25 hover:bg-[#3B82F6]/[0.06] hover:text-white"
          >
            <Icon className="h-3.5 w-3.5 text-[#60A5FA]" />
            {lang === 'tr' ? c.tr : c.en}
          </button>
        );
      })}
    </div>
  );
}
