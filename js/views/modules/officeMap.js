"use strict";

// OfficeMap — standalone, presentation-only pannable/zoomable office floor map.
// Owns NO booking/domain logic. Driven entirely by a data model (§4 of
// PLAN_officemap.md). Used only in the user-facing booking view (plan.html).
//
// pan/zoom via @panzoom/panzoom; seat sprite via external <use href="#cell-<name>">.

import Panzoom from '@panzoom/panzoom';

const STYLE_ID = 'officemap-default-styles';

// OfficeMap's own design tokens — FLAT, mode-independent defaults, used as
// var() fallbacks below (e.g. background:var(--om-map-bg,#f5f5f5)). The
// component is theme-agnostic; a host defines the --om-* vars (mapped to its
// own theme vars) to theme it. With no host override, the fallbacks apply so it
// works standalone.
const DEFAULT_CSS = `
.OMMap{position:relative;overflow:hidden;width:100%;height:100%;touch-action:none;overscroll-behavior:none;background:var(--om-map-bg,#f5f5f5);user-select:none}
.OMBackground{position:absolute;left:0;top:0;width:100%;height:100%;display:block;transform-origin:0 0;pointer-events:none}
.OMWorld{position:absolute;left:0;top:0;transform-origin:0 0}
.OMSeat{position:absolute;cursor:pointer;transform-origin:50% 50%;will-change:transform}
.OMSeatGlyph{display:block;pointer-events:none}
.OMLabel{position:absolute;left:50px;top:-2px;max-width:220px;z-index:10;padding:2px 6px;background:var(--om-label-bg,rgba(255,255,255,.94));border:1px solid var(--om-label-border,rgba(0,0,0,.15));border-radius:4px;font:12px/1.3 sans-serif;color:var(--om-label-fg,#333);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.OMLabelTitle{font-weight:600}
.OMLabelBody{margin-top:1px;font-weight:400;opacity:.85}
.OMHint{position:absolute;z-index:10;max-width:280px;padding:8px 10px;background:var(--om-hint-bg,#fff);border:1px solid var(--om-hint-border,rgba(0,0,0,.2));border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.18);font:13px/1.4 sans-serif;color:var(--om-hint-fg,#222);pointer-events:none;display:none}
.OMHint.OMHint--visible{display:block}
.OMHintTitle{font-weight:600;margin-bottom:2px}
.OMHintBody{font-weight:400}
.OMZoom{position:absolute;right:10px;top:10px;bottom:auto;display:flex;flex-direction:column;gap:4px;z-index:5}
.OMZoom button{width:36px;height:36px;padding:0;border:1px solid var(--om-zoom-border,#bbb);border-radius:4px;background:var(--om-zoom-bg,#fff);color:var(--om-zoom-fg,#333);cursor:pointer;display:flex;align-items:center;justify-content:center}
.OMZoom button:hover{background:var(--om-zoom-bg-hover,#eee)}
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

const TAP_FINE = 8;     // px; mouse/pen — precise pointers
const TAP_COARSE = 18;  // px; touch — a finger tap drifts ~10-30px as it presses/lifts;
                       //       below this a down→up is a tap, not a drag
const LONG_PRESS_MS = 500;          // hold this long on touch → show hint
const DOUBLE_TAP_MS = 300;          // two taps within this → double-tap (reset zoom)
const DOUBLE_TAP_DIST = 40;         // px; the two taps must land within this to count as a double-tap

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
    this._hintBuilder = options.hintBuilder || null;
    this._activePid = null;
    this._lastTap = { x: 0, y: 0, t: 0 };
    this._validCells = null;     // Set<string> of #cell-<name> ids in the sprite (null until loaded)

    this._build(targetEl);
    this._loadSpriteCells();
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
    this._zoomBtn('OMZoom-in', 'Zoom in', ZOOM_IN_SVG, () => this._animatedZoom(() => this._pz.zoomIn({ animate: true })));
    this._zoomBtn('OMZoom-out', 'Zoom out', ZOOM_OUT_SVG, () => this._animatedZoom(() => this._pz.zoomOut({ animate: true })));
    this._zoomBtn('OMZoom-reset', 'Reset zoom', RESET_SVG, () => this._pz.reset());

    // Map image → once sized, init panzoom at the computed fit/initial scale.
    const sp = this.options.sprite || {};
    this._spriteUrl = sp.url;
    this._cellW = sp.cellWidth || 48;
    this._cellH = sp.cellHeight || 48;

    bg.addEventListener('load', () => this._onImageLoad());
    if (this.options.mapImage) {
      bg.src = this.options.mapImage;
      // Cached/instant images may already be decoded (Safari sometimes skips the
      // 'load' event for these); set the dims now too.
      if (bg.complete && bg.naturalWidth > 0) this._onImageLoad();
    }
    // Panzoom must init with the root actually laid out: the root is a flex
    // child and has clientWidth=0 synchronously at mount, so a cached/instant
    // image (which loads before the first layout) would otherwise init panzoom
    // against zero root dims — minScale derived from a zero-width root, and
    // wheel zoom silently does nothing until a click/resize forces a relayout.
    // ResizeObserver fires once layout has happened, then on every viewport
    // change; _onRootResize gates init on non-zero dims and re-clamps on resize.
    this._ro = new ResizeObserver(() => this._onRootResize());
    this._ro.observe(this.root);

    root.addEventListener('pointerenter', (e) => this._onPointerEnter(e), true);
    root.addEventListener('pointerleave', (e) => this._onPointerLeave(e), true);
    root.addEventListener('pointerdown', (e) => this._onPointerDown(e), true);
    root.addEventListener('pointermove', (e) => this._onPointerMove(e), true);
    root.addEventListener('pointerup', (e) => this._onPointerUp(e), true);
    root.addEventListener('pointercancel', (e) => this._onPointerCancel(e), true);
    root.addEventListener('click', (e) => this._onClick(e), true);
    root.addEventListener('dblclick', (e) => this._onDblClick(e), true);
    // Track the active pointer so we can forcibly release a pan when the user
    // right-clicks or the window loses focus (otherwise panzoom can stay stuck
    // panning). The world pointerdown fires for every drag (incl. empty map).
    this.world.addEventListener('pointerdown', (e) => { this._activePID = e.pointerId; }, true);
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // On touch the long-press we use for the hint ALSO raises `contextmenu`.
      // Force-releasing the pan here clears the in-flight press (_down), which
      // orphans the just-shown hint (it can then never hide on release) and kills
      // long-press on browsers that raise contextmenu early. Only force-release on
      // fine pointers — desktop right-click, the case this was actually for.
      if (!COARSE) this._releasePan();
    });
    // Wheel is bound at mount (NOT in _initPanzoom, which waits for the image to
    // decode): in Safari the image 'load' event can be deferred, so until it
    // fires the listener was absent and wheel scrolled/bounced the document.
    // _onWheel preventDefaults before checking panzoom, so the page never
    // scrolls over the map even before panzoom is ready.
    root.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this._onWindowBlur = () => this._releasePan();
    window.addEventListener('blur', this._onWindowBlur);

    // Touch synthesises a compatibility 'click' ~300ms after our pointerup-driven
    // tap. panzoom uses Pointer Events, so its pointerdown preventDefault does NOT
    // suppress it; that ghost click lands at the tap point — now over the modal's
    // backdrop — and WarpDialog._onBackdrop dismisses the modal the instant it
    // opened. Swallow the single ghost click at the tap location, in the capture
    // phase, before it reaches the dialog. Location-gated so it can't eat a real
    // click elsewhere (e.g. a modal button).
    this._onDocClickCapture = (e) => {
      if (!this._swallowNextClick) return;
      if (Math.hypot(e.clientX - this._swallowAt.x, e.clientY - this._swallowAt.y) > 40) return;
      this._swallowNextClick = false;
      clearTimeout(this._swallowClickTimer);
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('click', this._onDocClickCapture, true);
  }

  // Arm the one-shot ghost-click swallow for the tap that just happened (touch).
  _armGhostClickSwallow(e) {
    this._swallowNextClick = true;
    this._swallowAt = { x: e.clientX, y: e.clientY };
    clearTimeout(this._swallowClickTimer);
    this._swallowClickTimer = setTimeout(() => { this._swallowNextClick = false; }, 700);
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
    this._imgReady = true;
    this._maybeInitPanzoom();
  }

  _onRootResize() {
    if (this.root.clientWidth > 0) { this._rootReady = true; this._maybeInitPanzoom(); }
    if (this._pz) this._onTransform();   // re-clamp pan with fresh root dims (resize/orientation)
  }

  _fitScale() {
    const rw = this.root.clientWidth, rh = this.root.clientHeight;
    if (!rw || !rh || !this._imgW) return 1;
    return Math.min(rw / this._imgW, rh / this._imgH);
  }

  _maybeInitPanzoom() {
    // Wait for BOTH the image dims (so the world is sized + minScale computable)
    // and the root to be laid out (non-zero dims): a flex child is 0x0
    // synchronously at mount, and a cached image can load before the first
    // layout, which previously inited panzoom against zero root dims.
    if (this._pz || !this._imgReady || !this._rootReady) return;
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
    // Centre the map in the viewport at the initial scale. Panzoom uses
    // transform-origin 50% 50%, so the pan x that puts the image's centre on the
    // viewport's centre is (rootW - imgW)/(2*scale) (and likewise for y). _clampPan
    // then keeps this (the centre is always within bounds).
    const startX = (this.root.clientWidth  - this._imgW) / (2 * startScale);
    const startY = (this.root.clientHeight - this._imgH) / (2 * startScale);
    this._pz = Panzoom(this.world, {
      // No panzoom `contain`: it would force cover-at-min (image always covers
      // viewport), which crops the office on mobile. We want fit-at-min (whole
      // office visible, letterbox gaps OK) and pan clamped so the image can't be
      // dragged off-screen once zoomed in. _clampPan does that (§8).
      minScale: min,
      maxScale: max,
      startScale,
      startX,
      startY,
      step: 0.3,
      cursor: 'move',
    });
    // Panzoom has no .on(); it dispatches 'panzoomchange' on the element.
    this.world.addEventListener('panzoomchange', () => this._onTransform());
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
      // panzoom writes the transform AND fires panzoomchange inside a rAF, so the
      // out-of-bounds drag is ALREADY painted on the element by the time we run
      // here. pz.pan() alone would only correct it on the next rAF → a one-frame
      // bounce at the edges (the visible flicker). So overwrite the transform
      // synchronously now (matching panzoom's own format) — no out-of-bounds frame
      // ever reaches the screen — and still pz.pan(silent) to sync panzoom's
      // internal x/y for the next gesture. During an animated zoom we let the
      // transition run instead of snapping.
      if (!this._animatingZoom)
        this.world.style.transform = `scale(${k}) translate(${nx}px, ${ny}px)`;
      pz.pan(nx, ny, { silent: true, force: true, animate: !!this._animatingZoom });
    }
  }

  _applyCounterScale(force) {
    if (!this._pz) return;
    const k = this._pz.getScale();
    // Pan-only frames keep k constant — the sprite scale can't change, so skip
    // the per-seat writes (the hot path during a drag; cheaper = no jank/flicker).
    // force=true for mode changes and freshly created seats, where the transform
    // must be (re)written regardless.
    if (!force && k === this._lastCounterK) return;
    this._lastCounterK = k;
    const fn = this._sFn;
    for (const s of this._seats.values()) {
      const cs = fn(k) / k;            // counter-scale the whole seat (glyph + label) about its center
      s.el.style.transform = `scale(${cs})`;
    }
  }

  // ---- sprite scaling mode (§6) --------------------------------------------
  setSpriteMode(mode) { this._setMode(mode); }

  // Update the OMBackground CSS filter (dark-mode plan filter). Pass null/'' to clear.
  setFilter(filter) {
    if (this.bg) this.bg.style.filter = filter || '';
  }
  _setMode(mode) {
    if (mode !== 'follow' && mode !== 'flat' && mode !== 'clamp') mode = 'follow';
    this._mode = mode;
    this._sFn = spriteScaleFn(mode, this.options.spriteZoom);
    this._applyCounterScale(true);
  }
  getSpriteMode() { return this._mode; }

  // ---- seat model API (§7) --------------------------------------------------
  createSeats(seats) {
    // Full recreation: drop old DOM, build fresh. Any shown hint belongs to a seat
    // that's about to be removed, so dismiss it (it persists across interactions now).
    if (this._hintSeatId != null) this._hideHint();
    for (const s of this._seats.values()) s.el.remove();
    this._seats.clear();
    for (const seat of seats) this._upsert(seat.id, seat, /*build*/true);
    this._markDirty();
  }

  updateSeat(id, partial) {
    if (partial === null) {                       // delete
      const s = this._seats.get(id);
      if (s) {
        if (String(id) === this._hintSeatId) this._hideHint();   // don't leave a hint for a removed seat
        s.el.remove(); this._seats.delete(id);
      }
      this._markDirty();
      return;
    }
    const existing = this._seats.get(id);
    if (!existing) { this._upsert(id, partial, true); this._markDirty(); return; }
    this._merge(existing.data, partial);
    this._markDirty();
  }

  _merge(dst, src) {
    for (const k of ['x','y','sprite','labelTitle','hintTitle','hintable']) {
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
    // Fixed cell-size box so the seat's counter-scale anchors on its centre
    // (transform-origin 50% 50% = the seat spot x+24,y+24) and the label has a
    // stable 50% to centre on. The label rides the seat's counter-scale (scales
    // with the glyph). The seat IS a stacking context (it has a transform), so
    // labels can only out-paint a neighbour seat via the seat's own z-index — set
    // by vertical position in _paint (upper seats in front; their labels hang
    // down over lower seats).
    el.style.width = this._cellW + 'px';
    el.style.height = this._cellH + 'px';

    const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    glyph.setAttribute('class', 'OMSeatGlyph');
    glyph.setAttribute('viewBox', '0 0 24 24');
    glyph.setAttribute('width', this._cellW);
    glyph.setAttribute('height', this._cellH);
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
    return { data: Object.assign({}, data), el, glyph, uses: new Map(), activeUse: null, fallback: null, _lastLabelBody: undefined, labelEl, labelTitleEl: labelTitle, labelBodyEl: labelBody };
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
    // Newly created seats have no transform yet; apply the counter-scale so they
    // render at the right size immediately (matters in flat/clamp mode, where
    // cs != 1 — otherwise seats are mis-sized until the first pan/zoom event).
    this._applyCounterScale(true);
  }

  _paint(s) {
    const d = s.data;
    s.el.style.left = (d.x || 0) + 'px';
    s.el.style.top = (d.y || 0) + 'px';
    // Stack upper seats in front of lower ones, so a label (which hangs below its
    // seat) paints above the seat it overlaps. Kept positive so seats stay above
    // OMBackground. (Each OMSeat is a stacking context via its transform, so this
    // seat-level z-index is how a label out-paints a neighbour seat.)
    s.el.style.zIndex = String(100000 - Math.round(d.y || 0));
    // Glyph: one <use> per distinct cell name, created once (its external ref
    // resolves once) and toggled by visibility. Mutating href on an external
    // <use> makes the browser re-resolve and blank the glyph for a frame — the
    // seat "blink" — so we never mutate href after creation.
    const name = d.sprite || '';
    if (name) {
      let u = s.uses.get(name);
      if (!u) {
        u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        u.setAttribute('href', `${this._spriteUrl}#cell-${name}`);
        s.glyph.appendChild(u);
        s.uses.set(name, u);
      }
      if (s.activeUse !== u) {
        if (s.activeUse) s.activeUse.style.display = 'none';
        u.style.display = '';
        s.activeUse = u;
      }
    } else if (s.activeUse) {
      s.activeUse.style.display = 'none';
      s.activeUse = null;
    }
    // Loud fallback ONLY for unknown sprite names (valid seats: no fallback).
    const unknown = this._validCells != null && name !== '' && !this._validCells.has(name);
    if (unknown && !s.fallback) s.fallback = this._addFallback(s.glyph);
    else if (!unknown && s.fallback) { s.fallback.remove(); s.fallback = null; }
    // Label: shown iff title or body non-null. Skip DOM work when unchanged so a
    // slider drag (sprite/label mostly stable per tick) doesn't churn the DOM.
    const showLabel = d.labelTitle != null || d.labelBody != null;
    const disp = showLabel ? '' : 'none';
    if (s.labelEl.style.display !== disp) s.labelEl.style.display = disp;
    const titleStr = d.labelTitle != null ? d.labelTitle : '';
    if (s.labelTitleEl.textContent !== titleStr) s.labelTitleEl.textContent = titleStr;
    if (d.labelBody !== s._lastLabelBody) {
      s.labelBodyEl.replaceChildren();
      const hasBody = (d.labelBody instanceof Node) || (typeof d.labelBody === 'string' && d.labelBody !== '');
      if (d.labelBody instanceof Node) s.labelBodyEl.appendChild(d.labelBody);
      else if (typeof d.labelBody === 'string') s.labelBodyEl.textContent = d.labelBody;
      s.labelBodyEl.style.display = hasBody ? '' : 'none';
      s._lastLabelBody = d.labelBody;
    }
  }

  // ---- sprite validation (loud failure for unknown cells) -------------------
  // Fetch the sprite once (cache-served — the <use> references already loaded
  // it), parse its <defs> for id="cell-*", and cache the set. Then repaint so
  // any unknown-sprite seats get the red fallback. Valid seats never get one.
  async _loadSpriteCells() {
    if (!this._spriteUrl) return;
    try {
      const txt = await (await fetch(this._spriteUrl)).text();
      const doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      const ids = new Set();
      doc.querySelectorAll('[id^="cell-"]').forEach(el => ids.add(el.id.slice(5)));
      this._validCells = ids;
      this._markDirty();
    } catch (e) {
      // Fetch/parse failed (e.g. CORS): leave _validCells null → no fallback,
      // unknown cells render blank (the original §1 behaviour). Degrade safely.
      this._validCells = null;
    }
  }

  _addFallback(glyph) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10.5');
    c.setAttribute('fill', 'var(--om-fallback, #d32f2f)');
    glyph.insertBefore(c, glyph.firstElementChild);  // behind the <use>
    return c;
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
    // Body: lazy (hintBuilder) when the seat is hintable, else the eager hintBody.
    const body = (this._hintBuilder && d.hintable)
      ? this._hintBuilder(s.el.dataset.seatId)
      : d.hintBody;
    if (d.hintTitle == null && body == null && !(typeof body === 'string' && body !== '')) return;
    this._hintSeatId = s.el.dataset.seatId;
    this.hintTitle.textContent = d.hintTitle != null ? d.hintTitle : '';
    this.hintBody.replaceChildren();
    if (body instanceof Node) this.hintBody.appendChild(body);
    else if (typeof body === 'string') this.hintBody.textContent = body;
    this._positionHint(s);
    this.hint.classList.add('OMHint--visible');
  }

  _hideHint() {
    this._hintSeatId = null;
    this.hint.classList.remove('OMHint--visible');
  }

  _positionHint(s) {
    // Place the hint to the SIDE of the seat, flipping left/right and above/below
    // by the seat's screen position (mirrors the old seat_preview placement).
    const sr = s.el.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    const sx = sr.left - rr.left, sy = sr.top - rr.top;
    const sw = sr.width, sh = sr.height;
    if (sx + sw / 2 < rr.width / 2) {        // left half -> place to the right
      this.hint.style.left = (sx + sw * 0.7) + 'px';
      this.hint.style.right = '';
    } else {                                  // right half -> place to the left
      this.hint.style.right = (rr.width - sx - sw * 0.3) + 'px';
      this.hint.style.left = '';
    }
    if (sy + sh / 2 < rr.height / 2) {        // top half -> place below
      this.hint.style.top = (sy + sh * 0.7) + 'px';
      this.hint.style.bottom = '';
    } else {                                  // bottom half -> place above
      this.hint.style.bottom = (rr.height - sy - sh * 0.3) + 'px';
      this.hint.style.top = '';
    }
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

  // Animated zoom (buttons): set a flag so _clampPan animates the pan to match
  // (an animate:false pan would set transition:none and SNAP the world), and
  // give the glyphs a matching transform transition so icons resize smoothly
  // with the world during the zoom. Reset shortly after the transition ends.
  _animatedZoom(fn) {
    if (!this._pz) return;
    this._animatingZoom = true;
    this._enableSeatTransition(true);
    fn();
    clearTimeout(this._zoomAnimTimer);
    this._zoomAnimTimer = setTimeout(() => {
      this._animatingZoom = false;
      this._enableSeatTransition(false);
    }, 280);
  }

  _enableSeatTransition(on) {
    const t = on ? 'transform 200ms ease-in-out' : 'none';
    for (const s of this._seats.values()) s.el.style.transition = t;
  }

  // Magnitude-aware wheel zoom toward the cursor, like most map apps. Instant
  // per event (no transition) — rapid events ARE the motion, so a trackpad's
  // two-finger scroll zooms continuously. deltaY is normalised across deltaMode
  // so a mouse-wheel notch zooms ~the same in Chrome (px), Firefox/Safari (lines).
  // preventDefault runs first so the page never scrolls over the map, even if
  // panzoom isn't ready yet (image still decoding) — it just won't zoom.
  _onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    const pz = this._pz;
    if (!pz) return;   // image not loaded yet; keep the page from scrolling but don't zoom
    // Interrupt any in-flight button-zoom animation → instant from here.
    if (this._animatingZoom) { this._animatingZoom = false; this._enableSeatTransition(false); clearTimeout(this._zoomAnimTimer); }
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 100;          // lines → ~one mouse-notch each (≈Chrome px, ~±26%)
    else if (e.deltaMode === 2) dy *= this.root.clientHeight;  // pages
    const k = pz.getScale();
    const opts = pz.getOptions();
    const target = Math.min(opts.maxScale, Math.max(opts.minScale, k * Math.pow(2, -dy / 300)));
    if (target !== k) pz.zoomToPoint(target, { clientX: e.clientX, clientY: e.clientY }, { animate: false });
  }

  // Force-release an in-progress pan: dispatch a pointerup matching the active
  // pointer so panzoom's handleUp ends the gesture (and clear our tap state).
  _releasePan() {
    if (this._activePID != null && this._pz) {
      // panzoom binds its handleUp on document; a synthetic pointerup matching
      // the active pointer is the only way to end a gesture stuck by right-click
      // or window-blur. Only dispatched when a pan is active (inert otherwise).
      try { document.dispatchEvent(new PointerEvent('pointerup', { pointerId: this._activePID, bubbles: true, cancelable: true })); } catch (e) {}
      this._activePID = null;
    }
    if (this._down && this._down.timer) clearTimeout(this._down.timer);
    this._down = null;
    this._hideHint();
  }

  _onPointerDown(e) {
    const s = this._seatFromEvent(e);
    // A fresh touch dismisses any hint left up by a previous long-press (tap-away, §8).
    if (COARSE && this._hintSeatId) this._hideHint();
    // Track every tap (id=null on the empty map too) so a double-tap anywhere can
    // reset the zoom.
    this._down = { id: s ? s.el.dataset.seatId : null, x: e.clientX, y: e.clientY, t: Date.now(), moved: false, longFired: false, timer: 0, slop: (e.pointerType === 'touch') ? TAP_COARSE : TAP_FINE };
    if (this._animatingZoom) { this._animatingZoom = false; this._enableSeatTransition(false); clearTimeout(this._zoomAnimTimer); }
    if (!s) return;          // empty map: keep _down for the double-tap, but no long-press hint
    // Long-press → show hint (touch only; fine pointers use hover, and a held
    // mouse button shouldn't suppress the click). Suppress the click on release.
    if (e.pointerType !== 'touch') return;
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
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > d.slop) {
      // It's a drag (pan): cancel the long-press hint timer and mark moved.
      if (d.timer) { clearTimeout(d.timer); d.timer = 0; }
      d.moved = true;
      if (d.longFired) this._hideHint();   // panning away from a held hint hides it
    }
  }

  _onPointerUp(e) {
    const down = this._down;
    this._down = null;
    if (!down) return;
    if (down.timer) { clearTimeout(down.timer); down.timer = 0; }
    // Tap vs drag by NET down→up displacement. A running 'moved' flag (set on the
    // worst intermediate frame) mis-reads real taps as drags: a finger commonly
    // spikes past the threshold on press, then settles back onto the seat before
    // lifting — so judge by where it actually ended, not its noisiest moment.
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (dist > down.slop) return;        // ended away from the start — a drag/pan, not a tap
    // Long-press already revealed the hint: leave it up after release (so it's
    // readable, not under the finger) — it's dismissed by the NEXT interaction
    // (the _hideHint at the top of _onPointerDown). No click.
    if (down.longFired) return;
    // Double-tap (touch) anywhere → revert the zoom to the default (centred 1:1).
    const now = Date.now();
    if (COARSE && now - this._lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(down.x - this._lastTap.x, down.y - this._lastTap.y) < DOUBLE_TAP_DIST) {
      this._lastTap = { x: 0, y: 0, t: 0 };
      this._resetZoom();
      return;
    }
    this._lastTap = { x: down.x, y: down.y, t: now };
    if (down.id == null) return;         // single tap on the empty map — nothing to do
    const s = this._seats.get(down.id);
    if (!s) return;
    // Emit click. (Let the native 'click' handler also fire? We emit here directly
    // so a long-press-suppressed release never reaches _onClick.)
    if (e.pointerType === 'touch') this._armGhostClickSwallow(e);  // swallow the touch-compat ghost click
    this._emitClick(s);
  }

  _onPointerCancel() {
    // Leave a shown long-press hint up (dismissed by the next interaction); just
    // clear the pending press + its long-press timer.
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
    // Desktop parity with the touch double-tap: revert the zoom to the default.
    if (this._pz) { e.stopPropagation(); this._resetZoom(); }
  }

  // Revert the zoom to the default scale WITHOUT moving the map — zoom about the
  // viewport centre so the same point stays put (only the scale resets). The full
  // reset() would also snap the pan back to the start position; we don't want that.
  _resetZoom() {
    if (!this._pz) return;
    const startScale = this._pz.getOptions().startScale;
    const r = this.root.getBoundingClientRect();
    this._animatedZoom(() => this._pz.zoomToPoint(
      startScale,
      { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 },
      { animate: true }));
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    clearTimeout(this._zoomAnimTimer);
    if (this._down && this._down.timer) clearTimeout(this._down.timer);
    clearTimeout(this._swallowClickTimer);
    if (this._ro) this._ro.disconnect();
    window.removeEventListener('blur', this._onWindowBlur);
    document.removeEventListener('click', this._onDocClickCapture, true);
    if (this._pz) this._pz.destroy();
    this.root.remove();   // removes all root-scoped listeners (this.root subtree)
  }
}

// Inline SVG glyphs for the zoom controls (icon-only, no i18n, no deps).
const ZOOM_IN_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ZOOM_OUT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const RESET_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/></svg>';