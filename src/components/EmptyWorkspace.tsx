import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import KorvixOrb from './KorvixOrb';
import WebBuildMascot from '@/components/builder/WebBuildMascot';

/**
 * The Chat empty state. When `builder` is set (the normal Chat home) it reads as
 * a unified Korvix Builder home: the premium glassy-sphere mascot beside a
 * "let's build something" headline + subtitle, laid out horizontally on desktop
 * and stacked on mobile. Other workspaces keep the classic centered core orb.
 */
const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

export default function EmptyWorkspace({ builder = false }: { builder?: boolean }) {
  const { t, lang } = useLanguageStore();

  // ── Builder home: compact horizontal hero (mascot left, text right). No
  // overflow-hidden / duplicate ambient glow — the mascot's own radial glow is
  // free to fade out smoothly (clipping it produced the rectangular artifact).
  if (builder) {
    return (
      <div className="flex w-full flex-col items-center gap-4 px-4 text-center sm:flex-row sm:justify-center sm:gap-5 sm:text-left">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0"
        >
          <WebBuildMascot state="idle" size={64} />
        </motion.div>
        <div className="max-w-md">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-[21px] sm:text-[24px] font-semibold tracking-tight text-white"
          >
            {L(lang, 'Hey, let’s build something.', 'Haydi, bir şey inşa edelim.')}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16, duration: 0.5 }}
            className="mt-2 text-[13px] leading-relaxed text-[#94A3B8]"
          >
            {L(lang,
              'Choose a mode or just describe what you want. Korvix can chat, build websites, draft apps, or create game features.',
              'Bir mod seç ya da ne istediğini anlat. Korvix sohbet edebilir, web siteleri kurabilir, uygulama taslakları çıkarabilir veya oyun özellikleri oluşturabilir.')}
          </motion.p>
        </div>
      </div>
    );
  }

  // ── Classic empty state (non-chat workspaces) — unchanged.
  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow behind the orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(59, 130, 246,0.05) 0%, transparent 60%)' }} />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6 relative z-10"
      >
        <KorvixOrb size="lg" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-lg font-semibold tracking-tight mb-1.5 relative z-10 text-center px-4"
        style={{ color: '#E2E8F0' }}
      >
        {t('howCanIHelp')}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-[13px] relative z-10 text-center px-6 max-w-md leading-relaxed"
        style={{ color: 'rgba(203, 213, 225,0.4)' }}
      >
        {t('sendAMessage')}
      </motion.p>
    </div>
  );
}
