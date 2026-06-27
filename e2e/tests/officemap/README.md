# OfficeMap — isolated component e2e (Phase 1)

Standalone Playwright suite for the `OfficeMap` component (see
`PLAN_officemap.md` §10, Phase 1). No backend, no container — a tiny static
server (`serve.mjs`) serves the test page plus the real component module, the
sprite, the theme, and the sample map images.

## Run

    cd e2e
    npm run test:officemap          # = playwright test --config=playwright.officemap.config.ts

The config starts `serve.mjs` as a `webServer` (port `OFFICEMAP_PORT` or 7357)
and reuses an existing one outside CI.

## Layout

- `index.html` — static harness page: builds an `OfficeMap` on synthetic seat
  data, with mode/dark/clear/reseed controls and test hooks on `window.__*`.
- `serve.mjs` — dependency-free Node static server; maps URL prefixes
  (`/js/`, `/static/`, `/maps/`, `/panzoom/`, `/`) to repo dirs.
- `officemap.spec.ts` — the suite (rendering, zoom/pan/bounds, counter-scale
  S1/S2, click/hover/long-press/pinch, dark filter).
- `playwright.officemap.config.ts` (in `e2e/`) — standalone config, no
  container global-setup.