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
  success: 'border-[#4ADE80]/15 bg-[#4ADE80]/[0.04] text-[#4ADE80]',
  warning: 'border-[#FACC15]/15 bg-[#FACC15]/[0.04] text-[#FACC15]',
  error: 'border-[#F87171]/15 bg-[#F87171]/[0.04] text-[#F87171]',
  info: 'border-[#8B5CF6]/15 bg-[#8B5CF6]/[0.04] text-[#8B5CF6]',
};

const ICON_COLORS = {
  success: 'text-[#4ADE80]',
  warning: 'text-[#FACC15]',
  error: 'text-[#F87171]',
  info: 'text-[#8B5CF6]',
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
                className="text-[#858B99] hover:text-[#B6BBC6] transition-colors p-0.5 rounded"
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
