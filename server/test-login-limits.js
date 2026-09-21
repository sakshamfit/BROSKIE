/* Sign-in throttling regression suite.
 *
 * The production topology is  client → Vercel (plusoneco.in) → Render edge →
 * this container, so every request arrives with a two-entry X-Forwarded-For
 * chain: "‹client›, ‹proxy›". When only one hop was trusted, `req.ip` was the
 * *proxy* address, every user shared a single rate-limit bucket, and once 30
 * sign-in attempts had been seen in 15 minutes the whole user base got
 * "Too many attempts from this network" — users could not log in at all, even
 * with the correct password.
 *
 * This suite boots the real server and verifies, through that proxy chain:
 *   1. buckets are per CLIENT, not per proxy (two clients behind the same
 *      proxy do not consume each other's budget),
 *   2. a correct password is NEVER refused by a throttled budget,
 *   3. wrong passwords are still stopped (per-origin and per-account budgets),
 *   4. successful sign-ins never consume a brute-force budget,
 *   5. extra entries a client prepends to X-Forwarded-For cannot move it into
 *      someone else's bucket.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4325;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plusone-login-limits-'));
const BASE = `http://127.0.0.1:${PORT}`;
// Two proxies in front of the app, as in production.
const PROXY = '76.76.21.21';
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '203.0.113.11';
const CLIENT_C = '203.0.113.12';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = (clientIp, username, password, extraLeftHops = []) => fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Forwarded-For': [...extraLeftHops, clientIp, PROXY].join(', '),
  },
  body: JSON.stringify({ username, password }),
});

const register = (clientIp, body) => fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${clientIp}, ${PROXY}` },
  body: JSON.stringify(body),
});

async function main() {
  // Exercise the production default hop count (2): drop any inherited override.
  const childEnv = { ...process.env };
  delete childEnv.TRUST_PROXY_HOPS;
  const server = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: {
      ...childEnv,
      PORT: String(PORT),
      JWT_SECRET: 'login-limits-test-secret',
      DATA_DIR,
      CORS_ORIGIN: '*',
      NODE_ENV: 'production',
      // Exercise the limiters on loopback; they are exempt by default.
      RATE_LIMIT_ENFORCE_LOOPBACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.env.VERBOSE && console.error(String(d)));
  server.stdout.on('data', (d) => process.env.VERBOSE && console.log(String(d)));

  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch {}
    await sleep(250);
  }

  /* Accounts used by the suite (each registered from its own client IP). */
  const alice = await register(CLIENT_A, { username: 'limits_alice', name: 'Alice', password: 'correct-horse-1' });
  ok(alice.status === 200, 'register works through the two-hop proxy chain');
  const bob = await register(CLIENT_B, { username: 'limits_bob', name: 'Bob', password: 'correct-horse-2' });
  ok(bob.status === 200, 'a second client behind the same proxy can register');
  const carol = await register(CLIENT_C, { username: 'limits_carol', name: 'Carol', password: 'correct-horse-3' });
  ok(carol.status === 200, 'a third client behind the same proxy can register');

  const plain = await login(CLIENT_A, 'limits_alice', 'correct-horse-1');
  ok(plain.status === 200, 'sign-in with the correct password succeeds');

  /* 1. Successful sign-ins never consume a brute-force budget. */
  let successCount = 0;
  for (let i = 0; i < 40; i++) {
    const r = await login(CLIENT_A, 'limits_alice', 'correct-horse-1');
    if (r.status === 200) successCount += 1;
  }
  ok(successCount === 40, '40 correct sign-ins in a row are all accepted (successes cost nothing)');

  /* 2. Wrong passwords from CLIENT_A draw on that origin's budget … */
  let failuresBefore429 = 0;
  let firstLimit = null;
  for (let i = 0; i < 40; i++) {
    const r = await login(CLIENT_A, `nowhere_${i}`, 'definitely-wrong');
    if (r.status === 429) { firstLimit = { i, body: await r.json().catch(() => ({})) }; break; }
    if (r.status === 401) failuresBefore429 += 1;
  }
  ok(failuresBefore429 >= 30, `wrong passwords are allowed ~30 times per origin (got ${failuresBefore429})`);
  ok(!!firstLimit, 'wrong passwords from one origin are then throttled with 429');
  ok(/from this network/i.test(firstLimit?.body?.error || ''), 'the 429 explains the network budget');

  /* 3. … but the user with the RIGHT password still signs in (the bug). */
  const afterLimit = await login(CLIENT_A, 'limits_alice', 'correct-horse-1');
  ok(afterLimit.status === 200, 'a correct password still signs in from a throttled origin (users can log in)');

  /* 4. A different client behind the SAME proxy keeps its own budget. */
  const otherClientWrong = await login(CLIENT_B, 'limits_bob', 'definitely-wrong');
  ok(otherClientWrong.status === 401, 'a second client behind the same proxy is not throttled by the first');
  const otherClientRight = await login(CLIENT_B, 'limits_bob', 'correct-horse-2');
  ok(otherClientRight.status === 200, 'the second client still signs in normally');

  /* 5. Entries prepended by a client cannot move it to another bucket. */
  const spoofed = await login(CLIENT_A, 'limits_alice', 'definitely-wrong', ['198.51.100.7', '192.0.2.9']);
  ok(spoofed.status === 429, 'prepending X-Forwarded-For entries does not escape the origin budget');

  /* 6. The per-account budget still stops an account-targeted grind. */
  let accountThrottled = false;
  for (let i = 0; i < 15; i++) {
    const r = await login(CLIENT_C, 'limits_carol', `wrong-${i}`);
    if (r.status === 429) {
      const body = await r.json().catch(() => ({}));
      accountThrottled = /for this account/i.test(body.error || '');
      break;
    }
    if (r.status !== 401) break;
  }
  ok(accountThrottled, '10 wrong passwords for one account trip the per-account budget');
  const carolRight = await login(CLIENT_C, 'limits_carol', 'correct-horse-3');
  ok(carolRight.status === 200, 'the locked account still signs in with its correct password');

  console.log(`\nLOGIN LIMITS: ${pass} passed, ${fail} failed`);
  server.kill('SIGTERM');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
