import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DeleteConfirmModalProps {
  open: boolean;
  title?: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({
  open,
  title = 'Delete Conversation',
  description = 'This conversation will be permanently deleted. This action cannot be undone.',
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, onConfirm, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0f1a]/70 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm mx-4 rounded-2xl border border-white/[0.06] bg-[#171C24] shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#B76E79]/[0.06] border border-[#B76E79]/10 shrink-0">
                <AlertTriangle className="h-4 w-4 text-[#B76E79]" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-white">{title}</h3>
                <p className="text-[12px] text-[#7F8FA3] mt-1 leading-relaxed">{description}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="h-8 px-4 text-[12px] text-[#A9B7C6] hover:text-white hover:bg-white/[0.04] rounded-lg"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onConfirm}
                className="h-8 px-4 text-[12px] bg-[#B76E79]/[0.1] text-[#B76E79] hover:bg-[#B76E79]/[0.15] border border-[#B76E79]/15 rounded-lg"
              >
                Delete
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
