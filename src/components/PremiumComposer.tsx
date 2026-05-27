import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Command, Plus, FileUp, Image as ImageIcon, Camera, FolderOpen } from 'lucide-react';
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
  //
  // Returns true when the send was actually accepted by the backend.
  // The composer uses this to decide whether to clear the input/chips —
  // on false the chips stay so the user can retry without re-attaching.
  onSend: (message: string, attachments: AttachedAsset[]) => Promise<boolean>;
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
  const [isSending, setIsSending]   = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const dragDepthRef = useRef(0);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const photoInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef  = useRef<HTMLInputElement>(null);
  const attachMenuRef   = useRef<HTMLDivElement>(null);

  const value = externalValue !== undefined ? externalValue : internalValue;
  const setValue = onExternalValueChange || setInternalValue;

  // Phase 9 — owns the upload queue + progress state.
  const assets = useAssets({ projectId });

  const handleSubmit = useCallback(async () => {
    // Block when nothing to send, when explicitly disabled, while a
    // prior send is still in flight, or while ANY upload is still
    // uploading — sending mid-upload would silently drop the asset
    // (only `ready` chips have an asset_id to forward to the backend).
    if (
      (!value.trim() && assets.attachedAssetIds.length === 0) ||
      disabled || isSending || assets.isUploading
    ) return;

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

    setIsSending(true);
    try {
      const ok = await onSend(value.trim(), attachments);
      if (ok) {
        // Only clear on success — on failure the user keeps both their
        // typed text (restored by the chat hook via externalValue) AND
        // the chips, so they can retry without re-attaching the file.
        setValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        assets.clearAll();
      }
    } finally {
      setIsSending(false);
    }
  }, [value, disabled, isSending, assets, onSend, setValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
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
  //
  // ChatGPT-style attach menu: a single "+" button opens a popover with
  // three discoverable actions. Each routes through a dedicated <input>
  // so we can set the right `accept` / `capture` attrs per action without
  // toggling them on a single shared input (which has races on iOS).

  const openPhotoLibrary = useCallback(() => {
    setAttachMenuOpen(false);
    photoInputRef.current?.click();
  }, []);

  const openCamera = useCallback(() => {
    setAttachMenuOpen(false);
    cameraInputRef.current?.click();
  }, []);

  const openFilePicker = useCallback(() => {
    setAttachMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) assets.upload(files);
    if (e.target) e.target.value = '';
  }, [assets]);

  // Close the attach menu on outside click / Escape so it behaves like
  // the rest of the popovers in the app.
  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [attachMenuOpen]);

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

  // Phase 9 fix — the send button is gated until uploads complete so
  // a fast typist can't fire off the message while their image is mid-
  // upload (which would silently drop the asset because only `ready`
  // chips have an asset_id).
  const canSend =
    (value.trim().length > 0 || assets.attachedAssetIds.length > 0) &&
    !disabled && !isSending && !assets.isUploading;

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
          {/* ChatGPT-style "+" attach menu. The menu lives anchored to
              the + button so it opens upward over the composer without
              being clipped by the parent's overflow. */}
          <div ref={attachMenuRef} className="relative">
            <motion.button
              type="button"
              onClick={() => setAttachMenuOpen((v) => !v)}
              disabled={disabled}
              whileHover={!disabled ? { scale: 1.06 } : undefined}
              whileTap={!disabled ? { scale: 0.94 } : undefined}
              className={`flex items-center justify-center h-7 w-7 rounded-lg border transition-all disabled:opacity-30 ${
                attachMenuOpen
                  ? 'text-cyan-300 bg-white/[0.06] border-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border-white/[0.05]'
              }`}
              title="Attach"
              aria-label="Attach"
              aria-expanded={attachMenuOpen}
              aria-haspopup="menu"
            >
              <Plus className="h-3.5 w-3.5" />
            </motion.button>

            <AnimatePresence>
              {attachMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }}
                  transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  role="menu"
                  className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
                  style={{
                    borderColor:     'rgba(255,255,255,0.06)',
                    background:      'rgba(23,28,36,0.96)',
                    backdropFilter:  'blur(24px)',
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openPhotoLibrary}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-colors"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-cyan-400/70" />
                    <span className="flex-1">Photo Library</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openCamera}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-colors"
                  >
                    <Camera className="h-3.5 w-3.5 text-violet-400/70" />
                    <span className="flex-1">Take Photo or Video</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openFilePicker}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-slate-300 hover:bg-white/[0.04] hover:text-white transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-amber-400/70" />
                    <span className="flex-1">Choose Files</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <ComposerTools onSelectTool={handleToolSelect} />

          {/* Hidden file inputs — one per attach action so we can set
              `accept` / `capture` per intent without races (iOS Safari
              resets `accept` between rapid toggles on a shared input). */}
          <input
            ref={photoInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={onFileInputChange}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            // `capture` triggers the device camera on iOS / Android.
            // Desktop browsers ignore it and fall back to a regular
            // file picker scoped to images & videos — no harm.
            capture="environment"
            className="hidden"
            onChange={onFileInputChange}
          />
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
            onClick={() => { void handleSubmit(); }}
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
