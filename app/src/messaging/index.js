import { createPersistence } from './persistence';
import { LocalMessageStore, sortChats } from './LocalMessageStore';
import { createConnectivityManager } from './ConnectivityManager';
import { createOutboxManager } from './OutboxManager';
import { createSyncManager } from './SyncManager';
import { createMessageRepository } from './MessageRepository';
import { OTDocumentCache } from './OTStore';
import { OTManager } from '../ot/OTManager';

export { sortChats };
export { createMessageId, isClientMessageId } from './ids';
export { messageTime, isPendingMessage, isOutboxStatus } from './messageState';

export function createMessagingEngine({ userId, getSocket, getChats }) {
  const persistence = createPersistence();
  const store = new LocalMessageStore(userId, persistence);
  const connectivity = createConnectivityManager();
  const outbox = createOutboxManager({ store, getSocket, connectivity, getChats });
  const sync = createSyncManager({ store, outbox, connectivity, getChats });
  const repository = createMessageRepository({ store, outbox });
  const otCache = new OTDocumentCache(userId, persistence);
  const otManager = new OTManager({ getSocket });

  otCache.hydrate().catch(() => {});

  return {
    store,
    outbox,
    sync,
    connectivity,
    repository,
    otCache,
    otManager,
    dispose() {
      outbox.dispose();
      sync.dispose();
      connectivity.dispose();
      store.dispose();
      otCache.dispose();
      otManager.dispose();
    },
  };
}
