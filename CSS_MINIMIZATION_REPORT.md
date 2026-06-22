# CSS Minimization & Color Unification Report

Fresh independent analysis of the custom CSS layer over Materialize 2.x.
Scope: `js/base/style.css`, the SCSS modules, inline template styles, and JS-injected
styles. Goal: shrink the custom layer, route every color through a single source of
truth, and keep deploy-time theming working.

**This is analysis only. No code changed. Decisions for you are at the end (§8).**

---

## 1. The headline findings

1. **The brand purple is gone.** `theme.css` defines `--warp-primary: #8f1f8c` but never
   wires it into Materialize's M3 token `--md-sys-color-primary-light`. The built CSS has
   **0** occurrences of `#8f1f8c` and **107** of `#006495` (Materialize's stock blue). The
   nav bar, primary buttons, focus rings, links, etc. all render **Materialize default
   blue**, not WARP's brand. → §8 Q1.

2. **The "single source of truth" is barely used.** `theme.css` is a clean, well-designed
   token file (the `--warp-*` ramp + affordance classes + M2 button restoration). But
   `style.css` references `var(--warp-*)` **exactly once** (line 645) and hardcodes ~25
   distinct hex values that *already have tokens*. The SCSS, JS, and templates hardcode
   too. The source of truth exists; almost nothing points at it.

3. **`style.css` is ~40% repetition.** Seven form-modal IDs are styled by giant
   comma-selector blocks repeated ~15 times. This is the single largest shrink target.

4. **Color sprawl.** The app uses **6 distinct reds**, **2 oranges**, an indigo accent
   family, and two greens — many are near-duplicates that should collapse.

---

## 2. How CSS is assembled (verified)

Load order in `base.html`:
1. `<html theme="light">` — pins Materialize to its light M3 palette, defeats its
   `prefers-color-scheme: dark` rule. Good; keep.
2. `material_icons.css`
3. **`theme.css`** — the token/override layer (loads *before* the bundle; wins via the
   higher-specificity `:root[theme="light"]` selector).
4. Webpack `dist/*.css` — compiled from `style.css` + the SCSS modules + Materialize 2.x.

Materialize 2.x themes through **Material Design 3 CSS custom properties**
(`--md-sys-color-*`). This is the correct hook for deploy-time theming and `theme.css`
already adopts it ("Approach C"). The architecture is right — it's just under-wired.

---

## 3. `style.css` inventory (1740 lines) — keep vs. revert vs. shrink

I sort every block by the decision ladder (need it? → Materialize default? → native? →
dependency? → one line? → minimum).

### 3a. Migration restorations — **KEEP** (necessary; M2 dropped 1.x behavior)
These exist because Materialize 2.x removed/changed behavior WARP's markup relies on.
They are legitimate and not "bloat", though several can be tightened:

| Block | Lines | Verdict |
|---|---|---|
| Nav bar bg + height + white text | 11–34 | Keep — restores brand bar. Colors → tokens. |
| `.nav-wrapper { display:block }` + `nav ul/li/a` inline bar | 35–85 | Keep — restores float layout 2.x dropped. |
| `.dropdown-content` fit-content sizing | 87–133 | Keep — fixes the `[popover]` full-height bug. Well-documented. |
| Datepicker/timepicker centering | 135–146 **and 771–784** | Keep **one** — **defined twice, near-identical. Delete the duplicate.** |
| `.btn` 1.x shape restore | 1671–1684 | Keep — 2.x reshaped buttons. |
| `.modal.bottom-sheet` restore | 1686–1701 | Keep — 2.x lost full-width sheet. |
| `.btn-floating` shape/centering | 1124–1144 | Keep — FAB icon centering. |

### 3b. Form-modal styling — **SHRINK HARD** (the big win)
Lines ~405–879 and ~1463–1523 style these seven dialogs:
`#pref_modal, #calendar_modal, #change_password_modal, #edit_modal,
#add_to_group_modal, #assign_to_zone_modal, #assigned_seat_modal`
— plus `#reassign_modal` and `.modal:not([id])` which duplicate the *same* sheet look
again with different selectors.

The same ~12 declarations (white sheet, filled inputs, floating labels, select triggers,
dropdown menus, autocomplete rows, footer grouping, row spacing, scroll behavior) are
repeated across every ID. This is **~450 lines that collapse to ~120** behind one shared
class (e.g. `.warp-form-modal`) added to each `<dialog>`.

- **Reverting to Materialize 2.x default is NOT viable** — the migration notes and the
  comments here document that M2's "surface-tint dialog + underline-only fields" looked
  "muddy/scrambled". So we keep the look but **de-duplicate** it.
- Cost: add one class to ~9 modal elements in templates/JS (see §8 Q4).

### 3c. App-specific UI — **KEEP, re-color through tokens**
Genuinely WARP's own components, not Materialize: seat labels (1199–1269), seat preview
(1158–1189), marquee box/handles/rotate (1532–1610), zone side panels (998–1097,
1426–1523), time sliders (315–401), spinner (1620–1658), weekday chips (904–934), calendar
tabs (942–964), dropdown headers (1660–1669). All legitimate. The only issue is **every
color is hardcoded** instead of `var(--warp-*)`.

### 3d. Dead / redundant — **DELETE**
- Duplicate `.datepicker-modal[open]` / `.timepicker-modal[open]` block (one of 135–146 /
  771–784).
- `.book-as_container` (207–242): hand-rolls a filled-underline input that largely repeats
  the modal-input treatment — fold into the shared input style.
- `SELECT.warp_select`, `.TR { visibility:hidden }`, and a few one-offs — verify still
  referenced; remove if orphaned.

**Estimated `style.css`: ~1740 → ~1050–1150 lines** (~35% smaller) with no visual change,
mostly from §3b de-duplication and token routing, before any palette decisions.

---

## 4. SCSS modules

| File | Lines | Notes |
|---|---|---|
| `tabulator/tabulator.scss` | 1367 | **Vendored upstream Tabulator theme**, unmodified. Hardcoded greys (`#999`, `#ccc`, `#666`, `#333`…) are vendor defaults. Leave as-is (it's a dependency file); only the WARP-facing colors in `tabulator_materialize.scss` matter. |
| `tabulator/tabulator_materialize.scss` | 314 | WARP's bridge. Hardcodes the spinner orange `#ff6d00`/`#ffe0b2` (dup of `style.css` spinner) and error `#c62828`. Route through tokens; the spinner is **duplicated** between here and `style.css` — share it. |
| `tabulator/variables.scss` | 88 | Defines `$materialize-orange` (full 14-shade map) only to pick `accent-4 = #ff6d00` as `$primary-color`. Heavy machinery for one value. Replace the map with the single token. |
| `zone/nouislider_materialize.scss` | 38 | Hardcodes `#c5cae9` (= `--warp-indigo-light`) and `#ff6d00` (= `--warp-accent`). Route through tokens. Note the slider is **also** styled in `style.css` (`.pref_timeslider_container`) — overlapping sources. |

SCSS can't read CSS custom properties at compile time for *logic*, but it can emit
`var(--warp-*)` in output. So the bridge files should emit `var(--warp-accent)` etc.,
keeping `theme.css` authoritative.

## 5. JS-injected colors & inline template styles

| Site | Color | Action |
|---|---|---|
| `zoneModify_marquee.js:93–95` | `#3949ab` ×3 (SVG rotate-icon stroke) | Inject `var(--warp-indigo)` or read from CSS. |
| `zoneModify_seat.js:113` | `#b71c1c` (select outline) | **6th red, not even in `theme.css`.** Route to an error/danger token. |
| `login.html`, `auth_error.html` | `.flash_message { color:#F44336 }` | **7th red** (Material 500). Route to error token. |
| `ical_action.html`, `ical_confirm.html` | no colors | OK as-is. |

## 6. Full color audit

### Reds — **6 in use, should be ~1 (+1 dark variant)**
`#e42025` (token `--warp-error`) · `#d32f2f` (`--warp-danger-btn`) · `#c62828`
(`--warp-danger-icon`, tabulator) · `#b71c1c` (seat outline, untokenized) · `#dd0000`
(tabulator `$errorColor`) · `#F44336` (login flash). These are all "error/danger red" —
the eye cannot tell them apart in context.

### Oranges — **2 in use**
`#ef7f21` (`--warp-secondary`, brand) vs `#ff6d00` (`--warp-accent`: sliders, spinner,
calendar tabs, tabulator select). Two deliberately-distinct oranges per the token
comments — but worth confirming they need to differ. → §8 Q2.

### Indigo accent family — **4 shades, the app's de-facto second accent**
`#3949ab` (×14 built), `#c5cae9`, `#e8eaf6`, `#283593`. Drives the zone editor, seat
labels, marquee, weekday chips, sliders. This is a *separate* accent from the brand color
— a legacy choice, not derived from primary/secondary. → §8 Q3.

### Greens — `#78be20` (`--warp-success`), `#1b5e20`, `#2e7d32` (edit icons). Collapse to one.

### Greys — 5-step ramp (`#f5f5f5 #e0e0e0 #9e9e9e #616161 #757575`) + text `#212121`.
Reasonable; keep as the neutral ramp. Note `#757575` and `#616161` are both "secondary
text" and could merge.

### RESOLVED minimal palette (single source = `theme.css`)
The pre-migration SCSS brand was `$primary = indigo darken-1`, `$secondary = orange
accent-4`, `$link = indigo darken-3`. The purple `#8f1f8c` / `#ef7f21` / `#0c9dd9` set
currently in `theme.css` is a **stale/foreign rebrand** and is dropped. Final palette:

```
primary    #3949ab  indigo darken-1   → wire into --md-sys-color-primary-light (nav, buttons, focus)
  tints    #c5cae9 (lighten-4), #e8eaf6 (lighten-5), #283593 (darken-3 = link)
secondary  #ff6d00  orange accent-4   → the single orange (sliders, spinner, tabs, FAB, secondary btns)
link       #283593  indigo darken-3
error      one red  → merge the 6 reds to Materialize error #F44336 (+ optional darker border)
success    one green → merge #78be20/#1b5e20/#2e7d32 to one Materialize green
neutral    greys #f5f5f5 #e0e0e0 #9e9e9e #757575 #616161 + text #212121 + surface #ffffff
```
The indigo is now the **brand primary**, not a second accent — so the ×14 indigo usages
need no recoloring; they just become `var(--warp-primary)` / its tints. Odd tokens
(slider-handle shadows, disabled-FAB grey) stay as-is in `theme.css`.

## 7. Theming approach — recommendation

The user requirement is **deploy-time recolor without a rebuild**. `theme.css` (Approach C:
override `--md-sys-color-*-light` + define `--warp-*`, served as a standalone file
overridable via `WARP_THEME_FILE`) is the **right** model and already in place. Plan:

1. **Wire the brand into M3 tokens**: in `theme.css :root[theme="light"]`, set
   `--md-sys-color-primary-light` (and on-primary, secondary, error…) from the `--warp-*`
   values. This is what actually restores branding (§8 Q1).
2. **Route every hardcoded hex** in `style.css` / bridge SCSS / JS / templates to
   `var(--warp-*)` (or `var(--md-sys-color-*)` where it's truly the framework role).
3. After that, **re-theming a deployment = edit `theme.css` only** — the stated goal.

No need for Approaches A/B/D from the older `COLOR_SCHEME_ANALYSIS.md`; C already works.

---

## 8. Decisions — RESOLVED

- **Q1 — Brand color:** Restore the true source brand — **primary `#3949ab` (indigo
  darken-1)**, **secondary `#ff6d00` (orange accent-4)**, **link `#283593` (indigo
  darken-3)**. Drop the stale purple set. The nav bar goes from the current Materialize
  blue to indigo.
- **Q2 — Oranges:** Merge to one orange = **`#ff6d00`** (the real secondary).
- **Q3 — Indigo:** Keep indigo — but it is the **primary brand**, not a separate accent.
- **Q4 — Modal de-dup:** **Yes, touch markup** — add a shared `.warp-form-modal` class.
- **Q5 — Reds/greens:** Merge to one error red and one green (default, low risk).

---

## Appendix — quantified bloat

- `style.css`: 1740 lines, `var(--warp-*)` used **1×**, hardcoded hex **~150 occurrences /
  ~25 distinct values**, ~95% of which duplicate existing tokens.
- Built `base.css`: `#006495`×107, `#3949ab`×14, `#ff6d00`×6, brand purple/orange/red ×**0**.
- Form-modal repetition: 7 IDs × ~15 selector blocks ≈ the largest single shrink target.
- Duplicates to delete: `.datepicker-modal[open]` block (×2), spinner (style.css ↔
  tabulator), slider (style.css ↔ nouislider scss).
