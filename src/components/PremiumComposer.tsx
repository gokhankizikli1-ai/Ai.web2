import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Command, Paperclip, FileUp } from 'lucide-react';
import ComposerTools, { type ComposerTool } from './ComposerTools';
import ToolChips from './ToolChips';
import AssetChip from './AssetChip';
import useAssets from '@/hooks/useAssets';


import type { AttachedAsset } from '@/types';

interface PremiumComposerProps {
  // Phase 9 — onSend carries the attached AssetMeta records (asset_id +
  // filename + size + mime + public_url). The chat hook saves them on
  // the user Message AND forwards the ids to /v2/chat/stream so the
  // backend can fold asset summaries into the system prompt. Empty
  // array = text-only turn (byte-identical to pre-Phase-9 behaviour).
  onSend: (message: string, attachments: AttachedAsset[]) => void;
  disabled?: boolean;
  activeTools: ComposerTool[];
  onAddTool: (tool: ComposerTool) => void;
  onRemoveTool: (tool: ComposerTool) => void;
  externalValue?: string;
  onExternalValueChange?: (value: string) => void;
  /** When set, every uploaded asset is auto-scoped to this project. */
  projectId?: string;
}


export default function PremiumComposer({
  onSend,
  disabled,
  activeTools,
  onAddTool,
  onRemoveTool,
  externalValue,
  onExternalValueChange,
  projectId,
}: PremiumComposerProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused]   = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const setValue = onExternalValueChange || setInternalValue;

  // Phase 9 — owns the upload queue + progress state.
  const assets = useAssets({ projectId });

  const handleSubmit = () => {
    if ((!value.trim() && assets.attachedAssetIds.length === 0) || disabled) return;
    // Build AttachedAsset[] from the chip queue — only `ready` rows
    // (with a server-issued asset_id) make it into the message.
    const attachments: AttachedAsset[] = assets.pendingAssets
      .filter((a) => a.status === 'ready' && !!a.assetId)
      .map((a) => ({
        asset_id:   a.assetId as string,
        filename:   a.filename,
        mime_type:  a.mimeType,
        size_bytes: a.sizeBytes,
        public_url: a.publicUrl,
      }));
    onSend(value.trim(), attachments);
    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    // Clear chip state — historical attachments are surfaced by the
    // parent via the message record's `attachments`.
    assets.clearAll();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleToolSelect = useCallback((tool: ComposerTool) => {
    onAddTool(tool);
    setTimeout(() => {
      const el = textareaRef.current;
      if (el) el.focus();
    }, 50);
  }, [onAddTool]);

  // ── Upload triggers ───────────────────────────────────────────────────

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) assets.upload(files);
    if (e.target) e.target.value = '';
  }, [assets]);

  // Drag/drop wiring — uses nested dragenter counting so leaving a
  // child element doesn't flicker the overlay off.
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) assets.upload(files);
  }, [assets]);

  // Paste-image — captures clipboard files (Cmd+V on a screenshot)
  // and routes them through the same upload pipeline.
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      assets.upload(files);
    }
  }, [assets]);

  // ── Render ────────────────────────────────────────────────────────────

  const canSend =
    (value.trim().length > 0 || assets.attachedAssetIds.length > 0) && !disabled;

  return (
    <div className="max-w-3xl mx-auto">
      <ToolChips tools={activeTools} onRemove={onRemoveTool} />

      {/* Asset chips — in-flight + ready uploads. */}
      <AnimatePresence>
        {assets.pendingAssets.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 mb-2 px-0.5">
              {assets.pendingAssets.map((a) => (
                <AssetChip
                  key={a.localId}
                  asset={a}
                  onDismiss={assets.dismiss}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        animate={{
          boxShadow: isDragging
            ? '0 0 0 2px rgba(34,211,238,0.45), 0 0 28px -4px rgba(34,211,238,0.30)'
            : isFocused
              ? '0 0 0 1px rgba(255,255,255,0.08), 0 0 20px -4px rgba(34,211,238,0.06)'
              : '0 0 0 1px transparent, 0 1px 3px rgba(0,0,0,0.1)',
        }}
        transition={{ duration: 0.2 }}
        className={`relative rounded-2xl border transition-all duration-300 ${
          isDragging
            ? 'border-cyan-400/40'
            : isFocused
              ? 'border-cyan-500/15'
              : 'border-white/[0.05] hover:border-white/[0.07]'
        }`}
        style={{
          background: isFocused ? 'rgba(27,34,48,0.6)' : 'rgba(27,34,48,0.4)',
          backdropFilter: 'blur(20px)',
          boxShadow: isFocused
            ? '0 0 24px -6px rgba(34,211,238,0.08), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 4px 16px -8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)',
        }}
      >
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 rounded-2xl pointer-events-none flex items-center justify-center z-10"
              style={{
                background:
                  'linear-gradient(135deg, rgba(34,211,238,0.10), rgba(99,102,241,0.10))',
              }}
            >
              <div className="flex items-center gap-2 text-cyan-300 text-[12px] font-medium">
                <FileUp className="h-3.5 w-3.5" />
                Drop to attach
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1 px-3 pt-2 pb-1">
          <ComposerTools onSelectTool={handleToolSelect} />
          <button
            type="button"
            onClick={openFilePicker}
            disabled={disabled}
            className="flex items-center justify-center h-6 w-6 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/[0.04] transition-colors disabled:opacity-30"
            title="Attach file"
            aria-label="Attach file"
          >
            <Paperclip className="h-3 w-3" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,video/*"
            className="hidden"
            onChange={onFileInputChange}
          />
          {activeTools.length === 0 && assets.pendingAssets.length === 0 && (
            <span className="text-[11px] text-[#64748B] ml-1.5">Add tool or attach</span>
          )}
        </div>

        <div className="px-3 pb-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={
              assets.pendingAssets.length > 0
                ? 'Describe what to do with the attachment(s)…'
                : activeTools.length > 0
                  ? `Using ${activeTools.map((t) => t.chip).join(', ')}...`
                  : 'Message KorvixAI…'
            }
            rows={1}
            disabled={disabled}
            className="w-full bg-transparent text-[14px] text-slate-200 placeholder:text-slate-600/40 resize-none outline-none min-h-[28px] max-h-[200px] py-1 leading-[1.6] disabled:opacity-40 transition-opacity"
          />
        </div>

        <div className="flex items-center justify-between px-2 pb-2 pt-0.5">
          <div className="flex items-center gap-1 text-[11px]" style={{ color: 'rgba(148,163,184,0.2)' }}>
            <Command className="h-2.5 w-2.5" />
            <span>K to focus</span>
            {assets.isUploading && (
              <span className="ml-2 text-cyan-400/60">Uploading…</span>
            )}
          </div>

          <motion.button
            onClick={handleSubmit}
            disabled={!canSend}
            whileHover={canSend ? { scale: 1.06 } : {}}
            whileTap={canSend ? { scale: 0.92 } : {}}
            animate={{
              backgroundColor: canSend ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
              boxShadow: canSend
                ? '0 0 12px -2px rgba(34,211,238,0.15)'
                : 'none',
            }}
            transition={{ duration: 0.2 }}
            className={`flex items-center justify-center h-8 w-8 rounded-xl transition-all duration-200 ${
              canSend
                ? 'text-white hover:text-cyan-300'
                : 'text-[#64748B]'
            } disabled:opacity-30`}
          >
            <Send className="h-[15px] w-[15px]" />
          </motion.button>
        </div>
      </motion.div>

      <div className="flex items-center justify-center mt-2">
        <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.2)' }}>KorvixAI can make mistakes. Verify important information.</span>
      </div>
    </div>
  );
}
