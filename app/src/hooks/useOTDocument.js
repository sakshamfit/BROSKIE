import { useEffect, useRef, useState, useCallback } from 'react';
import TextOperation from '../ot/TextOperation';
import { OTDocumentSession } from '../ot/OTManager';
import { useAuth } from '../store/AuthContext';

/**
 * useOTDocument - Hook for collaborative document editing with OT
 * 
 * Provides:
 * - content: current document content
 * - version: current version
 * - applyLocalEdit(old, new): apply local edit and broadcast via OT
 * - applyOperation(op): apply operation directly
 * - collaborators: active collaborators with cursors
 * - hasPending: whether we have unacked operations
 * - reset: reset document
 */

export function useOTDocument({ documentId, initialContent = '', initialVersion = 0, socket, onContentChange, onRemoteEdit } = {}) {
  const { user } = useAuth();
  const [content, setContent] = useState(initialContent);
  const [version, setVersion] = useState(initialVersion);
  const [hasPending, setHasPending] = useState(false);
  const [collaborators, setCollaborators] = useState({}); // userId -> { name, cursor, selection, lastActive }
  const [connected, setConnected] = useState(false);
  const sessionRef = useRef(null);
  const contentRef = useRef(initialContent);

  // Initialize session
  useEffect(() => {
    contentRef.current = initialContent;
    setContent(initialContent);
    setVersion(initialVersion);

    const session = new OTDocumentSession(documentId, initialContent, initialVersion, {
      onOperation: (operation, rev) => {
        if (socket?.connected) {
          socket.emit('doc:operation', {
            documentId,
            operation: operation.toJSON(),
            baseVersion: rev
          }, (ack) => {
            if (ack?.error) {
              console.warn('[OT] Operation ack error', ack.error);
              // Request resync on error
              socket.emit('doc:join', { documentId }, (res) => {
                if (res?.content != null) {
                  session.reset(res.content, res.version);
                  setContent(res.content);
                  setVersion(res.version);
                  contentRef.current = res.content;
                }
              });
            } else if (ack?.version != null) {
              session.handleAck(ack.version);
              setVersion(ack.version);
              setHasPending(session.hasPending());
            }
          });
        }
      },
      onContentChange: (newContent, operation, isRemote) => {
        contentRef.current = newContent;
        setContent(newContent);
        setHasPending(session.hasPending());
        onContentChange?.(newContent, operation, isRemote);
        if (isRemote) {
          onRemoteEdit?.(newContent, operation);
        }
      },
      onResyncNeeded: () => {
        socket?.emit('doc:join', { documentId }, (res) => {
          if (res?.content != null) {
            session.reset(res.content, res.version);
            setContent(res.content);
            setVersion(res.version);
            contentRef.current = res.content;
          }
        });
      }
    });

    sessionRef.current = session;

    return () => {
      sessionRef.current = null;
    };
  }, [documentId, socket]);

  // Handle remote operations
  useEffect(() => {
    if (!socket || !documentId) return;

    const handleOperation = (payload) => {
      if (payload.documentId !== documentId) return;
      if (payload.userId === user?.id) {
        // This is ack for our own operation (if server echoes)
        // Actually server doesn't echo to sender, but handle just in case
        return;
      }
      const session = sessionRef.current;
      if (!session) return;
      try {
        const op = TextOperation.fromJSON(payload.operation);
        session.applyRemoteOperation(op, payload.version);
        setVersion(payload.version);
        setHasPending(session.hasPending());

        // Update collaborator activity
        if (payload.userId) {
          setCollaborators(prev => ({
            ...prev,
            [payload.userId]: {
              ...(prev[payload.userId] || {}),
              name: payload.userName || prev[payload.userId]?.name || 'Unknown',
              lastActive: Date.now()
            }
          }));
        }
      } catch (e) {
        console.warn('[OT] Remote op handling failed', e.message);
      }
    };

    const handleAck = (payload) => {
      if (payload.documentId !== documentId) return;
      const session = sessionRef.current;
      if (session) {
        session.handleAck(payload.version);
        setVersion(payload.version);
        setHasPending(session.hasPending());
      }
    };

    const handleSelection = (payload) => {
      if (payload.documentId !== documentId) return;
      if (payload.userId === user?.id) return;
      setCollaborators(prev => ({
        ...prev,
        [payload.userId]: {
          name: payload.userName || 'Unknown',
          cursor: payload.cursor,
          selection: payload.selection,
          lastActive: Date.now()
        }
      }));
    };

    const handleUserJoined = (payload) => {
      if (payload.documentId !== documentId) return;
      if (payload.userId === user?.id) return;
      setCollaborators(prev => ({
        ...prev,
        [payload.userId]: {
          name: payload.userName || 'Unknown',
          joinedAt: Date.now(),
          lastActive: Date.now()
        }
      }));
    };

    const handleUserLeft = (payload) => {
      if (payload.documentId !== documentId) return;
      setCollaborators(prev => {
        const next = { ...prev };
        delete next[payload.userId];
        return next;
      });
    };

    socket.on('doc:operation', handleOperation);
    socket.on('doc:ack', handleAck);
    socket.on('doc:selection', handleSelection);
    socket.on('doc:user:joined', handleUserJoined);
    socket.on('doc:user:left', handleUserLeft);

    // Join document room
    socket.emit('doc:join', { documentId }, (res) => {
      if (res?.error) {
        console.warn('[OT] Join failed', res.error);
        return;
      }
      if (res?.content != null && res.content !== contentRef.current) {
        const session = sessionRef.current;
        if (session) {
          session.reset(res.content, res.version);
          setContent(res.content);
          setVersion(res.version);
          contentRef.current = res.content;
        }
      }
      setConnected(true);
    });

    return () => {
      socket.off('doc:operation', handleOperation);
      socket.off('doc:ack', handleAck);
      socket.off('doc:selection', handleSelection);
      socket.off('doc:user:joined', handleUserJoined);
      socket.off('doc:user:left', handleUserLeft);
      socket.emit('doc:leave', { documentId });
      setConnected(false);
    };
  }, [socket, documentId, user?.id]);

  // Cleanup inactive collaborators every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setCollaborators(prev => {
        const next = {};
        Object.entries(prev).forEach(([id, data]) => {
          if (now - (data.lastActive || 0) < 60000) {
            next[id] = data;
          }
        });
        return next;
      });
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const applyLocalEdit = useCallback((oldContent, newContent) => {
    const session = sessionRef.current;
    if (!session) return null;
    // Use ref for oldContent to ensure we diff against actual current content
    const base = oldContent != null ? oldContent : contentRef.current;
    return session.applyLocalEdit(base, newContent);
  }, []);

  const applyOperation = useCallback((operation) => {
    const session = sessionRef.current;
    if (!session) return null;
    return session.applyLocalOperation(operation);
  }, []);

  const updateSelection = useCallback((cursor, selection) => {
    if (!socket?.connected || !documentId) return;
    socket.emit('doc:selection', { documentId, cursor, selection });
  }, [socket, documentId]);

  const reset = useCallback((newContent, newVersion = 0) => {
    const session = sessionRef.current;
    if (session) {
      session.reset(newContent, newVersion);
      setContent(newContent);
      setVersion(newVersion);
      contentRef.current = newContent;
    }
  }, []);

  return {
    content,
    version,
    hasPending,
    collaborators,
    connected,
    applyLocalEdit,
    applyOperation,
    updateSelection,
    reset,
    session: sessionRef.current
  };
}

export default useOTDocument;
