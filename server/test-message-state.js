/* Pure local-first merge/backoff checks. No database.
 *
 * These functions live in the APP bundle (app/src/messaging/messageState.js).
 * Instead of mirroring the logic (which drifts), this file loads the real ESM
 * source and strips only the module syntax — pure functions, no bundler
 * needed, and the checks run against exactly what the app ships.
 */
const fs = require('fs');
const path = require('path');

function loadPureEsm(filePath, seen = new Map()) {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return seen.get(resolved);
  let src = fs.readFileSync(resolved, 'utf8');
  const mod = { exports: {} };
  seen.set(resolved, mod.exports);
  const load = (spec) => {
    const dep = path.resolve(path.dirname(resolved), spec);
    return loadPureEsm(dep.endsWith('.js') ? dep : `${dep}.js`, seen);
  };
  // ESM → CJS: strip `import X from '…'` (resolved via load) and
  // `export const/fn/class X` / `export default X`.
  const exported = [];
  // ESM default imports resolve to the module's `default` export when one
  // exists; plain module-object imports fall back to the whole exports.
  src = src.replace(/import\s+([A-Za-z0-9_]+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_, name, spec) => `const ${name} = (() => { const m = __load(${JSON.stringify(spec)}); return m && m.default !== undefined ? m.default : m; })();`);
  src = src.replace(/export\s+default\s+([A-Za-z0-9_]+);?/g, (_, name) => {
    exported.push(`module.exports.default = ${name};`);
    return '';
  });
  src = src.replace(/export\s+(class|function|const|let|var)\s+([A-Za-z0-9_]+)/g, (_, kind, name) => {
    exported.push(`module.exports.${name} = ${name};`);
    return `${kind} ${name}`;
  });
  src = `${src}\n${exported.join('\n')}\n`;
  const fn = new Function('module', 'exports', '__load', `${src}\nreturn module.exports;`);
  fn(mod, mod.exports, load);
  seen.set(resolved, mod.exports);
  return mod.exports;
}

const {
  sortMessages, mergeMessageLists, upsertMessageList, higherStatus,
  nextBackoffMs, isPermanentSendError, boundMessages, dropExpiredMessages,
} = loadPureEsm(path.join(__dirname, '..', 'app', 'src', 'messaging', 'messageState.js'));
const TextOperation = loadPureEsm(path.join(__dirname, '..', 'app', 'src', 'ot', 'TextOperation.js')).default;

let passed = 0;
function pass(name, cond) {
  if (!cond) throw new Error(name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const a = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientCreatedAt: 1, createdAt: 10, status: 'queued', pending: true, body: 'hi' };
const ack = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: 10, status: 'delivered', body: 'hi' };
const merged = upsertMessageList([a], ack);
pass('ack replaces the optimistic copy instead of duplicating', merged.length === 1);
pass('status never moves backwards from delivered to queued', merged[0].status === 'delivered');
pass('pending is cleared once the server acks', merged[0].pending === false);

const lateSent = upsertMessageList(merged, { ...ack, status: 'sent' });
pass('a late sent ack cannot un-deliver a message', lateSent[0].status === 'delivered');

const second = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', clientCreatedAt: 2, createdAt: 20, status: 'queued', pending: true, body: 'two' };
const ordered = sortMessages([second, a]);
pass('queued messages keep send order by clientCreatedAt', ordered[0].id === a.id && ordered[1].id === second.id);

const both = mergeMessageLists([a, second], [ack]);
pass('merge keeps both the acked row and the still-queued neighbour', both.length === 2);

{
  // Real implementation adds 0–249ms jitter and caps the base at 60s.
  const b0 = nextBackoffMs(0);
  const b3 = nextBackoffMs(3);
  const b20 = nextBackoffMs(20);
  pass('backoff grows exponentially, jitters and caps',
    b0 >= 1000 && b0 < 1250 && b3 >= 8000 && b3 < 8250 && b20 >= 60000 && b20 < 60250);
}
pass('timeouts are not permanent failures', isPermanentSendError({ message: 'ACK_TIMEOUT' }) === false);
pass('blocked/not-a-member errors are permanent', isPermanentSendError('Not a member') === true);

const expired = dropExpiredMessages([
  { id: '1', expiresAt: Date.now() - 10, status: 'sent' },
  { id: '2', expiresAt: Date.now() + 10_000, status: 'sent' },
  { id: '3', expiresAt: Date.now() - 10, status: 'queued', pending: true },
], Date.now());
pass('expired synced messages drop, queued ones never do', expired.map((m) => m.id).join(',') === '2,3');

const bounded = boundMessages([
  ...Array.from({ length: 10 }, (_, i) => ({ id: `old${i}`, createdAt: i, status: 'sent' })),
  { id: 'pending', createdAt: 0, status: 'queued', pending: true },
], 5);
pass('bounding history never drops the outbox', bounded.some((m) => m.id === 'pending') && bounded.length <= 6);

// ---- real-module-only behaviours (the old mirror never exercised these) ----
pass('permanent errors include every server-side rejection',
  isPermanentSendError('Cannot message this person') === true
  && isPermanentSendError('unknown user') === true
  && isPermanentSendError('Message cannot be empty') === true
  && isPermanentSendError({ message: 'connect ECONNREFUSED' }) === false);

const otBase = {
  id: 'ot1', clientId: 'ot1', clientCreatedAt: 1, createdAt: 1,
  status: 'sent', body: 'hello world', otVersion: 0,
};
// Full-document op: retain 5, insert "XY", retain the remaining 6.
const op = new TextOperation().retain(5).insert('XY').retain(6);
const otMerged = mergeMessageLists([otBase], [{
  id: 'ot1', status: 'sent', body: null,
  otVersion: 1, otOperation: op.toJSON(), edited: true,
}]);
pass('OT message edit merges by applying the operation to local body',
  otMerged.length === 1 && otMerged[0].body === 'helloXY world'
  && otMerged[0].otVersion === 1 && otMerged[0].edited === true);

const keepPendingOff = mergeMessageLists(
  [{ id: 'todo', clientId: 'todo', clientCreatedAt: 5, status: 'queued', pending: true }],
  [{ id: 'done', clientId: 'done', clientCreatedAt: 6, status: 'sent' }],
  { keepPending: false },
);
pass('mergeMessageLists can drop the queued outbox when asked',
  keepPendingOff.length === 1 && keepPendingOff[0].id === 'done');

const mediaOptimistic = {
  id: 'media1', clientId: 'media1', createdAt: 1, status: 'sending', pending: true,
  body: 'pic', localMediaUri: 'file:///tmp/photo.jpg',
};
const remoteAspect = upsertMessageList([mediaOptimistic], {
  id: 'media1', status: 'sent', mediaUrl: '/uploads/x.png',
}, { replaceId: 'media1' });
pass('server-confirmed media replaces the local temp URI',
  remoteAspect[0].mediaUrl === '/uploads/x.png' && remoteAspect[0].localMediaUri === null
  && remoteAspect[0].pending === false && remoteAspect[0].status === 'sent');

console.log(`\n${passed} local message-state checks passed.`);
