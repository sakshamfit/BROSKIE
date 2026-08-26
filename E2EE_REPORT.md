# +one — End-to-End Encryption Implementation Report

## Date
2026-08-26

## Decisions Surfaced (report-then-continue)

### 1. Safety & Moderation conflict — Chose (b) Opt-in Secret Chat mode
**Trade-off:** True E2EE breaks server-side content scanning. Options:
- (a) E2EE for all 1:1 and group chats, accept that Safety Center auto-scanning no longer works (client-side scanning would be different, harder feature)
- (b) Keep moderation working by scoping E2EE to specific chat types only (opt-in per conversation, Secret Chat mode, similar to FB Messenger/Telegram)
- (c) Client-side pre-encryption scanning (privacy trade-off: scan before encrypting on-device)

**Chosen: (b)** — Pragmatic default matching real apps' approach (FB Messenger Secret Conversations, Telegram Secret Chats). WhatsApp/Signal use E2EE by default but rely on user reports, not server scanning. Since +one already has a working Safety Center with context-aware detection (threats, violence, extremism, child safety, etc.) that auto-scans, silently breaking it would be a regression.

**Implementation:**
- Default chats remain unencrypted (transport HTTPS + server moderation)
- Users can enable E2EE per conversation via Chat Info toggle → "Enable end-to-end encryption"
- For encrypted chats, server skips auto detection (`fanoutNewMessage` checks `is_encrypted`)
- New reporting endpoint `/api/moderation/report-encrypted` allows user-initiated reports with explicit decrypted plaintext forwarding ONLY if `consent=true` — privacy trade-off flagged explicitly in UI and server code
- UI clearly distinguishes: lock icon + "End-to-end encrypted" label ONLY for E2EE chats, matching Graphite & Pulp tokens
- Push previews hide plaintext for encrypted messages (shows "🔒 Encrypted message")

### 2. Operational Transformation (collaborative notes) conflict — Chose unencrypted docs
**Trade-off:** OT requires server to apply transform/compose logic on operations in real time, needs to read actual text content. Full E2EE not straightforward.

**Chosen:** Collaborative notes stay unencrypted explicitly, communicated in-app.

**Why:** Implementing E2EE OT would require client-side OT with server as blind relay (Jupiter OT blind), major protocol change beyond scope. For now, docs remain unencrypted even inside encrypted chats.

**Implementation:**
- `/api/chats/:id/documents` and OT socket events remain plaintext
- Chat Info shows warning when chat is encrypted: "Collaborative notes are NOT encrypted — OT requires server to read operations"
- System message when enabling encryption says: "Collaborative notes remain unencrypted"

### 3. Multi-device — Chose single-device-per-account
**Trade-off:** +one has no multi-device linking flow (session per login). Options:
- Single device/session key storage (simpler, re-login = re-key = old messages unreadable unless backup)
- Build device-linking now (scope-creep)

**Chosen:** Single-device-per-account, flag key backup/recovery as fast-follow.

**Why:** Avoid scope-creep into full multi-device protocol (Signal-style). Simpler to tie keys to device.

**Implementation:**
- On account creation / first app launch after update, generate long-term identity keypair (X25519 box) on-device via libsodium
- Store private key in secure storage: `expo-secure-store` on native (secure enclave/keystore), localStorage/IndexedDB on web with explicit warning that browser storage isn't equivalent to mobile secure enclave
- Public key published to server (`users.public_key` column)
- Web limitation flagged: `isWebStorageInsecure()` console.warn and UI note that E2EE is native-first, web fallback shows clear indicator
- Re-login on same device keeps keys (secure storage persists); new device generates new keypair, old messages unreadable on new device — expected for single-device model
- Key backup/recovery flagged as fast-follow (encrypted backup with password, etc.)

## Cryptography Choice
- **Library:** `libsodium-wrappers` (audited, WASM) on both client and server for tests. No custom AES/RSA.
- **1:1:** `crypto_box` (X25519 key exchange + XSalsa20Poly1305 authenticated encryption) — `crypto_box_easy` / `crypto_box_open_easy`
- **Group:** Per-chat symmetric key (32 bytes via `randombytes_buf`), distributed via `crypto_box_seal` (sealed box, recipient public only, server relays but can't unwrap). Messages encrypted once with `crypto_secretbox_easy` (fast, scalable) not per-recipient.
- **Media:** Per-message random symmetric key (32 bytes) + nonce, file encrypted via `secretbox` before upload, key+nonce JSON encrypted inside message body (box for 1:1, secretbox for group). Server stores encrypted blobs in `uploads/`.

## Schema Changes (server/src/db.js)

- `users`: added `public_key TEXT` (base64 X25519 public key)
- `chats`: added `is_encrypted INTEGER DEFAULT 0`, `encryption_version INTEGER DEFAULT 0`
- `messages`: added `is_encrypted INTEGER DEFAULT 0`, `encryption_nonce TEXT`, `encryption_type TEXT` (box|secretbox)
- New table `chat_encryption_keys`:
  ```sql
  CREATE TABLE chat_encryption_keys (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    wrapped_key TEXT NOT NULL, -- base64 sealed box of symmetric key
    wrapped_nonce TEXT, -- base64 nonce if using crypto_box
    created_at INTEGER NOT NULL,
    created_by TEXT,
    PRIMARY KEY (chat_id, user_id)
  )
  ```

## Server Changes (server/src/index.js)

- `publicUser` now includes `publicKey` and `hasPublicKey`
- `chatSummary` and `chatSummariesForUser` include `isEncrypted` and `encryptionVersion`
- `hydrateMessage` and `hydrateMessagePreview` include `isEncrypted`, `encryptionNonce`, `encryptionType`
- `persistMessageTx` handles new encryption columns
- `deliverUserMessage` accepts `isEncrypted`, `encryptionNonce`, `encryptionType`; if chat is encrypted, requires encrypted payload for user messages, stores ciphertext only
- `fanoutNewMessage` skips moderation auto-detection for encrypted chats/messages
- Search (`/api/search`) excludes `is_encrypted=1` messages (server can't search ciphertext) — documented as client-side-only for encrypted chats
- Push (`push.js`): `messagePreview` hides preview for encrypted messages, shows generic "🔒 Encrypted message" etc.

### New E2EE Endpoints
- `POST /api/e2ee/public-key` — publish own public key (validated base64)
- `GET /api/e2ee/public-key/:userId` — fetch user's public key (blocked pairs denied)
- `POST /api/e2ee/public-keys` — batch fetch (up to 50)
- `GET /api/chats/:id/encryption-key` — get wrapped key for current user
- `GET /api/chats/:id/encryption-keys` — list members who have keys (no plaintext)
- `POST /api/chats/:id/encryption-keys` — distribute wrapped keys (client-side wrapping, membership verified)
- `POST /api/chats/:id/encryption/enable` — opt-in Secret Chat toggle, sets `is_encrypted=1`, stores wrapped keys, posts system message, emits `chat:encryption-enabled`
- `POST /api/chats/:id/encryption/disable` — disable (admin or either member), system message, emits `chat:encryption-disabled`
- `POST /api/chats/group-encrypted` — create encrypted group with wrapped keys
- `POST /api/moderation/report-encrypted` — report encrypted message with optional decrypted body ONLY if `consent=true` (privacy trade-off flagged)

### Message Editing
- For encrypted messages, OT not supported — server does last-write-wins re-encrypting full content
- Socket `message:edit` now accepts `isEncrypted`, `encryptionNonce`, `encryptionType`; if message is encrypted, updates ciphertext directly, no OT store
- `message:edit:ot` rejects encrypted messages with error "OT edits not supported for encrypted messages — use simple edit"

### Calls
- No changes needed — WebRTC media already encrypted via DTLS-SRTP by browser/webrtc stack
- Verified: server only relays SDP/ICE signaling, never inspects media payloads, no plaintext relay path
- `call:invite`, `call:offer`, `call:answer`, `call:ice-candidate` remain signaling-only

## Client Changes (app/src/e2ee/)

- `crypto.js`: init, keypair generation, box, secretbox, sealed box, media encryption — all via libsodium high-level primitives
- `keyStore.js`: identity key generation/storage in `expo-secure-store` native, localStorage web fallback with warning, publish to server, `isWebStorageInsecure()` flag
- `chatKeys.js`: per-chat symmetric key management, generate/wrap via sealed box, fetch/unwrap, wrap for new member, rotate on removal
- `messageCrypto.js`: encrypt/decrypt for direct (box) and group (secretbox), public key cache, batch fetch
- `mediaCrypto.js`: file read as Uint8Array (web fetch + expo-file-system native), encrypt via secretbox with random per-message key, upload encrypted blob, include key+nonce inside encrypted message body, decrypt downloaded file
- `index.js`: barrel + `initE2EE(userId)`

### Messaging Integration
- `messaging/index.js`: `createMessagingEngine` now accepts `getChats` to know encryption status
- `OutboxManager.js`: now checks `isChatEncrypted`, encrypts file before upload via `encryptFileForUpload`, stashes `_mediaKeyB64`, `_mediaNonceB64`, encrypts body via `encryptMessage` before `message:send` socket or REST, decrypts server response for local storage, fails message if encryption fails (no plaintext leak to encrypted chat)
- `SyncManager.js`: added `tryDecryptBatch` to decrypt incoming messages after fetch (pullChat, pullOlder, pullMissed), handles media payload parsing
- `ChatContext.js`: added `decryptMessageIfNeeded` and `decryptMessagesBatch`, socket `message:new`, `gc:message`, `message:updated` now async decrypt, `loadMessages` decrypts via SyncManager, `editMessage` handles encrypted last-write-wins, added `enableChatEncryption`, `createEncryptedGroupChat`, `getChatEncryptionStatus`, listeners for `chat:encryption-enabled`, `chat:encryption-disabled`, `chat:encryption-keys-updated` that refetch keys and refresh chat list

### UI
- `ChatInfoScreen.js`: lock icon + "End-to-end encrypted" label for encrypted chats, detailed subtext honest about what is NOT covered (collab notes, search, moderation), toggle to enable/disable with confirm dialogs explaining trade-offs, uses Graphite & Pulp tokens (inkBox, marker, PaperCard weight ink)
- `ConversationScreen.js`: header shows lock icon + "ENCRYPTED" label if chat encrypted, subtitle includes encryption status, report modal shows consent toggle for encrypted messages with explicit privacy trade-off text
- `MessageBubble.js`: meta shows lock icon for encrypted messages, media decrypting state with "DECRYPTING…" and ActivityIndicator, image/voice uses decrypted uri if available
- `NewChatScreen.js`: group creation has toggle "Enable encryption for this group" with explanation, uses `createEncryptedGroupChat` when enabled
- `ChatListScreen.js`: chat row shows lock icon for encrypted chats, preview shows "🔒 Encrypted message" etc. for encrypted last messages, search now includes client-side search over locally decrypted encrypted messages (since server can't search ciphertext)

## Verification Proof

### Direct SQLite Inspection
Ran `server/test-e2ee.js`:
- Messages columns include `is_encrypted`, `encryption_nonce`, `encryption_type` — YES
- Users has `public_key` — YES
- Chats has `is_encrypted` — YES
- `chat_encryption_keys` exists — YES
- Stored message body is ciphertext (base64 76 chars for 38-char plaintext), does NOT contain plaintext "Hello Bob" — PASS
- Third party reading raw DB with wrong private key fails to decrypt (libsodium throws "incorrect key pair") — PASS

### Full Round Trip
- Alice generates keypair, Bob generates keypair
- Alice encrypts "Hello Bob, this is a secret message! 🔒" with Bob's public + Alice's private + random nonce via `crypto_box_easy`
- Ciphertext stored as `body`, nonce stored as `encryption_nonce`, `is_encrypted=1`
- Bob decrypts with Alice's public + Bob's private + nonce via `crypto_box_open_easy` → plaintext matches — PASS
- Third party with fake keypair cannot decrypt — throws — PASS

### Group Chat Key Distribution
Ran `server/test-e2ee-group.js`:
- Group created with Alice and Bob, group symmetric key (32 bytes) generated, wrapped via `crypto_box_seal` for each member, stored in `chat_encryption_keys`
- New member Carol joins — Alice wraps current group key for Carol using Carol's public key, Carol can unwrap and matches original — PASS
- Bob leaves — key rotated (new 32-byte key generated), distributed to remaining Alice and Carol only, old key != new key, Bob has no key row — PASS

### Real-time Features Still Work
- Typing indicators: `typing` and `gc:typing` events still broadcast, no encryption impact — verified via code, not blocked
- Read receipts: `message:read` still writes delivered/read receipts, status derivation in `hydrateMessage` still works for encrypted messages (receipts don't need plaintext)
- Message search: server-side search now excludes encrypted messages (since ciphertext LIKE won't match plaintext) — intentional, documented. Client-side search over decrypted local cache implemented in ChatListScreen for encrypted chats
- Disappearing messages: 15-second sweep still hard-deletes encrypted messages via `hardDeleteMessage` (deletion doesn't need plaintext) — no conflict
- Calls: WebRTC DTLS-SRTP still used, no plaintext relay — verified via signaling handlers only relay SDP/ICE, never media

### Moderation Behavior Change (Explicit)
- For encrypted chats (`is_encrypted=1`), `fanoutNewMessage` skips `moderation.recordAutoDetection`
- Ciphertext does not trigger moderation rules (random base64 doesn't match threat patterns) — verified in `test-e2ee-moderation.js`
- User reports still work via `/api/moderation/report-encrypted` with explicit consent to share decrypted text — privacy trade-off flagged in UI ("decrypted text only leaves device if you consent") and server comment

## Files Changed
- `server/src/db.js` — schema migrations for E2EE
- `server/src/index.js` — encryption handling, new endpoints, moderation skip, search exclusion, edit handling
- `server/src/push.js` — hide preview for encrypted messages
- `server/package.json` + `package-lock.json` — added `libsodium-wrappers`
- `app/package.json` + `package-lock.json` — added `libsodium-wrappers`, `expo-secure-store`
- `app/src/api.js` — E2EE API methods
- `app/src/store/AuthContext.js` — key generation on login/register/restore
- `app/src/messaging/index.js` — pass getChats
- `app/src/messaging/OutboxManager.js` — encrypt media and messages before send, decrypt server response
- `app/src/messaging/SyncManager.js` — decrypt batch after fetch
- `app/src/store/ChatContext.js` — decryption for incoming, encryption for edits, enable/rotate keys, socket listeners
- `app/src/screens/ChatInfoScreen.js` — encryption status card with lock icon, honest copy, toggle
- `app/src/screens/ConversationScreen.js` — header lock + ENCRYPTED label, report consent toggle
- `app/src/components/MessageBubble.js` — lock in meta, media decryption UI
- `app/src/screens/NewChatScreen.js` — encrypted group toggle
- `app/src/screens/ChatListScreen.js` — lock icon, encrypted preview, client-side encrypted search
- New: `app/src/e2ee/crypto.js`, `keyStore.js`, `chatKeys.js`, `messageCrypto.js`, `mediaCrypto.js`, `index.js`
- Tests: `server/test-e2ee.js`, `test-e2ee-group.js`, `test-e2ee-moderation.js`

## Security Notes
- No custom crypto — only libsodium high-level primitives (`crypto_box`, `crypto_secretbox`, `crypto_box_seal`)
- Server stores and relays ciphertext only for encrypted chats, never plaintext
- `JWT_SECRET` and VAPID keys via env vars, never hardcoded (existing convention)
- Private keys never leave device, stored in `expo-secure-store` native (secure enclave/keystore), web fallback flagged as insecure
- Web limitation explicitly documented: browser storage != secure enclave, E2EE native-only initially, web shows clear UI indicator

## Future Work (Fast-follow)
- Key backup/recovery: encrypted backup of private key with user password or recovery phrase
- Multi-device linking: device registration, per-device keys, sender key distribution to all devices
- Encrypted media thumbnails: currently thumb remains plaintext for preview (limitation flagged), should encrypt thumb with same per-message key + separate nonce
- Forward secrecy & key rotation: automatic rotation on member removal already partially implemented (new key generation), needs more robust client-driven rotation on all membership changes
- Client-side pre-encryption moderation (optional, privacy trade-off)
- E2EE for OT collaborative docs (client-side OT with blind relay)
