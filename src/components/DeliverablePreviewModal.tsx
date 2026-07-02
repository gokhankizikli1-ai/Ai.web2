// DeliverablePreviewModal — EPIC 2 — rich Artifact Preview (website-builder feel).
//
// HTML artifacts preview in a sandboxed iframe with a device toolbar
// (Desktop / Tablet / Mobile), Fullscreen, Refresh, plus Copy / Download
// / Open. React/project files → code view; file_tree → per-file view;
// markdown/text → formatted. Shows artifact metadata (type, theme,
// components, complexity). Backwards compatible with pre-M2 deliverables
// (content.text only).
import { useCallback, useMemo, useState } from 'react';
import {
  X, Download, Copy, Check, ExternalLink, FileCode,
  Monitor, Tablet, Smartphone, Maximize2, Minimize2, RotateCw,
} from 'lucide-react';
import { wrapWithPremiumCss } from '@/lib/previewHtml';
import type {
  DeliverableView, Artifact, ArtifactMetadata,
} from '@/hooks/useProjectOrchestrator';
import BuilderRefinePanel, {
  APP_QUICK_EDITS, WEBSITE_QUICK_EDITS, type RefinePatch,
} from '@/components/builder/BuilderRefinePanel';
import {
  CATEGORY_LABELS, brandNameFromPrompt, detectCategory, paletteForDirection,
} from '@/components/builder/promptCategory';
import {
  buildEnhancedPrompt, parseVisiblePrompt, resolveBriefAnswers, type DesignBriefAnswers,
} from '@/lib/designBrief';

interface Resolved {
  type:     string;
  preview:  'iframe' | 'code' | 'markdown' | 'file_tree';
  body:     string;
  files:    Array<{ path: string; content: string; language: string }>;
  filename: string;
  mime:     string;
  metadata?: ArtifactMetadata;
}

function resolve(d: DeliverableView): Resolved {
  const c = (d.content || {}) as Record<string, unknown>;
  const art = c.artifact as Artifact | undefined;
  if (art && typeof art.content === 'string') {
    return {
      type: art.type, preview: art.preview, body: art.content,
      files: art.files || [],
      filename: art.download?.filename || `${d.node_id || d.kind}.txt`,
      mime: art.download?.mime || 'text/plain',
      metadata: art.metadata,
    };
  }
  const text = typeof c.text === 'string' ? c.text
    : (typeof d.content === 'string' ? (d.content as unknown as string) : '');
  const head = text.trimStart().slice(0, 200).toLowerCase();
  const isHtml = d.kind === 'landing_page_html'
    || head.startsWith('<!doctype html') || head.startsWith('<html');
  return {
    type: isHtml ? 'html' : 'markdown',
    preview: isHtml ? 'iframe' : 'markdown',
    body: text, files: [],
    filename: `${d.node_id || d.kind}${isHtml ? '.html' : '.txt'}`,
    mime: isHtml ? 'text/html' : 'text/plain',
  };
}

const DEVICE_WIDTH: Record<string, number | null> = {
  desktop: null, tablet: 834, mobile: 390,
};

export default function DeliverablePreviewModal({
  deliverable, onClose, userRequest, onRefine, refining = false,
}: {
  deliverable: DeliverableView | null;
  onClose: () => void;
  /** The run's persisted (possibly design-brief-enhanced) request — enables the refine panel when present. */
  userRequest?: string;
  /** Re-runs the build with an enhanced prompt (original request + design brief + edit instruction). Omit to hide refine controls. */
  onRefine?: (enhancedPrompt: string) => void;
  /** True while a refine-triggered run is starting — disables the refine panel's apply action. */
  refining?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [fullscreen, setFullscreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const r = useMemo(() => deliverable ? resolve(deliverable) : null, [deliverable]);

  // Refine — folds the settings patch + free-text instruction into the
  // SAME buildEnhancedPrompt() the Design Interview uses, then hands the
  // enhanced prompt to the host (ProjectRunCenter), which re-runs the real
  // build flow. Nothing is fabricated: a new run genuinely happens.
  const handleRefine = useCallback((patch: RefinePatch) => {
    if (!userRequest || !onRefine) return;
    const { visible } = parseVisiblePrompt(userRequest);
    const currentBrief = resolveBriefAnswers(userRequest);
    const nextBrief: DesignBriefAnswers = {
      ...currentBrief,
      colorDirection: patch.colorDirection || currentBrief.colorDirection,
      density: patch.density || currentBrief.density,
      layoutType: patch.layoutType || currentBrief.layoutType,
    };
    const asks: string[] = [];
    if (patch.instruction) asks.push(patch.instruction);
    if (patch.brandName) asks.push(`Use the brand name "${patch.brandName}".`);
    const basePrompt = asks.length ? `${visible} ${asks.join(' ')}`.trim() : visible;
    onRefine(buildEnhancedPrompt(basePrompt, nextBrief));
  }, [userRequest, onRefine]);

  const copy = useCallback(async () => {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.body);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }, [r]);

  const download = useCallback(() => {
    if (!r) return;
    const blob = new Blob([r.body], { type: r.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [r]);

  const openInTab = useCallback(() => {
    if (!r) return;
    const w = window.open('', '_blank');
    if (w) {
      const out = r.preview === 'iframe' ? wrapWithPremiumCss(r.body) : r.body;
      w.document.open(); w.document.write(out); w.document.close();
    }
  }, [r]);

  if (!deliverable || !r) return null;
  const isHtml = r.preview === 'iframe';
  const meta = r.metadata;
  const width = DEVICE_WIDTH[device];
  // Refine panel is only meaningful for a generated website/app HTML
  // artifact — never shown for plan/concept markdown deliverables, and
  // never rendered inside the artifact itself (it lives in this wrapper).
  const brief = userRequest ? resolveBriefAnswers(userRequest) : null;
  const category = userRequest ? detectCategory(userRequest) : null;
  const palette = paletteForDirection(brief?.colorDirection);
  const isAppKind = /app_prototype|dashboard/i.test(deliverable.kind || '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div
        className={`flex flex-col rounded-2xl overflow-hidden ${fullscreen ? 'w-full h-full max-w-none max-h-none' : 'w-full max-w-4xl max-h-[88vh]'}`}
        style={{ background: 'rgba(13, 17, 23,0.98)', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/80 truncate">{deliverable.title || deliverable.kind}</p>
            <p className="text-[10px] text-white/30">
              {r.type}{meta?.product_type ? ` · ${meta.product_type}` : ''}
              {meta?.complexity ? ` · ${meta.complexity} complexity` : ''}
            </p>
          </div>

          {/* Device toolbar (html only) */}
          {isHtml && (
            <div className="hidden sm:flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
              {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} onClick={() => setDevice(d)} title={d}
                  className="p-1.5 rounded-md transition-colors"
                  style={{ background: device === d ? 'rgba(59, 130, 246,0.14)' : 'transparent',
                           color: device === d ? 'rgb(156, 187, 209)' : 'rgba(255,255,255,0.45)' }}>
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            {isHtml && (
              <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh" className="p-1.5 rounded-lg text-white/45 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            )}
            {isHtml && (
              <button onClick={() => setFullscreen(f => !f)} title="Fullscreen" className="p-1.5 rounded-lg text-white/45 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            )}
            <button onClick={copy} title="Copy" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-white/50 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
              {copied ? <Check className="h-3 w-3 text-[#4ADE80]" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
            </button>
            {isHtml && (
              <button onClick={openInTab} title="Open in new tab" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-white/50 hover:text-white/80 transition-colors" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <ExternalLink className="h-3 w-3" /> Open
              </button>
            )}
            <button onClick={download} title="Download" className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[#60A5FA] transition-colors" style={{ background: 'rgba(59, 130, 246,0.08)' }}>
              <Download className="h-3 w-3" /> Download
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-white/40 hover:text-white/80 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Edit / Refine / Settings — Korvix builder controls for the
            generated artifact, never rendered inside the artifact itself. */}
        {isHtml && userRequest && brief && category && onRefine && (
          <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <BuilderRefinePanel
              accent={palette.accent}
              accent2={palette.accent2}
              palette={palette}
              categoryLabel={CATEGORY_LABELS[category]}
              brief={brief}
              brandName={brandNameFromPrompt(userRequest)}
              brandLabel={isAppKind ? 'App name' : 'Brand name'}
              quickEdits={isAppKind ? APP_QUICK_EDITS : WEBSITE_QUICK_EDITS}
              onApply={handleRefine}
              busy={refining}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto" style={{ background: isHtml ? 'rgba(0,0,0,0.25)' : 'transparent' }}>
          {isHtml ? (
            <div className="flex justify-center py-3 px-3 min-h-full">
              <iframe
                // deliverable.id + content length so a different deliverable
                // (or a re-run that changed this one's content) always gets a
                // fresh DOM node, not just an in-place srcDoc mutation.
                key={`${deliverable.id}-${r.body.length}-${device}-${refreshKey}`}
                title={`preview-${deliverable.id}`}
                srcDoc={wrapWithPremiumCss(r.body)}
                // allow-scripts (NO allow-same-origin) → inline prototype JS
                // runs in an opaque origin: no access to parent, cookies or
                // storage. The artifact's own CSP blocks all network.
                sandbox="allow-scripts"
                className="rounded-lg shadow-2xl transition-all"
                style={{ width: width ? `${width}px` : '100%', maxWidth: '100%',
                         height: fullscreen ? '82vh' : '64vh', border: 'none', background: '#0b0b10' }}
              />
            </div>
          ) : r.preview === 'file_tree' && r.files.length > 0 ? (
            <div className="px-4 py-3 space-y-3">
              {r.files.map((f, i) => (
                <div key={`${f.path}-${i}`}>
                  <p className="flex items-center gap-1.5 text-[11px] text-[#60A5FA]/80 mb-1">
                    <FileCode className="h-3 w-3" /> {f.path}
                  </p>
                  <pre className="text-[11px] text-white/70 whitespace-pre-wrap break-words rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)' }}>{f.content}</pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-[12px] text-white/75 whitespace-pre-wrap break-words px-4 py-3 leading-relaxed">{r.body}</pre>
          )}
        </div>

        {/* Metadata footer */}
        {meta && (meta.components_used?.length || meta.theme?.mode) && (
          <div className="flex items-center gap-2 flex-wrap px-4 py-2 text-[9px] text-white/35" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            {meta.theme?.mode && <Chip>{meta.theme.mode} mode</Chip>}
            {meta.responsive && <Chip>responsive</Chip>}
            {meta.dark_mode && <Chip>dark mode</Chip>}
            {typeof meta.components_used?.length === 'number' && <Chip>{meta.components_used.length} components</Chip>}
            {(meta.components_used || []).slice(0, 6).map(c => <Chip key={c}>{c}</Chip>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,0.04)' }}>{children}</span>
  );
}
