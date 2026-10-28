import type { Transaccion } from '../types/finance';
import { supabase } from '../services/supabase';

export type MutationStatus = 'pending' | 'conflict' | 'orphan';

export type QueuedMutation = {
  mutationId: string;
  ownerUserId: string;
  status?: MutationStatus;
  conflictReason?: string;
} & (
  | { op: 'insert'; tx: Transaccion }
  | { op: 'delete'; id: string }
  | { op: 'update'; id: string; patch: Partial<Transaccion> }
);

export type QueuedMutationInput = {
  mutationId?: string;
  ownerUserId?: string;
  status?: MutationStatus;
  conflictReason?: string;
} & (
  | { op: 'insert'; tx: Transaccion }
  | { op: 'delete'; id: string }
  | { op: 'update'; id: string; patch: Partial<Transaccion> }
);

export class LeaseLostError extends Error {
  constructor(message = 'Pérdida de lease en lock de sincronización') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

const DB_NAME = 'finanzas_offline_db';
const DB_VERSION = 4;
const STORE_NAME = 'mutations';
const LOCKS_STORE_NAME = 'locks';
const LOCK_NAME = 'finanzas_offline_queue_lock';
const LEGACY_LOCALSTORAGE_KEY = 'finanzas_offline_queue';

interface IdbLockRecord {
  name: string;
  holderId: string;
  ownerToken: string;
  expiresAt: number;
}

interface MutationRecord {
  id?: number;
  mutation: QueuedMutation;
  timestamp: number;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/** Resuelve el ID del usuario autenticado en la sesión actual */
export async function resolveCurrentUserId(): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user?.id) {
      return sessionData.session.user.id;
    }
    const { data: userData } = await supabase.auth.getUser();
    return userData?.user?.id || null;
  } catch {
    return null;
  }
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

      // Upgrade: asignar mutationId si falta y marcar como orphan los registros sin ownerUserId
      const tx = request.transaction;
      if (tx && db.objectStoreNames.contains(STORE_NAME)) {
        const store = tx.objectStore(STORE_NAME);
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const val = cursor.value;
            let modified = false;
            if (val && val.mutation) {
              if (!val.mutation.mutationId) {
                val.mutation.mutationId = generateUuid();
                modified = true;
              }
              if (!val.mutation.ownerUserId) {
                val.mutation.ownerUserId = '';
                val.mutation.status = 'orphan';
                modified = true;
              }
            }
            if (modified) {
              cursor.update(val);
            }
            cursor.continue();
          }
        };
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
  ownerToken: string,
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
      if (!record || record.expiresAt <= now || record.ownerToken === ownerToken) {
        store.put({
          name: lockName,
          holderId,
          ownerToken,
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

/** Renueva el lease lock mediante compare-and-set si el ownerToken coincide */
function renewIdbLock(
  db: IDBDatabase,
  lockName: string,
  ownerToken: string,
  leaseMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let renewed = false;
    const tx = db.transaction(LOCKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LOCKS_STORE_NAME);
    const getReq = store.get(lockName);

    getReq.onsuccess = () => {
      const record = getReq.result as IdbLockRecord | undefined;
      const now = Date.now();
      // Compare-and-set: solo actúa si el token coincide y el lease sigue vigente
      if (record && record.ownerToken === ownerToken && record.expiresAt > now) {
        store.put({
          name: lockName,
          holderId: record.holderId,
          ownerToken,
          expiresAt: now + leaseMs,
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

/** Libera el lease lock mediante compare-and-set solo si el ownerToken coincide */
function releaseIdbLock(
  db: IDBDatabase,
  lockName: string,
  ownerToken: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let released = false;
    const tx = db.transaction(LOCKS_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LOCKS_STORE_NAME);
    const getReq = store.get(lockName);

    getReq.onsuccess = () => {
      const record = getReq.result as IdbLockRecord | undefined;
      // Compare-and-set: solo borra si el token coincide con el propio
      if (record && record.ownerToken === ownerToken) {
        store.delete(lockName);
        released = true;
      }
    };

    tx.oncomplete = () => resolve(released);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** Fallback multipestaña atómico mediante transacciones readwrite en IndexedDB con token de dueño, heartbeat y fail-closed */
async function withIdbFallbackLock<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  const holderId = generateUuid();
  const ownerToken = generateUuid();

  const LEASE_MS = 15000;
  const HEARTBEAT_MS = 4000;
  const MAX_WAIT_MS = 15000;
  const startWait = Date.now();

  let acquired = false;
  while (Date.now() - startWait < MAX_WAIT_MS) {
    acquired = await tryAcquireIdbLock(db, LOCK_NAME, holderId, ownerToken, LEASE_MS);
    if (acquired) break;
    const delay = 120 + Math.floor(Math.random() * 40);
    await new Promise((res) => setTimeout(res, delay));
  }

  if (!acquired) {
    db.close();
    // FAIL-CLOSED OBLIGATORIO: Jamás ejecutar la operación sin lock
    throw new Error('Timeout esperando lock de cola offline en IndexedDB');
  }

  const controller = new AbortController();
  let isStale = false;

  const heartbeatTimer = setInterval(async () => {
    try {
      const renewed = await renewIdbLock(db, LOCK_NAME, ownerToken, LEASE_MS);
      if (!renewed) {
        isStale = true;
        controller.abort(new LeaseLostError('Pérdida de lease detectada en heartbeat de IndexedDB lock'));
        clearInterval(heartbeatTimer);
      }
    } catch {
      isStale = true;
      controller.abort(new LeaseLostError('Fallo en renovación de lease en IndexedDB lock'));
      clearInterval(heartbeatTimer);
    }
  }, HEARTBEAT_MS);

  try {
    const result = await fn(controller.signal);
    if (isStale) {
      throw new LeaseLostError('La operación finalizó pero el lease se perdió durante la ejecución');
    }
    return result;
  } finally {
    clearInterval(heartbeatTimer);
    if (!isStale) {
      try {
        await releaseIdbLock(db, LOCK_NAME, ownerToken);
      } catch (err) {
        console.warn('Error liberando lock de IndexedDB:', err);
      }
    }
    db.close();
  }
}

/** Ejecuta una operación bajo exclusión mutua de navigator.locks o lock atómico en IndexedDB */
export async function withQueueLock<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && typeof navigator.locks?.request === 'function') {
    const controller = new AbortController();
    return navigator.locks.request(LOCK_NAME, () => fn(controller.signal));
  }
  return withIdbFallbackLock(fn);
}

function notifyQueueUpdated(count: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: count }));
  }
}

/** Lee todos los registros de IndexedDB asegurando mutationId y marcado de huérfanos */
async function readAllRecords(db: IDBDatabase): Promise<MutationRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result || []) as MutationRecord[];
      for (const rec of records) {
        if (rec?.mutation) {
          if (!rec.mutation.mutationId) {
            rec.mutation.mutationId = generateUuid();
          }
          if (!rec.mutation.ownerUserId) {
            rec.mutation.ownerUserId = '';
            rec.mutation.status = 'orphan';
          }
        }
      }
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
        const base = item && item.op ? item : { op: 'insert', tx: item as Transaccion };
        return {
          mutationId: base.mutationId || generateUuid(),
          ownerUserId: base.ownerUserId || '',
          status: base.ownerUserId ? (base.status || 'pending') : 'orphan',
          ...base,
        };
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

/** Obtiene la lista de mutaciones encoladas activas (no huérfanas) sin adquirir lock */
export async function getQueuedMutationsUnlocked(ownerUserId?: string): Promise<QueuedMutation[]> {
  try {
    const db = await openDatabase();
    await ensureLegacyMigrated(db);
    const records = await readAllRecords(db);
    db.close();

    let list = records.map(r => r.mutation);
    if (ownerUserId) {
      list = list.filter(m => m.ownerUserId === ownerUserId && m.status !== 'orphan');
    } else {
      list = list.filter(m => m.status !== 'orphan' && Boolean(m.ownerUserId));
    }
    return list;
  } catch (err) {
    console.warn('Error leyendo mutaciones de IndexedDB:', err);
    return [];
  }
}

/** Obtiene la lista de mutaciones encoladas activas bajo lock */
export async function getQueuedMutations(ownerUserId?: string): Promise<QueuedMutation[]> {
  return withQueueLock(() => getQueuedMutationsUnlocked(ownerUserId));
}

/** Obtiene registros huérfanos sin ownerUserId o con status 'orphan' sin adquirir lock */
export async function getOrphanMutationsUnlocked(): Promise<QueuedMutation[]> {
  try {
    const db = await openDatabase();
    await ensureLegacyMigrated(db);
    const records = await readAllRecords(db);
    db.close();
    return records
      .map(r => r.mutation)
      .filter(m => m.status === 'orphan' || !m.ownerUserId);
  } catch (err) {
    console.warn('Error leyendo mutaciones huérfanas de IndexedDB:', err);
    return [];
  }
}

/** Obtiene registros huérfanos bajo lock */
export async function getOrphanMutations(): Promise<QueuedMutation[]> {
  return withQueueLock(() => getOrphanMutationsUnlocked());
}

/** Marca una mutación como en conflicto en IndexedDB sin adquirir lock */
export async function markMutationConflictUnlocked(
  mutationId: string,
  reason: string
): Promise<void> {
  const db = await openDatabase();
  const records = await readAllRecords(db);
  let changed = false;
  for (const rec of records) {
    if (rec.mutation.mutationId === mutationId) {
      rec.mutation.status = 'conflict';
      rec.mutation.conflictReason = reason;
      changed = true;
      break;
    }
  }
  if (changed) {
    await writeAllRecords(db, records);
  }
  db.close();
}

/** Marca una mutación como en conflicto bajo lock */
export async function markMutationConflict(
  mutationId: string,
  reason: string
): Promise<void> {
  return withQueueLock(() => markMutationConflictUnlocked(mutationId, reason));
}

/** Encola una mutación aplicando particionado por usuario y coalescencia atómica sin adquirir lock */
export async function enqueueMutationUnlocked(mutation: QueuedMutationInput): Promise<void> {
  let ownerUserId = mutation.ownerUserId;
  if (!ownerUserId) {
    ownerUserId = (await resolveCurrentUserId()) || undefined;
  }

  if (!ownerUserId || typeof ownerUserId !== 'string' || ownerUserId.trim() === '') {
    throw new Error('Rechazado: no se puede encolar una mutación sin sesión autenticada (ownerUserId requerido)');
  }

  const cleanOwnerId = ownerUserId.trim();
  const db = await openDatabase();
  await ensureLegacyMigrated(db);
  const records = await readAllRecords(db);

  const list = records.map(r => r.mutation);
  const assignedId = mutation.mutationId || generateUuid();
  const mut: QueuedMutation = {
    ...mutation,
    mutationId: assignedId,
    ownerUserId: cleanOwnerId,
    status: mutation.status || 'pending',
  } as QueuedMutation;

  if (mut.op === 'insert') {
    const idx = list.findIndex(
      m => m.ownerUserId === cleanOwnerId && m.op === 'insert' && String(m.tx.id) === String(mut.tx.id)
    );
    if (idx >= 0) {
      // Reintento de inserción del mismo registro: mantener mutationId original si no se especificó otro
      const preservedId = mutation.mutationId || list[idx].mutationId;
      list[idx] = { ...mut, mutationId: preservedId };
    } else {
      list.push(mut);
    }
  } else if (mut.op === 'update') {
    // REGLA: NUNCA fusionar dentro de un insert pendiente. Se encola como mutación independiente.
    // Solo coalescer con otro update previo del mismo registro del MISMO usuario si no hay un delete posterior para ese ID.
    const lastDeleteIdx = list
      .map(m => m.ownerUserId === cleanOwnerId && m.op === 'delete' && String(m.id) === String(mut.id))
      .lastIndexOf(true);
    const existingUpdateIdx = list.findIndex(
      (m, i) => i > lastDeleteIdx && m.ownerUserId === cleanOwnerId && m.op === 'update' && String(m.id) === String(mut.id)
    );

    if (existingUpdateIdx >= 0) {
      // Al fusionar updates pendientes, asignar un mutationId NUEVO para evitar
      // que una sincronización en curso elimine por el ID previo cambios recién acumulados.
      const prev = list[existingUpdateIdx] as { op: 'update'; id: string; patch: Partial<Transaccion>; mutationId: string; ownerUserId: string };
      list[existingUpdateIdx] = {
        mutationId: generateUuid(),
        ownerUserId: cleanOwnerId,
        op: 'update',
        id: mut.id,
        patch: { ...prev.patch, ...mut.patch },
        status: 'pending',
      };
    } else {
      // Encolar como mutación update independiente posterior al insert o mutaciones previas
      list.push(mut);
    }
  } else if (mut.op === 'delete') {
    // REGLA: NUNCA cancelar silenciosamente el insert ni updates pendientes.
    // Encolar el delete como mutación propia posterior al insert/updates (orden: insert -> updates -> delete).
    const alreadyHasDelete = list.some(
      m => m.ownerUserId === cleanOwnerId && m.op === 'delete' && String(m.id) === String(mut.id)
    );
    if (!alreadyHasDelete) {
      list.push(mut);
    }
  }

  const updatedRecords: MutationRecord[] = list.map(m => ({ mutation: m, timestamp: Date.now() }));
  await writeAllRecords(db, updatedRecords);
  db.close();
  notifyQueueUpdated(updatedRecords.length);
}

/** Encola una mutación aplicando particionado por usuario y coalescencia atómica bajo lock */
export async function enqueueMutation(mutation: QueuedMutationInput): Promise<void> {
  return withQueueLock(() => enqueueMutationUnlocked(mutation));
}

/** Remueve las mutaciones procesadas con éxito por mutationId sin adquirir lock (para uso dentro de withQueueLock) */
export async function removeProcessedMutationsUnlocked(
  processedIds: (string | QueuedMutation)[]
): Promise<void> {
  if (!processedIds || processedIds.length === 0) return;
  const idSet = new Set(
    processedIds
      .map(item => (typeof item === 'string' ? item : item?.mutationId))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  if (idSet.size === 0) return;

  const db = await openDatabase();
  const records = await readAllRecords(db);

  const remaining = records.filter(r => !idSet.has(r.mutation.mutationId));

  await writeAllRecords(db, remaining);
  db.close();
  notifyQueueUpdated(remaining.length);
}

/** Remueve las mutaciones procesadas con éxito bajo lock */
export async function removeProcessedMutations(
  processedIds: (string | QueuedMutation)[]
): Promise<void> {
  return withQueueLock(() => removeProcessedMutationsUnlocked(processedIds));
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
