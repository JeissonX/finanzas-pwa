import type { Transaccion } from '../types/finance';

export type QueuedMutation =
  | { op: 'insert'; tx: Transaccion }
  | { op: 'delete'; id: string }
  | { op: 'update'; id: string; patch: Partial<Transaccion> };

const DB_NAME = 'finanzas_offline_db';
const DB_VERSION = 2;
const STORE_NAME = 'mutations';
const LOCKS_STORE_NAME = 'locks';
const LOCK_NAME = 'finanzas_offline_queue_lock';
const LEGACY_LOCALSTORAGE_KEY = 'finanzas_offline_queue';

interface IdbLockRecord {
  name: string;
  holderId: string;
  expiresAt: number;
}

interface MutationRecord {
  id?: number;
  mutation: QueuedMutation;
  timestamp: number;
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
      if (!db.objectStoreNames.contains(LOCKS_STORE_NAME)) {
        db.createObjectStore(LOCKS_STORE_NAME, { keyPath: 'name' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Intenta adquirir el lease lock de forma atómica en una única transacción readwrite de IndexedDB */
function tryAcquireIdbLock(
  db: IDBDatabase,
  lockName: string,
  holderId: string,
  leaseMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let acquired = false;
    const tx = db.transaction(LOCKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LOCKS_STORE_NAME);
    const getReq = store.get(lockName);

    getReq.onsuccess = () => {
      const record = getReq.result as IdbLockRecord | undefined;
      const now = Date.now();
      if (!record || record.expiresAt <= now || record.holderId === holderId) {
        store.put({
          name: lockName,
          holderId,
          expiresAt: now + leaseMs,
        });
        acquired = true;
      }
    };

    tx.oncomplete = () => {
      resolve(acquired);
    };

    tx.onerror = () => {
      resolve(false);
    };

    tx.onabort = () => {
      resolve(false);
    };
  });
}

/** Renueva el lease lock si el titular actual coincide */
function renewIdbLock(
  db: IDBDatabase,
  lockName: string,
  holderId: string,
  leaseMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let renewed = false;
    const tx = db.transaction(LOCKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LOCKS_STORE_NAME);
    const getReq = store.get(lockName);

    getReq.onsuccess = () => {
      const record = getReq.result as IdbLockRecord | undefined;
      if (record && record.holderId === holderId) {
        store.put({
          name: lockName,
          holderId,
          expiresAt: Date.now() + leaseMs,
        });
        renewed = true;
      }
    };

    tx.oncomplete = () => {
      resolve(renewed);
    };

    tx.onerror = () => {
      resolve(false);
    };

    tx.onabort = () => {
      resolve(false);
    };
  });
}

/** Libera el lease lock si el titular actual coincide */
function releaseIdbLock(
  db: IDBDatabase,
  lockName: string,
  holderId: string
): Promise<void> {
  return new Promise((resolve) => {
    const tx = db.transaction(LOCKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LOCKS_STORE_NAME);
    const getReq = store.get(lockName);

    getReq.onsuccess = () => {
      const record = getReq.result as IdbLockRecord | undefined;
      if (record && record.holderId === holderId) {
        store.delete(lockName);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

/** Fallback multipestaña atómico mediante transacciones readwrite serializadas en IndexedDB con heartbeat y fail-closed */
async function withIdbFallbackLock<T>(fn: () => Promise<T>): Promise<T> {
  const db = await openDatabase();
  const holderId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `idb_holder_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;

  const LEASE_MS = 15000;
  const HEARTBEAT_MS = 4000;
  const MAX_WAIT_MS = 15000;
  const startWait = Date.now();

  let acquired = false;
  while (Date.now() - startWait < MAX_WAIT_MS) {
    acquired = await tryAcquireIdbLock(db, LOCK_NAME, holderId, LEASE_MS);
    if (acquired) break;
    const delay = 120 + Math.floor(Math.random() * 40);
    await new Promise((res) => setTimeout(res, delay));
  }

  if (!acquired) {
    db.close();
    // FAIL-CLOSED OBLIGATORIO: Jamás ejecutar la operación sin lock
    throw new Error('Timeout esperando lock de cola offline en IndexedDB');
  }

  let leaseLost = false;
  const heartbeatTimer = setInterval(async () => {
    try {
      const renewed = await renewIdbLock(db, LOCK_NAME, holderId, LEASE_MS);
      if (!renewed) {
        leaseLost = true;
        console.warn('Alerta: Pérdida de lease detectada en heartbeat de IndexedDB lock');
      }
    } catch {
      leaseLost = true;
    }
  }, HEARTBEAT_MS);

  try {
    const result = await fn();
    if (leaseLost) {
      console.warn('Advertencia: La operación offline finalizó pero el lease se perdió durante la ejecución');
    }
    return result;
  } finally {
    clearInterval(heartbeatTimer);
    try {
      await releaseIdbLock(db, LOCK_NAME, holderId);
    } catch (err) {
      console.warn('Error liberando lock de IndexedDB:', err);
    }
    db.close();
  }
}

/** Ejecuta una operación bajo exclusión mutua de navigator.locks o lock atómico en IndexedDB */
export async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && typeof navigator.locks?.request === 'function') {
    return navigator.locks.request(LOCK_NAME, fn);
  }
  return withIdbFallbackLock(fn);
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
