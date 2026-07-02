// AssetChip — Phase 9 composer/message attachment chip.
//
// Renders one PendingAsset (queued / uploading / ready / failed /
// cancelled) as a compact chip with:
//   - 24px image thumbnail (image MIMEs only) or a type-glyph
//   - filename + size
//   - progress bar (uploading state)
//   - status icon (ready ✓ / failed ✗ / uploading spinner)
//   - dismiss button (×)
//
// Used by:
//   - PremiumComposer  — strip above the textarea showing in-flight uploads
//   - MessageBubble    — read-only chips showing which assets a turn carried
//
// Read-only mode (no onDismiss) hides the × and disables progress bar
// — that's the shape MessageBubble uses to render historical attachments.
import { motion } from 'framer-motion';
import { Paperclip, FileText, Image as ImageIcon, FileVideo, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import type { PendingAsset } from '@/hooks/useAssets';


export interface AssetChipProps {
  asset:      PendingAsset;
  onDismiss?: (localId: string) => void;
  compact?:   boolean;          // when used inside a message bubble — slightly tighter
}


function formatSize(n: number): string {
  if (n < 1024)            return `${n} B`;
  if (n < 1024 * 1024)     return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}


function TypeIcon({ mime }: { mime: string }) {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return <ImageIcon className="h-3 w-3 text-[#7EA6BF]/70" />;
  if (m.startsWith('video/')) return <FileVideo className="h-3 w-3 text-[#7EA6BF]/70" />;
  if (m === 'application/pdf' || m.startsWith('text/'))
    return <FileText className="h-3 w-3 text-[#7EA6BF]/70" />;
  return <Paperclip className="h-3 w-3 text-[#A9B7C6]/70" />;
}


export default function AssetChip({ asset, onDismiss, compact = false }: AssetChipProps) {
  const isImage = (asset.mimeType || '').toLowerCase().startsWith('image/');
  const status  = asset.status;

  // Colour the border by status so the user reads progress at a glance
  // without having to focus on the text.
  const borderClass = (() => {
    if (status === 'ready')     return 'border-[#86A88B]/20';
    if (status === 'failed')    return 'border-[#C98282]/25';
    if (status === 'cancelled') return 'border-white/[0.06]';
    if (status === 'uploading') return 'border-[#7EA6BF]/25';
    return 'border-white/[0.08]';
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`relative inline-flex items-center gap-2 rounded-xl border ${borderClass} bg-white/[0.02] hover:bg-white/[0.03] transition-colors ${compact ? 'pl-1 pr-2 py-[3px]' : 'pl-1.5 pr-2.5 py-1'}`}
      style={{
        backdropFilter: 'blur(8px)',
        maxWidth: '260px',
      }}
    >
      {/* Thumbnail or type icon */}
      <div className={`shrink-0 flex items-center justify-center rounded-md overflow-hidden bg-white/[0.04] ${compact ? 'h-5 w-5' : 'h-6 w-6'}`}>
        {isImage && asset.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.previewUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : isImage && asset.publicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.publicUrl}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <TypeIcon mime={asset.mimeType} />
        )}
      </div>

      {/* Filename + meta */}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className={`truncate ${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-200 leading-tight`}
          title={asset.filename}
        >
          {asset.filename}
        </span>
        <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-[#7F8FA3] leading-tight`}>
          {status === 'failed' && asset.errorMessage
            ? <span className="text-[#C98282]/80">{asset.errorMessage}</span>
            : status === 'uploading'
              ? `${asset.progress}% · ${formatSize(asset.sizeBytes)}`
              : status === 'cancelled'
                ? 'cancelled'
                : `${formatSize(asset.sizeBytes)}`
          }
        </span>
      </div>

      {/* Status icon */}
      <div className="shrink-0 flex items-center justify-center">
        {status === 'uploading' && (
          <Loader2 className="h-3 w-3 text-[#7EA6BF]/70 animate-spin" />
        )}
        {status === 'ready' && (
          <Check className="h-3 w-3 text-[#86A88B]/80" />
        )}
        {status === 'failed' && (
          <AlertCircle className="h-3 w-3 text-[#C98282]/80" />
        )}
      </div>

      {/* Dismiss × */}
      {onDismiss && (
        <button
          onClick={() => onDismiss(asset.localId)}
          className="shrink-0 h-4 w-4 flex items-center justify-center rounded-full text-[#7F8FA3] hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
          aria-label="Remove attachment"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}

      {/* Progress bar — only during uploading. Sits at the bottom edge
          of the chip so it doesn't bump layout. */}
      {status === 'uploading' && (
        <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/[0.04] overflow-hidden rounded-b-xl">
          <motion.div
            className="h-full bg-[#7EA6BF]/50"
            initial={{ width: 0 }}
            animate={{ width: `${asset.progress}%` }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          />
        </div>
      )}
    </motion.div>
  );
}
