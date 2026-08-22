/**
 * OTStore - Client-side persistence for OT documents
 * Caches collaborative documents locally for offline access
 * Integrates with existing persistence layer
 */

export class OTDocumentCache {
  constructor(userId, persistence) {
    this.userId = userId;
    this.persistence = persistence;
    this.prefix = `plusone.ot.v1.${userId}`;
    this.documents = new Map(); // docId -> { content, version, title, chatId, updatedAt }
    this.listeners = new Set();
    this.hydrated = false;
  }

  key(suffix) {
    return `${this.prefix}.${suffix}`;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.listeners.forEach(fn => {
      try { fn(); } catch {}
    });
  }

  async hydrate() {
    try {
      const meta = await this.persistence.get(this.key('meta'));
      if (!meta || !Array.isArray(meta.docIds)) {
        this.hydrated = true;
        return;
      }
      await Promise.all(meta.docIds.map(async (docId) => {
        try {
          const data = await this.persistence.get(this.key(`doc.${docId}`));
          if (data && data.content != null) {
            this.documents.set(docId, data);
          }
        } catch {}
      }));
    } catch {}
    this.hydrated = true;
    this.notify();
  }

  async persist() {
    try {
      const docIds = [...this.documents.keys()];
      await this.persistence.set(this.key('meta'), { docIds, savedAt: Date.now() });
      await Promise.all(docIds.map(docId => {
        const data = this.documents.get(docId);
        return this.persistence.set(this.key(`doc.${docId}`), data);
      }));
    } catch {}
  }

  getDocument(docId) {
    return this.documents.get(docId) || null;
  }

  getDocumentsForChat(chatId) {
    const docs = [];
    this.documents.forEach((doc, id) => {
      if (doc.chatId === chatId) docs.push({ id, ...doc });
    });
    return docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  setDocument(docId, data) {
    this.documents.set(docId, {
      ...(this.documents.get(docId) || {}),
      ...data,
      updatedAt: Date.now()
    });
    this.notify();
    // Debounced persist
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this.persist().catch(() => {}), 200);
  }

  removeDocument(docId) {
    this.documents.delete(docId);
    this.notify();
    this.persistence.remove(this.key(`doc.${docId}`)).catch(() => {});
    this.persist().catch(() => {});
  }

  getAllDocuments() {
    const out = {};
    this.documents.forEach((doc, id) => {
      out[id] = doc;
    });
    return out;
  }

  dispose() {
    clearTimeout(this._persistTimer);
    this.listeners.clear();
  }
}
