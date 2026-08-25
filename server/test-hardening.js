/* Live verification of the LOOP-2 hardening changes.
 * Boots the real server and checks: security headers, upload MIME enforcement
 * (+ magic-byte sniffing), upload serving headers, HTML/SVG upload rejection,
 * per-IP rate limiting (via the box's non-loopback IP), and the privacy-aware
 * presence broadcast (nobody-mode users no longer leak online/last-seen).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4316;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-hardening-'));
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: 'hardening-smoke-secret',
      DATA_DIR,
      CORS_ORIGIN: '*',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.env.VERBOSE && console.error(String(d)));
  server.stdout.on('data', (d) => process.env.VERBOSE && console.log(String(d)));
  server.on('exit', (code) => {
    if (code !== null && code !== 0 && pass + fail === 0) {
      console.error(`[smoke] server exited early with code ${code} — rerun with VERBOSE=1 for logs`);
    }
  });

  // wait for boot
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {}
    await sleep(250);
  }

  /* 1. security headers */
  const health = await fetch(`${BASE}/api/health`);
  ok(health.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff on API');
  ok(health.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer-Policy set');

  /* 2. auth + login throttle recording path works over loopback (exempt) */
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hardener1', name: 'Hardener', password: 'supersecret123', phone: '+15550000001' }),
  });
  const regBody = await reg.json().catch(() => ({}));
  ok(reg.status === 200 && regBody.token, 'register works (loopback exempt from limiter)');
  const badLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hardener1', password: 'wrong-password' }),
  });
  ok(badLogin.status === 401, 'wrong password rejected');
  const goodLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hardener1', password: 'supersecret123' }),
  });
  ok(goodLogin.status === 200, 'correct password accepted after failures');

  /* 3. upload enforcement */
  const token = regBody.token;
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000148afa4710000000049454e44ae426082', 'hex');

  const up = async (buf, mime, name) => fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data; boundary=X' },
    body: Buffer.concat([Buffer.from('--X\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: ' + mime + '\r\n\r\n'), buf, Buffer.from('\r\n--X--\r\n')]),
  });

  const goodPng = await up(PNG, 'image/png', 'pixel.png');
  const goodPngBody = await goodPng.json().catch(() => ({}));
  ok(goodPng.status === 200 && typeof goodPngBody.url === 'string', 'valid PNG upload accepted');

  const htmlAsHtml = await up(Buffer.from('<script>alert(1)</script>'), 'text/html', 'evil.html');
  ok(htmlAsHtml.status === 415, 'text/html upload rejected (415)');

  const htmlAsPng = await up(Buffer.from('<script>alert(1)</script>'), 'image/png', 'evil.png');
  ok(htmlAsPng.status === 415, 'HTML masquerading as image/png rejected by magic-byte sniff');

  const exeAsPng = await up(PNG, 'application/octet-stream', 'pixel.bin');
  ok(exeAsPng.status === 415, 'unknown mimetype rejected');

  /* 4. served uploads carry safe headers */
  if (goodPngBody.url) {
    const getUrl = goodPngBody.url.startsWith('http') ? goodPngBody.url : BASE + goodPngBody.url;
    const img = await fetch(getUrl);
    ok(img.status === 200, 'uploaded PNG served back');
    ok(img.headers.get('x-content-type-options') === 'nosniff', 'nosniff on uploads');
    ok(String(img.headers.get('content-security-policy') || '').includes('sandbox'), 'CSP sandbox on uploads');
  }

  /* 5. privacy-aware presence: user with lastSeen=nobody must not leak */
  const { io } = require('socket.io-client');
  const reg2 = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hardener2', name: 'Private', password: 'supersecret123', phone: '+15550000002' }),
  });
  const u2 = await reg2.json();
  // u1 sets lastSeen=nobody, then connects; u2 listens for presence events.
  await fetch(`${BASE}/api/me/settings`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ privacy: { lastSeen: 'nobody' } }),
  });
  const s1 = io(BASE, { auth: { token }, transports: ['websocket'] });
  await new Promise((r) => s1.on('connect', r));
  const leaks = [];
  const s2 = io(BASE, { auth: { token: u2.token }, transports: ['websocket'] });
  s2.on('presence', (p) => { if (p.userId === JSON.parse(atob(token.split('.')[1])).id) leaks.push(p); });
  await new Promise((r) => s2.on('connect', r));
  await sleep(1200);
  ok(leaks.length === 0, 'presence of lastSeen=nobody user is NOT broadcast to others');
  s1.disconnect(); s2.disconnect();

  /* 6. per-IP rate limit actually bites from a non-loopback source IP */
  const nonLoopback = Object.values(os.networkInterfaces()).flat()
    .find((i) => i && !i.internal && i.family === 'IPv4');
  if (nonLoopback) {
    const host = nonLoopback.address;
    let got429 = false;
    for (let i = 0; i < 45; i++) {
      const r = await fetch(`http://${host}:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', host: `spoiled:${PORT}` },
        body: JSON.stringify({ username: `probe${i}`, password: 'x' }),
      }).catch(() => null);
      if (r && r.status === 429) { got429 = true; break; }
    }
    ok(got429, 'rate limiter returns 429 after the per-IP auth budget (non-loopback IP)');
  } else {
    console.log('  - no non-loopback interface; rate-limit bite check skipped');
  }

  console.log(`\nHARDENING SMOKE: ${pass} passed, ${fail} failed`);
  server.kill('SIGTERM');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
