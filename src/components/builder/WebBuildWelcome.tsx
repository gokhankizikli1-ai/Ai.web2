import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Web Build start screen — a calm, premium, centered welcome (in the spirit of
 * a modern website-builder start screen, with Korvix's own identity). Shown only
 * when there is no active build content. A gently breathing Korvix mark, a
 * friendly headline + subtitle, and a few high-quality example prompts that
 * kick off a real (persistent) Web Build session.
 */
const ACCENT = '#60A5FA';
const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

const EXAMPLES: { en: string; tr: string }[] = [
  { en: 'Build a site for a landscape architect', tr: 'Peyzaj mimarı için site yap' },
  { en: 'A landing page for my AI support chatbot', tr: 'AI müşteri destek chatbotu için site yap' },
  { en: 'A website for a furniture maker', tr: 'Mobilyacı için web sitesi yap' },
  { en: 'A site for a car dealership', tr: 'Araba satıcısı için site kur' },
  { en: 'A website for a fitness coach', tr: 'Fitness koçluğu için site yap' },
];

/** The Korvix mark — a gradient tile with a soft breathing pulse + a slow blink. */
function KorvixMark() {
  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-3xl"
        style={{ background: `radial-gradient(circle, ${ACCENT}55, transparent 65%)`, filter: 'blur(26px)' }}
        animate={{ opacity: [0.4, 0.75, 0.4], scale: [0.92, 1.08, 0.92] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-500/30 to-cyan-400/15 shadow-lg shadow-black/40"
        animate={{ y: [0, -4, 0], scale: [1, 1.03, 1] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles className="h-7 w-7" style={{ color: ACCENT }} />
        {/* subtle blink: a thin line that briefly closes like an eye */}
        <motion.span
          aria-hidden
          className="absolute h-[2px] w-6 rounded-full bg-white/70"
          animate={{ scaleY: [0, 0, 1, 0], opacity: [0, 0, 0.8, 0] }}
          transition={{ duration: 5.5, repeat: Infinity, times: [0, 0.82, 0.9, 1], ease: 'easeInOut' }}
        />
      </motion.div>
    </div>
  );
}

export default function WebBuildWelcome({ onExample }: { onExample: (idea: string) => void }) {
  const { lang } = useLanguageStore();
  return (
    <div className="flex flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <KorvixMark />
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
