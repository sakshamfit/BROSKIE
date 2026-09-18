// Dependency-free checks for backend URL selection and deployment routing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const backend = 'https://broskie.onrender.com';
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
check('web', 'https://plusoneco.in/app', undefined, ['', backend]);
check('web', 'https://www.plusoneco.in', backend, ['', backend]);
check('web', 'https://preview.vercel.app', undefined, ['', backend]);
check('web', 'https://broskie.workers.dev', backend, [backend, backend]);
check('web', backend, undefined, ['', '']);
check('android', undefined, undefined, ['https://plusoneco.in', backend]);
check('android', undefined, backend, ['https://plusoneco.in', backend]);
check('android', undefined, 'http://localhost:4000', ['https://plusoneco.in', backend]);
check('web', 'http://localhost:8081', undefined, ['http://localhost:4000', 'http://localhost:4000']);
const vercel = JSON.parse(read('vercel.json'));
for (const route of ['/api/:path*', '/uploads/:path*', '/.well-known/assetlinks.json']) {
  assert.equal(vercel.rewrites.find((r) => r.source === route).destination, backend + route);
}
for (const file of ['package.json', 'wrangler.jsonc', 'app/public/index.html']) {
  assert.ok(read(file).includes(backend), `${file} must reference Render`);
  assert.ok(!read(file).includes('broskie-h.up.railway.app'), `${file} must not reference the old backend`);
}
assert.ok(read('app/plugins/withAuthNetworkSecurity.js').includes('>broskie.onrender.com</domain>'));
assert.ok(read('render.yaml').includes('dockerfilePath: ./Dockerfile.render'));
assert.ok(!/^COPY (?:--\S+ )*(?:\.\/)?app\//m.test(read('Dockerfile.render')), 'Render must not copy the frontend');
console.log('Backend URL selection and deployment configuration checks passed.');
