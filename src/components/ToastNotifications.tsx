import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import type { Toast } from '@/hooks/useToast';

const ICONS = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: 'border-emerald-500/15 bg-emerald-500/[0.04] text-emerald-400',
  warning: 'border-amber-500/15 bg-amber-500/[0.04] text-amber-400',
  error: 'border-red-500/15 bg-red-500/[0.04] text-red-400',
  info: 'border-cyan-500/15 bg-cyan-500/[0.04] text-cyan-400',
};

const ICON_COLORS = {
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
  info: 'text-cyan-400',
};

interface ToastNotificationsProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export default function ToastNotifications({ toasts, onRemove }: ToastNotificationsProps) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-2.5 shadow-xl backdrop-blur-md min-w-[280px] max-w-sm ${STYLES[toast.type]}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${ICON_COLORS[toast.type]}`} />
              <span className="text-[12px] text-slate-300 flex-1">{toast.message}</span>
              <button
                onClick={() => onRemove(toast.id)}
                className="text-slate-600 hover:text-slate-400 transition-colors p-0.5 rounded"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
