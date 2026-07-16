/**
 * Visual Edit — selection foundation (Phase 14K.1).
 *
 * Centralized, framework-agnostic rules for resolving a pointer target inside
 * the REAL Web Build preview (the same-origin, direct-DOM safe-fallback renderer)
 * into a stable, typed selection context. This module owns:
 *   - which DOM nodes are selectable and the resolution hierarchy,
 *   - element-type + label classification,
 *   - a serializable selection identity (stable section metadata where present,
 *     otherwise an HONESTLY-labelled runtime DOM fallback),
 *   - a safe, truncated text preview (never form/input/password values),
 *   - the single overlay coordinate-conversion helper.
 *
 * It NEVER stores a live DOM node, serializes outerHTML, mutates the preview, or
 * triggers AI. This is Generate → Select only.
 */

export type VisualElementType =
  | 'heading' | 'text' | 'button' | 'link' | 'image'
  | 'card' | 'navigation' | 'section' | 'footer' | 'container' | 'unknown';

/** Where a selection's identity comes from — surfaced honestly in the UI. */
export type VisualIdentitySource = 'metadata' | 'runtime';

/** Serializable selection context. No live DOM node, no outerHTML. */
export interface VisualSelection {
  version: 1;
  /** Single-document preview today → usually undefined; reserved for multi-page. */
  route?: string;
  /** Stable metadata id when present, else a deterministic runtime DOM path. */
  nodeId: string;
  /** Honest signal: is `nodeId` from generated metadata or a runtime fallback? */
  identitySource: VisualIdentitySource;
  tagName: string;
  role: string;
  elementType: VisualElementType;
  /** i18n key for the element-type portion of the label (resolved via t()). */
  typeKey: string;
  /** Short human section name (from aria-label / heading text), already safe. */
  section?: string;
  /** Safe, normalized, truncated visible text (never input/password values). */
  textPreview?: string;
  /** Short tag-chain hint for debugging only (not shown to normal users). */
  domPath?: string;
}

/**
 * An image target derived from a selection (Phase 14K.2). Present ONLY when the
 * selected element visually IS a replaceable content photo — a real `<img>` or a
 * single, safe CSS `background-image`. Icons, SVG, gradients, overlays, tiny /
 * decorative / tracking images and non-https sources never produce a target, so
 * the image actions surface only where a stock photo can meaningfully replace it.
 */
export interface VisualImageTarget {
  selection: VisualSelection;
  imageKind: 'img' | 'background';
  /** The current, rendered source URL (for prefill/attribution — never mutated). */
  currentUrl: string;
  altText?: string;
  /** Rendered CSS-pixel size (used for the size threshold + picker hints). */
  width?: number;
  height?: number;
  aspectRatio?: number;
  objectFit?: string;
  sourceAttribute: 'src' | 'background-image';
}

/** Below this rendered side (px) an image is treated as an icon/avatar/pixel. */
const MIN_IMAGE_SIDE = 40;

/** i18n keys for each element type (resolved by the UI via t()). */
const TYPE_KEY: Record<VisualElementType, string> = {
  heading: 'vsHeading', text: 'vsText', button: 'vsButton', link: 'vsLink',
  image: 'vsImage', card: 'vsCard', navigation: 'vsNavigation', section: 'vsSection',
  footer: 'vsFooter', container: 'vsContainer', unknown: 'vsElement',
};

const MAX_CLIMB = 8;
const MAX_TEXT = 80;
/** Marks the selection tooling itself so it can never resolve to a target. */
export const VS_TOOLING_ATTR = 'data-korvix-vs-tooling';

function isElement(n: EventTarget | Node | null): n is HTMLElement {
  return !!n && (n as Node).nodeType === 1 && n instanceof HTMLElement;
}

/** Visible + non-zero-size. Zero-size / hidden / collapsed nodes are skipped. */
function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
  return true;
}

/** Never a selectable target: document scaffolding, tooling, code, raw svg guts. */
function isBlockedTag(tag: string): boolean {
  return tag === 'html' || tag === 'head' || tag === 'body'
    || tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta'
    || tag === 'svg' || tag === 'path' || tag === 'g' || tag === 'defs' || tag === 'use';
}

function isInputLike(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option';
}

function classify(el: HTMLElement): VisualElementType {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'img') return 'image';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'nav') return 'navigation';
  if (tag === 'footer') return 'footer';
  if (tag === 'header' || tag === 'section' || tag === 'main' || tag === 'article') return 'section';
  if (tag === 'p' || tag === 'span' || tag === 'li' || tag === 'blockquote') return 'text';
  // A block that looks like a repeated card (direct child of a section with siblings).
  const parent = el.parentElement;
  if (parent && (parent.tagName.toLowerCase() === 'section' || parent.getAttribute('role') === 'list')
      && parent.children.length >= 2 && el.querySelector('h1,h2,h3,h4,h5,h6,p,img,button')) {
    return 'card';
  }
  return 'container';
}

/**
 * Resolve a raw pointer node into the nearest MEANINGFUL selectable element,
 * within `root`. Hierarchy: interactive control (button/link) → media → heading
 * → nav/footer → nearest section/card/container → safe fallback. Bounded climb.
 */
export function resolveTarget(node: Node | EventTarget | null, root: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = isElement(node) ? node : (node && (node as Node).parentElement) || null;
  if (!el || !root.contains(el)) return null;
  // Never resolve into the selection tooling.
  if (el.closest(`[${VS_TOOLING_ATTR}]`)) return null;

  // Climb out of blocked scaffolding / raw svg internals first.
  let guard = 0;
  while (el && guard++ < MAX_CLIMB && (isBlockedTag(el.tagName.toLowerCase()) || isInputLike(el))) {
    if (el === root) break;
    el = el.parentElement;
  }
  if (!el || el === root || !root.contains(el)) return null;

  // Whole interactive control wins (click on icon/label inside a button/link).
  const control = el.closest('button, a[href], [role="button"]') as HTMLElement | null;
  if (control && root.contains(control) && isVisible(control)) return control;

  // Media selects itself.
  if (el.tagName.toLowerCase() === 'img') return isVisible(el) ? el : null;

  // Heading text selects the heading.
  const heading = el.closest('h1, h2, h3, h4, h5, h6') as HTMLElement | null;
  if (heading && root.contains(heading) && isVisible(heading)) return heading;

  // If the node is already a meaningful semantic element, keep it.
  const type = classify(el);
  if ((type === 'text' || type === 'card' || type === 'navigation' || type === 'footer' || type === 'section')
      && isVisible(el)) {
    return el;
  }

  // Otherwise walk up to the nearest meaningful ancestor (card/section), bounded.
  let cur: HTMLElement | null = el;
  let depth = 0;
  while (cur && cur !== root && depth++ < MAX_CLIMB) {
    if (isVisible(cur)) {
      const t = classify(cur);
      if (t !== 'container' && t !== 'unknown') return cur;
    }
    cur = cur.parentElement;
  }
  // Safe fallback: the visible element itself.
  return isVisible(el) ? el : null;
}

/** Nearest enclosing section-like element (for label + identity grouping). */
function sectionOf(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  const sec = el.closest('section, header, footer, nav, main, article') as HTMLElement | null;
  return sec && root.contains(sec) ? sec : null;
}

/** Human section name from aria-label / first heading text — safe + truncated. */
function sectionName(sec: HTMLElement | null): string | undefined {
  if (!sec) return undefined;
  const aria = sec.getAttribute('aria-label');
  const raw = aria || sec.querySelector('h1, h2, h3, h4, h5, h6')?.textContent || '';
  const norm = raw.replace(/\s+/g, ' ').trim();
  return norm ? norm.slice(0, 28) : undefined;
}

/** Safe visible text preview — normalized, truncated; never input/password values. */
function textPreviewOf(el: HTMLElement): string | undefined {
  if (isInputLike(el)) return undefined;
  const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return undefined;
  return raw.length > MAX_TEXT ? `${raw.slice(0, MAX_TEXT)}…` : raw;
}

/** Short tag-chain hint (debug only), bounded depth. */
function domPathOf(el: HTMLElement, root: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  let depth = 0;
  while (cur && cur !== root && depth++ < 6) {
    parts.unshift(cur.tagName.toLowerCase());
    cur = cur.parentElement;
  }
  return parts.join('>');
}

/**
 * Build the serializable selection context for a resolved element. Prefers a
 * stable generated id (`data-korvix-id` / element `id`) and marks the identity
 * source honestly; otherwise derives a deterministic runtime DOM path.
 */
export function buildSelection(el: HTMLElement, root: HTMLElement, route?: string): VisualSelection {
  const tagName = el.tagName.toLowerCase();
  const elementType = classify(el);
  const sec = sectionOf(el, root);
  const section = sectionName(sec);

  const metaId = el.getAttribute('data-korvix-id') || (el.id && !el.id.startsWith('radix-') ? el.id : '');
  let nodeId: string;
  let identitySource: VisualIdentitySource;
  if (metaId) {
    nodeId = metaId;
    identitySource = 'metadata';
  } else {
    // Runtime fallback: NOT source-stable across regeneration (documented).
    const scope = sec && sec.id ? sec.id : (sec ? sec.tagName.toLowerCase() : 'root');
    const scopeRoot = sec || root;
    const same = Array.from(scopeRoot.querySelectorAll(tagName));
    const index = Math.max(0, same.indexOf(el));
    nodeId = `${scope}/${tagName}[${index}]`;
    identitySource = 'runtime';
  }

  return {
    version: 1,
    route,
    nodeId,
    identitySource,
    tagName,
    role: el.getAttribute('role') || tagName,
    elementType,
    typeKey: elementType === 'heading' && tagName === 'h1' ? 'vsMainHeading' : TYPE_KEY[elementType],
    section,
    textPreview: textPreviewOf(el),
    domPath: domPathOf(el, root),
  };
}

/** Composed, localized label for the overlay/pill (e.g. "Hero / Main heading"). */
export function selectionLabel(sel: Pick<VisualSelection, 'typeKey' | 'section'>, t: (k: string) => string): string {
  const type = t(sel.typeKey);
  return sel.section ? `${sel.section} / ${type}` : type;
}

/** `<svg>` guts / icons living inside an svg — never a replaceable content photo. */
function isSvgLike(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'svg' || tag === 'path' || tag === 'g' || tag === 'use' || tag === 'defs') return true;
  return !!el.closest('svg');
}

/**
 * A single, safe CSS background-image url. Rejects gradients (decorative),
 * multi-layer / overlay stacks, data-URIs and anything non-https so we never try
 * to "replace" a gradient overlay or a tooling pixel.
 */
function backgroundImageUrl(el: HTMLElement): string {
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const bg = (cs?.backgroundImage || '').trim();
  if (!bg || bg === 'none') return '';
  if (/gradient/i.test(bg)) return '';                       // decorative gradient
  if ((bg.match(/url\(/g) || []).length !== 1) return '';    // overlay / multi-layer stack
  const m = bg.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  const url = m ? m[2].trim() : '';
  if (!url || url.startsWith('data:')) return '';            // data-URI tooling
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

/** Rendered `<img>` url (currentSrc/src). Rejects data-URI tooling + non-https. */
function imgUrl(img: HTMLImageElement): string {
  const src = (img.currentSrc || img.src || '').trim();
  if (!src || src.startsWith('data:')) return '';            // tracking pixel / tooling
  if (!/^https?:\/\//i.test(src)) return '';
  return src;
}

/**
 * Resolve a selected element into an image target — but ONLY when it visually is
 * a genuine, replaceable content photo. Handles a real `<img>` (resolving
 * `<picture>` to its rendered `<img>`) and, best-effort, a single safe CSS
 * `background-image`. Returns null for icons/SVG, tiny/decorative/tracking
 * images (below the size threshold), gradients, overlays and non-https sources.
 * Never mutates the DOM.
 */
export function getImageTarget(el: HTMLElement, root: HTMLElement, route?: string): VisualImageTarget | null {
  if (!el || !root.contains(el)) return null;
  if (el.closest(`[${VS_TOOLING_ATTR}]`)) return null;

  const tag = el.tagName.toLowerCase();
  let img: HTMLImageElement | null = null;
  if (tag === 'img') img = el as HTMLImageElement;
  else if (tag === 'picture') img = el.querySelector('img');

  if (img && root.contains(img) && !isSvgLike(img)) {
    const r = img.getBoundingClientRect();
    if (r.width >= MIN_IMAGE_SIDE && r.height >= MIN_IMAGE_SIDE) {
      const url = imgUrl(img);
      if (url) {
        const cs = img.ownerDocument.defaultView?.getComputedStyle(img);
        return {
          selection: buildSelection(img, root, route),
          imageKind: 'img',
          currentUrl: url,
          altText: img.getAttribute('alt') || undefined,
          width: Math.round(r.width),
          height: Math.round(r.height),
          aspectRatio: r.height ? r.width / r.height : undefined,
          objectFit: cs?.objectFit || undefined,
          sourceAttribute: 'src',
        };
      }
    }
  }

  // Background-image fallback — only a single, safe https url on a large element.
  if (!isSvgLike(el)) {
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_IMAGE_SIDE && r.height >= MIN_IMAGE_SIDE) {
      const bg = backgroundImageUrl(el);
      if (bg) {
        const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
        return {
          selection: buildSelection(el, root, route),
          imageKind: 'background',
          currentUrl: bg,
          altText: el.getAttribute('aria-label') || undefined,
          width: Math.round(r.width),
          height: Math.round(r.height),
          aspectRatio: r.height ? r.width / r.height : undefined,
          objectFit: cs?.backgroundSize || undefined,
          sourceAttribute: 'background-image',
        };
      }
    }
  }

  return null;
}

export interface OverlayRect { top: number; left: number; width: number; height: number }

/**
 * The single coordinate conversion: an element's rect expressed relative to the
 * overlay container's viewport box. Both are same-document viewport coords, so
 * this correctly follows preview scroll, container scroll, device-width changes
 * and re-renders when recomputed on scroll/resize. Returns null for zero-size.
 */
export function overlayRectOf(el: HTMLElement, container: HTMLElement): OverlayRect | null {
  const er = el.getBoundingClientRect();
  if (er.width < 1 || er.height < 1) return null;
  const cr = container.getBoundingClientRect();
  return { top: er.top - cr.top, left: er.left - cr.left, width: er.width, height: er.height };
}
