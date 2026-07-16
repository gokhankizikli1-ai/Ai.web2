import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  resolveTarget, buildSelection, selectionLabel, overlayRectOf,
  VS_TOOLING_ATTR, type VisualSelection, type OverlayRect,
} from '@/lib/visualSelection';

/**
 * VisualSelectSurface (Phase 14K.1) — wraps the REAL same-origin Web Build
 * preview document and adds a direct-DOM selection layer. No iframe, no bridge,
 * no sandbox change: the safe-fallback preview is direct React DOM, so we read
 * its bounding boxes directly and draw an overlay that never touches the
 * generated markup.
 *
 * When `enabled` is false the surface is transparent — no listeners, no overlay,
 * preview behaves exactly as before. When enabled, capture-phase listeners
 * intercept ONLY selection clicks (preventing link navigation / button actions /
 * form submit / drag) while leaving scrolling and pointer movement intact. Hover
 * is driven imperatively via a ref (no React re-render per pixel); the selected
 * rectangle is React state recomputed on scroll / resize / device change. All
 * listeners, the ResizeObserver and timers are removed on disable/unmount.
 */

export interface VisualSelectHandle { clear: () => void }

interface Props {
  enabled: boolean;
  onSelect: (sel: VisualSelection | null) => void;
  /** Called on Escape when there is no hover and no selection to clear. */
  onExitMode: () => void;
  route?: string;
  children: React.ReactNode;
}

const VisualSelectSurface = forwardRef<VisualSelectHandle, Props>(function VisualSelectSurface(
  { enabled, onSelect, onExitMode, route, children }, ref,
) {
  const { t } = useLanguageStore();
  const containerRef = useRef<HTMLDivElement | null>(null);   // coordinate box (viewport)
  const scrollRef = useRef<HTMLDivElement | null>(null);      // scroll container
  const hoverBoxRef = useRef<HTMLDivElement | null>(null);    // imperative hover rect
  const hoverElRef = useRef<HTMLElement | null>(null);        // live hovered element (not persisted)
  const selectedElRef = useRef<HTMLElement | null>(null);     // live selected element (not persisted)
  const lastMoveRef = useRef(0);

  const [selected, setSelected] = useState<{ rect: OverlayRect; sel: VisualSelection } | null>(null);

  // Stable access to the latest callbacks/flags for the long-lived listeners.
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onExitRef = useRef(onExitMode); onExitRef.current = onExitMode;
  const routeRef = useRef(route); routeRef.current = route;

  const hideHover = useCallback(() => {
    hoverElRef.current = null;
    const box = hoverBoxRef.current;
    if (box) box.style.display = 'none';
  }, []);

  const clearSelection = useCallback(() => {
    selectedElRef.current = null;
    setSelected(null);
  }, []);

  useImperativeHandle(ref, () => ({
    clear: () => { hideHover(); clearSelection(); },
  }), [hideHover, clearSelection]);

  // Recompute the SELECTED rectangle from the live element (scroll / resize /
  // device-width change / re-render). Identity is preserved; if the element is
  // gone, the selection is cleared.
  const recomputeSelected = useCallback(() => {
    const el = selectedElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    if (!container.contains(el)) { clearSelection(); onSelectRef.current(null); return; }
    const rect = overlayRectOf(el, container);
    setSelected((prev) => (prev && rect ? { rect, sel: prev.sel } : prev));
  }, [clearSelection]);

  // Attach/detach the whole selection interaction based on `enabled`.
  useEffect(() => {
    const scroll = scrollRef.current;
    const container = containerRef.current;
    if (!enabled || !scroll || !container) { hideHover(); return; }

    const paintHover = (el: HTMLElement | null) => {
      const box = hoverBoxRef.current;
      if (!box) return;
      if (!el) { box.style.display = 'none'; hoverElRef.current = null; return; }
      const rect = overlayRectOf(el, container);
      if (!rect) { box.style.display = 'none'; return; }
      box.style.display = 'block';
      box.style.top = `${rect.top}px`;
      box.style.left = `${rect.left}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    };

    const onMove = (e: PointerEvent) => {
      const now = e.timeStamp || performance.now();
      if (now - lastMoveRef.current < 24) return;   // throttle ~40fps of processing
      lastMoveRef.current = now;
      const el = resolveTarget(e.target, container);
      if (el === hoverElRef.current) { if (el) paintHover(el); return; }
      hoverElRef.current = el;
      paintHover(el);
    };

    const onClick = (e: MouseEvent) => {
      // Intercept ONLY the selection click — stop navigation / button / React
      // onClick from firing, but leave scrolling and pointer movement alone.
      e.preventDefault();
      e.stopPropagation();
      (e as unknown as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
      const el = resolveTarget(e.target, container);
      if (!el) return;
      const sel = buildSelection(el, container, routeRef.current);
      selectedElRef.current = el;
      const rect = overlayRectOf(el, container);
      setSelected(rect ? { rect, sel } : null);
      onSelectRef.current(sel);
      hideHover();
    };

    const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    const onScroll = () => recomputeSelected();
    const onLeave = () => hideHover();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !enabledRef.current) return;
      if (hoverElRef.current) hideHover();
      if (selectedElRef.current) { clearSelection(); onSelectRef.current(null); }
      else onExitRef.current();
    };

    scroll.addEventListener('pointermove', onMove, { passive: true });
    scroll.addEventListener('click', onClick, { capture: true });
    scroll.addEventListener('submit', block, { capture: true });
    scroll.addEventListener('dragstart', block, { capture: true });
    scroll.addEventListener('pointerleave', onLeave, { passive: true });
    // Capture-phase document scroll catches EVERY scroll container (the preview's
    // own vertical scroll and BrowserFrame's tablet/mobile horizontal scroll)
    // without needing a ref to each — scroll events don't bubble but do capture.
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('keydown', onKey, { capture: true });

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { hideHover(); recomputeSelected(); }) : null;
    ro?.observe(container);

    return () => {
      scroll.removeEventListener('pointermove', onMove);
      scroll.removeEventListener('click', onClick, { capture: true } as EventListenerOptions);
      scroll.removeEventListener('submit', block, { capture: true } as EventListenerOptions);
      scroll.removeEventListener('dragstart', block, { capture: true } as EventListenerOptions);
      scroll.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions);
      ro?.disconnect();
      hideHover();
    };
  }, [enabled, hideHover, clearSelection, recomputeSelected]);

  // Leaving selection mode clears the selection (foundation behaviour) so no
  // stale context lingers.
  useEffect(() => {
    if (!enabled && (selectedElRef.current || selected)) { clearSelection(); onSelectRef.current(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const label = selected ? selectionLabel(selected.sel, t) : '';

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        ref={scrollRef}
        className="max-h-[70vh] overflow-y-auto scrollbar-thin"
        style={enabled ? { cursor: 'crosshair' } : undefined}
      >
        {children}
      </div>

      {/* Overlay layer — never intercepts events, never in the generated markup. */}
      <div
        aria-hidden="true"
        {...{ [VS_TOOLING_ATTR]: 'true' }}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 20 }}
      >
        <div
          ref={hoverBoxRef}
          style={{
            display: 'none', position: 'absolute',
            border: '1.5px solid rgba(59,130,246,0.6)', background: 'rgba(59,130,246,0.08)',
            borderRadius: 4, boxSizing: 'border-box', transition: 'top .04s linear, left .04s linear, width .04s linear, height .04s linear',
          }}
        />
        {selected && (
          <div
            style={{
              position: 'absolute', top: selected.rect.top, left: selected.rect.left,
              width: selected.rect.width, height: selected.rect.height, boxSizing: 'border-box',
              border: '2px solid #3B82F6', background: 'rgba(59,130,246,0.10)', borderRadius: 4,
              boxShadow: '0 0 0 1px rgba(59,130,246,0.25)',
            }}
          >
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <span
                key={c}
                style={{
                  position: 'absolute', width: 7, height: 7, background: '#3B82F6', borderRadius: 2,
                  border: '1.5px solid #0B0E12',
                  top: c[0] === 't' ? -4 : undefined, bottom: c[0] === 'b' ? -4 : undefined,
                  left: c[1] === 'l' ? -4 : undefined, right: c[1] === 'r' ? -4 : undefined,
                }}
              />
            ))}
            <span
              style={{
                position: 'absolute', top: -22, left: -2, whiteSpace: 'nowrap',
                fontSize: 11, fontWeight: 600, color: '#fff', background: '#2563EB',
                borderRadius: 6, padding: '2px 8px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default VisualSelectSurface;
