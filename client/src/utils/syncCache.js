/**
 * Cache for "last sync" data so Customers, Price List (items), Services show when offline.
 * Stored in IndexedDB; updated when API calls succeed; read when API fails due to network.
 */

const DB_NAME = 'supaclean-sync-cache';
const STORE_NAME = 'cache';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * @param {string} key - e.g. 'customers', 'items', 'services', 'branches', 'settings'
 * @returns {Promise<{ data: any, syncedAt: string }|null>}
 */
export async function getSyncCache(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * @param {string} key
 * @param {any} data
 */
export async function setSyncCache(key, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, data, syncedAt: new Date().toISOString() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export function isNetworkError(error) {
  if (!error) return false;
  const noResponse = !error.response && error.request;
  const code = error.code || '';
  const msg = (error.message || '').toLowerCase();
  return (
    noResponse ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    msg.includes('network error') ||
    msg.includes('failed to fetch') ||
    msg.includes('timeout')
  );
}

/** Use cache immediately when offline so we don't wait for request timeout. */
export function isOffline() {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}
