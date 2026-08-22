import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Browser storage for app preferences and sessions. IndexedDB is asynchronous,
// quota-friendly, and does not block the UI thread like localStorage. Native
// builds keep using AsyncStorage.
const DB_NAME = 'plusone-app';
const STORE_NAME = 'key-value';
let database;

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idbStorage = {
  async getItem(key) {
    const db = await openDatabase();
    return (await idbRequest(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key))) ?? null;
  },
  async setItem(key, value) {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(String(value), key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  },
  async removeItem(key) {
    const db = await openDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  },
};

export const appStorage = Platform.OS === 'web' && typeof indexedDB !== 'undefined'
  ? idbStorage
  : AsyncStorage;
