#!/usr/bin/env node
/* Serve app/dist with vercel cleanUrls semantics for local preview.
 * Usage: node scripts/preview-site.mjs [port]  (default 8080) */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
function resolveFile(urlPath) {
  let p = urlPath.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const direct = path.normalize(path.join(DIST, p));
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (!p.includes('.')) {
    for (const c of [`${p}.html`, path.join(p, 'index.html')]) {
      const f = path.normalize(path.join(DIST, c));
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}
http.createServer((req, res) => {
  const file = resolveFile(req.url);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(PORT, '0.0.0.0', () => console.log(`+one site preview → http://0.0.0.0:${PORT} (serving ${DIST})`));
