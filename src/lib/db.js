// Archivio locale (IndexedDB): le immagini non lasciano mai il dispositivo
// se non verso l'altro giocatore, in diretta P2P.
const DB_NAME = 'giochi-coppia';
const STORES = ['boards', 'geopacks'];
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  }));
}

export const db = {
  all: (store) => tx(store, 'readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => (b.updated || 0) - (a.updated || 0))),
  get: (store, id) => tx(store, 'readonly', (s) => s.get(id)),
  put: (store, obj) => tx(store, 'readwrite', (s) => s.put({ ...obj, updated: Date.now() })),
  del: (store, id) => tx(store, 'readwrite', (s) => s.delete(id)),
};

// Chiede al browser di non cancellare i dati (utile su iPhone/Android).
export function persist() { try { navigator.storage?.persist?.(); } catch {} }

const SETTINGS_KEY = 'gc-settings';
export function getSettings() {
  try { return { name: '', turn: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { name: '', turn: '' }; }
}
export function setSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), ...s })); } catch {}
}
