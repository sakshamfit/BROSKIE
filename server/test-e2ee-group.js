const sodium = require('libsodium-wrappers');
const db = require('./src/db');

async function main() {
  await sodium.ready;
  console.log('=== Group Key Distribution Test ===');

  const aliceKp = sodium.crypto_box_keypair();
  const bobKp = sodium.crypto_box_keypair();
  const carolKp = sodium.crypto_box_keypair();

  const alicePub = sodium.to_base64(aliceKp.publicKey);
  const bobPub = sodium.to_base64(bobKp.publicKey);
  const carolPub = sodium.to_base64(carolKp.publicKey);

  const groupKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const groupKeyB64 = sodium.to_base64(groupKey);

  // Wrap for Alice and Bob
  const wrapFor = (pub) => sodium.to_base64(sodium.crypto_box_seal(groupKey, sodium.from_base64(pub)));
  const wrappedAlice = wrapFor(alicePub);
  const wrappedBob = wrapFor(bobPub);

  const chatId = 'group-test';
  const t = Date.now();
  try { db.prepare('DELETE FROM chat_encryption_keys WHERE chat_id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM chats WHERE id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM users WHERE id IN (?,?,?)').run('alice','bob','carol'); } catch {}

  db.prepare('INSERT INTO users (id, phone, name, password_hash, created_at, public_key) VALUES (?,?,?,?,?,?)').run('alice','pA','Alice','h',t,alicePub);
  db.prepare('INSERT INTO users (id, phone, name, password_hash, created_at, public_key) VALUES (?,?,?,?,?,?)').run('bob','pB','Bob','h',t,bobPub);
  db.prepare('INSERT INTO users (id, phone, name, password_hash, created_at, public_key) VALUES (?,?,?,?,?,?)').run('carol','pC','Carol','h',t,carolPub);
  db.prepare('INSERT INTO chats (id, type, name, created_by, created_at, updated_at, is_encrypted, encryption_version) VALUES (?,?,?,?,?,?,?,?)')
    .run(chatId, 'group', 'Secret Group', 'alice', t, t, 1, 1);
  db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(chatId, 'alice', 'admin', t);
  db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(chatId, 'bob', 'member', t);
  db.prepare('INSERT INTO chat_encryption_keys (chat_id, user_id, wrapped_key, created_at, created_by) VALUES (?,?,?,?,?)').run(chatId, 'alice', wrappedAlice, t, 'alice');
  db.prepare('INSERT INTO chat_encryption_keys (chat_id, user_id, wrapped_key, created_at, created_by) VALUES (?,?,?,?,?)').run(chatId, 'bob', wrappedBob, t, 'alice');

  console.log('Group created with Alice and Bob, key distributed');

  // Simulate new member Carol joins — Alice wraps current key for Carol
  const wrappedCarol = wrapFor(carolPub);
  db.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(chatId, 'carol', 'member', t+1000);
  db.prepare('INSERT INTO chat_encryption_keys (chat_id, user_id, wrapped_key, created_at, created_by) VALUES (?,?,?,?,?)').run(chatId, 'carol', wrappedCarol, t+1000, 'alice');
  console.log('Carol joined, key wrapped for her');

  // Verify Carol can unwrap
  const carolRow = db.prepare('SELECT wrapped_key FROM chat_encryption_keys WHERE chat_id = ? AND user_id = ?').get(chatId, 'carol');
  const sealed = sodium.from_base64(carolRow.wrapped_key);
  const unwrapped = sodium.crypto_box_seal_open(sealed, carolKp.publicKey, carolKp.privateKey);
  const unwrappedB64 = sodium.to_base64(unwrapped);
  console.log('Carol unwrap matches:', unwrappedB64 === groupKeyB64 ? 'PASS' : 'FAIL');

  // Simulate Bob leaves — rotate key
  const newGroupKey = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const newGroupKeyB64 = sodium.to_base64(newGroupKey);
  const newWrappedAlice = sodium.to_base64(sodium.crypto_box_seal(newGroupKey, aliceKp.publicKey));
  const newWrappedCarol = sodium.to_base64(sodium.crypto_box_seal(newGroupKey, carolKp.publicKey));
  // Delete old keys for remaining members and insert new
  db.prepare('DELETE FROM chat_encryption_keys WHERE chat_id = ?').run(chatId);
  db.prepare('INSERT INTO chat_encryption_keys (chat_id, user_id, wrapped_key, created_at, created_by) VALUES (?,?,?,?,?)').run(chatId, 'alice', newWrappedAlice, t+2000, 'alice');
  db.prepare('INSERT INTO chat_encryption_keys (chat_id, user_id, wrapped_key, created_at, created_by) VALUES (?,?,?,?,?)').run(chatId, 'carol', newWrappedCarol, t+2000, 'alice');
  db.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').run(chatId, 'bob');
  console.log('Bob removed, key rotated for Alice and Carol');

  // Verify Bob's old wrapped key no longer exists, and new key is different
  console.log('Old group key != new group key:', groupKeyB64 !== newGroupKeyB64 ? 'PASS' : 'FAIL');
  console.log('Bob has no key:', !db.prepare('SELECT 1 FROM chat_encryption_keys WHERE chat_id = ? AND user_id = ?').get(chatId, 'bob') ? 'PASS' : 'FAIL');

  // Cleanup
  try { db.prepare('DELETE FROM chat_encryption_keys WHERE chat_id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM chats WHERE id = ?').run(chatId); } catch {}
  try { db.prepare('DELETE FROM users WHERE id IN (?,?,?)').run('alice','bob','carol'); } catch {}

  console.log('=== Group Key Distribution Test Complete ===');
}

main().catch(e=>{ console.error(e); process.exit(1); });
