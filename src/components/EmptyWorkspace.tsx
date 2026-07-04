import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import KorvixOrb from './KorvixOrb';
import WebBuildMascot from '@/components/builder/WebBuildMascot';

/**
 * The Chat empty state. When `builder` is set (the normal Chat home), it reads
 * as a unified Korvix Builder home — same premium orb, but a "let's build
 * something" headline and a subtitle that says Korvix can chat, build websites,
 * draft apps, or create game features. Other workspaces keep the neutral copy.
 */
const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

export default function EmptyWorkspace({ builder = false }: { builder?: boolean }) {
  const { t, lang } = useLanguageStore();

  const headline = builder
    ? L(lang, 'Hey, let’s build something.', 'Haydi, bir şey inşa edelim.')
    : t('howCanIHelp');
  const subtitle = builder
    ? L(lang,
        'Choose a mode or just describe what you want. Korvix can chat, build websites, draft apps, or create game features.',
        'Bir mod seç ya da ne istediğini anlat. Korvix sohbet edebilir, web siteleri kurabilir, uygulama taslakları çıkarabilir veya oyun özellikleri oluşturabilir.')
    : t('sendAMessage');

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow behind the orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(59, 130, 246,0.05) 0%, transparent 60%)' }} />

      {/* Korvix mascot — the builder home uses the premium glassy-sphere orb
          (same as Web Build); other workspaces keep the classic core orb. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6 relative z-10"
      >
        {builder ? <WebBuildMascot state="idle" size={76} /> : <KorvixOrb size="lg" />}
      </motion.div>

      {/* Welcome Text */}
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-lg font-semibold tracking-tight mb-1.5 relative z-10 text-center px-4"
        style={{ color: '#E2E8F0' }}
      >
        {headline}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-[13px] relative z-10 text-center px-6 max-w-md leading-relaxed"
        style={{ color: 'rgba(203, 213, 225,0.4)' }}
      >
        {subtitle}
      </motion.p>
    </div>
  );
}
