/**
 * Candidate Preview visual-edit RUNTIME source (Phase 14K.3).
 *
 * This is the narrow visual-edit runtime injected into the Candidate Preview's
 * Sandpack iframe as a virtual file. It is EDITOR INFRASTRUCTURE, never project
 * content: it lives only in the Sandpack virtual file map, is never written to
 * `payload.files` / All Files / exports, and never mutates the authoritative
 * generated user source.
 *
 * It runs INSIDE the sandbox iframe and owns: pointer capture, meaningful target
 * resolution, its own hover + selected overlays (drawn in its own coordinate
 * system), sanitized selection metadata, image-target detection, and TEMPORARY
 * in-place image replacement + exact restore. It talks to the parent ONLY through
 * the strict `korvix.visual-edit.v1` postMessage protocol — there is no eval, no
 * `new Function`, no generic DOM command, and no access to app auth/session state
 * (there is none in the sandbox). It never sends a DOM node, outerHTML, form
 * values or styles to the parent.
 *
 * The classification rules mirror `src/lib/visualSelection.ts` so Safe Preview and
 * Candidate Preview selections carry the SAME `elementType` / `typeKey`, letting
 * the parent's existing localized label + pill code work unchanged. This module
 * cannot import that file (it must be standalone in the sandbox), so the rules are
 * re-declared here — keep them in sync.
 *
 * Because the sandbox origin is opaque/cross-origin from inside the iframe, the
 * runtime posts to `'*'`; the PARENT validates event.source identity + instance id
 * + protocol + payload shape. This is the documented, sanctioned limitation.
 */

/** Sandpack virtual paths (never part of the generated project / exports). */
export const VE_RUNTIME_VIRTUAL_PATH = '/korvix-visual-edit-runtime.js';
export const VE_BOOT_VIRTUAL_PATH = '/korvix-visual-edit-boot.tsx';

/**
 * Bootstrap entry: run the visual-edit runtime (side-effect import), then the real
 * generated app entry. Import order is preserved by ES modules, so the runtime
 * installs its message listener before the app mounts. `appEntry` is the generated
 * project's own entry path (e.g. `/src/main.tsx`).
 */
export function buildVisualEditBootSource(appEntry: string): string {
  const app = appEntry.replace(/'/g, '');
  return [
    "// Korvix Candidate Preview bootstrap (editor infrastructure — not project source).",
    "import '" + VE_RUNTIME_VIRTUAL_PATH + "';",
    "import '" + app + "';",
    '',
  ].join('\n');
}

/* The runtime is authored with string concatenation and single quotes only — no
 * template literals — so it embeds cleanly inside this module's own template. */
export const VE_RUNTIME_SOURCE = `(function () {
  'use strict';
  if (window.__korvixVisualEdit) { return; }
  window.__korvixVisualEdit = true;

  var NS = 'korvix.visual-edit';
  var VER = 1;
  var TOOL_ATTR = 'data-korvix-ve';
  var MIN_IMAGE_SIDE = 40;
  var MAX_CLIMB = 8;
  var MAX_TEXT = 80;
  var ACCENT = '#3B82F6';

  var TYPE_KEY = {
    heading: 'vsHeading', text: 'vsText', button: 'vsButton', link: 'vsLink',
    image: 'vsImage', card: 'vsCard', navigation: 'vsNavigation', section: 'vsSection',
    footer: 'vsFooter', container: 'vsContainer', unknown: 'vsElement'
  };

  function genId() {
    try { if (window.crypto && window.crypto.randomUUID) { return 've_' + window.crypto.randomUUID(); } } catch (e) {}
    return 've_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  }

  var instanceId = genId();
  var enabled = false;
  var hoverEl = null;
  var selectedEl = null;
  var lastNodeId = null;
  var imgOriginal = null; // { node, kind, src, srcset, sizes, inlineBg }
  var overlay = null, hoverBox = null, selBox = null, selLabel = null;
  var lastMove = 0;
  var ro = null;
  var readyTimers = [];

  /* ── messaging ─────────────────────────────────────────────────────────── */
  function post(type, payload, requestId) {
    var msg = { namespace: NS, version: VER, type: type, instanceId: instanceId };
    if (requestId) { msg.requestId = requestId; }
    if (payload !== undefined) { msg.payload = payload; }
    // Target '*' — parent validates source+instance+protocol+payload (documented).
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  /* ── dom helpers (mirror visualSelection.ts) ───────────────────────────── */
  function isEl(n) { return !!n && n.nodeType === 1; }
  function tagOf(el) { return el.tagName ? el.tagName.toLowerCase() : ''; }
  function isTool(el) { return !!(el && el.closest && el.closest('[' + TOOL_ATTR + ']')); }
  function isBlockedTag(t) {
    return t === 'html' || t === 'head' || t === 'body' || t === 'script' || t === 'style'
      || t === 'link' || t === 'meta' || t === 'svg' || t === 'path' || t === 'g' || t === 'defs' || t === 'use';
  }
  function isInputLike(el) { var t = tagOf(el); return t === 'input' || t === 'textarea' || t === 'select' || t === 'option'; }
  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { return false; }
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) { return false; }
    return true;
  }
  function classify(el) {
    var t = tagOf(el);
    if (t === 'button') { return 'button'; }
    if (t === 'a') { return 'link'; }
    if (t === 'img') { return 'image'; }
    if (/^h[1-6]$/.test(t)) { return 'heading'; }
    if (t === 'nav') { return 'navigation'; }
    if (t === 'footer') { return 'footer'; }
    if (t === 'header' || t === 'section' || t === 'main' || t === 'article') { return 'section'; }
    if (t === 'p' || t === 'span' || t === 'li' || t === 'blockquote') { return 'text'; }
    var p = el.parentElement;
    if (p && (tagOf(p) === 'section' || p.getAttribute('role') === 'list')
      && p.children.length >= 2 && el.querySelector('h1,h2,h3,h4,h5,h6,p,img,button')) { return 'card'; }
    return 'container';
  }
  function resolveTarget(node) {
    var root = document.body;
    var el = isEl(node) ? node : (node && node.parentElement) || null;
    if (!el || !root.contains(el)) { return null; }
    if (isTool(el)) { return null; }
    var guard = 0;
    while (el && guard++ < MAX_CLIMB && (isBlockedTag(tagOf(el)) || isInputLike(el))) {
      if (el === root) { break; }
      el = el.parentElement;
    }
    if (!el || el === root || !root.contains(el)) { return null; }
    var control = el.closest('button, a[href], [role="button"]');
    if (control && root.contains(control) && isVisible(control)) { return control; }
    if (tagOf(el) === 'img') { return isVisible(el) ? el : null; }
    var heading = el.closest('h1,h2,h3,h4,h5,h6');
    if (heading && root.contains(heading) && isVisible(heading)) { return heading; }
    var type = classify(el);
    if ((type === 'text' || type === 'card' || type === 'navigation' || type === 'footer' || type === 'section') && isVisible(el)) { return el; }
    var cur = el, depth = 0;
    while (cur && cur !== root && depth++ < MAX_CLIMB) {
      if (isVisible(cur)) { var tt = classify(cur); if (tt !== 'container' && tt !== 'unknown') { return cur; } }
      cur = cur.parentElement;
    }
    return isVisible(el) ? el : null;
  }

  /* ── selection model (sanitized; mirrors visualSelection.buildSelection) ── */
  function sectionOf(el) { var s = el.closest('section,header,footer,nav,main,article'); return s && document.body.contains(s) ? s : null; }
  function sectionName(sec) {
    if (!sec) { return undefined; }
    var aria = sec.getAttribute('aria-label');
    var h = sec.querySelector('h1,h2,h3,h4,h5,h6');
    var raw = aria || (h && h.textContent) || '';
    var n = raw.replace(/\\s+/g, ' ').trim();
    return n ? n.slice(0, 28) : undefined;
  }
  function textPreviewOf(el) {
    if (isInputLike(el)) { return undefined; }
    var raw = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!raw) { return undefined; }
    return raw.length > MAX_TEXT ? raw.slice(0, MAX_TEXT) + '\\u2026' : raw;
  }
  function domPathOf(el) {
    var parts = [], cur = el, d = 0;
    while (cur && cur !== document.body && d++ < 6) { parts.unshift(tagOf(cur)); cur = cur.parentElement; }
    return parts.join('>');
  }
  function buildSelection(el) {
    var tagName = tagOf(el);
    var elementType = classify(el);
    var sec = sectionOf(el);
    var section = sectionName(sec);
    var metaId = el.getAttribute('data-korvix-id') || (el.id && el.id.indexOf('radix-') !== 0 ? el.id : '');
    var nodeId, identitySource;
    if (metaId) { nodeId = metaId; identitySource = 'metadata'; }
    else {
      var scope = sec && sec.id ? sec.id : (sec ? tagOf(sec) : 'root');
      var scopeRoot = sec || document.body;
      var same = Array.prototype.slice.call(scopeRoot.querySelectorAll(tagName));
      var index = Math.max(0, same.indexOf(el));
      nodeId = scope + '/' + tagName + '[' + index + ']';
      identitySource = 'runtime';
    }
    var typeKey = (elementType === 'heading' && tagName === 'h1') ? 'vsMainHeading' : TYPE_KEY[elementType];
    return {
      version: 1, nodeId: nodeId, identitySource: identitySource, tagName: tagName,
      role: el.getAttribute('role') || tagName, elementType: elementType, typeKey: typeKey,
      section: section, textPreview: textPreviewOf(el), domPath: domPathOf(el)
    };
  }

  /* ── image target detection (mirrors visualSelection.getImageTarget) ────── */
  function isSvgLike(el) {
    var t = tagOf(el);
    if (t === 'svg' || t === 'path' || t === 'g' || t === 'use' || t === 'defs') { return true; }
    return !!(el.closest && el.closest('svg'));
  }
  function bgUrl(el) {
    var cs = getComputedStyle(el);
    var bg = ((cs && cs.backgroundImage) || '').trim();
    if (!bg || bg === 'none') { return ''; }
    if (/gradient/i.test(bg)) { return ''; }
    if ((bg.match(/url\\(/g) || []).length !== 1) { return ''; }
    var m = bg.match(/url\\(\\s*(['"]?)(.*?)\\1\\s*\\)/i);
    var u = m ? m[2].trim() : '';
    if (!u || u.indexOf('data:') === 0) { return ''; }
    if (!/^https:\\/\\//i.test(u)) { return ''; }
    return u;
  }
  function imgUrl(img) {
    var s = (img.currentSrc || img.src || '').trim();
    if (!s || s.indexOf('data:') === 0) { return ''; }
    if (!/^https:\\/\\//i.test(s)) { return ''; }
    return s;
  }
  function imageInfo(el) {
    var t = tagOf(el), img = null;
    if (t === 'img') { img = el; }
    else if (t === 'picture') { img = el.querySelector('img'); }
    if (img && document.body.contains(img) && !isSvgLike(img)) {
      var r = img.getBoundingClientRect();
      if (r.width >= MIN_IMAGE_SIDE && r.height >= MIN_IMAGE_SIDE) {
        var cs = getComputedStyle(img);
        var url = imgUrl(img);
        if (url) {
          return { node: img, kind: 'img', data: {
            imageKind: 'img', currentUrl: url, altText: img.getAttribute('alt') || undefined,
            width: Math.round(r.width), height: Math.round(r.height),
            aspectRatio: r.height ? r.width / r.height : undefined,
            objectFit: (cs && cs.objectFit) || undefined, sourceAttribute: 'src', canPreviewReplace: true
          } };
        }
        return { node: img, kind: 'img', data: {
          imageKind: 'img', currentUrl: '', width: Math.round(r.width), height: Math.round(r.height),
          sourceAttribute: 'src', canPreviewReplace: false, limitationReason: 'unsupported_source'
        } };
      }
    }
    if (!isSvgLike(el)) {
      var r2 = el.getBoundingClientRect();
      if (r2.width >= MIN_IMAGE_SIDE && r2.height >= MIN_IMAGE_SIDE) {
        var bg = bgUrl(el);
        if (bg) {
          var cs2 = getComputedStyle(el);
          return { node: el, kind: 'background', data: {
            imageKind: 'background', currentUrl: bg, altText: el.getAttribute('aria-label') || undefined,
            width: Math.round(r2.width), height: Math.round(r2.height),
            aspectRatio: r2.height ? r2.width / r2.height : undefined,
            objectFit: (cs2 && cs2.backgroundSize) || undefined, sourceAttribute: 'background-image', canPreviewReplace: true
          } };
        }
      }
    }
    return null;
  }

  /* ── overlay (drawn inside the iframe, in the iframe's own coordinates) ─── */
  function ensureOverlay() {
    if (overlay) { return; }
    overlay = document.createElement('div');
    overlay.setAttribute(TOOL_ATTR, 'root');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
    hoverBox = document.createElement('div');
    hoverBox.setAttribute(TOOL_ATTR, 'hover');
    hoverBox.style.cssText = 'display:none;position:fixed;box-sizing:border-box;border:1.5px solid rgba(59,130,246,0.6);background:rgba(59,130,246,0.08);border-radius:4px;';
    selBox = document.createElement('div');
    selBox.setAttribute(TOOL_ATTR, 'selected');
    selBox.style.cssText = 'display:none;position:fixed;box-sizing:border-box;border:2px solid ' + ACCENT + ';background:rgba(59,130,246,0.10);border-radius:4px;box-shadow:0 0 0 1px rgba(59,130,246,0.25);';
    selLabel = document.createElement('span');
    selLabel.setAttribute(TOOL_ATTR, 'label');
    selLabel.style.cssText = 'position:absolute;top:-22px;left:-2px;white-space:nowrap;font:600 11px system-ui,sans-serif;color:#fff;background:#2563EB;border-radius:6px;padding:2px 8px;max-width:260px;overflow:hidden;text-overflow:ellipsis;';
    selBox.appendChild(selLabel);
    overlay.appendChild(hoverBox);
    overlay.appendChild(selBox);
    document.body.appendChild(overlay);
  }
  function paintBox(box, el) {
    if (!box) { return; }
    if (!el || !document.body.contains(el)) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.top = r.top + 'px';
    box.style.left = r.left + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  }
  function removeOverlay() {
    if (overlay && overlay.parentNode) { try { overlay.parentNode.removeChild(overlay); } catch (e) {} }
    overlay = null; hoverBox = null; selBox = null; selLabel = null;
  }
  function hideHover() { hoverEl = null; if (hoverBox) { hoverBox.style.display = 'none'; } }
  function repaintSelected() {
    if (!selectedEl) { return; }
    if (!document.body.contains(selectedEl)) { clearSelection(true); return; }
    paintBox(selBox, selectedEl);
  }

  /* ── image preview / restore ───────────────────────────────────────────── */
  function captureOriginal(node, kind) {
    if (imgOriginal && imgOriginal.node === node) { return; }
    restoreImage(false);
    if (kind === 'img') {
      imgOriginal = { node: node, kind: kind, src: node.getAttribute('src'), srcset: node.getAttribute('srcset'), sizes: node.getAttribute('sizes') };
    } else {
      imgOriginal = { node: node, kind: kind, inlineBg: node.style.backgroundImage };
    }
  }
  function restoreImage(notify) {
    var o = imgOriginal;
    if (!o) { return; }
    imgOriginal = null;
    try {
      if (o.kind === 'img') {
        if (o.src != null) { o.node.setAttribute('src', o.src); } else { o.node.removeAttribute('src'); }
        if (o.srcset != null) { o.node.setAttribute('srcset', o.srcset); } else { o.node.removeAttribute('srcset'); }
        if (o.sizes != null) { o.node.setAttribute('sizes', o.sizes); } else { o.node.removeAttribute('sizes'); }
      } else {
        o.node.style.backgroundImage = o.inlineBg || '';
      }
    } catch (e) {}
    if (notify) { post('IMAGE_RESTORED', { nodeId: lastNodeId || undefined }); }
  }
  function applyUrl(node, kind, url) {
    if (kind === 'img') {
      node.removeAttribute('srcset');
      node.removeAttribute('sizes');
      node.setAttribute('src', url);
    } else {
      node.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    }
  }
  function handlePreview(payload, requestId) {
    if (!payload || typeof payload !== 'object') { post('ERROR', { code: 'bad_payload' }, requestId); return; }
    var nodeId = payload.nodeId, provider = payload.provider, url = payload.url;
    if (typeof url !== 'string' || !/^https:\\/\\//i.test(url)) { post('ERROR', { code: 'invalid_url' }, requestId); return; }
    if (provider !== 'pexels' && provider !== 'unsplash' && provider !== 'user-upload') { post('ERROR', { code: 'invalid_provider' }, requestId); return; }
    if (!selectedEl || !document.body.contains(selectedEl)) { post('ERROR', { code: 'selection_gone' }, requestId); return; }
    if (nodeId && lastNodeId && nodeId !== lastNodeId) { post('ERROR', { code: 'node_mismatch' }, requestId); return; }
    var info = imageInfo(selectedEl);
    if (!info || !info.data.canPreviewReplace) { post('ERROR', { code: 'not_replaceable' }, requestId); return; }
    captureOriginal(info.node, info.kind);
    var node = info.node, kind = info.kind;
    var pre = new Image();
    var done = false;
    pre.onload = function () { if (done) { return; } done = true; applyUrl(node, kind, url); post('IMAGE_PREVIEW_APPLIED', { nodeId: lastNodeId || undefined, provider: provider, providerImageId: payload.providerImageId || '' }, requestId); };
    pre.onerror = function () { if (done) { return; } done = true; restoreImage(false); post('ERROR', { code: 'image_load_failed' }, requestId); };
    try { pre.src = url; } catch (e) { post('ERROR', { code: 'image_load_failed' }, requestId); }
  }

  /* ── selection lifecycle ───────────────────────────────────────────────── */
  function selectionLabelText(sel) {
    return sel.section ? sel.section + ' \\u00b7 ' + sel.elementType : sel.elementType;
  }
  function select(el) {
    // A new selection restores any previous temporary preview first.
    if (selectedEl && el !== selectedEl) { restoreImage(false); }
    selectedEl = el;
    var sel = buildSelection(el);
    lastNodeId = sel.nodeId;
    var info = imageInfo(el);
    var imageTarget = info ? info.data : null;
    ensureOverlay();
    hideHover();
    paintBox(selBox, el);
    if (selLabel) { selLabel.textContent = selectionLabelText(sel); }
    post('SELECTED', { selection: sel, imageTarget: imageTarget });
  }
  function clearSelection(notify) {
    restoreImage(false);
    selectedEl = null; lastNodeId = null;
    if (selBox) { selBox.style.display = 'none'; }
    if (ro) { try { ro.disconnect(); } catch (e) {} }
    if (notify) { post('SELECTION_CLEARED', {}); }
  }

  var onMove = function (e) {
    if (!enabled) { return; }
    var now = e.timeStamp || Date.now();
    if (now - lastMove < 24) { return; }
    lastMove = now;
    var el = resolveTarget(e.target);
    if (el === hoverEl) { if (el) { paintBox(hoverBox, el); } return; }
    hoverEl = el;
    if (el) { paintBox(hoverBox, el); } else { hideHover(); }
  };
  var onClick = function (e) {
    if (!enabled) { return; }
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) { e.stopImmediatePropagation(); }
    var el = resolveTarget(e.target);
    if (el) { select(el); }
  };
  var block = function (e) { if (enabled) { e.preventDefault(); e.stopPropagation(); } };
  var onScroll = function () { if (enabled) { hideHover(); repaintSelected(); } };
  var onResize = function () { if (enabled) { hideHover(); repaintSelected(); } };
  var onKey = function (e) {
    if (!enabled || e.key !== 'Escape') { return; }
    if (hoverEl) { hideHover(); return; }
    if (selectedEl) { clearSelection(true); return; }
    disable();
  };

  function attach() {
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', block, true);
    document.addEventListener('dragstart', block, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize, true);
    document.addEventListener('keydown', onKey, true);
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function () { repaintSelected(); });
      try { ro.observe(document.body); } catch (e) {}
    }
  }
  function detach() {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', block, true);
    document.removeEventListener('dragstart', block, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize, true);
    document.removeEventListener('keydown', onKey, true);
    if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
  }

  function enable() {
    if (enabled) { return; }
    enabled = true;
    ensureOverlay();
    attach();
    post('SELECTION_MODE_CHANGED', { enabled: true });
  }
  function disable() {
    if (!enabled) { post('SELECTION_MODE_CHANGED', { enabled: false }); return; }
    enabled = false;
    detach();
    hideHover();
    clearSelection(false);
    removeOverlay();
    post('SELECTION_MODE_CHANGED', { enabled: false });
  }

  /* ── command handler ───────────────────────────────────────────────────── */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') { return; }
    if (d.namespace !== NS || d.version !== VER) { return; }
    if (d.instanceId !== instanceId) { return; }
    switch (d.type) {
      case 'PING': post('PONG'); break;
      case 'GET_STATE': post('STATE', { enabled: enabled, hasSelection: !!selectedEl }); break;
      case 'ENABLE_SELECTION': enable(); break;
      case 'DISABLE_SELECTION': disable(); break;
      case 'CLEAR_SELECTION': clearSelection(true); break;
      case 'PREVIEW_IMAGE': handlePreview(d.payload, d.requestId); break;
      case 'RESTORE_IMAGE': restoreImage(true); break;
      case 'MEASURE': handleMeasure(d.payload); break;
      default: break;
    }
  }, false);

  /* ── PR #517 — read-only layout MEASUREMENT. Reports ONLY bounded numeric/boolean layout
   *  facts (never DOM nodes, HTML, text, source, styles or user data). Fully guarded. ── */
  function rectTop(el) { try { return Math.round(el.getBoundingClientRect().top); } catch (e) { return 1e7; } }
  function handleMeasure(payload) {
    try {
      var p = (payload && typeof payload === 'object') ? payload : {};
      var vp = (p.viewport === 'desktop' || p.viewport === 'tablet' || p.viewport === 'mobile') ? p.viewport : 'desktop';
      var runId = (typeof p.runId === 'string') ? p.runId.slice(0, 128) : '';
      if (!runId) { return; }
      var docEl = document.documentElement;
      var body = document.body;
      var vw = Math.round(window.innerWidth || (docEl && docEl.clientWidth) || 0);
      var vh = Math.round(window.innerHeight || (docEl && docEl.clientHeight) || 0);
      var contentH = Math.round(Math.max(docEl ? docEl.scrollHeight : 0, body ? body.scrollHeight : 0));
      var scrollW = Math.round(Math.max(docEl ? docEl.scrollWidth : 0, body ? body.scrollWidth : 0));
      var clientW = Math.round((docEl && docEl.clientWidth) || vw);
      var horizontalOverflow = scrollW > clientW + 2;
      // Blank: almost no visible text and no images rendered.
      var textLen = 0; try { textLen = (body && body.innerText ? body.innerText : '').replace(/\\s+/g, ' ').trim().length; } catch (e2) { textLen = 0; }
      var imgCount = 0; try { imgCount = document.querySelectorAll('img').length; } catch (e3) { imgCount = 0; }
      var blank = textLen < 8 && imgCount === 0;
      // Whitespace ratio (rough, deterministic): fraction of the FIRST viewport not covered by
      // the top-level content blocks. Bounded to [0,1]; never inspects pixels.
      var whitespaceRatio = 0;
      try {
        var blocks = document.querySelectorAll('section, header, main > *');
        var covered = 0, n = Math.min(blocks.length, 40);
        for (var i = 0; i < n; i++) {
          var r = blocks[i].getBoundingClientRect();
          if (r.top < vh && r.bottom > 0) { covered += Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top)); }
        }
        if (vh > 0) { whitespaceRatio = Math.max(0, Math.min(1, 1 - (covered / vh))); }
      } catch (e4) { whitespaceRatio = 0; }
      // First meaningful content top.
      var firstContentTop = undefined;
      try { var first = document.querySelector('h1, [data-korvix-id], section, header, main'); if (first) firstContentTop = Math.max(0, rectTop(first)); } catch (e5) {}
      // Layout-contract facts (only when the parent asked).
      var heroVisible = undefined, ctaInFirstViewport = undefined, marketingHeroOnAppFirst = undefined;
      try {
        if (p.expectHero === true) {
          var hero = document.querySelector('[data-korvix-id*="hero" i], header, section');
          heroVisible = !!(hero && rectTop(hero) < vh && hero.getBoundingClientRect().height > 40);
        }
        if (p.expectCta === true) {
          var ctas = document.querySelectorAll('a, button'); var seen = false;
          for (var j = 0; j < Math.min(ctas.length, 60); j++) { var cr = ctas[j].getBoundingClientRect(); if (cr.top >= 0 && cr.top < vh && cr.width > 0 && cr.height > 0) { seen = true; break; } }
          ctaInFirstViewport = seen;
        }
        if (p.appFirst === true) {
          var h1 = document.querySelector('h1');
          marketingHeroOnAppFirst = !!(h1 && rectTop(h1) < vh && contentH > vh * 1.5 && document.querySelectorAll('a, button').length >= 2);
        }
      } catch (e6) {}
      var out = {
        viewport: vp, runId: runId, width: vw, height: vh, contentHeight: contentH,
        horizontalOverflow: horizontalOverflow, whitespaceRatio: whitespaceRatio, blank: blank,
        runtimeCompiled: true, runtimeError: false
      };
      if (typeof firstContentTop === 'number') out.firstContentTop = firstContentTop;
      if (typeof heroVisible === 'boolean') out.heroVisible = heroVisible;
      if (typeof ctaInFirstViewport === 'boolean') out.ctaInFirstViewport = ctaInFirstViewport;
      if (typeof marketingHeroOnAppFirst === 'boolean') out.marketingHeroOnAppFirst = marketingHeroOnAppFirst;
      post('MEASUREMENT', out);
    } catch (err) { /* fail silent — measurement is advisory only */ }
  }

  // Teardown: restore any temporary preview if the iframe is torn down.
  window.addEventListener('pagehide', function () { restoreImage(false); detach(); }, false);
  window.addEventListener('beforeunload', function () { restoreImage(false); }, false);

  /* ── announce readiness (retry a few times to beat the parent listener) ── */
  function announce() { post('READY', { instanceId: instanceId }); }
  announce();
  [150, 500, 1200, 2500].forEach(function (ms) { readyTimers.push(setTimeout(announce, ms)); });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce, false);
  }
})();
`;
