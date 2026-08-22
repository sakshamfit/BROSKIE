# Operational Transformation in BROSKIE (+one)

This document explains the OT implementation that powers real-time collaborative editing in BROSKIE.

## Why OT?

BROSKIE is a real-time messaging app with:
- Message editing (user can edit their own messages)
- Group chats with shared context
- Offline-first architecture (outbox, local cache, sync manager)

Without OT, concurrent edits cause conflicts:
- **Last-write-wins** loses data when two devices edit same message offline
- **Group notes** need conflict-free merging when multiple users type simultaneously
- **Offline queue** needs transformation when reconnecting

OT ensures **convergence**: all clients eventually see same document, regardless of operation order or network delays.

## Core OT Type: TextOperation

Located at:
- Server: `server/src/ot/textOperation.js` (CommonJS)
- Client: `app/src/ot/TextOperation.js` (ESM)

Operation format (JSON):
```json
[
  { "retain": 5 },
  { "insert": " Brave" },
  { "retain": 6 }
]
```

Components:
- `retain(n)`: keep n chars
- `insert("text")`: insert text
- `delete(n)`: delete n chars

Methods:
- `apply(str)`: apply to document
- `compose(other)`: compose this then other
- `transform(other)`: transform two concurrent ops -> [a', b'] such that apply(apply(doc, a), b') == apply(apply(doc, b), a')
- `invert(str)`: undo operation
- `fromDiff(old, new)`: create operation from diff
- `fromJSON/toJSON`: serialization

Transformation satisfies **TP1** (convergence) and **TP2** (composition) properties.

### Example: Concurrent insert vs delete

Doc: "Hello World"
- User A: insert " Brave" after "Hello" -> "Hello Brave World"
- User B: delete " World" -> "Hello"

Transform ensures both orders converge to "Hello Brave" (or equivalent "HelloBrave " depending on diff representation, but both clients agree).

## Server: OT Document Manager

`server/src/ot/document.js`:
- `OTDocument`: manages content, version, history
- `DocumentManager`: in-memory cache + DB persistence

`server/src/ot/otStore.js`:
- Persists documents and operations to SQLite
- Tables:
  - `documents`: id, chat_id, community_id, post_id, title, content, version, created_by, meta, timestamps
  - `document_operations`: id, document_id, user_id, operation JSON, base_version, version, created_at
  - `message_edit_operations`: id, message_id, user_id, operation JSON, base_version, version, created_at

Key method `transformIncoming`:
- Transforms incoming operation against all operations since its baseVersion
- Ensures operation can be applied to current version even if client is behind

## Server Integration (index.js)

### REST Endpoints

- `GET /api/chats/:id/documents` — list collaborative notes for chat
- `GET /api/documents/:id` — get document with version and recent ops
- `POST /api/chats/:id/documents` — create collaborative note (group or direct)
- `PATCH /api/documents/:id` — update title
- `DELETE /api/documents/:id` — delete (creator or admin)
- `POST /api/documents/:id/operation` — submit OT operation (REST fallback)
- `GET /api/messages/:id/edits` — get OT edit history for message

### Socket.IO Events

| Direction | Event | Purpose |
|-----------|-------|---------|
| → | `doc:join` | join document room, get snapshot |
| → | `doc:operation` | submit OT operation |
| → | `doc:selection` | broadcast cursor/selection |
| → | `doc:leave` | leave document |
| ← | `doc:operation` | remote operation transformed by server |
| ← | `doc:created` | new collaborative note in chat |
| ← | `doc:deleted` | note deleted |
| ← | `doc:updated` | title changed |
| ← | `doc:selection` | remote cursor |
| ← | `doc:user:joined` / `doc:user:left` | presence |
| → | `message:edit` | now supports `{ messageId, operation, baseVersion, body }` — OT path |
| → | `message:edit:ot` | explicit OT edit event |
| ← | `message:edit:ot` | broadcast transformed message edit |

### Message Edit OT

Legacy: `message:edit` with full body -> last-write-wins
New: `message:edit` with operation + baseVersion -> OT transformed

Flow:
1. Client creates operation via `TextOperation.fromDiff(oldBody, newBody)`
2. Sends `{ messageId, operation, baseVersion }`
3. Server transforms against history since baseVersion
4. Server applies to message body, persists operation, increments version
5. Broadcasts `message:edit:ot` and `message:updated` with otVersion

Handles:
- Same user editing from two devices offline concurrently
- Multiple rapid edits
- Offline queue transformation on reconnect

## Client: OT Integration

### Core

- `app/src/ot/TextOperation.js` — same as server
- `app/src/ot/WrappedOperation.js` — operation + metadata
- `app/src/ot/OTClient.js` — Jupiter state machine (Synchronized, AwaitingConfirm, AwaitingWithBuffer)
- `app/src/ot/OTManager.js` — manages multiple sessions, offline queue, socket integration

### Hooks

- `useOTDocument({ documentId, initialContent, initialVersion, socket })`:
  - Manages collaborative document session
  - `content`, `version`, `hasPending`, `collaborators`, `connected`
  - `applyLocalEdit(old, new)`: diff and submit
  - `applyOperation(op)`: submit operation directly
  - `updateSelection(cursor, selection)`: broadcast cursor
  - Auto-resync on error

- `useOTMessageEdit({ messageId, initialBody, socket })`:
  - OT-aware message editing
  - Handles optimistic updates and transformation
  - `submitEdit(old, new, { baseVersion })`

### Components

- `CollabEditor`: full-screen collaborative editor
  - Debounced OT submission (300ms)
  - Live collaborators bar with avatars
  - Version and sync status
  - Remote cursor indicators
  - Works offline (queues ops)

- `CollabDocumentView`: lists docs for chat, create/open/delete
  - Real-time updates via `doc:created/deleted/updated`
  - Opens editor on tap

### ChatContext Integration

- OTManager initialized with messaging engine
- Listens for `doc:operation`, `doc:created`, etc.
- Drains offline OT queue on socket reconnect
- `editMessage` now uses OT (diff-based)
- Exposes `socketRef`, `otManager`, `documents`, `onDocEvent`, `refreshDocuments`, `createDocument`

### Persistence

- `app/src/messaging/OTStore.js`: `OTDocumentCache`
  - Caches documents in IndexedDB (web) or AsyncStorage (native)
  - Same persistence as message store
  - Hydrates on startup

- `app/src/messaging/messageState.js`: updated `mergeMessage` to handle `otVersion` and `otOperation`
  - If incoming has `otOperation`, applies it to local body
  - Higher `otVersion` wins for body when both present
  - Ensures offline edits converge after sync

## Collaborative Notes Feature (Group Docs)

New feature enabled by OT:
- Each chat (especially groups) can have multiple collaborative notes
- Title + content (50k chars max)
- Real-time editing: all members see changes live, cursors, presence
- Offline: edits queued, transformed on reconnect
- System message when note created
- Accessible from:
  - Conversation header: document icon button
  - Chat info: "Collaborative notes" row

Use cases:
- Meeting notes in group chats
- Shopping lists, trip planning
- Shared agendas, study notes
- Community guidelines, club event planning

## Offline Support

Existing offline infrastructure:
- `OutboxManager`: queues messages when offline, retries with backoff
- `LocalMessageStore`: caches messages, merges with server
- `SyncManager`: pulls missed messages on reconnect
- `ConnectivityManager`: tracks socket and network status

OT extends this:
- `OTManager.offlineQueue`: queues doc and message edit operations when socket disconnected
- `drainOfflineQueue()`: called on socket reconnect, submits queued ops with transformation
- `OTDocumentCache`: local cache of docs for offline viewing
- Operations include `baseVersion` so server can transform even if client behind

## Testing

`server/test-ot.js`: 31 checks
- TextOperation basics (retain/insert/delete merging)
- Apply (insert, delete, fromDiff)
- Compose (insert+insert, delete+insert)
- Transform convergence (insert vs delete, insert vs insert)
- Invert (undo)
- fromDiff edge cases (identical, empty, start insertion/deletion)
- OTDocument versioning and transformation
- Concurrent multi-user scenario
- Message edit history transformation

Run:
```bash
cd server && node test-ot.js
# or
npm run test:ot
```

## Future Extensions

OT infrastructure now enables:
- **Post collaborative editing**: Network posts could be edited collaboratively with same OT
- **Community description OT**: Real-time collaborative community descriptions
- **Rich text OT**: Extend TextOperation to handle formatting (bold, etc.)
- **Undo/Redo**: Using invert operations
- **Conflict UI**: Show edit history and allow reverting via operation inversion
- **Cursor sharing**: More detailed selection ranges for co-editing

## Implementation Notes

- **Canonical form**: inserts before deletes, merged retains/inserts/deletes
- **Tie-breaking**: insert operations have priority and are ordered by arrival (first wins position, second retains)
- **Versioning**: each document/message has monotonically increasing version, operations reference baseVersion
- **Idempotency**: operations persisted with unique id, version check prevents double-apply
- **Security**: only chat members can join/edit docs, only message sender can edit message (server-enforced)
- **Performance**: operation history capped (100 recent ops in memory), old ops can be pruned after snapshots
- **Compatibility**: legacy full-body edits still work, converted to OT diff on server for history

## Files Changed/Added

**Server:**
- `server/src/ot/textOperation.js` — core OT
- `server/src/ot/wrappedOperation.js` — wrapped op + selection
- `server/src/ot/document.js` — document + manager
- `server/src/ot/otStore.js` — persistence
- `server/src/db.js` — new tables
- `server/src/index.js` — REST + socket integration, OT for message edits
- `server/test-ot.js` — tests
- `server/package.json` — test:ot script

**Client:**
- `app/src/ot/TextOperation.js` — core OT (ESM)
- `app/src/ot/WrappedOperation.js`
- `app/src/ot/OTClient.js` — state machine
- `app/src/ot/OTManager.js` — session manager
- `app/src/ot/index.js`
- `app/src/messaging/OTStore.js` — doc cache
- `app/src/messaging/index.js` — integrate OT
- `app/src/messaging/messageState.js` — OT-aware merging
- `app/src/hooks/useOTDocument.js`
- `app/src/hooks/useOTMessageEdit.js`
- `app/src/components/CollabEditor.js`
- `app/src/components/CollabDocumentView.js`
- `app/src/store/ChatContext.js` — OT integration, socket events, editMessage OT
- `app/src/screens/ConversationScreen.js` — docs button, OT edit version tracking
- `app/src/screens/ChatInfoScreen.js` — docs row + modal
- `app/src/api.js` — document endpoints

## Summary

OT is now fully integrated:
1. **Core library** works on both server and client, handles all transform cases
2. **Message editing** uses OT to handle concurrent edits from multiple devices conflict-free
3. **Collaborative documents** provide real-time shared notes in chats, powered by OT
4. **Offline support** queues and transforms operations on reconnect
5. **Real-time sync** via Socket.IO with transformation ensures convergence
6. **Persistence** on both server (SQLite) and client (IndexedDB/AsyncStorage)
