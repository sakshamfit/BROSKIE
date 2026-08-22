import TextOperation from './TextOperation';
import OTClient from './OTClient';
import { WrappedOperation } from './WrappedOperation';

/**
 * OT Manager - Integrates OT with the existing messaging infrastructure
 * Handles:
 * - Message edit OT (transform concurrent edits)
 * - Collaborative documents OT (real-time shared notes)
 * - Offline queuing and transformation
 */

export class OTDocumentSession {
  constructor(documentId, initialContent = '', revision = 0, callbacks = {}) {
    this.documentId = documentId;
    this.content = initialContent;
    this.revision = revision;
    this.client = new OTClient(revision);
    this.callbacks = callbacks;
    this.pendingOps = []; // For offline support
    this.isApplyingRemote = false;
  }

  // Apply local edit (user typing)
  applyLocalOperation(operation) {
    if (!(operation instanceof TextOperation)) {
      operation = TextOperation.fromJSON(operation);
    }

    // Apply to local content immediately (optimistic)
    try {
      this.content = operation.apply(this.content);
    } catch (e) {
      console.warn('[OT] Failed to apply local op', e.message);
      return null;
    }

    this.callbacks.onContentChange?.(this.content, operation);
    
    // Pass to client state machine
    this.client.applyClient(operation);

    // If we can send, send it
    const toSend = this.client.getPendingOperation();
    if (toSend && !this.isApplyingRemote) {
      this.callbacks.onOperation?.(toSend, this.revision);
    }

    return operation;
  }

  // Create operation from old to new content and apply
  applyLocalEdit(oldContent, newContent) {
    if (oldContent === newContent) return null;
    try {
      const op = TextOperation.fromDiff(oldContent, newContent);
      if (op.isNoop()) return null;
      return this.applyLocalOperation(op);
    } catch (e) {
      console.warn('[OT] Diff failed', e.message);
      return null;
    }
  }

  // Apply remote operation from server
  applyRemoteOperation(operation, revision) {
    if (!(operation instanceof TextOperation)) {
      operation = TextOperation.fromJSON(operation);
    }

    this.isApplyingRemote = true;
    try {
      // Transform against pending operations via client state machine
      this.client.applyServer(operation);
      
      // Apply to content
      this.content = operation.apply(this.content);
      this.revision = revision != null ? revision : this.revision + 1;
      
      this.callbacks.onContentChange?.(this.content, operation, true);
      this.callbacks.onRemoteOperation?.(operation, this.revision);
    } catch (e) {
      console.warn('[OT] Failed to apply remote op', e.message);
      // Request full resync
      this.callbacks.onResyncNeeded?.();
    } finally {
      this.isApplyingRemote = false;
    }

    // If we have pending ops that can now be sent
    const toSend = this.client.getPendingOperation();
    if (toSend) {
      this.callbacks.onOperation?.(toSend, this.revision);
    }

    return this.content;
  }

  // Server acked our operation
  handleAck(revision) {
    try {
      this.client.serverAck();
      this.revision = revision != null ? revision : this.revision + 1;
      
      // Send buffered operations if any
      const toSend = this.client.getPendingOperation();
      if (toSend) {
        this.callbacks.onOperation?.(toSend, this.revision);
      }
    } catch (e) {
      console.warn('[OT] Ack handling failed', e.message);
    }
  }

  // Server transformed our operation
  handleTransformedOperation(operation, revision) {
    this.handleAck(revision);
    // The server's transformed version is already applied via applyRemote if needed
    // But we should ensure content consistency
    if (operation) {
      this.applyRemoteOperation(operation, revision);
    }
  }

  getContent() {
    return this.content;
  }

  getRevision() {
    return this.revision;
  }

  hasPending() {
    return this.client.hasPending();
  }

  // Reset to new content (for resync)
  reset(content, revision = 0) {
    this.content = content;
    this.revision = revision;
    this.client = new OTClient(revision);
    this.callbacks.onContentChange?.(this.content, null, true);
  }
}

/**
 * Message Edit OT Session
 * Handles concurrent edits to the same message from multiple devices
 */
export class MessageEditOTSession {
  constructor(messageId, initialBody, version = 0) {
    this.messageId = messageId;
    this.body = initialBody;
    this.version = version;
    this.history = []; // List of operations applied
  }

  // Create operation from old to new body
  createEditOperation(oldBody, newBody) {
    if (oldBody === newBody) return null;
    const op = TextOperation.fromDiff(oldBody, newBody);
    if (op.isNoop()) return null;
    return op;
  }

  // Transform incoming edit against history
  transformIncoming(operation, baseVersion) {
    let transformed = operation.clone();
    for (let i = baseVersion; i < this.version; i++) {
      const historic = this.history[i];
      if (!historic) continue;
      const [transformedPrime] = TextOperation.transform(transformed, historic);
      transformed = transformedPrime;
    }
    return transformed;
  }

  // Apply operation
  applyOperation(operation, userId) {
    try {
      this.body = operation.apply(this.body);
      this.version++;
      this.history.push(operation.clone());
      return this.body;
    } catch (e) {
      console.warn('[OT Message] Apply failed', e.message);
      return null;
    }
  }

  // Submit edit: create op, transform, apply
  submitEdit(oldBody, newBody, userId, baseVersion) {
    const op = this.createEditOperation(oldBody, newBody);
    if (!op) return null;
    
    const effectiveBase = baseVersion != null ? baseVersion : this.version;
    const transformed = this.transformIncoming(op, effectiveBase);
    const result = this.applyOperation(transformed, userId);
    
    return {
      operation: transformed,
      body: result,
      version: this.version
    };
  }
}

/**
 * Global OT Manager - Coordinates multiple document sessions
 */
export class OTManager {
  constructor({ getSocket, onDocumentUpdate, onMessageEdit } = {}) {
    this.getSocket = getSocket;
    this.onDocumentUpdate = onDocumentUpdate;
    this.onMessageEdit = onMessageEdit;
    this.sessions = new Map(); // documentId -> OTDocumentSession
    this.messageSessions = new Map(); // messageId -> MessageEditOTSession
    this.offlineQueue = []; // Queued operations when offline
  }

  // Get or create document session
  getDocumentSession(documentId, initialContent = '', revision = 0, callbacks = {}) {
    if (this.sessions.has(documentId)) {
      return this.sessions.get(documentId);
    }

    const session = new OTDocumentSession(documentId, initialContent, revision, {
      onOperation: (operation, rev) => {
        const socket = this.getSocket?.();
        if (socket?.connected) {
          socket.emit('doc:operation', {
            documentId,
            operation: operation.toJSON(),
            baseVersion: rev
          });
        } else {
          // Queue for offline
          this.offlineQueue.push({ type: 'doc', documentId, operation, baseVersion: rev });
        }
      },
      onContentChange: (content, operation, isRemote) => {
        this.onDocumentUpdate?.(documentId, content, operation, isRemote);
        callbacks.onContentChange?.(content, operation, isRemote);
      },
      onRemoteOperation: callbacks.onRemoteOperation,
      onResyncNeeded: () => {
        // Request full document from server
        const socket = this.getSocket?.();
        socket?.emit('doc:join', { documentId }, (res) => {
          if (res?.content != null) {
            session.reset(res.content, res.version);
          }
        });
      },
      ...callbacks
    });

    this.sessions.set(documentId, session);
    return session;
  }

  // Handle incoming remote operation
  handleRemoteOperation({ documentId, operation, version, userId }) {
    const session = this.sessions.get(documentId);
    if (!session) {
      // Create session if not exists, will be synced via content
      return;
    }
    session.applyRemoteOperation(operation, version);
  }

  // Handle ack
  handleAck({ documentId, version }) {
    const session = this.sessions.get(documentId);
    if (session) {
      session.handleAck(version);
    }
  }

  // Drain offline queue when reconnected
  drainOfflineQueue() {
    const socket = this.getSocket?.();
    if (!socket?.connected) return;
    
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    
    for (const item of queue) {
      if (item.type === 'doc') {
        socket.emit('doc:operation', {
          documentId: item.documentId,
          operation: item.operation.toJSON ? item.operation.toJSON() : item.operation,
          baseVersion: item.baseVersion
        });
      } else if (item.type === 'message_edit') {
        socket.emit('message:edit:ot', {
          messageId: item.messageId,
          operation: item.operation.toJSON ? item.operation.toJSON() : item.operation,
          baseVersion: item.baseVersion
        });
      }
    }
  }

  // Message edit OT
  getMessageSession(messageId, initialBody, version = 0) {
    if (this.messageSessions.has(messageId)) {
      return this.messageSessions.get(messageId);
    }
    const session = new MessageEditOTSession(messageId, initialBody, version);
    this.messageSessions.set(messageId, session);
    return session;
  }

  // Submit message edit via OT
  submitMessageEdit(messageId, oldBody, newBody, baseVersion) {
    const session = this.getMessageSession(messageId, oldBody, baseVersion);
    const result = session.submitEdit(oldBody, newBody, null, baseVersion);
    if (!result) return null;

    const socket = this.getSocket?.();
    if (socket?.connected) {
      socket.emit('message:edit:ot', {
        messageId,
        operation: result.operation.toJSON(),
        baseVersion: baseVersion != null ? baseVersion : session.version - 1,
        body: result.body
      }, (res) => {
        if (res?.error) {
          console.warn('[OT] Message edit failed', res.error);
        } else if (res?.body) {
          this.onMessageEdit?.(messageId, res.body, res.version);
        }
      });
    } else {
      this.offlineQueue.push({
        type: 'message_edit',
        messageId,
        operation: result.operation,
        baseVersion
      });
    }

    return result;
  }

  dispose() {
    this.sessions.clear();
    this.messageSessions.clear();
    this.offlineQueue = [];
  }
}

export default OTManager;
