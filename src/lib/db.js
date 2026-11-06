// Armazenamento local (IndexedDB): livros, arquivos e coletâneas ficam no aparelho.
import { planChapterImport } from './chapter-collections.js';
const DB_NAME = 'estante-livre';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => tx(store, 'readonly', (s) => s.get(id));
export const put = (store, value) => tx(store, 'readwrite', (s) => { s.put(value); return value; });
export const del = (store, id) => tx(store, 'readwrite', (s) => { s.delete(id); });
export const putMany = (store, values) => tx(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); return values; });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function commitImport(blob, book) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['books', 'files', 'collections'], 'readwrite');
    const bookStore = transaction.objectStore('books'), colStore = transaction.objectStore('collections');
    const booksReq = bookStore.getAll(), colsReq = colStore.getAll();
    let books, collections, result;
    const commit = () => {
      if (!books || !collections) return;
      const plan = planChapterImport(book, books, collections, uid);
      result = plan.book;
      transaction.objectStore('files').put({ id: result.id, blob });
      if (plan.collection) colStore.put(plan.collection);
      plan.updates.forEach((b) => bookStore.put(b));
      bookStore.put(result);
    };
    booksReq.onsuccess = () => { books = booksReq.result; commit(); };
    colsReq.onsuccess = () => { collections = colsReq.result; commit(); };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Não foi possível salvar o download.'));
  });
}

export async function patchBook(id, patch) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('books', 'readwrite'), store = transaction.objectStore('books');
    const request = store.get(id);
    let result;
    request.onsuccess = () => { if (request.result) { result = { ...request.result, ...patch }; store.put(result); } };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// Preferências (por aparelho) em localStorage, sempre protegido.
export function loadPref(key, fallback) {
  try { const v = localStorage.getItem('estante:' + key); return v == null ? fallback : { ...fallback, ...JSON.parse(v) }; }
  catch { return fallback; }
}
export function savePref(key, value) {
  try { localStorage.setItem('estante:' + key, JSON.stringify(value)); } catch { /* sem armazenamento */ }
}

export async function persistStorage() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* opcional */ }
}
