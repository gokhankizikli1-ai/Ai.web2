import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Lightbulb, Globe, ShoppingBag, FileText,
  Wand2, Bot, X, Rocket,
} from 'lucide-react';

interface QuickAction {
  label: string;
  icon: typeof Sparkles;
  path: string;
  color: string;
}

const ACTIONS_BY_PATH: Record<string, QuickAction[]> = {
  '/startup': [
    { label: 'Validate Idea', icon: Lightbulb, path: '/startup', color: 'text-[#3B82F6]' },
    { label: 'Analyze Competitor', icon: Globe, path: '/startup', color: 'text-[#3B82F6]' },
    { label: 'Build Pitch Deck', icon: FileText, path: '/startup', color: 'text-[#3B82F6]' },
  ],
  '/ecommerce': [
    { label: 'Find Product', icon: ShoppingBag, path: '/ecommerce', color: 'text-[#3B82F6]' },
    { label: 'Generate Page', icon: FileText, path: '/ecommerce', color: 'text-[#3B82F6]' },
    { label: 'TikTok Hooks', icon: Sparkles, path: '/tools/viral-content', color: 'text-[#3B82F6]' },
  ],
  '/agents': [
    { label: 'Create Agent', icon: Bot, path: '/agents/builder', color: 'text-[#3B82F6]' },
    { label: 'Browse Market', icon: ShoppingBag, path: '/agents', color: 'text-[#3B82F6]' },
  ],
  '/chat': [
    { label: 'Deep Research', icon: Wand2, path: '/chat', color: 'text-[#3B82F6]' },
    { label: 'New Project', icon: Rocket, path: '/workspace', color: 'text-[#3B82F6]' },
  ],
};

const DEFAULT_ACTIONS: QuickAction[] = [
  { label: 'New Chat', icon: Sparkles, path: '/chat', color: 'text-[#3B82F6]' },
  { label: 'Startup Hub', icon: Rocket, path: '/startup', color: 'text-[#3B82F6]' },
  { label: 'Ecommerce', icon: ShoppingBag, path: '/ecommerce', color: 'text-[#3B82F6]' },
  { label: 'Build Agent', icon: Bot, path: '/agents/builder', color: 'text-[#3B82F6]' },
];

export default function FloatingOrb() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const actions = ACTIONS_BY_PATH[location.pathname] || DEFAULT_ACTIONS;

  return (
    <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="absolute bottom-14 right-0 w-56 rounded-2xl border border-white/[0.06] bg-[#111111]/95 backdrop-blur-xl shadow-2xl overflow-hidden mb-2"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.03]">
              <span className="text-[11px] font-semibold text-white uppercase tracking-wider">Quick Actions</span>
              <button onClick={() => setIsOpen(false)} className="text-[#94A3B8] hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Actions */}
            <div className="p-2 space-y-0.5">
              {actions.map((action) => (
                <motion.button
                  key={action.label}
                  whileHover={{ x: 2 }}
                  onClick={() => {
                    navigate(action.path);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-left hover:bg-white/[0.03] transition-colors group"
                >
                  <action.icon className={`w-4 h-4 ${action.color} group-hover:scale-110 transition-transform`} />
                  <span className="text-[12px] text-slate-300 group-hover:text-white transition-colors">{action.label}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Orb */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-12 w-12 items-center justify-center rounded-full shadow-lg"
        style={{
          background: isOpen
            ? 'linear-gradient(135deg, rgba(143, 180, 204,0.85), rgba(59, 130, 246,0.95))'
            : 'linear-gradient(135deg, rgba(59, 130, 246,0.8), rgba(156, 187, 209,0.8))',
          boxShadow: isOpen
            ? '0 4px 24px rgba(59, 130, 246,0.3)'
            : '0 4px 24px rgba(59, 130, 246,0.2)',
        }}
      >
        <motion.div
          animate={!isOpen ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Sparkles className="w-5 h-5 text-white" />
        </motion.div>

        {/* Pulse ring */}
        {!isOpen && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ border: '1px solid rgba(59, 130, 246,0.3)' }}
            animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' as const }}
          />
        )}
      </motion.button>
    </div>
  );
}
