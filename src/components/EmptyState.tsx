import { motion } from 'framer-motion';
import { useNavigate } from 'react-router';
import {
  Lightbulb, Search, FileText,
  Crown, BarChart3, Sparkles, ArrowRight,
  ShoppingBag, Camera,
  Brain, BookOpen, CheckCircle,
  Code2, Bug, GitPullRequest, HelpCircle,
  Palette, Video, PenTool, Layout,
  BookMarked, ClipboardList, CreditCard,
  Rocket, type LucideIcon,
} from 'lucide-react';

type WorkspaceType = 'startup' | 'ecommerce' | 'research' | 'coding' | 'creative' | 'study';

interface Action {
  label: string;
  icon: LucideIcon;
  path: string;
}

const CONFIG: Record<WorkspaceType, { headline: string; subline: string; gradient: string; actions: Action[] }> = {
  startup: {
    headline: 'Validate your next business idea',
    subline: 'Use AI-powered tools to validate, build, and launch your startup.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Validate Idea', icon: Lightbulb, path: '/startup' },
      { label: 'Generate SaaS Idea', icon: Sparkles, path: '/startup' },
      { label: 'Analyze Competitor', icon: Search, path: '/startup' },
      { label: 'Build Pitch Deck', icon: Crown, path: '/startup' },
    ],
  },
  ecommerce: {
    headline: 'Find, validate, and launch products faster',
    subline: 'AI-powered tools for your Shopify and ecommerce business.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Find Winning Product', icon: Search, path: '/ecommerce' },
      { label: 'Generate Shopify Page', icon: ShoppingBag, path: '/ecommerce' },
      { label: 'Create TikTok Hooks', icon: Camera, path: '/tools/viral-content' },
      { label: 'Analyze Competitor Store', icon: BarChart3, path: '/ecommerce' },
    ],
  },
  research: {
    headline: 'Research, compare, verify, and summarize',
    subline: 'Multi-source deep research with AI-powered analysis.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Deep Research', icon: Brain, path: '/chat' },
      { label: 'Compare Sources', icon: BookOpen, path: '/chat' },
      { label: 'Summarize Topic', icon: FileText, path: '/chat' },
      { label: 'Verify Claim', icon: CheckCircle, path: '/chat' },
    ],
  },
  coding: {
    headline: 'Write, debug, review, and ship code',
    subline: 'AI-powered coding assistant for every stage of development.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Generate Code', icon: Code2, path: '/chat' },
      { label: 'Debug Issue', icon: Bug, path: '/chat' },
      { label: 'Review PR', icon: GitPullRequest, path: '/chat' },
      { label: 'Explain Code', icon: HelpCircle, path: '/chat' },
    ],
  },
  creative: {
    headline: 'Create content, brands, and visuals with AI',
    subline: 'Your AI-powered creative studio for content and branding.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Generate Image Prompt', icon: Palette, path: '/tools/brand-builder' },
      { label: 'Write Video Script', icon: Video, path: '/tools/viral-content' },
      { label: 'Create Brand Kit', icon: PenTool, path: '/tools/brand-builder' },
      { label: 'Design Landing Page', icon: Layout, path: '/tools/website-builder' },
    ],
  },
  study: {
    headline: 'Learn faster with AI-powered study tools',
    subline: 'Summarize, quiz yourself, and master any topic.',
    gradient: 'from-[#7EA6BF]/[0.03] to-[#9CBBD1]/[0.02]',
    actions: [
      { label: 'Summarize Text', icon: FileText, path: '/chat' },
      { label: 'Create Flashcards', icon: CreditCard, path: '/chat' },
      { label: 'Explain Concept', icon: BookMarked, path: '/chat' },
      { label: 'Generate Quiz', icon: ClipboardList, path: '/chat' },
    ],
  },
};

interface EmptyStateProps {
  type: WorkspaceType;
}

export default function EmptyState({ type }: EmptyStateProps) {
  const navigate = useNavigate();
  const config = CONFIG[type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' as const }}
      className={`flex flex-col items-center justify-center min-h-[60vh] px-6 py-12 rounded-2xl bg-gradient-to-b ${config.gradient} border border-white/[0.03]`}
    >
      {/* Icon */}
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="mb-6"
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.02] border border-white/[0.04]">
          <Rocket className="w-7 h-7 text-[#A9B7C6]" />
        </div>
      </motion.div>

      {/* Text */}
      <h2 className="text-xl font-semibold text-white text-center mb-2">{config.headline}</h2>
      <p className="text-[13px] text-[#7F8FA3] text-center max-w-md mb-8">{config.subline}</p>

      {/* Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-xl">
        {config.actions.map((action, i) => (
          <motion.button
            key={action.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.08 }}
            whileHover={{ y: -2, borderColor: 'rgba(255,255,255,0.08)' }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate(action.path)}
            className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.02] transition-colors text-center"
          >
            <action.icon className="w-5 h-5 text-[#A9B7C6]" />
            <span className="text-[12px] font-medium text-slate-300">{action.label}</span>
            <ArrowRight className="w-3 h-3 text-[#7F8FA3]" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
