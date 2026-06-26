"use strict";

// OfficeMap — standalone, presentation-only pannable/zoomable office floor map.
// Owns NO booking/domain logic. Driven entirely by a data model (§4 of
// PLAN_officemap.md). Used only in the user-facing booking view (plan.html).
//
// pan/zoom via @panzoom/panzoom; seat sprite via external <use href="#cell-<name>">.

import Panzoom from '@panzoom/panzoom';

const STYLE_ID = 'officemap-default-styles';

const DEFAULT_CSS = `
.OMMap{position:relative;overflow:hidden;width:100%;height:100%;touch-action:none;background:var(--warp-map-bg,#f5f5f5);user-select:none}
.OMBackground{position:absolute;left:0;top:0;width:100%;height:100%;display:block;transform-origin:0 0;pointer-events:none}
.OMWorld{position:absolute;left:0;top:0;transform-origin:0 0}
.OMSeat{position:absolute;transform-origin:50% 50%;cursor:pointer;will-change:transform}
.OMSeatGlyph{display:block;pointer-events:none}
.OMLabel{position:absolute;left:50px;top:-2px;max-width:220px;padding:2px 6px;background:var(--warp-label-bg,rgba(255,255,255,.9));border:1px solid var(--warp-label-border,rgba(0,0,0,.15));border-radius:4px;font:12px/1.3 sans-serif;color:var(--warp-label-fg,#333);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.OMLabelTitle{font-weight:600}
.OMLabelBody{margin-top:1px;font-weight:400;opacity:.85}
.OMHint{position:absolute;z-index:10;max-width:280px;padding:8px 10px;background:var(--warp-hint-bg,#fff);border:1px solid var(--warp-hint-border,rgba(0,0,0,.2));border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.18);font:13px/1.4 sans-serif;color:var(--warp-hint-fg,#222);pointer-events:none;display:none}
.OMHint.OMHint--visible{display:block}
.OMHintTitle{font-weight:600;margin-bottom:2px}
.OMHintBody{font-weight:400}
.OMZoom{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:4px;z-index:5}
.OMZoom button{width:36px;height:36px;padding:0;border:1px solid var(--warp-zoom-border,#bbb);border-radius:4px;background:var(--warp-zoom-bg,#fff);color:var(--warp-zoom-fg,#333);cursor:pointer;display:flex;align-items:center;justify-content:center}
.OMZoom button:hover{background:var(--warp-zoom-bg-hover,#eee)}
.OMZoom svg{width:18px;height:18px;pointer-events:none}
`;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = DEFAULT_CSS;
  document.head.appendChild(s);
}

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const TAP_MOVE_THRESHOLD = 8;      // px; beyond this a down→up is a drag, not a tap
const LONG_PRESS_MS = 500;          // hold this long on touch → show hint
const DOUBLE_TAP_MS = 300;          // two taps within this → double-tap zoom

// Desired on-screen sprite scale at world zoom k, per the active mode (§6).
function spriteScaleFn(mode, spriteZoom) {
  switch (mode) {
    case 'flat':  return () => 1;
    case 'clamp': {
      const min = spriteZoom ? spriteZoom.min : -Infinity;
      const max = spriteZoom ? spriteZoom.max : Infinity;
      return (k) => Math.min(Math.max(k, min), max);
    }
    case 'follow':
    default:      return (k) => k;
  }
}

export class OfficeMap extends EventTarget {
  // options = model minus seats: { mapImage, sprite:{url,cellWidth,cellHeight},
  //   zoom:{initial,min,max}, spriteZoom?:{min,max}, filter?:string|null }
  constructor(targetEl, options) {
    super();
    ensureStyles();
    this.options = options || {};
    this._seats = new Map();         // id -> { data, el, glyph, labelEl, labelTitleEl, labelBodyEl }
    this._dirty = false;
    this._raf = 0;
    this._mode = null;               // 'follow' | 'flat' | 'clamp'
    this._sFn = null;
    this._hintSeatId = null;
    this._lastTap = { id: null, t: 0 };

    this._build(targetEl);
    this._setMode(options.spriteZoom
      ? 'clamp'
      : (COARSE ? 'flat' : 'follow'));
  }

  _build(targetEl) {
    const root = document.createElement('div');
    root.className = 'OMMap';
    targetEl.appendChild(root);
    this.root = root;

    const world = document.createElement('div');
    world.className = 'OMWorld';
    root.appendChild(world);
    this.world = world;

    const bg = document.createElement('img');
    bg.className = 'OMBackground';
    bg.alt = '';
    bg.draggable = false;
    if (this.options.filter) bg.style.filter = this.options.filter;
    world.appendChild(bg);
    this.bg = bg;

    // Hint popup — child of OMMap (outside the pan/zoom transform), constant size.
    const hint = document.createElement('div');
    hint.className = 'OMHint';
    root.appendChild(hint);
    this.hint = hint;
    this.hintTitle = document.createElement('div');
    this.hintTitle.className = 'OMHintTitle';
    this.hintBody = document.createElement('div');
    this.hintBody.className = 'OMHintBody';
    hint.appendChild(this.hintTitle);
    hint.appendChild(this.hintBody);

    // Zoom controls (icon-only, no translatable strings).
    const zoom = document.createElement('div');
    zoom.className = 'OMZoom';
    root.appendChild(zoom);
    this.zoomEl = zoom;
    this._zoomBtn('OMZoom-in', 'Zoom in', ZOOM_IN_SVG, () => this._pz.zoomIn());
    this._zoomBtn('OMZoom-out', 'Zoom out', ZOOM_OUT_SVG, () => this._pz.zoomOut());
    this._zoomBtn('OMZoom-reset', 'Reset zoom', RESET_SVG, () => this._pz.reset());

    // Map image → once sized, init panzoom at the computed fit/initial scale.
    const sp = this.options.sprite || {};
    this._spriteUrl = sp.url;
    this._cellW = sp.cellWidth || 48;
    this._cellH = sp.cellHeight || 48;

    bg.addEventListener('load', () => this._onImageLoad());
    if (this.options.mapImage) bg.src = this.options.mapImage;

    root.addEventListener('pointerenter', (e) => this._onPointerEnter(e), true);
    root.addEventListener('pointerleave', (e) => this._onPointerLeave(e), true);
    root.addEventListener('pointerdown', (e) => this._onPointerDown(e), true);
    root.addEventListener('pointermove', (e) => this._onPointerMove(e), true);
    root.addEventListener('pointerup', (e) => this._onPointerUp(e), true);
    root.addEventListener('pointercancel', (e) => this._onPointerCancel(e), true);
    root.addEventListener('click', (e) => this._onClick(e), true);
    root.addEventListener('dblclick', (e) => this._onDblClick(e), true);
  }

  _zoomBtn(cls, label, svg, fn) {
    const b = document.createElement('button');
    b.className = cls;
    b.setAttribute('aria-label', label);
    b.type = 'button';
    b.innerHTML = svg;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    this.zoomEl.appendChild(b);
    return b;
  }

  _onImageLoad() {
    this._imgW = this.bg.naturalWidth;
    this._imgH = this.bg.naturalHeight;
    // Size OMWorld to the natural image so panzoom's contain math uses the
    // image extent; OMBackground fills it (width/height:100%). Panzoom
    // transforms OMWorld, so the image and seats pan/zoom together.
    this.world.style.width = this._imgW + 'px';
    this.world.style.height = this._imgH + 'px';
    this._initPanzoom();
  }

  _fitScale() {
    const rw = this.root.clientWidth, rh = this.root.clientHeight;
    if (!rw || !rh || !this._imgW) return 1;
    return Math.min(rw / this._imgW, rh / this._imgH);
  }

  _initPanzoom() {
    if (this._pz) return;
    const fit = this._fitScale();
    const z = this.options.zoom || {};
    const min = (typeof z.min === 'number') ? z.min : fit;
    const max = (typeof z.max === 'number') ? z.max : 4;
    let initial = z.initial;
    let startScale;
    if (initial === 'fit' || initial === undefined || initial === null) startScale = fit;
    else startScale = initial;
    // Clamp initial into [min,max].
    startScale = Math.min(Math.max(startScale, min), max);
    this._pz = Panzoom(this.world, {
      // No panzoom `contain`: it would force cover-at-min (image always covers
      // viewport), which crops the office on mobile. We want fit-at-min (whole
      // office visible, letterbox gaps OK) and pan clamped so the image can't be
      // dragged off-screen once zoomed in. _clampPan does that (§8).
      minScale: min,
      maxScale: max,
      startScale,
      startX: 0,
      startY: 0,
      step: 0.3,
      cursor: 'move',
    });
    // Panzoom has no .on(); it dispatches 'panzoomchange' on the element.
    this.world.addEventListener('panzoomchange', () => this._onTransform());
    // Wheel zoom is NOT auto-bound by panzoom; bind it (non-passive so preventDefault works).
    this.world.addEventListener('wheel', (e) => this._pz && this._pz.zoomWithWheel(e), { passive: false });
    this._onTransform();
  }

  _onTransform() {
    this._clampPan();
    this._applyCounterScale();
  }

  // Keep the image within the viewport: when the scaled image is smaller than
  // the viewport along an axis, centre it (letterbox); when larger, clamp pan so
  // the image always covers that axis (can't be dragged off-screen). §8.
  //
  // Panzoom applies `scale(k) translate(x,y)` to OMWorld with transform-origin
  // 50% 50% (its default for HTML elements). With that origin the bg's top-left
  // screen offset from the parent is  ox = k*x - diffH  where diffH = iw*(k-1)/2,
  // so to hit a desired screen offset ox we set x = (ox + diffH)/k. We compute
  // the desired ox (centre or cover-clamp) and convert back to panzoom coords.
  _clampPan() {
    const pz = this._pz;
    if (!pz || !this._imgW) return;
    const k = pz.getScale();
    const { x, y } = pz.getPan();
    const rw = this.root.clientWidth, rh = this.root.clientHeight;
    const iw = this._imgW, ih = this._imgH;
    const sw = iw * k, sh = ih * k;
    const diffH = iw * (k - 1) / 2, diffV = ih * (k - 1) / 2;
    // desired bg top-left screen offset from the parent (root) origin
    let ox = (sw <= rw) ? (rw - sw) / 2 : Math.min(0, Math.max(rw - sw, k * x - diffH));
    let oy = (sh <= rh) ? (rh - sh) / 2 : Math.min(0, Math.max(rh - sh, k * y - diffV));
    const nx = (ox + diffH) / k, ny = (oy + diffV) / k;
    if (nx !== x || ny !== y) {
      pz.pan(nx, ny, { silent: true, force: true, animate: false });
    }
  }

  _applyCounterScale() {
    if (!this._pz) return;
    const k = this._pz.getScale();
    const fn = this._sFn;
    for (const s of this._seats.values()) {
      const cs = fn(k) / k;            // counter-scale about the seat center (50% 50%)
      s.el.style.transform = `scale(${cs})`;
    }
  }

  // ---- sprite scaling mode (§6) --------------------------------------------
  setSpriteMode(mode) { this._setMode(mode); }
  _setMode(mode) {
    if (mode !== 'follow' && mode !== 'flat' && mode !== 'clamp') mode = 'follow';
    this._mode = mode;
    this._sFn = spriteScaleFn(mode, this.options.spriteZoom);
    this._applyCounterScale();
  }
  getSpriteMode() { return this._mode; }

  // ---- seat model API (§7) --------------------------------------------------
  createSeats(seats) {
    // Full recreation: drop old DOM, build fresh.
    for (const s of this._seats.values()) s.el.remove();
    this._seats.clear();
    for (const seat of seats) this._upsert(seat.id, seat, /*build*/true);
    this._markDirty();
  }

  updateSeat(id, partial) {
    if (partial === null) {                       // delete
      const s = this._seats.get(id);
      if (s) { s.el.remove(); this._seats.delete(id); }
      this._markDirty();
      return;
    }
    const existing = this._seats.get(id);
    if (!existing) { this._upsert(id, partial, true); this._markDirty(); return; }
    this._merge(existing.data, partial);
    this._markDirty();
  }

  _merge(dst, src) {
    for (const k of ['x','y','sprite','labelTitle','hintTitle']) {
      if (src[k] !== undefined) dst[k] = (src[k] === null ? null : src[k]);
    }
    for (const k of ['labelBody','hintBody']) {
      if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; // Node|null
    }
  }

  _upsert(id, data, build) {
    let s = this._seats.get(id);
    if (build || !s) {
      s = this._makeSeat(id, data);
      this._seats.set(id, s);
    }
    this._merge(s.data, data);
  }

  _makeSeat(id, data) {
    const el = document.createElement('div');
    el.className = 'OMSeat';
    el.id = 'sprite-' + id;
    el.dataset.seatId = String(id);
    el.style.position = 'absolute';
    el.style.transformOrigin = '50% 50%';

    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'OMSeatGlyph');
    glyph.setAttribute('viewBox', '0 0 24 24');
    glyph.setAttribute('width', this._cellW);
    glyph.setAttribute('height', this._cellH);
    // Fallback disc drawn behind the <use>: covered exactly by any valid
    // cell's own r=10.5 disc, but shows as a loud red disc when the sprite
    // name has no matching #cell-<name> (unknown state → visible failure,
    // not a silent blank). §1.
    const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fallback.setAttribute('cx', '12');
    fallback.setAttribute('cy', '12');
    fallback.setAttribute('r', '10.5');
    fallback.setAttribute('fill', 'var(--warp-error, #d32f2f)');
    glyph.appendChild(fallback);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    glyph.appendChild(use);
    el.appendChild(glyph);

    const labelEl = document.createElement('div');
    labelEl.className = 'OMLabel';
    const labelTitle = document.createElement('div');
    labelTitle.className = 'OMLabelTitle';
    const labelBody = document.createElement('div');
    labelBody.className = 'OMLabelBody';
    labelEl.appendChild(labelTitle);
    labelEl.appendChild(labelBody);
    el.appendChild(labelEl);

    this.world.appendChild(el);
    return { data: Object.assign({}, data), el, glyph, use, labelEl, labelTitleEl: labelTitle, labelBodyEl: labelBody };
  }

  // ---- rAF-batched redraw ---------------------------------------------------
  _markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0; this._dirty = false; this._redraw();
    });
  }

  _redraw() {
    for (const s of this._seats.values()) this._paint(s);
  }

  _paint(s) {
    const d = s.data;
    s.el.style.left = (d.x || 0) + 'px';
    s.el.style.top = (d.y || 0) + 'px';
    // href = spriteUrl#cell-<name>
    const name = d.sprite || '';
    s.use.setAttribute('href', `${this._spriteUrl}#cell-${name}`);
    // Label: shown iff title or body non-null.
    const showLabel = d.labelTitle != null || d.labelBody != null;
    s.labelEl.style.display = showLabel ? '' : 'none';
    s.labelTitleEl.textContent = d.labelTitle != null ? d.labelTitle : '';
    // Reparent fresh body node (or clear).
    s.labelBodyEl.replaceChildren();
    if (d.labelBody instanceof Node) s.labelBodyEl.appendChild(d.labelBody);
    else if (typeof d.labelBody === 'string') s.labelBodyEl.textContent = d.labelBody;
  }

  // ---- hint -----------------------------------------------------------------
  _seatFromEvent(e) {
    const el = e.target.closest('.OMSeat');
    if (!el) return null;
    return this._seats.get(el.dataset.seatId);
  }

  _showHint(s) {
    if (!s) return;
    const d = s.data;
    if (d.hintTitle == null && d.hintBody == null) return;  // no hint for this seat
    this._hintSeatId = s.el.dataset.seatId;
    this.hintTitle.textContent = d.hintTitle != null ? d.hintTitle : '';
    this.hintBody.replaceChildren();
    if (d.hintBody instanceof Node) this.hintBody.appendChild(d.hintBody);
    else if (typeof d.hintBody === 'string') this.hintBody.textContent = d.hintBody;
    this._positionHint(s);
    this.hint.classList.add('OMHint--visible');
  }

  _hideHint() {
    this._hintSeatId = null;
    this.hint.classList.remove('OMHint--visible');
  }

  _positionHint(s) {
    const sr = s.el.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    // Place above the seat glyph; fall back to below if near top edge.
    const above = sr.top - rr.top;
    this.hint.style.left = Math.max(4, Math.min(rr.width - 200, sr.left - rr.left)) + 'px';
    // Hint height unknown until shown; measure then adjust.
    const wantAbove = above > 60;
    this.hint.style.bottom = wantAbove ? '' : '';
    this.hint.style.top = wantAbove
      ? Math.max(4, above - this.hint.offsetHeight - 4) + 'px'
      : (sr.bottom - rr.top + 6) + 'px';
  }

  // ---- interaction ----------------------------------------------------------
  _onPointerEnter(e) {
    if (COARSE) return;                 // hover only on fine pointers
    const s = this._seatFromEvent(e);
    if (s) this._showHint(s);
  }

  _onPointerLeave(e) {
    if (COARSE) return;
    const s = this._seatFromEvent(e);
    if (s && s.el.dataset.seatId === this._hintSeatId) this._hideHint();
  }

  _onPointerDown(e) {
    const s = this._seatFromEvent(e);
    this._down = s ? { id: s.el.dataset.seatId, x: e.clientX, y: e.clientY, t: Date.now(), moved: false, longFired: false, timer: 0 } : null;
    if (!s) return;
    // Long-press → show hint (touch). Suppress the click that would follow release.
    this._down.timer = setTimeout(() => {
      if (this._down && !this._down.moved) {
        this._down.longFired = true;
        this._showHint(this._seats.get(this._down.id));
      }
    }, LONG_PRESS_MS);
  }

  _onPointerMove(e) {
    const d = this._down;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_THRESHOLD) {
      // It's a drag (pan): cancel the long-press hint timer and mark moved.
      if (d.timer) { clearTimeout(d.timer); d.timer = 0; }
      d.moved = true;
    }
  }

  _onPointerUp(e) {
    const down = this._down;
    this._down = null;
    if (!down) return;
    if (down.timer) { clearTimeout(down.timer); down.timer = 0; }
    const moved = down.moved;
    if (moved) return;                   // was a drag (pan) — not a tap
    if (down.longFired) return;          // long-press already revealed hint; don't click
    const s = this._seats.get(down.id);
    if (!s) return;
    // Double-tap (touch) → zoom in.
    const now = Date.now();
    if (COARSE && this._lastTap.id === down.id && now - this._lastTap.t < DOUBLE_TAP_MS) {
      this._lastTap = { id: null, t: 0 };
      if (this._pz) this._pz.zoomIn();
      return;
    }
    this._lastTap = { id: down.id, t: now };
    // Emit click. (Let the native 'click' handler also fire? We emit here directly
    // so a long-press-suppressed release never reaches _onClick.)
    this._emitClick(s);
  }

  _onPointerCancel() {
    if (this._down && this._down.timer) clearTimeout(this._down.timer);
    this._down = null;
  }

  _onClick(e) {
    // Pointer events cover mouse/touch/pen uniformly; pointerup already emits
    // the click for taps. Native 'click' is ignored here to avoid double fire.
    // (Kept as a no-op hook for future fine-pointer-only behaviour.)
  }

  _emitClick(s) {
    this.dispatchEvent(new CustomEvent('click', { detail: { id: s.el.dataset.seatId } }));
  }

  _onDblClick(e) {
    const s = this._seatFromEvent(e);
    if (s && this._pz) { e.stopPropagation(); this._pz.zoomIn(); }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._pz) this._pz.destroy();
    this.root.remove();
  }
}

// Inline SVG glyphs for the zoom controls (icon-only, no i18n, no deps).
const ZOOM_IN_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ZOOM_OUT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const RESET_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>';