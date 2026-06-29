# OfficeMap — Design & Implementation Spec

> Hand-off document for the implementer. This is the converged design from the
> architecture exploration; it is a contract, not a draft.

`OfficeMap` is a standalone, presentation-only map component: a pannable /
zoomable office floor image with seat glyphs, labels, and hover/hold hints,
driven entirely by a data model. It owns **no** booking or domain logic. It is
used only in the user-facing booking view (`plan.html`). The admin plan editor
(`plan_modify.html`) is **untouched** — it keeps its current 1:1, desktop-only,
marquee/transform code.

---

## 1. Boundary

| Owned by `OfficeMap` (presentation) | Owned by `plan.js` (domain) |
|---|---|
| DOM skeleton: viewport, world, `OMBackground`, per-seat glyph + label/hint containers | Booking state machine (`WarpSeat.SeatStates` → presentational state name) |
| Pan / zoom (`@panzoom/panzoom`): wheel, pinch, drag-pan, double-tap, zoom buttons, bounds | Date/time slider, date checkboxes, book-as, auto-book |
| Rendering each seat's glyph from its `sprite` name | Building label/hint content **Nodes** (assigned users, bookings table, i18n) |
| Showing label/hint when non-`null`; hiding when `null` | The action modal (book/remove/assign) — a separate overlay, not part of the map |
| Hover (desktop) and long-press (mobile) → show hint | Dark-mode CSS `filter` string (passed into the model as `filter`) |
| Emitting `click` events; rAF-batched redraw when dirty | Persisting/restoring zoom (optional, app-level) |

The component never interprets state names or colours. It builds
`'#cell-' + sprite` into a `<use href>`. An unknown name (no matching
`#cell-<name>`) renders a loud red fallback disc: the component fetches the
sprite once (cache-served) and parses its `<defs>` for `id="cell-*"`; a seat
whose sprite name is not in that set gets a red `r=10.5` disc inserted behind
its (empty) `<use>`. Valid seats carry no fallback node at all — zero waste for
the common case, loud failure only when it actually happens. All visual styling
of labels/hints/background comes from the
host stylesheet via the component's class names (§5).

## 2. Coordinate system

**Pixel coordinates, natural-image space — kept as-is, no migration.** Seats
store `x, y` as integer pixels relative to the map image's top-left (the
existing `seat.x` / `seat.y`). Rationale: additive office growth (a wider map
after an extension) keeps existing seats correctly placed for free; rescale of
the same extent is handled by the editor's existing marquee group-scale, which
is what it was built for. Fractional `[0,1]` coords were rejected because they
make the common additive-growth case worse.

The editor therefore needs **no** coordinate change — it stays fully untouched.

## 3. Sprite mechanism (external file, CSS-variable colouring)

`seat_icons.svg` stays an **external static file** (as today). It is **not**
inlined. Colouring uses `:root` theme CSS variables that cross the external
`<use>` boundary — a mechanism **already proven in production** by the existing
`#disc` group:

```svg
<!-- already in seat_icons.svg, referenced externally, works in light + dark: -->
<g id="disc">
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-bg, #ffffff)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
</g>
```

The state colour tokens are defined on `:root` and flipped on
`:root[theme="dark"]` (see `warp/static/theme.css`):

```
--warp-seat-available-fg / -bg
--warp-seat-yours-fg     / -bg
--warp-seat-unavailable-fg / -bg
```

### Change to the sprite

Today: one `<symbol>` per **shape** (6 shapes), coloured by `currentColor` +
`--warp-seat-bg` applied **per-state on the host seat class**.

New: one `<g id="cell-<name>">` per **presentational state** (~12–15 cells),
with the disc using `fill="var(--warp-seat-<state>-bg)"` and the glyph using
`fill="var(--warp-seat-<state>-fg)"` — i.e. the state-specific vars **baked
into the cell**, so the host needs no per-state class at all. Shapes are
duplicated across colour families (e.g. `head` appears in grey for `booked` and
in charcoal/blue for `yours`). The file stays tiny.

Example cell:
```svg
<g id="cell-booked">
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-unavailable-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-unavailable-fg)" stroke-width="1.5"/>
  <use href="#head-path" fill="var(--warp-seat-unavailable-fg)"/>
</g>
```

Each cell is exactly the pattern `#disc` already uses, extended to bake the fg
too. Light/dark flips for free, through the external `<use>` boundary, as `#disc`
already demonstrates.

### Canonical state names

The name set is the **single shared contract** between `plan.js` and
`seat_icons.svg`: `plan.js` emits a name ⇒ a matching `#cell-<name>` must exist
in the sprite, else the seat renders blank (loud failure). A name denotes a
**visual** state (shape × colour family), not a `SeatState`; several
`SeatState`s collapse to the same cell, and `CAN_BOOK`/`CAN_REBOOK` split by
whether the seat is assigned to the acting user. `plan.js` already computes
`assignedToMe` (`this.factory.login in this.assignments`), so the mapping takes
both:

| `WarpSeat.SeatStates` | `assignedToMe` | `sprite` name        | visual                      |
|-----------------------|:-------------:|----------------------|-----------------------------|
| `CAN_BOOK`            | false         | `available`          | plus,   green (available)   |
| `CAN_BOOK`            | true          | `availableAssigned`  | plus,   blue   (yours)      |
| `CAN_REBOOK`          | false         | `rebook`             | arrow,  green (available)   |
| `CAN_REBOOK`          | true          | `rebookAssigned`     | arrow,  blue   (yours)      |
| `CAN_CHANGE`          | —             | `yoursChange`        | head+arrows, blue (yours)   |
| `CAN_DELETE_EXACT`    | —             | `yours`              | head,   blue   (yours)      |
| `CAN_DELETE`          | —             | `taken`              | head,   grey   (unavailable)|
| `TAKEN`               | —             | `taken`              | head,   grey   (unavailable)|
| `VIEW_ONLY_TAKEN`     | —             | `taken`              | head,   grey   (unavailable)|
| `ASSIGNED`            | —             | `assigned`           | head+tie, grey (unavailable)|
| `VIEW_ONLY`           | —             | `unavailable`        | no-symbol, grey (unavailable)|
| `DISABLED`            | —             | `unavailable`        | no-symbol, grey (unavailable)|
| `NOT_AVAILABLE`       | —             | `unavailable`        | no-symbol, grey (unavailable)|

→ **9 distinct cells.** `CAN_DELETE`/`TAKEN`/`VIEW_ONLY_TAKEN` share `taken`;
`VIEW_ONLY`/`DISABLED`/`NOT_AVAILABLE` share `unavailable`. The help modal
keeps its semantic entries (book / rebook / conflict / userConflict / …) but
each now points at one of these 9 cells instead of an `(icon, colour)` pair.

The whole mapping in `plan.js` is one function:
```js
function spriteFor(state, assignedToMe) {
  switch (state) {
    case WarpSeat.SeatStates.CAN_BOOK:      return assignedToMe ? 'availableAssigned' : 'available';
    case WarpSeat.SeatStates.CAN_REBOOK:   return assignedToMe ? 'rebookAssigned'    : 'rebook';
    case WarpSeat.SeatStates.CAN_CHANGE:    return 'yoursChange';
    case WarpSeat.SeatStates.CAN_DELETE_EXACT: return 'yours';
    case WarpSeat.SeatStates.CAN_DELETE:
    case WarpSeat.SeatStates.TAKEN:
    case WarpSeat.SeatStates.VIEW_ONLY_TAKEN:   return 'taken';
    case WarpSeat.SeatStates.ASSIGNED:      return 'assigned';
    case WarpSeat.SeatStates.VIEW_ONLY:
    case WarpSeat.SeatStates.DISABLED:
    case WarpSeat.SeatStates.NOT_AVAILABLE:     return 'unavailable';
  }
}
```

### Draft sprite cells

The cells are **added to `seat_icons.svg`'s `<defs>`**, reusing the existing
path/group defs (`#plus-path`, `#arrow-path`, `#arrow-upper`, `#arrow-lower`,
`#head-path`, `#figure`, `#tie-path`). The existing `<symbol>`s and `#disc` are
**kept** — the plan editor (`zoneModify_seat.js`) still references them via the
host-class + `currentColor`/`--warp-seat-bg` mechanism, untouched. So the file
carries both: the old symbols (editor) and the new cells (booking view).

Each cell bakes its **state-specific** fg/bg vars directly (the same
`fill="var(...)"` presentation-attribute form `#disc` already proves works
across the external `<use>` boundary), so the host needs no per-state class —
it only picks the cell by name.

```svg
<!-- ===== Seat status cells. One <g id="cell-<name>"> per visual state.
      Colours come from the :root theme vars (--warp-seat-<family>-fg/-bg),
      which cross the external <use> boundary (proven by #disc). Light/dark flip
      via :root[theme="dark"]. Shapes reused from the defs above; duplicated
      across colour families as needed. Added alongside the existing <symbol>s
      and #disc, which the plan editor still uses. ===== -->

<g id="cell-available">          <!-- plus, green -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-available-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-available-fg)" stroke-width="1.5"/>
  <use href="#plus-path" fill="var(--warp-seat-available-fg)"/>
</g>

<g id="cell-availableAssigned">  <!-- plus, blue (assigned to you) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-yours-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="1.5"/>
  <use href="#plus-path" fill="var(--warp-seat-yours-fg)"/>
</g>

<g id="cell-rebook">             <!-- arrow, green -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-available-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-available-fg)" stroke-width="1.5"/>
  <use href="#arrow-path" fill="var(--warp-seat-available-fg)"/>
</g>

<g id="cell-rebookAssigned">      <!-- arrow, blue (assigned to you) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-yours-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="1.5"/>
  <use href="#arrow-path" fill="var(--warp-seat-yours-fg)"/>
</g>

<g id="cell-yours">               <!-- head, blue (your exact booking) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-yours-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="1.5"/>
  <use href="#head-path" fill="var(--warp-seat-yours-fg)"/>
</g>

<g id="cell-yoursChange">         <!-- head + sync arrows, blue (your booking, can change) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-yours-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="1.5"/>
  <use href="#figure" fill="var(--warp-seat-yours-fg)"/>
  <use href="#arrow-upper" fill="var(--warp-seat-yours-bg)"/>
  <use href="#arrow-upper" fill="var(--warp-seat-yours-fg)" fill-opacity="0.2"/>
  <use href="#arrow-upper" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="0.9" stroke-linejoin="round"/>
  <use href="#arrow-lower" fill="var(--warp-seat-yours-bg)"/>
  <use href="#arrow-lower" fill="var(--warp-seat-yours-fg)" fill-opacity="0.2"/>
  <use href="#arrow-lower" fill="none" stroke="var(--warp-seat-yours-fg)" stroke-width="0.5" stroke-linejoin="round"/>
</g>

<g id="cell-taken">               <!-- head, grey (booked by other / your unchangeable / view-only-taken) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-unavailable-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-unavailable-fg)" stroke-width="1.5"/>
  <use href="#head-path" fill="var(--warp-seat-unavailable-fg)"/>
</g>

<g id="cell-assigned">            <!-- head + tie knockout, grey (assigned to others) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-unavailable-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-unavailable-fg)" stroke-width="1.5"/>
  <use href="#head-path" fill="var(--warp-seat-unavailable-fg)"/>
  <use href="#tie-path" fill="var(--warp-seat-unavailable-bg)"/>
</g>

<g id="cell-unavailable">         <!-- no-symbol (plus rotated 45°), grey (view-only free / disabled / no dates) -->
  <circle cx="12" cy="12" r="10.5" fill="var(--warp-seat-unavailable-bg)"/>
  <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--warp-seat-unavailable-fg)" stroke-width="1.5"/>
  <use href="#plus-path" fill="var(--warp-seat-unavailable-fg)" transform="rotate(45 12 12)"/>
</g>
```

Notes for the implementer:
- Each cell is the existing `#disc` pattern (bg-var disc + fg-var ring + fg-var
  glyph), extended to bake the **state-specific** fg/bg vars instead of the
  generic `--warp-seat-bg`/`currentColor` set on the host. The arrow knockouts
  in `cell-yoursChange` use the **state bg** (`--warp-seat-yours-bg`) so they
  match that cell's disc — the old `icon-head-arrow` symbol used the generic
  `--warp-seat-bg` because the host set it per class; the cell bakes it directly.
- The preview row at the bottom of `seat_icons.svg` (the `<use href="#icon-*">`
  strip) can optionally get a parallel `#cell-*` preview strip, or stay as-is;
  it's only for opening the file in a browser to eyeball the icons.
- Verify each `#cell-<name>` renders with the right colour in both light and dark
  by opening `seat_icons.svg` directly (the `:root` vars resolve in the file's
  own context for the preview) and via an external `<use>` in a test page (the
  real consumption path — `#disc` already proves vars cross that boundary).

## 4. Data model

```js
{
  mapImage,                 // URL of the plan image
  sprite: {                 // the external seat sprite
    url,                    //   e.g. url_for('static', filename='images/seat_icons.svg')
    cellWidth,              //   48
    cellHeight,             //   48
  },
  zoom: { initial, min, max },   // initial may be "fit"; map zoom range [min, max]
  spriteZoom: { min, max },      // OPTIONAL clamp range for sprite scaling (see §6).
                                 //   min >= zoom.min, max <= zoom.max.
                                 //   Omit (or = zoom bounds) => sprites scale 1:1 with the map (pure follow).
  filter,                   // CSS filter string for OMBackground (dark mode), or null
  seats: [
    {
      id,                   // seat sid (string|number); used in DOM ids: #sprite-{id}
      x, y,                 // px, natural image space
      sprite,               // state NAME, e.g. 'available' -> href '#cell-available'
      labelTitle,           // string | null   (null => no title)
      labelBody,            // Node   | null   (null => no body)
      hintTitle,            // string | null   (null => no hint at all)
      hintBody,             // Node   | null
    },
    ...
  ]
}
```

Notes:
- `labelBody` / `hintBody` are **DOM Nodes** (the app builds them with full
  styling, e.g. the bookings table). The component re-parents and owns their
  lifecycle; the app builds fresh nodes on each update.
- `labelTitle` / `hintTitle` are plain strings.
- A label is shown iff at least one of `labelTitle`/`labelBody` is non-`null`.
- A hint is shown iff at least one of `hintTitle`/`hintBody` is non-`null`
  (i.e. presence drives display — no separate hint toggle).
- `filter` is per-plan dynamic data, so it lives in the model, not only as a
  class.

## 5. DOM & CSS classes

`OfficeMap` renders and owns these class names; they are styled from the host
stylesheet (`style.css`) using `--warp-*` theme tokens. The component ships
**sensible default styles** so it works out-of-the-box (batteries included), and
the host can override.

```
OMMap                         viewport root
  OMBackground                the <img> (dark-mode filter applied here)
  OMWorld                     pan/zoom-transformed layer (contains seats + labels)
    OMSeat                    per-seat anchor, id="sprite-{id}"
      OMSeatGlyph             the <svg> holding the <use href="#cell-<name>">
      OMLabel                 label container (shown when title/body non-null)
        OMLabelTitle          title (string)
        OMLabelBody           body (Node)
    OMHint                    the hover/long-press hint popup (one, shared; shown for the active seat)
      OMHintTitle
      OMHintBody
  OMZoom                      zoom control buttons (icon-only, no text -> no i18n)
```

- `OMSeat` carries a stable `id="sprite-{sid}"` so external CSS / tooling can
  address any seat by sid (e.g. an auto-book highlight:
  `#sprite-42 { outline: 2px solid gold }`). The id is for addressing only;
  the component remains the single writer of structure/position/`href`.
- Zoom controls are **icon-only** (material icons or inline SVG glyphs with
  aria-labels) — no translatable strings, so no i18n concern in the component.
- `OMBackground` receives the `filter` string (dark mode) directly.

## 6. Seat-scaling under zoom (unified counter-scale)

Seats live **inside `OMWorld`** and ride the `@panzoom` world transform for
**position** (free, GPU-composited — the browser handles one world transform).
Sprite **size** is controlled by a per-seat **counter-scale** applied on each
`panzoomchange`:

```
s(k)  = clamp(k, spriteZoom.min, spriteZoom.max)   // desired sprite scale
 cs    = s(k) / k                                    // counter-scale
 seat.style.transform = `scale(${cs})`               // transform-origin: 50% 50%
```

The whole policy is the one-line `s(k)` function — all three modes below are the
**same mechanism** (per-seat counter-scale about the seat's top-left), differing
only by `s(k)`, so they are trivial variants, not separate architectures:

- **follow (S1, default):** `s(k) = k` → `cs = 1` (no transform; sprites scale
  1:1 with the map). Active when `spriteZoom` is omitted or equals `zoom`.
- **flat (S2, finger-friendly):** `s(k) = 1` → `cs = 1/k` (sprites stay 48 px at
  any zoom). Enabled on `matchMedia('(pointer: coarse)')` (touch), with a user
  toggle.
- **clamped range (hybrid):** `s(k) = clamp(k, spriteZoom.min, spriteZoom.max)`
  → sprites scale with the map inside `[spriteZoom.min, spriteZoom.max]` and
  **freeze at the edges** outside it. E.g. pinching out, sprites shrink until
  `spriteZoom.min` then stay readable while the map keeps shrinking; zooming in,
  they stop growing at `spriteZoom.max`. `spriteZoom.min ≥ zoom.min`,
  `spriteZoom.max ≤ zoom.max`.

The glyph cell-colouring is transform-agnostic (the existing `#disc` already
proves var resolution is stable under transform), and the SVG scales crisply.

### Gotchas the implementer must get right

1. **`transform-origin: 50% 50%` on `OMSeat`.** The seat's logical spot is
   its **center** — the editor stores `x,y` as the top-left of the 48×48 box
   (`x - spriteSize/2` on creation), so the center `(x+24, y+24)` is the click
   point and the label is centred on it. The counter-scale must anchor that
   center so the glyph grows/shrinks around its spot (matching the 1:1 view,
   where the center sits on the spot). `0 0` would pin the top-left and drift
   the center off the spot whenever `cs != 1` (i.e. in flat/clamp modes). One
   CSS rule.
2. **Labels are children of `OMSeat`** (not a separate layer) so they ride the
   same counter-scale and stay attached to the (scaled) glyph. This differs
   from today's separate `#zonemap-labels` overlay — in the new component labels
   live inside the seat container. (The label's offset from the glyph scales by
   `cs`, then by the world `k` → net `s(k)`, so spacing stays correct at every
   zoom.)
3. **The hint popup is separate and constant-size** (a tooltip), positioned at
   the seat's (counter-scaled) screen rect — it does **not** scale with `s(k)`.
4. **Overlap at the low edge:** when the map shrinks past `spriteZoom.min`,
   seats stay readable but their map positions converge → close seats overlap.
   Set `spriteZoom.min` so this only bites when the map is too small to be
   useful anyway, or hide labels below a threshold. Inherent tradeoff of
   "keep seats readable when zoomed out."

Complexity: **low.** One per-frame counter-scale per seat on `panzoomchange`
(O(N), fine for a few hundred seats) + two config values + the `transform-origin`
rule. No overlay, no per-seat position recompute (position rides the world).

## 7. API

```js
class OfficeMap extends EventTarget {
  constructor(targetEl, options)   // options = model minus seats (mapImage, sprite, zoom, filter)
  createSeats(seats[])             // full recreation of the seat set
  updateSeat(id, partial)          // merge partial into seat {id};
                                   //   null for labelTitle/labelBody/hintTitle/hintBody => clears that field;
                                   //   new id => creates;
                                   //   updateSeat(id, null) => deletes the seat.
  // events (via EventTarget):
  //   'click'   -> { detail: { id } }      seat clicked/tapped
  //   (no hover/leave event; hint is shown internally by the component)
}
```

- **Merge semantics:** `updateSeat(id, {x, y})` updates only `x, y`; omitted
  keys are preserved. Pass `null` explicitly to clear a title/body field.
- **Redraw:** automatic, on `requestAnimationFrame`, only when the model is
  dirty (after `createSeats` / `updateSeat`). No manual `redraw()` API —
  callers just mutate the model; the component repaints on the next frame.
  Multiple updates in one frame coalesce into one repaint.
- **Lifecycle:** the component owns seat DOM (create/move/destroy) and the
  re-parented label/hint Nodes. The app does not retain references to those
  Nodes after handing them over; it rebuilds fresh nodes on each update.

## 8. Interaction details

- **Click/tap** a seat → emit `click` with `{ id }`. The app (`plan.js`) opens
  the action modal. On touch, a tap is distinguished from the long-press hint
  (see below) by duration/movement thresholds (the component handles this).
- **Hint — desktop:** shown on pointer hover over a seat; hidden on leave.
- **Hint — mobile:** shown on long-press (hold); released/tapped-away hides it.
  A quick tap does not show the hint — it triggers `click`.
- **Zoom:** `@panzoom` wheel + ctrl-wheel / pinch / double-tap / `+`/`−`/reset
  buttons. Bounds: `contain` so the image can't be dragged off-screen; min-zoom
  = "fit whole office in viewport" (big mobile win over today's natural-size +
  scroll); max-zoom ≈ 4×. `zoom.initial` may be `"fit"`.

## 9. What stays in `plan.js`

- The booking state machine (`WarpSeat._updateState` etc.) → produces a
  presentational `sprite` name per seat.
- Building `labelTitle` / `labelBody` (Node) / `hintTitle` / `hintBody` (Node)
  from seat data + assignments + bookings + i18n, respecting the three user
  prefs (show seat names / show booking preview / show assigned names) and the
  booking-wins precedence rule — all applied here, at data-build time.
- The three user preference toggles (UI unchanged, three checkboxes); they
  decide what content fills the label title/body.
- Date/time slider, date checkboxes, book-as, auto-book, the action modal, the
  apply XHR.
- One small `WarpSeat.SeatStates → sprite name` mapping (the table in §3).
- Dark-mode filter: passes the per-plan filter string into the model as `filter`.

## 10. Rollout (3 phases)

**Phase 1 — build `OfficeMap` + isolated permanent e2e on static data.**
De-risk first: the component is testable with no backend. Validate pan/zoom,
pinch, bounds, zoom buttons, click emission, label/hint show-when-non-null,
hover vs long-press, S1 and S2 modes — against `res/sample_zone_maps/*.png` with
synthetic seat data. Success: the component passes its own Playwright suite;
the zoom/bounds contract (min = fit, max ≈ 4×, contain) is frozen. Keep these
tests permanently after cutover.

**Phase 2 — swap into `plan.html`.** Low-risk once the component is proven.
`plan.js` shrinks to: state machine → emit per-seat data → `createSeats` /
`updateSeat` → listen for `click` → drive the action modal. Booking e2e is
rewritten to target the component's seat elements by `id="sprite-{sid}"`
(robust to zoom, no hardcoded px offsets). Three prefs, book-as, auto-book,
date/time slider, dark filter all stay in `plan.js`.

**Phase 3 — nomenclature cleanup (zone→plan leftovers).** The booking view was
renamed `zone`→`plan` at the schema/route/template level (commit bbe4b97: a
plan owns the floor-map + seats; a zone is now pure access-control), but the
JS/CSS/DOM/XHR layer still carries the old name. `plan.js` is today a 5-line
stub that imports `zone.js` (the real 1153-line booking view). This phase
collapses the stub and renames the leftovers so "zone" means only access-control
(`zones.py`, `zones.html`, `zoneAssign.js` — correctly named, untouched):

- `js/views/zone.js` → `js/views/plan.js`: delete the stub, move the booking
  view in. `plan.html` already loads `plan.*.js`, so no template script change.
- `js/views/css/zone/` → `js/views/css/plan/`; update the `import` in the view.
- `js/views/modules/zoneuserdata.js` → `planuserdata.js` (booking-view user
  data, not access-control); update the `import`.
- `plan.html` DOM ids/classes: `zonemap`→`planmap`, `zonemap-labels`→
  `planmap-labels`, `zone_sidepanel`→`plan_sidepanel`,
  `zonemap_help_modal`→`planmap_help_modal`, `zone_container`/`zone_map`/
  `zone_action_btn`→`plan_*`. Matching CSS in `css/plan/` + `style.css`.
- `window.warpGlobals` keys: `zoneApply`→`planApply`, `zoneAutoBook`→
  `planAutoBook`, `zoneGetUsers`→`planGetUsers`, `zonePreviewPrefs`→
  `planPreviewPrefs`, `zoneSelections`→`planSelections`; `view.py` emits the
  new keys.
- XHR: `warp/xhr/zone.py` (singular — booking-by-pid: `getSeats/<pid>`,
  `apply`, `autoBook`, `getUsers`) → `plan.py`, blueprint `xhr.plan`, endpoints
  `xhr.plan.*`; update `url_for(...)` in `plan.html`. Leave `warp/xhr/zones.py`
  (plural — access-control CRUD) untouched.
- Editor `zoneModify_*` modules → `planModify_*` fold into Phase 4 (editor
  side).

Mechanical, grep-driven rename; no logic change. Re-run booking + editor e2e.

**Phase 4 — clean up + simplify editor-side logic.** Delete the now-dead
booking-side seat rendering (`seat.js`'s DOM/positioning/label machinery).
Simplify the editor's `zoneModify_seat.js` (→`planModify_seat.js`) now that it
no longer mirrors the booking seat class. Optional tidy: extract the shared
`WarpSeat.SeatStates → sprite name` table into one tiny module imported by both
`plan.js` and (for its own editor-only states) the editor.

**Status — DONE (commits `604b17b`, `3e9ec80`, `c291cbd`).**
- #1 deleted the dead `seat.js` surface (`WarpSeat.Sprites.iconNames`, the
  factory's `spriteURL`/`rootDivId` params+props, `getPositionAndSize()`).
- #2 rewrote the editor `Seat` to render colour-baked `#cell-*` cells (no
  `.seat-icon--<color>` host class, no `currentColor`); renamed
  `zoneModify_seat.js` → `planModify_seat.js`. Added `cell-edited` (green head)
  to preserve the editor's "modified existing seat = green" signal. The base
  `seat-icon` class stayed (editor e2e counts it).
- #3 removed `currentColor` from `seat_icons.svg` entirely (deleted `#disc` + the
  six `#icon-*` symbols + preview row); the file is now var-only and
  well-formed XML.
- #4 (optional tidy) **skipped**: the booking `spriteFor` (over
  `WarpSeat.SeatStates`) and the editor `Seat.CONFIG.cells` (over editor
  transactionals: new/edited/existing/deleted) map **different state spaces** —
  they share sprite *cells* as graphical objects, not *states*. Extracting a
  shared table would add coupling with no real dedup (YAGNI).
- Scope note: only the `seat` editor module was renamed; `zoneModify_marquee.js`
  / `zoneModify_transform.js` keep their names — Phase 4 scoped the rename to
  `seat`, and the plan editor already lives in `planModify.js`.

**Remove `currentColor` from `seat_icons.svg`.** The pre-existing `#disc` and
the six `#icon-*` symbols still use `currentColor` (set via `color` on the
host `.seat-icon--<color>` class) because the editor and the pre-cutover
booking view depend on it. After the Phase 2 cutover (booking view uses the
new `#cell-*` cells) and the Phase 4 editor rewrite (editor picks
colour-baked symbols instead of one-shape-symbol-coloured-by-host), delete
`currentColor` from the file entirely so the SVG is var-only.

**Status — DONE (commit `c291cbd`).** `#disc`, the six `#icon-*` symbols, the
`.seat-icon--*` CSS, and the `--warp-seat-bg` plumbing all removed. The file is
var-only (cells read `:root --warp-seat-*-{fg,bg}` directly) and well-formed
XML. (Side-fix uncovered: SVG/XML comments forbidding `--` — reworded comments.)

During Phase 1 → 2 the old and new map code coexist (old in `plan.html`, new in
tests); Phase 2 is the cutover. Phases 3–4 are cleanup after the cutover.

**All four rollout phases are complete.** Phase 4 also added a self-containment
pass on OfficeMap itself (own flat `--om-*` tokens with `var()` fallbacks,
host maps them to `--warp-*` in style.css; leak-free lifecycle: the global
`blur` listener is removed and timers cleared in `destroy()`, the synthetic
`pointerup` release is guarded). OfficeMap is theme-agnostic and works
standalone (fallback tokens) or themed (host-mapped).

## 11. Explicit non-goals

- **No zoom / no mobile in the editor** (`plan_modify.html`) — it stays 1:1,
  desktop-only, with its marquee + transform controller.
- **No coordinate migration** — px coords kept.
- **No `spriteIdx`** — the sprite key is a **named state string**, transparent
  to the component (pass-through to `href`).
- **No inline sprite** — `seat_icons.svg` stays external; var-colouring crosses
  the external `<use>` boundary (proven by `#disc`).
- **No currentColor dependence in the new cells** — cells use the `:root` state
  vars directly (the `#disc` already does this for the bg).
- **No manual `redraw()`** — rAF-batched auto-redraw when dirty.

## 12. Spike artefacts

`res/sprite_strip_spike.html` (the transform-on-`<use>` + currentColor spike) is
**obsolete** — the chosen design uses `setAttribute('href', '#cell-<name>')`
(no transform-on-`<use>`) and the production `#disc` already proves
var-resolution across the external `<use>` boundary. Discard the spike file.

## 13. Deviations from this spec (as shipped)

The component matches §1–§9, with these behavioural choices settled during
implementation/QA (the component still *supports* the spec's options; these are
the values `plan.js` selects, plus a few UX refinements):

- **Default view is 1:1, centred** — `zoom.initial = 1` (the map at its natural
  pixel size, seats at their 48 px cell size), centred in the viewport, on both
  desktop and mobile. `min` stays "fit" (zoom out to see the whole floor), `max`
  ≈ 4×. (§4/§8 listed `"fit"` as the example initial; the component still
  accepts it.)
- **Sprite-scaling mode** — desktop = **follow** (S1); mobile (`pointer:coarse`)
  = **clamp** with `spriteZoom {min:0, max:1}`: from the 1:1 default, zooming in
  keeps seats at 48 px, zooming out shrinks them with the map. The **flat** (S2)
  mode and the per-user toggle in §6 were **not** shipped — `clamp` gave the
  wanted feel without a toggle.
- **Double-tap / double-click toggles fit ↔ 1:1** — it zooms about the
  clicked/tapped point (that point stays put on screen). When the current scale
  is within ±10% of the default "fit" scale it zooms IN to 1:1 (pixel-perfect);
  otherwise it zooms OUT to fit. (Previously it always reset to fit.) Taps on
  the zoom controls are excluded from this.
- **Long-press hint persists** — on touch the hint stays visible after the
  finger lifts (readable, not under the finger) and is dismissed by the next
  interaction (tap/pan/zoom). §8's "released … hides it" was changed to
  "next interaction hides it" after device testing.
- **Counter-scale is applied to the whole `OMSeat`** (so the label rides it, per
  §6 gotcha #2); seats are z-ordered by vertical position so a label paints above
  the seat below it.
- **Hard pan-stop** — the bounds clamp writes the clamped transform synchronously
  (matching panzoom's own format) to avoid a one-frame bounce at the edges, since
  panzoom commits transforms on `requestAnimationFrame`.