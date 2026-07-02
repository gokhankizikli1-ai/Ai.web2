import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface WidgetCardProps {
  title: string;
  icon?: React.ReactNode;
  children: ReactNode;
  delay?: number;
  className?: string;
  noPadding?: boolean;
}

export default function WidgetCard({ title, icon, children, delay = 0, className = '', noPadding = false }: WidgetCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: 'easeOut' as const }}
      className={`rounded-2xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] transition-all ${noPadding ? '' : 'p-5'} ${className}`}
    >
      <div className={`flex items-center gap-2 mb-4 ${noPadding ? 'p-5 pb-0' : ''}`}>
        {icon && <span className="text-[#94A3B8]">{icon}</span>}
        <h3 className="text-[12px] font-semibold text-white uppercase tracking-wider">{title}</h3>
      </div>
      <div className={noPadding ? 'px-5 pb-5' : ''}>
        {children}
      </div>
    </motion.div>
  );
}
