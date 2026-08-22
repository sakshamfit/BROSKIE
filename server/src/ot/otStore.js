let nano;
try {
  const { customAlphabet } = require('nanoid');
  nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
} catch {
  nano = () => Math.random().toString(36).slice(2, 10);
}
const TextOperation = require('./textOperation');
const { WrappedOperation } = require('./wrappedOperation');
const { OTDocument, DocumentManager } = require('./document');

/**
 * OT Store - Server persistence and logic for OT documents and message edits
 */

class OTStore {
  constructor(db) {
    this.db = db;
    this.docManager = new DocumentManager(db);
    this.messageEditSessions = new Map(); // messageId -> { body, version, history }
  }

  // Ensure OT tables exist (called from db.js migration, but also safe here)
  ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        community_id TEXT,
        post_id TEXT,
        title TEXT DEFAULT '',
        content TEXT DEFAULT '',
        version INTEGER DEFAULT 0,
        created_by TEXT,
        meta TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_chat ON documents(chat_id);
      CREATE INDEX IF NOT EXISTS idx_documents_community ON documents(community_id);

      CREATE TABLE IF NOT EXISTS document_operations (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_doc_ops_doc ON document_operations(document_id, version);

      CREATE TABLE IF NOT EXISTS message_edit_operations (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_msg_edit_ops_msg ON message_edit_operations(message_id, version);
    `);
  }

  // Documents
  getOrCreateDocument(id, initialContent = '', meta = {}) {
    return this.docManager.getOrCreate(id, initialContent, meta);
  }

  getDocument(id) {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      chatId: row.chat_id,
      communityId: row.community_id,
      postId: row.post_id,
      title: row.title,
      content: row.content,
      version: row.version,
      createdBy: row.created_by,
      meta: JSON.parse(row.meta || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  createDocument({ id, chatId, communityId, postId, title, content, createdBy, meta }) {
    const docId = id || nano();
    const now = Date.now();
    this.db.prepare('INSERT INTO documents (id, chat_id, community_id, post_id, title, content, version, created_by, meta, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(docId, chatId || null, communityId || null, postId || null, title || '', content || '', 0, createdBy, JSON.stringify(meta || {}), now, now);
    this.docManager.getOrCreate(docId, content || '', meta || {});
    return this.getDocument(docId);
  }

  listDocumentsForChat(chatId) {
    const rows = this.db.prepare('SELECT * FROM documents WHERE chat_id = ? ORDER BY updated_at DESC').all(chatId);
    return rows.map(r => ({
      id: r.id,
      chatId: r.chat_id,
      title: r.title,
      content: r.content,
      version: r.version,
      createdBy: r.created_by,
      updatedAt: r.updated_at
    }));
  }

  submitDocumentOperation(documentId, operation, userId, baseVersion) {
    const op = operation instanceof TextOperation ? operation : TextOperation.fromJSON(operation);
    const result = this.docManager.submit(documentId, op, { userId, baseVersion });
    return result;
  }

  // Message edit OT
  getMessageEditHistory(messageId) {
    const rows = this.db.prepare('SELECT * FROM message_edit_operations WHERE message_id = ? ORDER BY version ASC').all(messageId);
    return rows.map(r => ({
      id: r.id,
      messageId: r.message_id,
      userId: r.user_id,
      operation: TextOperation.fromJSON(JSON.parse(r.operation)),
      baseVersion: r.base_version,
      version: r.version,
      createdAt: r.created_at
    }));
  }

  submitMessageEditOperation(messageId, operation, userId, baseVersion) {
    const message = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    if (!message) throw new Error('Message not found');
    if (message.sender_id !== userId) throw new Error('Only sender can edit');

    // Get current history
    const history = this.getMessageEditHistory(messageId);
    const currentVersion = history.length;
    const effectiveBase = baseVersion != null ? baseVersion : currentVersion;

    if (effectiveBase > currentVersion) {
      throw new Error('Future base version');
    }

    let transformed = operation instanceof TextOperation ? operation.clone() : TextOperation.fromJSON(operation);

    // Transform against history since baseVersion
    for (let i = effectiveBase; i < currentVersion; i++) {
      const historic = history[i].operation;
      const [transformedPrime] = TextOperation.transform(transformed, historic);
      transformed = transformedPrime;
    }

    // Apply to current body to get new body
    const currentBody = message.body || '';
    // We need to apply all history first to get to current state? Actually message.body should already be latest.
    // But to be safe, we transform and apply to message.body
    let newBody;
    try {
      newBody = transformed.apply(currentBody);
    } catch (e) {
      // If apply fails, try to reconstruct from history
      let reconstructed = this.db.prepare('SELECT body FROM messages WHERE id = ?').get(messageId)?.body || '';
      // Actually, we should have stored original? Let's fallback to diff-based edit
      throw new Error(`Operation apply failed: ${e.message}`);
    }

    // Persist operation
    const opId = nano();
    const now = Date.now();
    this.db.prepare('INSERT INTO message_edit_operations (id, message_id, user_id, operation, base_version, version, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(opId, messageId, userId, JSON.stringify(transformed.toJSON()), effectiveBase, currentVersion + 1, now);

    // Update message body
    this.db.prepare('UPDATE messages SET body = ?, edited = 1, updated_at = ? WHERE id = ?')
      .run(newBody, now, messageId);

    return {
      body: newBody,
      version: currentVersion + 1,
      operation: transformed
    };
  }

  // Legacy full-body edit converted to OT operation
  submitMessageEditLegacy(messageId, oldBody, newBody, userId, baseVersion) {
    const operation = TextOperation.fromDiff(oldBody || '', newBody || '');
    if (operation.isNoop()) {
      return { body: newBody, version: this.getMessageEditHistory(messageId).length, operation };
    }
    return this.submitMessageEditOperation(messageId, operation, userId, baseVersion);
  }
}

module.exports = OTStore;
