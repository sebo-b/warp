# visual-snapshot

A throwaway **capture-and-compare-by-eye** tool for the Materialize 1.x → 2.x
upgrade and the colour single-source-of-truth refactor. It boots the project in
the existing `containers/Dockerfile_debug` sandbox (deterministic DB + sample
data, frozen clock), drives a headless browser through every screen, and
captures full-page screenshots into a timestamped run directory. A single
self-contained HTML report lays every run out side-by-side (newest on the left)
so any two runs sit next to each other for direct visual comparison.

It is **deliberately not** a pixel-diff gate — the goal is human review of an
intentional, sweeping visual change.

## Run

```sh
cd e2e
npm run snapshot -- --label before     # before the Materialize upgrade
# … perform the upgrade on the same branch …
npm run snapshot -- --label after      # after
open ../res/visual-snapshots/report.html
```

### Args

| arg | purpose |
|-----|---------|
| `--label <name>` | tag the run dir + report column (e.g. `before`/`after`) |
| `--only id,id` | capture just these catalogue ids (fast iteration) |
| `--keep-container` | leave the sandbox container running after the run |
| `--prune <N>` | keep only the newest `N` run directories, delete the rest |
| `--help` | usage |

### Escape hatch (no container)

Point the tool at an already-running instance instead of building/starting one
(mirrors the e2e `E2E_BASE_URL` convention):

```sh
VISUAL_BASE_URL=http://127.0.0.1:5000 \
  E2E_DB_HOST=127.0.0.1 E2E_DB_PORT=5432 \
  npm run snapshot -- --label before
```

Handy for fast iteration while writing the catalogue.

## Output

```
res/visual-snapshots/          ← git-ignored build artefact
  runs/<ISO-timestamp>[_label]/
    manifest.json              ← runId, label, gitSha, startedAt, engine, per-screen result
    login.png  bookings.png  plans-modify.png  …
  report.html                  ← regenerated on every run (the matrix)
```

The tool source (`res/visual-snapshot/**`) is committed; the screenshots and
report under `res/visual-snapshots/` are git-ignored.

## Determinism

1. **DB** — `resetDb()` replays `clean_db.sql` + `schema.sql` + `sample_data.sql`
   (the exact scripts the app runs at first start), so every run begins from the
   same seeded state.
2. **Clock** — `POST /debug/set_time_offset` freezes the server clock to a
   fixed instant (`2026-01-15 12:00:00 UTC`) *before* login, so sessions don't
   expire and there's no "today"/relative-date drift between before/after runs.
3. **Animations/fonts** — a style tag kills all transitions/animations and
   hides the caret; each shot waits for `networkidle` + web-font load first.
4. **Viewport** — fixed desktop default (`1280×900`, `deviceScaleFactor: 1`);
   per-screen override for the mobile sidenav case.

Dynamic ids (`pid`/`zid`/`group_login`) are resolved from the seeded DB at
runtime (via the imported `querySql` helper) — never hardcoded.

## Files

- `index.ts` — orchestration (thin): args, sandbox, DB reset, clock freeze,
  browser/contexts, manifest, prune, report.
- `container.ts` — inline sandbox lifecycle (start/stop `Dockerfile_debug`) +
  `VISUAL_BASE_URL` escape hatch. A deliberate self-contained copy of the
  proven ~40 lines from `e2e/global-setup.ts` (see plan for the footprint
  decision).
- `screens.ts` — the catalogue (declarative, ordered). Adding a screen is a
  one-line change.
- `capture.ts` — per-screen navigate + settle + screenshot, continue-on-error.
- `report.ts` — pure HTML matrix-report generator (no deps).

## One-line removal

This tool is built to be **isolated and deletable**. It reuses four e2e leaf
helpers (`auth`, `users`, `db`, `debug`) by import only — it never modifies the
e2e suite, `global-setup.ts`, or CI. Remove it and everything it produced with:

```sh
rm -rf res/visual-snapshot res/visual-snapshots
```

and revert the two small changes in `e2e/package.json` (the `tsx` devDependency
and the `snapshot` script) and the `res/visual-snapshots/` line in `.gitignore`.