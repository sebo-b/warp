# WARP Color Plan — Inventory, Unification & Roadmap

Goal: prepare WARP for (1) easy **re-branding** and (2) **dark mode**, by first
shrinking the palette to a small canonical set, then layering it, then flipping it.

Scope: source that affects the WARP UI — `warp/static/theme.css`, `js/base/style.css`,
`js/views/**`, `warp/static/images/seat_icons.svg`. Excluded: `node_modules`, built
`dist/`, generated `graphify-out/`, the standalone `res/maintanance.html` illustration,
the `res/visual-snapshot/*` test chrome, and `res/seat_icons_s.svg` (**leftover — ignore**).

---

## The three-step plan

| Step | What | Why it comes first |
|------|------|--------------------|
| **1. Collapse** | Reduce ~22 distinct color values to ~10 canonical ones; derive brand tints from the brand color; route every direct literal through a token. | Fewer values → re-brand by changing 2–3 colors. Smaller set → far less to layer in step 2. |
| **2. Layer** | Split the canonical set into *brand / neutral-primitive / semantic-role*; make `style.css` consume **roles only**, never raw greys. | Roles are the seam dark mode flips. Easy once the set is small. |
| **3. Dark mode** | Add a `:root[theme="dark"]` block that re-points the role tokens; parameterise the seat-icon white base. | Pure data change if steps 1–2 are done; the app CSS doesn't move. |

We are documenting all three but **only executing step 1 next**.

---

## Step 1 — Collapse to a canonical palette  ✅ IMPLEMENTED

Done on `feat/css-minimize-unify-colors`: `theme.css` rewritten to the canonical set
below (Charcoal+Blue brand, deeper red, `--warp-edit`, derived tints, collapsed greys);
all consumers (`style.css`, `nouislider.css`, `tabulator.css`) migrated to the new token
names; `black`→`--warp-text`; stale `#ee6e73` comment removed. Verified: no dropped token
name remains, every referenced colour token is defined. Rebuild of the webpack bundle still
pending. Original spec below.

### Target token set (the whole palette, after collapse)

**Brand — the re-brand knobs (only raw hex you ever change).** Chosen direction:
**Charcoal Slate + Blue** — professional/business, replacing the old indigo + orange.

| Token | Value | Was |
|-------|-------|-----|
| `--warp-primary` | `#2C3E50` (charcoal slate) | `#3949ab` indigo |
| `--warp-secondary` | `#2980B9` (blue accent) | `#ff6d00` orange |

**Derived from brand — `color-mix()` in `theme.css`, no own hex (recolor for free on
re-brand; still individually override-able by a deployment).** Background tints mix against
`var(--warp-surface)` so they follow the surface into dark mode automatically; accent fills
mix against `white`/`black`.

| Token | Derivation | Replaces | Dark-mode note |
|-------|-----------|----------|----------------|
| `--warp-primary-light` | `color-mix(in srgb, var(--warp-primary), white 20%)` | `--warp-primary-light #5c6bc0` | accent fill — toward white is correct in both modes |
| `--warp-primary-dark` | `color-mix(in srgb, var(--warp-primary), black 25%)` | `--warp-link` / `--warp-indigo-dark` `#283593` | **needs a 1-line override** in the step-3 dark block (mixing toward black is wrong on dark bg) |
| `--warp-primary-tint` | `color-mix(in srgb, var(--warp-primary), var(--warp-surface) 75%)` | `--warp-indigo-light #c5cae9` | background tint — follows surface, free in dark mode |
| `--warp-primary-pale` | `color-mix(in srgb, var(--warp-primary), var(--warp-surface) 90%)` | `--warp-indigo-pale #e8eaf6` | background tint — follows surface, free in dark mode |
| `--warp-secondary-pale` | `color-mix(in srgb, var(--warp-secondary), var(--warp-surface) 70%)` | `--warp-accent-light #ffe0b2` | background tint — follows surface, free in dark mode |

In light mode `--warp-surface` is `#fff`, so the surface-mixed tints render identically to
today's hardcoded values. The current `--warp-indigo` / `--warp-accent` aliases just point
at primary/secondary — drop them and use the brand tokens directly.

**Semantic status:**

| Token | Value | Role / absorbs |
|-------|-------|----------------|
| `--warp-error` | `#c62828` (deeper, was `#f44336`) | danger button + danger icon (absorbs `--warp-danger-btn`, `--warp-danger-icon`). White text on `#c62828` passes WCAG AA. |
| `--warp-success` | `#2e7d32` | **seat-status "free/available" only** (`.seat-icon--green`). No longer drives edit icons. |

**Edit/manage affordance (green dropped).** `--warp-edit-icon` / `--warp-edit-icon-alt`
aliased `--warp-success`, making the pencil/manage icons in the groups/zones/plans/users
tables green — semantically meaningless. Drop both tokens; the `.warp-icon-edit` /
`.warp-icon-edit-alt` classes use **`var(--warp-grey-text)`** (recommended — unobtrusive in
dense tables, lets the red delete icon own the eye). Alternative: `var(--warp-secondary)`
if edit should read as the primary interactive action. Green is now used *only* for seats.

**Neutrals — collapsed ramp (6 tokens, down from surface+text+6 greys+5 odds = 13):**

| Token | Value | Role | Absorbs |
|-------|-------|------|---------|
| `--warp-surface` | `#ffffff` | cards, modals, inputs | plain `#fff` / `white` literals |
| `--warp-text` | `#212121` | body/heading text | stray `black` (`style.css:1382`) |
| `--warp-grey-bg` | `#f5f5f5` | hover/fill/footer | `--warp-grey-1`; slider-handle-shadow `#ebebeb` |
| `--warp-grey-border` | `#e0e0e0` | borders, dividers | `--warp-grey-2`; `--warp-disabled-fab #dfdfdf`; slider-handle-border `#d9d9d9` |
| `--warp-grey-muted` | `#9e9e9e` | disabled text/icons | `--warp-grey-3`; slider-handle-shadow-outer `#bbb` |
| `--warp-grey-text` | `#616161` | secondary text, labels | `--warp-grey-4`; `--warp-grey-5 #757575`; `--warp-seat-preview-text #6e6e6e`; `--warp-grey-6 #424242` |

**RGB channels (kept for `rgba(... α)` rules), updated to the new values:**
`--warp-primary-rgb: 44, 62, 80` · `--warp-secondary-rgb: 41, 128, 185` · `--warp-error-rgb: 198, 40, 40`.

### Net effect

**Distinct raw hex values: 22 → 10** (`#2C3E50 #2980B9 #c62828 #2e7d32 #ffffff #212121
#f5f5f5 #e0e0e0 #9e9e9e #616161`). The five brand tints stop being hardcoded and follow
`--warp-primary` / `--warp-secondary`. A re-brand is now: change those two (+ optionally
`--warp-error`). Green (`--warp-success`) is reserved for seat status.

### Your mental model → roles

| You called it | Token |
|---------------|-------|
| Primary | `--warp-primary` |
| Secondary | `--warp-secondary` |
| Buttons (default / primary action / danger) | `--warp-secondary` / `--warp-primary` / `--warp-error` |
| Form elements (border / focus) | `--warp-grey-border` / `--warp-primary` |
| Labels | `--warp-grey-text` |
| danger-btn | `--warp-error` (deeper `#c62828`) |
| Edit/manage icons | `--warp-grey-text` (was green; green now seats-only) |
| warning-label | dropped — not used (YAGNI) |

### Literal migrations

- `black` (`style.css:1382`, `.userGroupCell`) → `var(--warp-text)`. **Done.**
- `#ee6e73` stale comment in `tabulator.css` → removed. **Done.**
- **`#fff` / `white` (18 sites) → moved to step 2.** On inspection these split into two
  roles — *surface backgrounds* vs *text/icon on a colored element* (e.g. the timepicker
  digital header text at `style.css:889,906` is white-on-primary; button text at `51,58`
  is on-brand). They're all already `#fff` = surface's value, so routing them changes **no
  colour** — it's pure layering, and the surface-vs-`--warp-on-brand` split is exactly the
  step-2 role work. Doing a coarse `→ --warp-surface` now would mislabel the on-brand whites
  and break dark mode. So step 1 leaves them; step 2 routes each to the correct role.
- Black `rgba()` shadows and white `rgba()` overlays: also step 2 (need `--warp-shadow-rgb`
  / `--warp-surface-rgb` channels).

### Decisions (locked)

1. **`--warp-grey-6 #424242`** (1 use) → folds into `--warp-grey-text #616161`. Accept the
   slight lightening.
2. **Warning role** → dropped. Not used anywhere; don't add one (YAGNI).
3. **Tints** → derived via `color-mix()` **in `theme.css`** (so a deployment can still
   override any single tint with a literal). Background tints mix against `var(--warp-surface)`
   to flip for free in dark mode; the one exception is `--warp-primary-dark`, which mixes
   toward black and gets a 1-line override in the step-3 dark block.
4. **Brand** → **Charcoal Slate `#2C3E50` + Blue `#2980B9`** (preview `res/palette-preview/4-final.png`),
   replacing indigo + orange.
5. **Error** → deepened to **`#c62828`** (was `#f44336`) for a more business tone; AA-safe with white text.
6. **Edit/manage icons** → **neutral `--warp-grey-text`** (green dropped). `--warp-success`
   green is now seat-status-only. Open sub-choice: keep grey (recommended) or use
   `--warp-secondary` blue for edit icons.

---

## Step 2 — Split into layers  ✅ IMPLEMENTED

`theme.css` is now organised into labelled layers, top to bottom: **BRAND** knobs →
derived **brand tints** → **semantic roles** → **neutral roles** → **rgba channels**. The
app consumes roles/channels only — every raw colour literal is routed to a token.

What was done:
- **New role/channel tokens:** `--warp-on-brand` (`#ffffff`, text/icons on a brand fill —
  stays light in dark mode), `--warp-surface-rgb`, `--warp-shadow-rgb`.
- **Routed the 18 white literals by role:** 12 on-brand (M3 `on-*` mappings, danger/primary
  button text, active weekday chip, timepicker numerals, seat/zone titles, rotate label) →
  `--warp-on-brand`; 6 surface backgrounds (sidepanel, seat preview/label, marquee handles)
  → `--warp-surface`. One inline-SVG `fill="white"` (`zoneModify_marquee.js`) → an inline
  `style="fill:var(--warp-surface)"` (presentation attrs can't take `var()`).
- **Routed rgba literals:** black drop-shadows (`style.css` 607/663/968) →
  `rgba(var(--warp-shadow-rgb), α)`; white overlays (`style.css:899`, `tabulator.css:47`) →
  `rgba(var(--warp-surface-rgb), α)`.

Naming note: the neutral roles keep their step-1 names (`--warp-surface`, `--warp-text`,
`--warp-grey-bg/border/muted/text`) rather than M3-style renames (`--warp-on-surface`, …).
They're already role-clear, and a dark theme flips `--warp-text` just as easily as
`--warp-on-surface` would — the rename was pure churn for no dark-mode benefit.

Result: a `:root[theme="dark"]` block overriding the **neutral roles + channels** is now
all that step 3 needs; brand tints re-mix against the new surface automatically and the app
CSS doesn't move. Only `seat_icons.svg`'s `#ffffff` disc base remains (external SVG — vars
don't cross an external `<use>`; handled in step 3).

---

## Step 3 — Dark mode (after step 2)

- One block re-points roles:
  ```css
  :root[theme="dark"] {
    --warp-bg:             #121212;
    --warp-surface:        #1e1e1e;
    --warp-on-surface:     #e0e0e0;
    --warp-on-surface-muted: var(--warp-grey-muted);
    --warp-border:         #3a3a3a;
    --warp-hover:          #2a2a2a;
    --warp-shadow-rgb:     0, 0, 0;     /* or a light glow */
    /* brand tints re-mix against the dark surface automatically */
  }
  ```
- Wire the existing Materialize M3 `*-dark` tokens alongside the `*-light` ones already in
  `style.css:35` (currently only `[theme="light"]` is defined).
- **Seat icons:** parameterise the white disc base in
  `warp/static/images/seat_icons.svg` (lines 31, 59, 62, 78). CSS vars don't cross an
  external `<use>`, so this needs the icon inlined, or a swapped dark sprite, or
  `color-scheme`-aware handling — decide at step 3.

---

## Appendix A — Seat icons (`warp/static/images/seat_icons.svg`)

Already built for color-swap and **conformant**: every glyph, the disc tint
(`currentColor` @ 0.2) and the ring (`currentColor`) inherit from CSS `color`, set by the
consuming `.seat-icon` class. Effectively **two colors per render: `currentColor` + white
background**. The only literals are the `#ffffff` disc base (lines 31, 59, 62, 78) and the
preview-strip `color=` swatches (lines 83–88), which the app does **not** use. No step-1
change; white base is parameterised in step 3.

## Appendix B — Census (verified against source)

### Current `theme.css` tokens — collapse map

| Current token | Value | → After step 1 |
|---------------|-------|----------------|
| `--warp-primary` | `#3949ab` | **rebrand → `#2C3E50` charcoal** |
| `--warp-primary-light` | `#5c6bc0` | derive from primary |
| `--warp-secondary` | `#ff6d00` | **rebrand → `#2980B9` blue** |
| `--warp-link` | `#283593` | → `--warp-primary-dark` (derived) |
| `--warp-indigo` (alias) | =primary | drop, use `--warp-primary` |
| `--warp-indigo-light` | `#c5cae9` | → `--warp-primary-tint` (derived) |
| `--warp-indigo-pale` | `#e8eaf6` | → `--warp-primary-pale` (derived) |
| `--warp-indigo-dark` | `#283593` | → `--warp-primary-dark` (derived) |
| `--warp-accent` (alias) | =secondary | drop, use `--warp-secondary` |
| `--warp-accent-light` | `#ffe0b2` | → `--warp-secondary-pale` (derived) |
| `--warp-error` | `#f44336` | **deepen → `#c62828`** |
| `--warp-success` | `#2e7d32` | keep — **seat status only** |
| `--warp-danger-btn/-icon` (alias) | =error | drop, use `--warp-error` |
| `--warp-edit-icon/-icon-alt` (alias) | =success | **drop; edit icons → `--warp-grey-text`** |
| `--warp-text` | `#212121` | keep |
| `--warp-surface` | `#ffffff` | keep |
| `--warp-grey-1` | `#f5f5f5` | → `--warp-grey-bg` |
| `--warp-grey-2` | `#e0e0e0` | → `--warp-grey-border` |
| `--warp-grey-3` | `#9e9e9e` | → `--warp-grey-muted` |
| `--warp-grey-4` | `#616161` | → `--warp-grey-text` |
| `--warp-grey-5` | `#757575` | → `--warp-grey-text` |
| `--warp-grey-6` | `#424242` | → `--warp-grey-text` |
| `--warp-seat-preview-text` | `#6e6e6e` | → `--warp-grey-text` |
| `--warp-disabled-fab` | `#dfdfdf` | → `--warp-grey-border` |
| `--warp-slider-handle-border` | `#d9d9d9` | → `--warp-grey-border` |
| `--warp-slider-handle-shadow` | `#ebebeb` | → `--warp-grey-bg` |
| `--warp-slider-handle-shadow-outer` | `#bbb` | → `--warp-grey-muted` |
| `--warp-*-rgb` | channels | keep (`primary`, `secondary`, `error`) |

### Direct colors in the themed app (the literals to migrate)

| Literal | Where | → |
|---------|-------|---|
| `#fff` / `white` | `js/base/style.css` ×18, `js/views/modules/zoneModify_marquee.js:93` | `var(--warp-surface)` — **except** on-brand whites `style.css:37,39,41,51,58` |
| `black` | `js/base/style.css:1382` | `var(--warp-text)` |
| `rgba(0,0,0,α)` shadows | `style.css:607,663,968` | step 2 (`--warp-shadow-rgb`) |
| `rgba(255,255,255,α)` overlays | `style.css:899`, `tabulator.css:47` | step 2 (`--warp-surface-rgb`) |
| `#ee6e73` (comment only) | `js/views/css/tabulator/tabulator.css:18` | delete comment |
| `currentColor`, `transparent`, `inherit` | various | keep (CSS keywords) |

Out-of-scope literals (maintenance illustration, visual-snapshot test chrome, `res/`
leftover sprite) are intentionally excluded from theming.
