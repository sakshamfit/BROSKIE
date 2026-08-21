import { createPersistence } from './persistence';
import { LocalMessageStore, sortChats } from './LocalMessageStore';
import { createConnectivityManager } from './ConnectivityManager';
import { createOutboxManager } from './OutboxManager';
import { createSyncManager } from './SyncManager';
import { createMessageRepository } from './MessageRepository';

export { sortChats };
export { createMessageId, isClientMessageId } from './ids';
export { messageTime, isPendingMessage, isOutboxStatus } from './messageState';

export function createMessagingEngine({ userId, getSocket }) {
  const persistence = createPersistence();
  const store = new LocalMessageStore(userId, persistence);
  const connectivity = createConnectivityManager();
  const outbox = createOutboxManager({ store, getSocket, connectivity });
  const sync = createSyncManager({ store, outbox, connectivity });
  const repository = createMessageRepository({ store, outbox });

  return {
    store,
    outbox,
    sync,
    connectivity,
    repository,
    dispose() {
      outbox.dispose();
      sync.dispose();
      connectivity.dispose();
      store.dispose();
    },
  };
}
