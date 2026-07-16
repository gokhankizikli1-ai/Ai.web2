import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import KorvixOrb from './KorvixOrb';
import WebBuildMascot from '@/components/builder/WebBuildMascot';

/**
 * The Chat empty state. When `builder` is set (the normal Chat home) it reads as
 * the "Korvix Creation Home": a subtle Korvix mark, a personalized
 * creation-focused question, and one calm supporting line — a centered,
 * restrained composition above the real composer (rendered by ChatView). Other
 * workspaces keep the classic centered core orb.
 *
 * All fixed copy resolves through the centralized `t()` locale authority; the
 * verified first name is interpolated as a `{name}` param (never baked into a
 * translation string), and a name-free key provides natural grammar in each
 * language when no name is available. There is no local en/tr/de helper here.
 */
export default function EmptyWorkspace({ builder = false }: { builder?: boolean }) {
  const { t } = useLanguageStore();
  const firstName = useAuthStore(
    (s) => (s.user?.name || s.user?.email?.split('@')[0] || '').trim().split(/\s+/)[0],
  );

  // ── Creation Home: centered mark + personalized question + supporting line.
  // No overflow-hidden / duplicate ambient glow — the mascot's own radial glow
  // is free to fade out smoothly (clipping it produced a rectangular artifact).
  if (builder) {
    const question = firstName
      ? t('homeCreateQuestionNamed', { name: firstName })
      : t('homeCreateQuestion');
    return (
      <div className="flex w-full flex-col items-center gap-3.5 px-4 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="shrink-0"
          aria-hidden="true"
        >
          <WebBuildMascot state="idle" size={54} />
        </motion.div>
        <div className="max-w-xl">
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-[23px] font-semibold tracking-tight text-white [text-wrap:balance] break-words sm:text-[30px]"
          >
            {question}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.5 }}
            className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-relaxed text-[#94A3B8] [text-wrap:balance] sm:text-[14px]"
          >
            {t('homeCreateSubtitle')}
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
