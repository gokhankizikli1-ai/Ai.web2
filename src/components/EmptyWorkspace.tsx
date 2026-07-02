import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import KorvixOrb from './KorvixOrb';

export default function EmptyWorkspace() {
  const { t } = useLanguageStore();

  return (
    <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow behind the orb */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(139, 92, 246,0.05) 0%, transparent 60%)' }} />

      {/* AI Core Orb */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mb-6 relative z-10"
      >
        <KorvixOrb size="lg" />
      </motion.div>

      {/* Welcome Text */}
      <motion.h1
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="text-lg font-semibold tracking-tight mb-1.5 relative z-10"
        style={{ color: '#E2E8F0' }}
      >
        {t('howCanIHelp')}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        className="text-[13px] relative z-10"
        style={{ color: 'rgba(182, 187, 198,0.35)' }}
      >
        {t('sendAMessage')}
      </motion.p>
    </div>
  );
}
