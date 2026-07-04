import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildMascot, { type MascotState } from '@/components/builder/WebBuildMascot';

/**
 * Web Build start screen — a calm, premium, centered welcome (in the spirit of
 * a modern website-builder start screen, with Korvix's own identity). Shown only
 * when there is no active build content. A gently breathing Korvix mark, a
 * friendly headline + subtitle, and a few high-quality example prompts that
 * kick off a real (persistent) Web Build session.
 */
const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

const EXAMPLES: { en: string; tr: string }[] = [
  { en: 'Build a site for a landscape architect', tr: 'Peyzaj mimarı için site yap' },
  { en: 'A landing page for my AI support chatbot', tr: 'AI müşteri destek chatbotu için site yap' },
  { en: 'A website for a furniture maker', tr: 'Mobilyacı için web sitesi yap' },
  { en: 'A site for a car dealership', tr: 'Araba satıcısı için site kur' },
  { en: 'A website for a fitness coach', tr: 'Fitness koçluğu için site yap' },
];

export default function WebBuildWelcome({
  onExample, mascotState = 'idle',
}: {
  onExample: (idea: string) => void;
  mascotState?: MascotState;
}) {
  const { lang } = useLanguageStore();
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <WebBuildMascot state={mascotState} />
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}
        className="mt-7 text-[24px] font-semibold tracking-tight text-white sm:text-[28px]"
      >
        {L(lang, 'Hey, let’s build something.', 'Haydi, bir şey inşa edelim.')}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.14 }}
        className="mt-3 max-w-md text-[13.5px] leading-relaxed text-[#94A3B8]"
      >
        {L(lang,
          'Tell Korvix what you want to build. It will plan the site, write the copy, create the components, and prepare a preview.',
          'Korvix’e ne inşa etmek istediğini söyle. Sayfayı planlar, metinleri yazar, bileşenleri oluşturur ve bir önizleme hazırlar.')}
      </motion.p>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.22 }}
        className="mt-8 flex max-w-lg flex-wrap items-center justify-center gap-2"
      >
        {EXAMPLES.map((ex) => {
          const idea = L(lang, ex.en, ex.tr);
          return (
            <button
              key={ex.en}
              onClick={() => onExample(idea)}
              className="rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-2 text-[12.5px] text-[#CBD5E1] transition-colors hover:border-white/[0.16] hover:bg-white/[0.05]"
            >
              {idea}
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}
