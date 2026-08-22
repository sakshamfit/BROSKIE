let nano;
try {
  const { customAlphabet } = require('nanoid');
  nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);
} catch {
  nano = () => Math.random().toString(36).slice(2, 10);
}
const TextOperation = require('./textOperation');
const { WrappedOperation } = require('./wrappedOperation');

/**
 * OT Document - Server-side document with versioning and history
 * Manages content and applies/transforms operations
 */
class OTDocument {
  constructor(id, initialContent = '', meta = {}) {
    this.id = id;
    this.content = initialContent;
    this.version = 0;
    this.operations = []; // History of WrappedOperations
    this.meta = meta;
  }

  // Get current state
  getSnapshot() {
    return {
      id: this.id,
      content: this.content,
      version: this.version,
      meta: this.meta
    };
  }

  // Apply an operation that is already transformed to current version
  applyOperation(wrappedOp) {
    if (wrappedOp.meta.baseVersion !== this.version) {
      throw new Error(`Version mismatch: expected ${this.version}, got ${wrappedOp.meta.baseVersion}`);
    }
    // Apply to content
    this.content = wrappedOp.apply(this.content);
    this.version++;
    wrappedOp.meta.version = this.version;
    this.operations.push(wrappedOp);
    return this.getSnapshot();
  }

  // Transform incoming operation against history since its base version
  // Returns transformed operation ready to apply
  transformIncoming(incomingOp) {
    if (incomingOp.meta.baseVersion > this.version) {
      throw new Error(`Future version: incoming base ${incomingOp.meta.baseVersion} > current ${this.version}`);
    }

    let transformed = incomingOp.operation.clone();
    
    // Transform against all operations since baseVersion
    for (let i = incomingOp.meta.baseVersion; i < this.version; i++) {
      const historicOp = this.operations[i].operation;
      const [transformedPrime, _] = TextOperation.transform(transformed, historicOp);
      transformed = transformedPrime;
    }

    return new WrappedOperation(transformed, {
      ...incomingOp.meta,
      baseVersion: this.version
    });
  }

  // Submit operation: transform and apply
  submitOperation(operation, meta = {}) {
    const wrapped = new WrappedOperation(operation, {
      ...meta,
      baseVersion: meta.baseVersion != null ? meta.baseVersion : this.version,
      timestamp: Date.now()
    });

    const transformed = this.transformIncoming(wrapped);
    const snapshot = this.applyOperation(transformed);
    return { operation: transformed, snapshot };
  }

  // Get operations since a version (for catch-up)
  getOperationsSince(version) {
    return this.operations.slice(version);
  }

  // Create operation from diff
  createOperationFromDiff(oldContent, newContent, meta = {}) {
    if (oldContent !== this.content) {
      // If oldContent doesn't match current, we need to transform
      // For simplicity, create diff from current content
      const op = TextOperation.fromDiff(this.content, newContent);
      return new WrappedOperation(op, {
        ...meta,
        baseVersion: this.version
      });
    }
    const op = TextOperation.fromDiff(oldContent, newContent);
    return new WrappedOperation(op, {
      ...meta,
      baseVersion: this.version
    });
  }

  // Serialize for storage
  toJSON() {
    return {
      id: this.id,
      content: this.content,
      version: this.version,
      operations: this.operations.map(op => op.toJSON()),
      meta: this.meta
    };
  }

  static fromJSON(json) {
    const doc = new OTDocument(json.id, json.content, json.meta);
    doc.version = json.version;
    doc.operations = (json.operations || []).map(opJson => WrappedOperation.fromJSON(opJson));
    return doc;
  }
}

/**
 * Document Manager - Manages multiple documents in memory with persistence
 */
class DocumentManager {
  constructor(db, options = {}) {
    this.db = db;
    this.documents = new Map(); // id -> OTDocument
    this.maxHistory = options.maxHistory || 100;
  }

  // Load or create document
  getOrCreate(id, initialContent = '', meta = {}) {
    if (this.documents.has(id)) {
      return this.documents.get(id);
    }
    
    // Try load from DB
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (row) {
      const doc = new OTDocument(row.id, row.content, JSON.parse(row.meta || '{}'));
      doc.version = row.version;
      // Load recent operations
      const ops = this.db.prepare('SELECT * FROM document_operations WHERE document_id = ? ORDER BY version ASC LIMIT ?')
        .all(id, this.maxHistory);
      doc.operations = ops.map(r => {
        const op = TextOperation.fromJSON(JSON.parse(r.operation));
        return new WrappedOperation(op, {
          userId: r.user_id,
          version: r.version,
          baseVersion: r.base_version,
          timestamp: r.created_at
        });
      });
      this.documents.set(id, doc);
      return doc;
    }

    // Create new
    const doc = new OTDocument(id, initialContent, meta);
    this.documents.set(id, doc);
    this.persistDocument(doc);
    return doc;
  }

  // Persist document to DB
  persistDocument(doc) {
    try {
      const existing = this.db.prepare('SELECT id FROM documents WHERE id = ?').get(doc.id);
      if (existing) {
        this.db.prepare('UPDATE documents SET content = ?, version = ?, meta = ?, updated_at = ? WHERE id = ?')
          .run(doc.content, doc.version, JSON.stringify(doc.meta), Date.now(), doc.id);
      } else {
        this.db.prepare('INSERT INTO documents (id, content, version, meta, created_at, updated_at) VALUES (?,?,?,?,?,?)')
          .run(doc.id, doc.content, doc.version, JSON.stringify(doc.meta), Date.now(), Date.now());
      }
    } catch (e) {
      console.error('[OT] persistDocument failed', e.message);
    }
  }

  // Persist operation
  persistOperation(docId, wrappedOp) {
    try {
      this.db.prepare('INSERT INTO document_operations (id, document_id, user_id, operation, base_version, version, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(
          nano(),
          docId,
          wrappedOp.meta.userId,
          JSON.stringify(wrappedOp.operation.toJSON()),
          wrappedOp.meta.baseVersion,
          wrappedOp.meta.version,
          wrappedOp.meta.timestamp
        );
    } catch (e) {
      console.error('[OT] persistOperation failed', e.message);
    }
  }

  // Submit operation to document
  submit(docId, operation, meta = {}) {
    const doc = this.getOrCreate(docId);
    const result = doc.submitOperation(operation, meta);
    this.persistDocument(doc);
    this.persistOperation(docId, result.operation);
    return result;
  }

  // Get document snapshot
  getSnapshot(docId) {
    const doc = this.documents.get(docId) || this.getOrCreate(docId);
    return doc.getSnapshot();
  }

  // Delete document
  delete(docId) {
    this.documents.delete(docId);
    try {
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
    } catch {}
  }
}

module.exports = { OTDocument, DocumentManager };
