import { useCallback, useEffect, useRef, useState } from 'react';
import TextOperation from '../ot/TextOperation';

/**
 * useOTMessageEdit - Hook for OT-based message editing
 * Handles concurrent edits from multiple devices of same user
 * and ensures convergence
 */

export function useOTMessageEdit({ messageId, initialBody = '', socket, onEditApplied } = {}) {
  const [body, setBody] = useState(initialBody);
  const [version, setVersion] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const bodyRef = useRef(initialBody);
  const versionRef = useRef(0);

  useEffect(() => {
    setBody(initialBody);
    bodyRef.current = initialBody;
  }, [initialBody]);

  useEffect(() => {
    if (!socket || !messageId) return;

    const handleOTEdit = (payload) => {
      if (payload.messageId !== messageId) return;
      try {
        const op = TextOperation.fromJSON(payload.operation);
        const newBody = op.apply(bodyRef.current);
        bodyRef.current = newBody;
        setBody(newBody);
        setVersion(payload.version);
        versionRef.current = payload.version;
        onEditApplied?.(newBody, payload.version, payload.operation);
      } catch (e) {
        console.warn('[OT Message] Failed to apply remote edit', e.message);
        // Fallback to full body if OT fails
        if (payload.body) {
          bodyRef.current = payload.body;
          setBody(payload.body);
          setVersion(payload.version);
          versionRef.current = payload.version;
        }
      }
    };

    const handleMessageUpdated = (message) => {
      if (message.id !== messageId) return;
      // If server sent full updated message (legacy path), update body
      if (message.body && message.body !== bodyRef.current) {
        // Only update if we're not currently editing locally to avoid clobber
        if (!isEditing) {
          bodyRef.current = message.body;
          setBody(message.body);
          if (message.otVersion != null) {
            setVersion(message.otVersion);
            versionRef.current = message.otVersion;
          }
        }
      }
    };

    socket.on('message:edit:ot', handleOTEdit);
    socket.on('message:updated', handleMessageUpdated);

    return () => {
      socket.off('message:edit:ot', handleOTEdit);
      socket.off('message:updated', handleMessageUpdated);
    };
  }, [socket, messageId, isEditing, onEditApplied]);

  const submitEdit = useCallback((oldBody, newBody, options = {}) => {
    if (!messageId) return Promise.reject(new Error('Missing messageId'));
    if (oldBody === newBody) return Promise.resolve({ body: newBody, version: versionRef.current });

    setIsEditing(true);
    const baseVersion = options.baseVersion != null ? options.baseVersion : versionRef.current;

    return new Promise((resolve, reject) => {
      try {
        const operation = TextOperation.fromDiff(oldBody || '', newBody || '');
        if (operation.isNoop()) {
          setIsEditing(false);
          return resolve({ body: newBody, version: versionRef.current });
        }

        // Optimistic update
        try {
          const optimisticBody = operation.apply(bodyRef.current);
          bodyRef.current = optimisticBody;
          setBody(optimisticBody);
        } catch {
          // If optimistic apply fails (e.g., base mismatch), still try server
        }

        if (socket?.connected) {
          socket.emit('message:edit:ot', {
            messageId,
            operation: operation.toJSON(),
            baseVersion,
            body: newBody
          }, (res) => {
            setIsEditing(false);
            if (res?.error) {
              // Revert optimistic on failure
              bodyRef.current = oldBody;
              setBody(oldBody);
              reject(new Error(res.error));
            } else {
              const finalBody = res.body || newBody;
              bodyRef.current = finalBody;
              setBody(finalBody);
              setVersion(res.version);
              versionRef.current = res.version;
              resolve(res);
            }
          });
        } else {
          // Offline: use legacy edit via REST or queue
          // For now, resolve optimistically and queue
          setIsEditing(false);
          resolve({ body: newBody, version: versionRef.current, offline: true });
        }
      } catch (e) {
        setIsEditing(false);
        reject(e);
      }
    });
  }, [messageId, socket]);

  const submitLegacyEdit = useCallback((newBody) => {
    return submitEdit(bodyRef.current, newBody);
  }, [submitEdit]);

  return {
    body,
    version,
    isEditing,
    submitEdit,
    submitLegacyEdit,
    setBody: (newBody) => {
      bodyRef.current = newBody;
      setBody(newBody);
    }
  };
}

export default useOTMessageEdit;
