// Dependency-free checks for backend URL selection and deployment routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const backend = 'https://broskie-production-5d30.up.railway.app';
const legacyBackends = [
  'https://broskie.onrender.com',
  'https://broskie-h.up.railway.app',
];

// Evaluate the URL-selection section without loading React Native or HTTP code.
const source = read('app/src/api.js').split('export function mediaUrl')[0]
  .replace("import { Platform } from 'react-native';", '')
  .replace(/export const /g, 'const ');
function resolve(os, url, override) {
  const context = {
    Platform: { OS: os },
    process: { env: override ? { EXPO_PUBLIC_API_URL: override } : {} },
    __DEV__: false,
    ...(url ? { window: { location: new URL(url) } } : {}),
  };
  return vm.runInNewContext(source + '\nJSON.stringify([API_URL, SOCKET_URL]);', context);
}
function check(os, url, override, expected) {
  assert.deepEqual(JSON.parse(resolve(os, url, override)), expected);
}

// Browser HTTP uses Vercel's same-origin proxy; Socket.IO connects to Railway.
check('web', 'https://plusoneco.in/app', undefined, ['', backend]);
check('web', 'https://www.plusoneco.in', backend, ['', backend]);
check('web', 'https://preview.vercel.app', undefined, ['', backend]);
// Other static hosts can explicitly bake the Railway origin into their build.
check('web', 'https://broskie.workers.dev', backend, [backend, backend]);
// Single-host Railway uses same-origin HTTP and Socket.IO.
check('web', backend, undefined, ['', '']);

// Native clients use Vercel for HTTP and Railway for sockets by default.
check('android', undefined, undefined, ['https://plusoneco.in', backend]);
check('android', undefined, backend, ['https://plusoneco.in', backend]);
for (const legacy of legacyBackends) {
  check('android', undefined, legacy, ['https://plusoneco.in', backend]);
}
check('android', undefined, 'http://localhost:4000', ['https://plusoneco.in', backend]);
check('web', 'http://localhost:8081', undefined, ['http://localhost:4000', 'http://localhost:4000']);

const vercel = JSON.parse(read('vercel.json'));
for (const route of ['/api/:path*', '/uploads/:path*', '/.well-known/assetlinks.json']) {
  assert.equal(vercel.rewrites.find((r) => r.source === route).destination, backend + route);
}

const androidNetworkSecurity = read('app/plugins/withAuthNetworkSecurity.js');
assert.ok(androidNetworkSecurity.includes('<domain includeSubdomains="false">broskie-production-5d30.up.railway.app</domain>'));
for (const file of ['package.json', 'wrangler.jsonc', 'app/public/index.html']) {
  assert.ok(read(file).includes(backend), `${file} must reference the active Railway backend`);
}
assert.ok(read('app/src/api.js').includes(`const DEFAULT_SERVER_URL = '${backend}'`));
for (const legacy of legacyBackends) {
  assert.ok(read('app/src/api.js').includes(legacy), `legacy native builds should be recognized: ${legacy}`);
}
assert.ok(read('render.yaml').includes('dockerfilePath: ./Dockerfile.render'));
assert.ok(!/^COPY (?:--\S+ )*(?:\.\/)?app\//m.test(read('Dockerfile.render')), 'Render must not copy the frontend');
console.log('Railway backend URL selection and deployment configuration checks passed.');
