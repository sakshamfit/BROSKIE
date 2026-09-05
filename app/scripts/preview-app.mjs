#!/usr/bin/env node
/* Serve app/dist exactly the way vercel.json does on plusoneco.in, for local
 * / sandbox preview of the FULL site + app:
 *
 *   /app, /app/*, /c/*, /gc/*   → dist/app/index.html   (the Expo app shell)
 *   /api/*, /uploads/*,
 *   /.well-known/assetlinks.json → proxied to the backend (default :4000)
 *   /socket.io/*                 → proxied (incl. WebSocket upgrade)
 *   everything else              → static file, cleanUrls (/about → about.html),
 *                                  falling back to dist/index.html (SPA)
 *
 * Usage: node scripts/preview-app.mjs [port] [backendUrl]
 *        node scripts/preview-app.mjs 8081 http://127.0.0.1:4000
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] || 8081);
const BACKEND = new URL(process.argv[3] || process.env.BACKEND_URL || 'http://127.0.0.1:4000');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.map': 'application/json',
};

const APP_SHELL = path.join(DIST, 'app', 'index.html');
const ROOT_SHELL = path.join(DIST, 'index.html');

const isProxied = (p) => (
  p === '/api' || p.startsWith('/api/')
  || p.startsWith('/uploads/')
  || p.startsWith('/socket.io')
  || p === '/.well-known/assetlinks.json'
);
const isAppRoute = (p) => (
  p === '/app' || p.startsWith('/app/')
  || p.startsWith('/c/') || p.startsWith('/gc/')
);

function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  return full.startsWith(base) ? full : null;
}

function resolveStatic(urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p.endsWith('/')) p += 'index.html';
  const direct = safeJoin(DIST, p);
  if (direct && fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  if (!path.extname(p)) {
    for (const c of [`${p}.html`, path.join(p, 'index.html')]) {
      const f = safeJoin(DIST, c);
      if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
  }
  return null;
}

function send(res, file, status = 200) {
  const ext = path.extname(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  headers['Cache-Control'] = file.includes(`${path.sep}_expo${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, must-revalidate, max-age=0';
  res.writeHead(status, headers);
  fs.createReadStream(file).pipe(res);
}

function proxy(req, res) {
  const opts = {
    hostname: BACKEND.hostname,
    port: BACKEND.port || (BACKEND.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: BACKEND.host },
  };
  const up = http.request(opts, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'backend unavailable', detail: err.message }));
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  if (isProxied(urlPath)) return proxy(req, res);
  if (isAppRoute(urlPath)) return send(res, APP_SHELL);
  const file = resolveStatic(urlPath);
  if (file) return send(res, file);
  // SPA fallback (matches the vercel.json catch-all rewrite)
  return send(res, fs.existsSync(ROOT_SHELL) ? ROOT_SHELL : APP_SHELL);
});

// WebSocket upgrade passthrough for socket.io
server.on('upgrade', (req, socket, head) => {
  const opts = {
    hostname: BACKEND.hostname,
    port: BACKEND.port || 80,
    path: req.url,
    method: 'GET',
    headers: { ...req.headers, host: BACKEND.host },
  };
  const up = http.request(opts);
  up.on('upgrade', (r, upSocket, upHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [k, v] of Object.entries(r.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upHead && upHead.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  up.on('error', () => socket.destroy());
  up.end(head);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`+one preview → http://0.0.0.0:${PORT}`);
  console.log(`  static: ${DIST}`);
  console.log(`  api/socket proxy → ${BACKEND.origin}`);
});
