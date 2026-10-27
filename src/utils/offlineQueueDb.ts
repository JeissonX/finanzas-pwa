import type { Transaccion } from '../types/finance';

export type QueuedMutation =
  | { op: 'insert'; tx: Transaccion }
  | { op: 'delete'; id: string }
  | { op: 'update'; id: string; patch: Partial<Transaccion> };

const DB_NAME = 'finanzas_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const LOCK_NAME = 'finanzas_offline_queue_lock';
const LEGACY_LOCALSTORAGE_KEY = 'finanzas_offline_queue';

interface MutationRecord {
  id?: number;
  mutation: QueuedMutation;
  timestamp: number;
}

/** Ejecuta una operación bajo exclusión mutua de navigator.locks entre pestañas */
export async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && typeof navigator.locks?.request === 'function') {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return fn();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está soportado en este entorno'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function notifyQueueUpdated(count: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: count }));
  }
}

/** Lee todos los registros de IndexedDB (con migración transparente de localStorage si existe) */
async function readAllRecords(db: IDBDatabase): Promise<MutationRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result || []) as MutationRecord[];
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Sobrescribe los registros de la tienda atómicamente dentro de una transacción IDB */
async function writeAllRecords(db: IDBDatabase, records: MutationRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    for (const rec of records) {
      store.add({
        mutation: rec.mutation,
        timestamp: rec.timestamp,
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let migratedLegacy = false;

/** Migra datos antiguos de localStorage a IndexedDB una sola vez */
async function ensureLegacyMigrated(db: IDBDatabase): Promise<void> {
  if (migratedLegacy || typeof localStorage === 'undefined') return;
  migratedLegacy = true;

  try {
    const raw = localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const legacyMutations: QueuedMutation[] = parsed.map((item: any) => {
        if (item && item.op) return item as QueuedMutation;
        return { op: 'insert', tx: item as Transaccion };
      });

      const current = await readAllRecords(db);
      for (const m of legacyMutations) {
        current.push({ mutation: m, timestamp: Date.now() });
      }
      await writeAllRecords(db, current);
      localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** Obtiene la lista completa de mutaciones encoladas sin adquirir lock (para uso dentro de withQueueLock) */
export async function getQueuedMutationsUnlocked(): Promise<QueuedMutation[]> {
  try {
    const db = await openDatabase();
    await ensureLegacyMigrated(db);
    const records = await readAllRecords(db);
    db.close();
    return records.map(r => r.mutation);
  } catch (err) {
    console.warn('Error leyendo mutaciones de IndexedDB:', err);
    return [];
  }
}

/** Obtiene la lista completa de mutaciones encoladas bajo lock */
export async function getQueuedMutations(): Promise<QueuedMutation[]> {
  return withQueueLock(() => getQueuedMutationsUnlocked());
}

/** Encola una mutación aplicando coalescencia atómica sin adquirir lock (para uso dentro de withQueueLock) */
export async function enqueueMutationUnlocked(mutation: QueuedMutation): Promise<void> {
  const db = await openDatabase();
  await ensureLegacyMigrated(db);
  const records = await readAllRecords(db);

  const list = records.map(r => r.mutation);

  if (mutation.op === 'insert') {
    const idx = list.findIndex(m => m.op === 'insert' && String(m.tx.id) === String(mutation.tx.id));
    if (idx >= 0) {
      list[idx] = mutation;
    } else {
      list.push(mutation);
    }
  } else if (mutation.op === 'delete') {
    // Eliminar inserts o updates pendientes de este ID antes de añadir el delete
    const filtered = list.filter(m => {
      if (m.op === 'insert' && String(m.tx.id) === String(mutation.id)) return false;
      if (m.op === 'update' && String(m.id) === String(mutation.id)) return false;
      return true;
    });
    filtered.push(mutation);
    const updatedRecords: MutationRecord[] = filtered.map(m => ({ mutation: m, timestamp: Date.now() }));
    await writeAllRecords(db, updatedRecords);
    db.close();
    notifyQueueUpdated(updatedRecords.length);
    return;
  } else if (mutation.op === 'update') {
    const insertIdx = list.findIndex(m => m.op === 'insert' && String(m.tx.id) === String(mutation.id));
    if (insertIdx >= 0 && list[insertIdx].op === 'insert') {
      const existingTx = (list[insertIdx] as { op: 'insert'; tx: Transaccion }).tx;
      list[insertIdx] = {
        op: 'insert',
        tx: { ...existingTx, ...mutation.patch },
      };
    } else {
      const updateIdx = list.findIndex(m => m.op === 'update' && String(m.id) === String(mutation.id));
      if (updateIdx >= 0) {
        const prevPatch = (list[updateIdx] as { op: 'update'; id: string; patch: Partial<Transaccion> }).patch;
        list[updateIdx] = {
          op: 'update',
          id: mutation.id,
          patch: { ...prevPatch, ...mutation.patch },
        };
      } else {
        list.push(mutation);
      }
    }
  }

  const updatedRecords: MutationRecord[] = list.map(m => ({ mutation: m, timestamp: Date.now() }));
  await writeAllRecords(db, updatedRecords);
  db.close();
  notifyQueueUpdated(updatedRecords.length);
}

/** Encola una mutación aplicando coalescencia atómica bajo lock */
export async function enqueueMutation(mutation: QueuedMutation): Promise<void> {
  return withQueueLock(() => enqueueMutationUnlocked(mutation));
}

function areMutationsEqual(a: QueuedMutation, b: QueuedMutation): boolean {
  if (a.op !== b.op) return false;
  if (a.op === 'insert' && b.op === 'insert') {
    return String(a.tx.id) === String(b.tx.id);
  }
  if (a.op === 'delete' && b.op === 'delete') {
    return String(a.id) === String(b.id);
  }
  if (a.op === 'update' && b.op === 'update') {
    return String(a.id) === String(b.id);
  }
  return false;
}

/** Remueve las mutaciones procesadas con éxito sin adquirir lock (para uso dentro de withQueueLock) */
export async function removeProcessedMutationsUnlocked(processed: QueuedMutation[]): Promise<void> {
  if (processed.length === 0) return;
  const db = await openDatabase();
  const records = await readAllRecords(db);

  const remaining = records.filter(
    r => !processed.some(p => areMutationsEqual(r.mutation, p))
  );

  await writeAllRecords(db, remaining);
  db.close();
  notifyQueueUpdated(remaining.length);
}

/** Remueve las mutaciones procesadas con éxito bajo lock */
export async function removeProcessedMutations(processed: QueuedMutation[]): Promise<void> {
  return withQueueLock(() => removeProcessedMutationsUnlocked(processed));
}

/** Limpia completamente la cola offline sin adquirir lock (para uso dentro de withQueueLock) */
export async function clearMutationQueueUnlocked(): Promise<void> {
  const db = await openDatabase();
  await writeAllRecords(db, []);
  db.close();
  notifyQueueUpdated(0);
}

/** Limpia completamente la cola offline bajo lock */
export async function clearMutationQueue(): Promise<void> {
  return withQueueLock(() => clearMutationQueueUnlocked());
}
