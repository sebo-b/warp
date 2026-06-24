// Pure HTML matrix-report generator. Scans runs/*/manifest.json, lays the
// screenshots out as a table: one row per screen id (catalogue order),
// one column per run (newest first). Self-contained — no external deps,
// opens from disk or attaches to a PR.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

interface ScreenEntry {
  id: string;
  title: string;
  file?: string;
  ok: boolean;
  error?: string;
}

interface Manifest {
  runId: string;
  label?: string;
  gitSha?: string;
  startedAt: string;
  engine?: string;
  screens: ScreenEntry[];
}

const RUNS_DIR = path.resolve(__dirname, '..', 'visual-snapshots', 'runs');

function loadRuns(): Manifest[] {
  if (!existsSync(RUNS_DIR)) return [];
  const runs: Manifest[] = [];
  for (const name of readdirSync(RUNS_DIR)) {
    const dir = path.join(RUNS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const manPath = path.join(dir, 'manifest.json');
    if (!existsSync(manPath)) continue;
    try {
      runs.push(JSON.parse(readFileSync(manPath, 'utf8')) as Manifest);
    } catch {
      /* skip unreadable manifest */
    }
  }
  // Newest-first (left → right). startedAt is ISO; lexicographic == chronological.
  runs.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  return runs;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Build the self-contained HTML report. `catalogue` fixes row order. */
export function generateReport(catalogue: string[]): string {
  const runs = loadRuns();
  // Screen title lookup from the first manifest that has it (stable across runs).
  const titleFor = new Map<string, string>();
  for (const m of runs) for (const s of m.screens) titleFor.set(s.id, s.title);
  // Union of ids, catalogue order first, then any extras (new screens) appended.
  const allIds = new Set<string>();
  for (const id of catalogue) allIds.add(id);
  for (const m of runs) for (const s of m.screens) allIds.add(s.id);

  const rows = [...allIds].map((id) => {
    const title = titleFor.get(id) ?? id;
    const cells = runs.map((m) => {
      const s = m.screens.find((x) => x.id === id);
      const runDir = `runs/${m.runId}`;
      if (!s || !s.ok || !s.file) {
        return `<td class="missing" title="${esc(s?.error ?? 'not captured')}"><span>—</span></td>`;
      }
      const src = `${runDir}/${s.file}`;
      return `<td><a href="${esc(src)}" target="_blank"><img loading="lazy" src="${esc(src)}" alt="${esc(title)}"></a></td>`;
    }).join('\n      ');
    return `    <tr><th>${esc(title)}</th>\n      ${cells}</tr>`;
  }).join('\n');

  const headers = runs.map((m) => {
    const label = m.label ? `${esc(m.label)}` : '';
    const sha = m.gitSha ? `<br><code class="sha">${esc(m.gitSha.slice(0, 10))}</code>` : '';
    const ts = new Date(m.startedAt).toLocaleString();
    return `<th>${label}${sha}<br><span class="ts">${esc(ts)}</span></th>`;
  }).join('');

  const nRuns = runs.length;
  const empty = nRuns === 0
    ? '<p class="empty">No runs yet. Capture one with <code>npm run snapshot -- --label before</code>.</p>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>warp visual snapshots</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.4 -apple-system, system-ui, sans-serif; background: #1e1e1e; color: #ddd; }
  h1 { margin: 0; padding: 12px 16px; font-size: 16px; background: #252526; border-bottom: 1px solid #333; }
  .bar { padding: 8px 16px; color: #999; font-size: 12px; background: #252526; border-bottom: 1px solid #333; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 6px; vertical-align: top; text-align: left; }
  thead th { position: sticky; top: 0; background: #2d2d2d; z-index: 2; min-width: 220px; }
  tbody th { position: sticky; left: 0; background: #2d2d2d; z-index: 1; min-width: 140px; max-width: 200px; }
  tbody tr:hover { background: rgba(255,255,255,0.04); }
  tbody tr:hover th { background: #383838; }
  .sha { color: #569cd6; font-size: 11px; }
  .ts { color: #888; font-size: 11px; }
  td img { max-width: 100%; height: auto; display: block; cursor: zoom-in; }
  td.missing { text-align: center; color: #666; background: #222; }
  td.missing span { font-size: 20px; }
  .empty { padding: 24px; color: #888; }
  /* click-to-enlarge lightbox */
  #lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: none; align-items: center; justify-content: center; z-index: 10; }
  #lightbox img { max-width: 95vw; max-height: 95vh; }
  #lightbox.open { display: flex; }
</style>
</head>
<body>
<h1>warp visual snapshots</h1>
<div class="bar">${nRuns} run${nRuns === 1 ? '' : 's'} · newest on the left</div>
${empty}
<table>
  <thead><tr><th>screen</th>${headers}</tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
<div id="lightbox"><img alt=""></div>
<script>
  const lb = document.getElementById('lightbox');
  const lbImg = lb.querySelector('img');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('td a');
    if (a) { e.preventDefault(); lbImg.src = a.href; lb.classList.add('open'); return; }
    if (e.target === lb) lb.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('open'); });
</script>
</body>
</html>
`;
}

const REPORT_PATH = path.resolve(__dirname, '..', 'visual-snapshots', 'report.html');
export { REPORT_PATH };