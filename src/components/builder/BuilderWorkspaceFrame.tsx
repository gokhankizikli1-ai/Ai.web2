// BuilderWorkspaceFrame — the shared page shell for Website Builder and App
// Builder: nav + a consistent eyebrow icon/title/subtitle header + a
// centered container. Keeps both builder pages visually identical in
// structure so the only real difference between them is their content, not
// their chrome.
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import Navigation from '@/components/Navigation';

interface BuilderWorkspaceFrameProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  accent: string;
  /** A literal Tailwind max-width class, e.g. "max-w-6xl". */
  maxWidth?: string;
  children: ReactNode;
}

export default function BuilderWorkspaceFrame({
  icon, title, subtitle, accent, maxWidth = 'max-w-6xl', children,
}: BuilderWorkspaceFrameProps) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className={`${maxWidth} mx-auto px-4 sm:px-6 py-8`}>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl border shrink-0"
                style={{ background: `${accent}18`, borderColor: `${accent}30` }}
              >
                {icon}
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">{title}</h1>
            </div>
            <p className="text-[13px] text-[#7F8FA3] ml-12">{subtitle}</p>
          </motion.div>

          {children}
        </div>
      </div>
    </div>
  );
}
