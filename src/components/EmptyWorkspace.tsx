import { motion } from 'framer-motion';
import { useLanguageStore } from '@/stores/languageStore';
import KorvixOrb from './KorvixOrb';
import type { WorkspaceTab } from '@/types';

interface EmptyWorkspaceProps {
  activeMode: WorkspaceTab;
  compact?: boolean;
  onQuickAction?: (msg: string) => void;
}

export default function EmptyWorkspace({ activeMode }: EmptyWorkspaceProps) {
  const { t } = useLanguageStore();

  const titles: Record<string, string> = {
    chat: t('howCanIHelp'),
    coding: t('codeAssistant'),
    research: t('deepResearch'),
    trading: t('tradingIntel'),
    business: t('business'),
    startup: t('startup'),
    agents: t('openAgents'),
    study: t('study'),
    creative: t('creative'),
  };

  const subtitles: Record<string, string> = {
    chat: t('sendAMessage'),
    coding: 'Write, review, and ship code with AI assistance.',
    research: 'Deep research across academic and web sources.',
    trading: 'Real-time signals, sentiment & market analysis.',
    business: 'Goal-driven workspace for your business.',
    startup: 'Validate ideas, build MVPs, find product-market fit.',
    agents: 'Deploy specialized AI agents for complex tasks.',
    study: 'Learning-focused research and summaries.',
    creative: 'Generate content, designs, and creative ideas.',
  };

  const title = titles[activeMode] || titles.chat;
  const subtitle = subtitles[activeMode] || subtitles.chat;

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-hidden px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center max-w-md"
      >
        {/* Korvix AI Core */}
        <div className="mb-7">
          <KorvixOrb size="lg" />
        </div>

        {/* Welcome Title */}
        <h1 className="text-[22px] sm:text-[26px] font-semibold text-white tracking-tight mb-2">
          {title}
        </h1>

        {/* Subtitle */}
        <p className="text-[13px] text-slate-500 max-w-sm leading-relaxed">
          {subtitle}
        </p>
      </motion.div>
    </div>
  );
}
