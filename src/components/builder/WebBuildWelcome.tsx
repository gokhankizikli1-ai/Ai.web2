import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildMascot, { type MascotState } from '@/components/builder/WebBuildMascot';

/**
 * Web Build start-screen hero — a calm, premium, centered welcome (Korvix mark +
 * headline + subtitle). Shown only when there is no active build. The build
 * category chips and the composer live directly below it (near the input), so
 * this component is intentionally just the mascot + copy, not a dashboard.
 */
const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

export default function WebBuildWelcome({ mascotState = 'idle' }: { mascotState?: MascotState }) {
  const { lang } = useLanguageStore();
  return (
    <div className="flex flex-col items-center gap-4 px-4 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="shrink-0"
      >
        <WebBuildMascot state={mascotState} size={60} />
      </motion.div>
      <div className="max-w-md">
        <motion.h2
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.08 }}
          className="text-[24px] font-semibold tracking-tight text-white sm:text-[28px]"
        >
          {L(lang, 'Hey, let’s build something.', 'Haydi, bir şey inşa edelim.')}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.14 }}
          className="mt-2.5 text-[13.5px] leading-relaxed text-[#94A3B8]"
        >
          {L(lang,
            'Tell Korvix what you want to build — a website, app, landing page, or game feature. It plans the structure, writes the copy, generates the components, and prepares a preview.',
            'Korvix’e ne inşa etmek istediğini söyle — web sitesi, uygulama, açılış sayfası veya oyun özelliği. Yapıyı planlar, metinleri yazar, bileşenleri oluşturur ve bir önizleme hazırlar.')}
        </motion.p>
      </div>
    </div>
  );
}
