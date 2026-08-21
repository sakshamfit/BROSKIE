import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const IDB_NAME = 'plusone-local-first';
const IDB_STORE = 'kv';

function createAsyncStoragePersistence() {
  return {
    kind: 'async-storage',
    async get(key) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async set(key, value) {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    },
    async remove(key) {
      await AsyncStorage.removeItem(key);
    },
  };
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function createIdbPersistence() {
  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
    return dbPromise;
  };

  return {
    kind: 'indexeddb',
    async get(key) {
      try {
        const db = await open();
        const tx = db.transaction(IDB_STORE, 'readonly');
        const value = await requestToPromise(tx.objectStore(IDB_STORE).get(key));
        return value === undefined ? null : value;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const db = await open();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('idb abort'));
      });
    },
    async remove(key) {
      const db = await open();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('idb abort'));
      });
    },
  };
}

/**
 * IndexedDB on web (larger, survives reloads). AsyncStorage on native
 * (already in the project, survives restarts). Both expose the same kv API.
 */
export function createPersistence() {
  if (Platform.OS === 'web' && typeof indexedDB !== 'undefined') {
    return createIdbPersistence();
  }
  return createAsyncStoragePersistence();
}

export function createMemoryPersistence() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

export { createAsyncStoragePersistence };
