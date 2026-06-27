// Tiny static file server for the OfficeMap isolated e2e page. No deps — just
// Node's http + fs. Maps URL prefixes to filesystem directories so the test
// page can import the real OfficeMap module + panzoom + sprite + theme + maps
// without a backend or a bundler. Used by playwright.officemap.config.ts as a
// webServer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');

// [urlPrefix, fsRoot] — longest/most-specific prefixes first.
const ROOTS = [
  ['/panzoom/', path.join(REPO, 'e2e/node_modules/@panzoom/panzoom/dist')],
  ['/js/',     path.join(REPO, 'js')],
  ['/static/', path.join(REPO, 'warp/static')],
  ['/maps/',   path.join(REPO, 'res/sample_zone_maps')],
  ['/',        __dirname],   // the test page itself + assets
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.json': 'application/json; charset=utf-8',
};

function resolve(urlPath) {
  for (const [prefix, root] of ROOTS) {
    if (urlPath === prefix.slice(0, -1) || urlPath.startsWith(prefix)) {
      const rel = urlPath.slice(prefix.length);
      const fsPath = path.join(root, decodeURIComponent(rel));
      // Guard against path traversal within a root.
      if (!fsPath.startsWith(root)) return null;
      return fsPath;
    }
  }
  return null;
}

const PORT = Number(process.env.OFFICEMAP_PORT) || 7357;

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let fsPath = resolve(urlPath);
  if (!fsPath) { res.writeHead(404); res.end('404'); return; }
  fs.stat(fsPath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404'); return; }
    const type = TYPES[path.extname(fsPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(fsPath).pipe(res);
  });
});

server.listen(PORT, () => {
  // stdout so playwright webServer `reuseExistingServer`/startup detection works.
  console.log(`officemap static server on http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));