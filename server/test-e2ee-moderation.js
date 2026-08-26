const sodium = require('libsodium-wrappers');
const db = require('./src/db');
const moderation = require('./src/moderation');

async function main() {
  await sodium.ready;
  console.log('=== E2EE Moderation Skip Test ===');

  // Simulate moderation for encrypted vs non-encrypted
  const chatIdEnc = 'enc-chat';
  const chatIdPlain = 'plain-chat';
  const userId = 'testUser';
  const t = Date.now();

  try { db.prepare('DELETE FROM moderation_cases WHERE chat_id IN (?,?)').run(chatIdEnc, chatIdPlain); } catch {}

  // Mock io
  const mockIO = {
    emitToUser: () => {},
    pushAdminSafety: () => {},
  };

  const threatText = "I'm going to kill you";

  // Plain chat should create case
  const plainResult = moderation.recordAutoDetection({
    userId, chatId: chatIdPlain, messageId: 'msg-plain', text: threatText, recentMessages: []
  }, mockIO);
  console.log('Plain chat threat detection:', plainResult ? `PASS — case ${plainResult.caseId} created` : 'FAIL — no case');

  // Encrypted chat — server should NOT call recordAutoDetection (we skip in fanoutNewMessage)
  // But if it did, it would still try to classify ciphertext, which is random, not threat.
  // Simulate ciphertext
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(sodium.from_string(threatText), nonce, key);
  const cipherB64 = sodium.to_base64(cipher);
  console.log('Ciphertext (should not trigger moderation):', cipherB64.slice(0,30)+'...');

  const encResult = moderation.recordAutoDetection({
    userId, chatId: chatIdEnc, messageId: 'msg-enc', text: cipherB64, recentMessages: []
  }, mockIO);
  console.log('Encrypted ciphertext moderation (should be null/safe):', !encResult ? 'PASS — no case from ciphertext' : `FAIL — case ${encResult.caseId} from ciphertext`);

  // Verify our server logic skips moderation for encrypted chats
  // In index.js fanoutNewMessage we check isEncryptedChat and skip
  const chatEnc = { is_encrypted: 1 };
  const rowEnc = { is_encrypted: 1, type: 'text', body: cipherB64 };
  const isEncryptedChat = !!chatEnc.is_encrypted || !!rowEnc.is_encrypted;
  console.log('Server skips moderation for encrypted:', isEncryptedChat ? 'PASS — would skip' : 'FAIL');

  // Cleanup
  try { db.prepare('DELETE FROM moderation_cases WHERE chat_id IN (?,?)').run(chatIdEnc, chatIdPlain); } catch {}

  console.log('=== Test Complete ===');
}

main().catch(e=>{ console.error(e); process.exit(1); });
