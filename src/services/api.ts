import { supabase } from './supabase';
import type { Transaccion, AppDataResponse, PresupuestoItem, Cartera, CarteraInfo, GastoRecurrente } from '../types/finance';
import {
  isDateInCurrentCycle,
  getCycleLabel,
  getPayrollCycleId,
  getBogotaDateParts,
  getDaysInBogotaMonth,
} from '../utils/format';
import {
  getQueuedMutations,
  getQueuedMutationsUnlocked,
  markMutationConflictUnlocked,
  resolveCurrentUserId,
  enqueueMutation,
  enqueueMutationUnlocked,
  removeProcessedMutationsUnlocked,
  withQueueLock,
  generateUuid,
  LeaseLostError,
  SessionChangedError,
  type QueuedMutation,
  type QueuedMutationInput,
  type MutationStatus,
} from '../utils/offlineQueueDb';

export { getQueuedMutations };
export type { QueuedMutation, QueuedMutationInput, MutationStatus };

/**
 * Emite un evento global 'supabase-sync-error' para visibilidad inmediata de errores de PostgreSQL/PostgREST en la UI.
 */
export function dispatchSupabaseSyncError(error: any): string {
  if (!error) return '';
  let errMsg: string;
  if (typeof error === 'string') {
    errMsg = error;
  } else {
    const code = error.code || error.status || 'ERR';
    const message = error.message || 'Error desconocido';
    const extra = [error.details, error.hint].filter(Boolean).join(' - ');
    errMsg = extra ? `${code}: ${message} (${extra})` : `${code}: ${message}`;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('supabase-sync-error', { detail: errMsg }));
  }
  return errMsg;
}

const TRANSACTIONS_KEY = 'finanzas_transacciones_ciclo_v2';
const APPDATA_CACHE_KEY = 'finanzas_cached_appdata_v4';
const APPDATA_CACHE_TTL = 5 * 60 * 1000;

export const DEFAULT_SALDOS: Record<string, number> = {
  'Lulo Principal (Cuenta)': 0,
  'Lulo Bolsillo - Ahorro': 0,
  'Lulo Bolsillo - Carro / Moto': 0,
  'Lulo Bolsillo - Vacaciones': 0,
  'Nequi': 0,
  'Efectivo': 0,
  'TC Lulo Bank': 0,
  'RappiCard': 0,
  'Crédito Mazda 2 (Lulo)': 0,
};

export interface AppData extends AppDataResponse {}

export const DEFAULT_APPDATA: AppData = {
  saldos: { ...DEFAULT_SALDOS },
  gastadoPorSubcat: {},
  gastadoPorMacro: {},
  kpis: {
    ingresos: 0,
    gastos: 0,
    balance: 0,
    tasaAhorro: 0,
    saldoRemunerados: 0,
    balanceDisponible: 0,
  },
  historico: [
    { ciclo: 'Ciclo Actual', gastos: 0, ingresos: 0 },
  ],
  fromCache: true,
  timestamp: 0,
  tasas: {
    lulo: 9.25,
    mazda: 21.35,
  },
  transacciones: [],
  presupuestos: [],
  carteras: [],
  gastosRecurrentes: [],
};

/** Sanitiza montos garantizando enteros seguros en COP */
function sanitizeAmount(m: any): number {
  const num = Number(m);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.trunc(Math.round(num));
  return Number.isSafeInteger(rounded) ? rounded : 0;
}

// ── Gestión Local de Transacciones ────────────────────────────────────────────

export function getTransacciones(): Transaccion[] {
  try {
    const raw = localStorage.getItem(TRANSACTIONS_KEY);
    return raw ? (JSON.parse(raw) as Transaccion[]) : [];
  } catch {
    return [];
  }
}

function saveTransacciones(txs: Transaccion[]): void {
  try {
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txs));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: txs }));
  }
}

function markTransactionSynced(id: number | string, synced = true): void {
  const list = getTransacciones();
  let changed = false;
  const updated = list.map(t => {
    if (String(t.id) === String(id)) {
      changed = true;
      return { ...t, sincronizado: synced };
    }
    return t;
  });
  if (changed) {
    saveTransacciones(updated);
  }
}

// ── Actualización Optimista Local ─────────────────────────────────────────────

function applyOptimisticTransaction(tx: Transaccion): AppData {
  const txList = getTransacciones();
  const existingIdx = txList.findIndex(t => String(t.id) === String(tx.id));
  let updatedList: Transaccion[];
  if (existingIdx >= 0) {
    updatedList = [...txList];
    updatedList[existingIdx] = tx;
  } else {
    updatedList = [tx, ...txList];
  }
  saveTransacciones(updatedList);

  let current: AppData = { ...DEFAULT_APPDATA };
  try {
    const raw = localStorage.getItem(APPDATA_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
      if (parsed?.data) {
        current = parsed.data;
      }
    }
  } catch {
    /* ignore */
  }

  const saldos = { ...DEFAULT_SALDOS, ...(current.saldos || {}) };
  const gastadoPorSubcat = { ...(current.gastadoPorSubcat || {}) };
  const gastadoPorMacro = { ...(current.gastadoPorMacro || {}) };
  const kpis = { ...(current.kpis || { ingresos: 0, gastos: 0, balance: 0, tasaAhorro: 0, saldoRemunerados: 0, balanceDisponible: 0 }) };

  const monto = sanitizeAmount(tx.monto);
  const subcatNombre = tx.subcategoria || tx.sub || '';
  const macroNombre = tx.categoria || tx.macro || '';
  const cuentaNombre = tx.cuenta || tx.cuentaOrigen || '';
  const cuentaDestino = tx.cuentaDestino || '';

  if (tx.tipo === 'GASTO') {
    if (cuentaNombre) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) - monto;
    }
    if (subcatNombre) {
      gastadoPorSubcat[subcatNombre] = (gastadoPorSubcat[subcatNombre] ?? 0) + monto;
    }
    if (macroNombre) {
      gastadoPorMacro[macroNombre] = (gastadoPorMacro[macroNombre] ?? 0) + monto;
    }
    kpis.gastos = (kpis.gastos ?? 0) + monto;
  } else if (tx.tipo === 'INGRESO') {
    if (cuentaNombre) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) + monto;
    }
    kpis.ingresos = (kpis.ingresos ?? 0) + monto;
  } else if (tx.tipo === 'TRANSFERENCIA') {
    if (cuentaNombre) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) - monto;
    }
    if (cuentaDestino) {
      saldos[cuentaDestino] = (saldos[cuentaDestino] ?? 0) + monto;
    }
  } else if (tx.tipo === 'AJUSTE') {
    if (tx.cuentaDestino || cuentaDestino) {
      const dest = (tx.cuentaDestino || cuentaDestino)!;
      saldos[dest] = (saldos[dest] ?? 0) + monto;
    } else if (tx.cuentaOrigen || cuentaNombre) {
      const orig = (tx.cuentaOrigen || cuentaNombre)!;
      saldos[orig] = (saldos[orig] ?? 0) - monto;
    }
  }

  kpis.balance = (kpis.ingresos ?? 0) - (kpis.gastos ?? 0);
  kpis.tasaAhorro = kpis.ingresos > 0 ? (kpis.balance / kpis.ingresos) * 100 : 0;

  const updatedData: AppData = {
    ...current,
    saldos,
    gastadoPorSubcat,
    gastadoPorMacro,
    kpis,
    timestamp: Date.now(),
    fromCache: true,
  };

  try {
    localStorage.setItem(APPDATA_CACHE_KEY, JSON.stringify({ timestamp: updatedData.timestamp, data: updatedData }));
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: updatedData }));
    window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedData.saldos }));
  }

  return updatedData;
}

// ── Inserción Remota Pura (Separada del Flujo Optimista) ───────────────────────

interface InsertRemoteResult {
  confirmed: boolean;
  conflict?: boolean;
  reason?: string;
}

async function insertRemote(
  tx: Transaccion,
  signal?: AbortSignal,
  clientMutationId?: string,
  ownerUserId?: string
): Promise<InsertRemoteResult> {
  const mutationId = (
    clientMutationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientMutationId)
      ? clientMutationId
      : generateUuid()
  );

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session || !session.user?.id) {
    const errMsg = '42501: Inserción remota rechazada: no hay usuario autenticado en la sesión de Supabase Auth';
    dispatchSupabaseSyncError(errMsg);
    throw new Error(errMsg);
  }

  const sessionUserId = session.user.id;
  const effectiveUserId = ownerUserId || tx.user_id || sessionUserId;

  if (effectiveUserId !== sessionUserId) {
    const errMsg = `42501: Discrepancia de usuario autenticado: sesión (${sessionUserId}) vs payload (${effectiveUserId})`;
    dispatchSupabaseSyncError(errMsg);
    throw new Error(errMsg);
  }

  let cuentaOrigen: string | null = null;
  let cuentaDestino: string | null = null;

  if (tx.tipo === 'GASTO') {
    cuentaOrigen = tx.cuentaOrigen || tx.cuenta || null;
    cuentaDestino = null;
  } else if (tx.tipo === 'INGRESO') {
    cuentaOrigen = null;
    cuentaDestino = tx.cuentaDestino || tx.cuenta || null;
  } else if (tx.tipo === 'TRANSFERENCIA') {
    cuentaOrigen = tx.cuentaOrigen || null;
    cuentaDestino = tx.cuentaDestino || null;
  } else if (tx.tipo === 'AJUSTE') {
    if (tx.cuentaDestino && !tx.cuentaOrigen) {
      cuentaDestino = tx.cuentaDestino;
      cuentaOrigen = null;
    } else if (tx.cuentaOrigen && !tx.cuentaDestino) {
      cuentaOrigen = tx.cuentaOrigen;
      cuentaDestino = null;
    } else if (tx.cuentaDestino) {
      cuentaDestino = tx.cuentaDestino;
      cuentaOrigen = null;
    } else if (tx.cuentaOrigen) {
      cuentaOrigen = tx.cuentaOrigen;
      cuentaDestino = null;
    } else if (tx.cuenta) {
      cuentaDestino = tx.cuenta;
      cuentaOrigen = null;
    }
  }

  cuentaOrigen = cuentaOrigen && cuentaOrigen.trim() !== '' ? cuentaOrigen.trim() : null;
  cuentaDestino = cuentaDestino && cuentaDestino.trim() !== '' ? cuentaDestino.trim() : null;
  const cuentaPrincipal = tx.cuenta || cuentaDestino || cuentaOrigen || '';

  const txDate = tx.fecha || new Date().toISOString();
  const canonicalCycle = getPayrollCycleId(txDate);
  const cleanMonto = Math.max(1, Math.trunc(Math.round(Number(tx.monto) || 0)));
  const macroValue = (tx.macroCategoria || tx.categoria || tx.macro || '').trim();
  const subValue = (tx.subcategoria || tx.sub || '').trim();

  const payload: Record<string, any> = {
    id: String(tx.id),
    client_mutation_id: mutationId,
    user_id: sessionUserId,
    fecha: txDate,
    tipo: tx.tipo,
    monto: cleanMonto,
    macro_categoria: macroValue,
    subcategoria: subValue,
    cuenta: cuentaPrincipal,
    cuenta_origen: cuentaOrigen,
    cuenta_destino: cuentaDestino,
    detalle: (tx.comentario || tx.detalle || '').trim(),
    ciclo: canonicalCycle,
  };

  let query = supabase
    .from('transacciones')
    .upsert([payload], { onConflict: 'id', ignoreDuplicates: true })
    .select('id,user_id');

  if (signal) {
    query = query.abortSignal(signal);
  }

  let { data, error } = await query;

  // Fallback si la columna client_mutation_id no existe en la base remota (42703)
  if (error && error.code === '42703' && payload.client_mutation_id) {
    const { client_mutation_id: _, ...fallbackPayload } = payload;
    let fallbackQuery = supabase
      .from('transacciones')
      .upsert([fallbackPayload], { onConflict: 'id', ignoreDuplicates: true })
      .select('id,user_id');
    if (signal) fallbackQuery = fallbackQuery.abortSignal(signal);
    const retryRes = await fallbackQuery;
    data = retryRes.data;
    error = retryRes.error;
  }

  if (error) {
    dispatchSupabaseSyncError(error);
  }

  // Caso 1: Fila insertada exitosamente (retornada por el select)
  if (!error && Array.isArray(data) && data.length > 0) {
    const row = data[0];
    if (String(row.user_id) !== String(sessionUserId)) {
      const reason = `Mismatch de user_id en insert: devuelto (${row.user_id}) vs dueño esperado (${sessionUserId})`;
      dispatchSupabaseSyncError(reason);
      return {
        confirmed: false,
        conflict: true,
        reason,
      };
    }
    return { confirmed: true };
  }

  // Caso 2: Fila ignorada por ON CONFLICT DO NOTHING (data vacía) o colisión 23505
  const isIgnored = !error && Array.isArray(data) && data.length === 0;
  const is23505 = error && (error.code === '23505' || String(error.message).includes('duplicate key'));

  if (isIgnored || is23505) {
    // Consultar la fila por id o client_mutation_id para el effectiveUserId
    let verifyQuery = supabase
      .from('transacciones')
      .select('*')
      .eq('id', String(tx.id))
      .eq('user_id', effectiveUserId);

    if (signal) {
      verifyQuery = verifyQuery.abortSignal(signal);
    }

    let { data: existingRows, error: verifyErr } = await verifyQuery;

    // Si no se encuentra por id, intentar por client_mutation_id
    if ((!existingRows || existingRows.length === 0) && mutationId) {
      let mutQuery = supabase
        .from('transacciones')
        .select('*')
        .eq('client_mutation_id', mutationId)
        .eq('user_id', effectiveUserId);
      if (signal) mutQuery = mutQuery.abortSignal(signal);
      const mutRes = await mutQuery;
      if (!mutRes.error && mutRes.data && mutRes.data.length > 0) {
        existingRows = mutRes.data;
        verifyErr = null;
      }
    }

    // Si la verificación falla (red, RLS, timeout): lanzar error para conservar la mutación en la cola
    if (verifyErr) {
      dispatchSupabaseSyncError(verifyErr);
      throw verifyErr;
    }

    // Si la consulta no encuentra la fila: el error 23505 vino de otra restricción (ej. PK ajena)
    if (!existingRows || existingRows.length === 0) {
      const reason = `Fila no encontrada por id (${tx.id}) o mutationId (${mutationId}) para user_id (${sessionUserId}). Posible colisión de PK u otra restricción ajena.`;
      dispatchSupabaseSyncError(reason);
      return {
        confirmed: false,
        conflict: true,
        reason,
      };
    }

    const row = existingRows[0];

    // Verificar usuario autenticado (Fallar cerrado)
    const rowUserId = row?.user_id;
    if (!rowUserId || String(rowUserId) !== String(sessionUserId)) {
      const reason = `Verificación de conflicto falló cerrado: usuario no coincide (remoto: ${rowUserId || 'falsy'}, dueño: ${sessionUserId})`;
      dispatchSupabaseSyncError(reason);
      throw new Error(reason);
    }

    // Verificar mismo ID de transacción
    if (String(row.id) !== String(tx.id)) {
      const reason = `Conflicto en ID de transacción: remoto (${row.id}) vs local (${tx.id})`;
      dispatchSupabaseSyncError(reason);
      return {
        confirmed: false,
        conflict: true,
        reason,
      };
    }

    // Normalizaciones estrictas para comparación contable
    const normalizeStr = (val: any): string => (val === null || val === undefined ? '' : String(val).trim());
    const normalizeStrCase = (val: any): string => normalizeStr(val).toLowerCase();
    const normalizeNullable = (val: any): string | null => {
      const s = normalizeStr(val);
      return s === '' ? null : s.toLowerCase();
    };

    // Comparar TODOS los campos que determinan el asiento contable
    const remoteMonto = sanitizeAmount(row.monto);
    const localMonto = cleanMonto;
    const montoMatch = remoteMonto === localMonto;

    const remoteTipo = normalizeStr(row.tipo).toUpperCase();
    const localTipo = normalizeStr(tx.tipo).toUpperCase();
    const tipoMatch = remoteTipo === localTipo;

    const remoteTime = new Date(row.fecha).getTime();
    const localTime = new Date(txDate).getTime();
    const fechaMatch = !isNaN(remoteTime) && !isNaN(localTime) && Math.abs(remoteTime - localTime) <= 1000;

    const remoteCuenta = normalizeStrCase(row.cuenta);
    const localCuenta = normalizeStrCase(cuentaPrincipal);
    const cuentaMatch = remoteCuenta === localCuenta;

    const remoteOrigen = normalizeNullable(row.cuenta_origen);
    const localOrigen = normalizeNullable(cuentaOrigen);
    const origenMatch = remoteOrigen === localOrigen;

    const remoteDestino = normalizeNullable(row.cuenta_destino);
    const localDestino = normalizeNullable(cuentaDestino);
    const destinoMatch = remoteDestino === localDestino;

    const remoteMacro = normalizeStrCase(row.macro_categoria);
    const localMacro = normalizeStrCase(macroValue);
    const macroMatch = remoteMacro === localMacro;

    const remoteSub = normalizeStrCase(row.subcategoria);
    const localSub = normalizeStrCase(subValue);
    const subMatch = remoteSub === localSub;

    const remoteCiclo = normalizeStr(row.ciclo);
    const localCiclo = normalizeStr(canonicalCycle);
    const cicloMatch = remoteCiclo === localCiclo;

    const remoteDetalle = normalizeStr(row.detalle);
    const localDetalle = normalizeStr(tx.comentario || tx.detalle || '');
    const detalleMatch = remoteDetalle === localDetalle;

    if (
      montoMatch &&
      tipoMatch &&
      fechaMatch &&
      cuentaMatch &&
      origenMatch &&
      destinoMatch &&
      macroMatch &&
      subMatch &&
      cicloMatch &&
      detalleMatch
    ) {
      return { confirmed: true };
    }

    const reason =
      `Conflicto contable en transacción ${tx.id}: campos difieren entre remoto y local. ` +
      `Monto: ${remoteMonto} vs ${localMonto}, Tipo: ${row.tipo} vs ${tx.tipo}, ` +
      `Cuenta: ${row.cuenta} vs ${cuentaPrincipal}, Origen: ${row.cuenta_origen} vs ${cuentaOrigen}, ` +
      `Destino: ${row.cuenta_destino} vs ${cuentaDestino}, Macro: ${row.macro_categoria} vs ${macroValue}, ` +
      `Sub: ${row.subcategoria} vs ${subValue}, Ciclo: ${row.ciclo} vs ${canonicalCycle}, ` +
      `Detalle: "${row.detalle}" vs "${tx.comentario || tx.detalle || ''}"`;

    dispatchSupabaseSyncError(reason);
    return {
      confirmed: false,
      conflict: true,
      reason,
    };
  }

  // Cualquier otro error de red, RLS o backend: lanzar para reintento
  if (error) {
    dispatchSupabaseSyncError(error);
    throw error;
  }

  return { confirmed: false, reason: 'Estado de inserción indeterminado' };
}

// ── Guardado de Transacción con Contingencia Offline ──────────────────────────

export async function saveTransaction(tx: Transaccion): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session || !session.user?.id) {
    const errMsg = '42501: No se puede registrar transacción sin sesión autenticada en Supabase Auth';
    dispatchSupabaseSyncError(errMsg);
    throw new Error(errMsg);
  }

  const currentUserId = session.user.id;

  let cuentaOrigen: string | null = null;
  let cuentaDestino: string | null = null;

  if (tx.tipo === 'GASTO') {
    cuentaOrigen = tx.cuentaOrigen || tx.cuenta || null;
    cuentaDestino = null;
  } else if (tx.tipo === 'INGRESO') {
    cuentaOrigen = null;
    cuentaDestino = tx.cuentaDestino || tx.cuenta || null;
  } else if (tx.tipo === 'TRANSFERENCIA') {
    cuentaOrigen = tx.cuentaOrigen || null;
    cuentaDestino = tx.cuentaDestino || null;
  } else if (tx.tipo === 'AJUSTE') {
    cuentaOrigen = tx.cuentaOrigen || null;
    cuentaDestino = tx.cuentaDestino || null;
  }

  cuentaOrigen = cuentaOrigen && cuentaOrigen.trim() !== '' ? cuentaOrigen.trim() : null;
  cuentaDestino = cuentaDestino && cuentaDestino.trim() !== '' ? cuentaDestino.trim() : null;
  const cleanMonto = Math.max(1, Math.trunc(Math.round(Number(tx.monto) || 0)));

  const fullTx: Transaccion = {
    ...tx,
    user_id: currentUserId,
    monto: cleanMonto,
    cuentaOrigen: cuentaOrigen ?? undefined,
    cuentaDestino: cuentaDestino ?? undefined,
  };

  // 1. Aplicar optimista local de inmediato
  applyOptimisticTransaction(fullTx);

  // 2. Serializar inserción online pasando por runOnlineMutation bajo el lock de la cola
  const res = await runOnlineMutation('insert', fullTx);
  if (res.status === 'confirmed') {
    markTransactionSynced(tx.id, true);
  } else {
    markTransactionSynced(tx.id, false);
    if (res.reason) {
      dispatchSupabaseSyncError(res.reason);
    }
  }
}


// ── Helper para Escrituras Online Serializadas con la Cola ──────────────────

export type OnlineMutationResult =
  | { status: 'confirmed'; mutationId?: string }
  | { status: 'pending'; mutationId: string; reason?: string };

/** Helper que serializa escrituras online sobre entidades (insert, update, delete) bajo el lock de la cola */
async function runOnlineMutation(
  op: 'insert' | 'update' | 'delete',
  entityOrId: Transaccion | string | number,
  patch?: Partial<Transaccion>
): Promise<OnlineMutationResult> {
  const isInsert = op === 'insert';
  const strId = isInsert ? String((entityOrId as Transaccion).id) : String(entityOrId);
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session;
  if (!session || !session.user?.id) {
    const errMsg = '42501: Rechazado: no se puede ejecutar mutación online sin sesión autenticada';
    dispatchSupabaseSyncError(errMsg);
    throw new Error(errMsg);
  }
  const currentUserId = session.user.id;

  const assignedMutationId = generateUuid();

  const SHORT_LOCK_TIMEOUT_MS = 2500;

  try {
    return await withQueueLock(async (lockSignal: AbortSignal) => {
      // 1. Dentro del lock, leer mutaciones activas de este dueño
      const userQueue = await getQueuedMutationsUnlocked(currentUserId);
      const entityMutations = userQueue.filter(
        m => (m.op === 'insert' ? String(m.tx.id) : String(m.id)) === strId
      );

      if (op === 'insert') {
        const tx = entityOrId as Transaccion;

        // a. Si hay un insert pendiente con el mismo id y distinto mutationId:
        // no encolar segundo insert; devolver error de conflicto claro
        const pendingInsert = entityMutations.find(m => m.op === 'insert');
        if (pendingInsert && pendingInsert.mutationId !== assignedMutationId) {
          throw new Error(
            `Conflicto: la transacción ${strId} ya está pendiente de creación en cola (mutationId: ${pendingInsert.mutationId})`
          );
        }

        // b. Si hay un delete o update pendiente para ese id:
        // encolar el insert DETRÁS (con ownerUserId y mutationId propios) y devolver "pendiente". No enviar online.
        const hasPendingDeleteOrUpdate = entityMutations.some(m => m.op === 'delete' || m.op === 'update');
        if (hasPendingDeleteOrUpdate) {
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'insert',
            tx: { ...tx, sincronizado: false },
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: 'Inserción encolada tras operaciones previas (delete/update) pendientes para esta entidad',
          };
        }

        // c. Si no hay pendientes: llamar a insertRemote y retirar solo con confirmación explícita
        try {
          const res = await insertRemote(tx, lockSignal, assignedMutationId, currentUserId);
          if (res && res.confirmed) {
            return { status: 'confirmed', mutationId: assignedMutationId };
          }

          // No confirmado o con conflicto devuelto por verificación
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'insert',
            tx: { ...tx, user_id: currentUserId, sincronizado: false },
            status: res?.conflict ? 'conflict' : 'pending',
            conflictReason: res?.reason,
          });
          if (res?.reason) {
            dispatchSupabaseSyncError(res.reason);
          }
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: res?.reason || 'Inserción remota no confirmada explícitamente',
          };
        } catch (remoteErr: any) {
          dispatchSupabaseSyncError(remoteErr);
          // Si el lease se pierde durante la petición online (signal abortado), tratar el resultado como incierto:
          // encolar la operación con su mutationId. El replay es seguro por idempotencia (client_mutation_id).
          console.warn(`Error o aborto en inserción online (${strId}), encolando:`, remoteErr);
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'insert',
            tx: { ...tx, user_id: currentUserId, sincronizado: false },
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: remoteErr?.message || 'Error de red o aborto durante inserción online',
          };
        }
      } else if (op === 'update') {
        const hasPending = entityMutations.length > 0;
        if (hasPending) {
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'update',
            id: strId,
            patch: patch || {},
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: 'Operación encolada porque existen mutaciones previas pendientes para esta entidad',
          };
        }

        try {
          const payload = formatUpdatePayload(patch || {});
          let updateQuery = supabase
            .from('transacciones')
            .update(payload)
            .eq('id', strId)
            .eq('user_id', currentUserId)
            .select('id,user_id');

          if (lockSignal) {
            updateQuery = updateQuery.abortSignal(lockSignal);
          }

          const { data, error } = await updateQuery;
          if (error) {
            dispatchSupabaseSyncError(error);
            throw error;
          }

          if (!data || data.length === 0) {
            await enqueueMutationUnlocked({
              mutationId: assignedMutationId,
              ownerUserId: currentUserId,
              op: 'update',
              id: strId,
              patch: patch || {},
              status: 'conflict',
              conflictReason: 'Update online devolvió 0 filas (fila no encontrada o bloqueo RLS)',
            });
            return {
              status: 'pending',
              mutationId: assignedMutationId,
              reason: 'Update no afectó filas en servidor; guardado en cola como pendiente',
            };
          }

          if (String(data[0].user_id) !== String(currentUserId)) {
            await enqueueMutationUnlocked({
              mutationId: assignedMutationId,
              ownerUserId: currentUserId,
              op: 'update',
              id: strId,
              patch: patch || {},
              status: 'conflict',
              conflictReason: `Mismatch de user_id devuelto (${data[0].user_id}) vs dueño (${currentUserId})`,
            });
            return {
              status: 'pending',
              mutationId: assignedMutationId,
              reason: 'Conflicto de usuario en respuesta de actualización remota',
            };
          }

          return { status: 'confirmed', mutationId: assignedMutationId };
        } catch (remoteErr: any) {
          dispatchSupabaseSyncError(remoteErr);
          console.warn(`Error en envío online de update (${strId}), encolando:`, remoteErr);
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'update',
            id: strId,
            patch: patch || {},
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: remoteErr?.message || 'Error de red o backend al ejecutar mutación online',
          };
        }
      } else {
        // op === 'delete'
        const hasPending = entityMutations.length > 0;
        if (hasPending) {
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'delete',
            id: strId,
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: 'Operación encolada porque existen mutaciones previas pendientes para esta entidad',
          };
        }

        try {
          let deleteQuery = supabase
            .from('transacciones')
            .delete()
            .eq('id', strId)
            .eq('user_id', currentUserId)
            .select('id');

          if (lockSignal) {
            deleteQuery = deleteQuery.abortSignal(lockSignal);
          }

          const { data, error } = await deleteQuery;
          if (error) {
            dispatchSupabaseSyncError(error);
            throw error;
          }

          if (!data || data.length === 0) {
            await enqueueMutationUnlocked({
              mutationId: assignedMutationId,
              ownerUserId: currentUserId,
              op: 'delete',
              id: strId,
              status: 'conflict',
              conflictReason: 'Delete online devolvió 0 filas (fila no encontrada o bloqueo RLS)',
            });
            return {
              status: 'pending',
              mutationId: assignedMutationId,
              reason: 'Delete no afectó filas en servidor; guardado en cola como pendiente',
            };
          }

          return { status: 'confirmed', mutationId: assignedMutationId };
        } catch (remoteErr: any) {
          dispatchSupabaseSyncError(remoteErr);
          console.warn(`Error en envío online de delete (${strId}), encolando:`, remoteErr);
          await enqueueMutationUnlocked({
            mutationId: assignedMutationId,
            ownerUserId: currentUserId,
            op: 'delete',
            id: strId,
          });
          return {
            status: 'pending',
            mutationId: assignedMutationId,
            reason: remoteErr?.message || 'Error de red o backend al ejecutar mutación online',
          };
        }
      }
    }, SHORT_LOCK_TIMEOUT_MS);
  } catch (lockErr: any) {
    // Si no se obtuvo el lock a tiempo: NUNCA enviar online sin lock.
    console.warn(`Timeout de lock en runOnlineMutation (${op} ${strId}), encolando:`, lockErr);
    if (op === 'insert') {
      await enqueueMutation({
        mutationId: assignedMutationId,
        ownerUserId: currentUserId,
        op: 'insert',
        tx: { ...(entityOrId as Transaccion), sincronizado: false },
      });
    } else {
      await enqueueMutation({
        mutationId: assignedMutationId,
        ownerUserId: currentUserId,
        op,
        id: strId,
        patch: op === 'update' ? patch : undefined,
      } as QueuedMutationInput);
    }

    return {
      status: 'pending',
      mutationId: assignedMutationId,
      reason: 'No se obtuvo el lock a tiempo; guardado en cola para sincronización posterior',
    };
  }
}

// ── Eliminación de Transacción con Contingencia Offline ───────────────────────

export async function deleteTransaction(id: number | string): Promise<boolean> {
  const strId = String(id);
  const list = getTransacciones();
  const tx = list.find(t => String(t.id) === strId);

  if (tx) {
    let current: AppData = { ...DEFAULT_APPDATA };
    try {
      const raw = localStorage.getItem(APPDATA_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
        if (parsed?.data) current = parsed.data;
      }
    } catch {
      /* ignore */
    }

    const saldos = { ...DEFAULT_SALDOS, ...(current.saldos || {}) };
    const gastadoPorSubcat = { ...(current.gastadoPorSubcat || {}) };
    const gastadoPorMacro = { ...(current.gastadoPorMacro || {}) };
    const kpis = { ...(current.kpis || { ingresos: 0, gastos: 0, balance: 0, tasaAhorro: 0, saldoRemunerados: 0, balanceDisponible: 0 }) };

    const monto = sanitizeAmount(tx.monto);
    const subcatNombre = tx.subcategoria || tx.sub || '';
    const macroNombre = tx.categoria || tx.macro || '';
    const cuentaNombre = tx.cuenta || tx.cuentaOrigen || '';
    const cuentaDestino = tx.cuentaDestino || '';

    if (tx.tipo === 'GASTO') {
      if (cuentaNombre) saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) + monto;
      if (subcatNombre) gastadoPorSubcat[subcatNombre] = Math.max(0, (gastadoPorSubcat[subcatNombre] ?? 0) - monto);
      if (macroNombre) gastadoPorMacro[macroNombre] = Math.max(0, (gastadoPorMacro[macroNombre] ?? 0) - monto);
      kpis.gastos = Math.max(0, (kpis.gastos ?? 0) - monto);
    } else if (tx.tipo === 'INGRESO') {
      if (cuentaNombre) saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) - monto;
      kpis.ingresos = Math.max(0, (kpis.ingresos ?? 0) - monto);
    } else if (tx.tipo === 'TRANSFERENCIA') {
      if (cuentaNombre) saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) + monto;
      if (cuentaDestino) saldos[cuentaDestino] = (saldos[cuentaDestino] ?? 0) - monto;
    }

    kpis.balance = (kpis.ingresos ?? 0) - (kpis.gastos ?? 0);
    kpis.tasaAhorro = kpis.ingresos > 0 ? (kpis.balance / kpis.ingresos) * 100 : 0;

    const updatedData: AppData = {
      ...current,
      saldos,
      gastadoPorSubcat,
      gastadoPorMacro,
      kpis,
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(APPDATA_CACHE_KEY, JSON.stringify({ timestamp: updatedData.timestamp, data: updatedData }));
    } catch {
      /* ignore */
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: updatedData }));
      window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedData.saldos }));
    }
  }

  const remainingTxs = list.filter(t => String(t.id) !== strId);
  saveTransacciones(remainingTxs);

  // Ejecución serializada con la cola bajo lock
  const res = await runOnlineMutation('delete', strId);
  return res.status === 'confirmed';
}


// ── Actualización de Transacción con Contingencia Offline ─────────────────────

function formatUpdatePayload(updatedData: Partial<Transaccion>): Record<string, any> {
  const cuenta = updatedData.cuenta ? updatedData.cuenta.trim() : '';
  const macroCategoria = updatedData.macroCategoria || updatedData.categoria || updatedData.macro || '';
  const subcategoria = updatedData.subcategoria || updatedData.sub || '';
  const detalle = updatedData.comentario !== undefined ? updatedData.comentario : (updatedData.detalle ?? '');

  let cuentaOrigen: string | null = null;
  let cuentaDestino: string | null = null;

  if (updatedData.tipo === 'GASTO') {
    cuentaOrigen = cuenta || null;
    cuentaDestino = null;
  } else if (updatedData.tipo === 'INGRESO') {
    cuentaOrigen = null;
    cuentaDestino = cuenta || null;
  } else {
    cuentaOrigen = updatedData.cuentaOrigen && updatedData.cuentaOrigen.trim() !== '' ? updatedData.cuentaOrigen.trim() : null;
    cuentaDestino = updatedData.cuentaDestino && updatedData.cuentaDestino.trim() !== '' ? updatedData.cuentaDestino.trim() : null;
  }

  const payload: Record<string, any> = {};

  if (updatedData.monto !== undefined) {
    payload.monto = Math.max(1, Math.trunc(Math.round(Number(updatedData.monto) || 0)));
  }
  if (macroCategoria) payload.macro_categoria = macroCategoria.trim();
  if (subcategoria) payload.subcategoria = subcategoria.trim();
  if (cuenta) payload.cuenta = cuenta;
  if (cuentaOrigen !== undefined) payload.cuenta_origen = cuentaOrigen && cuentaOrigen.trim() !== '' ? cuentaOrigen.trim() : null;
  if (cuentaDestino !== undefined) payload.cuenta_destino = cuentaDestino && cuentaDestino.trim() !== '' ? cuentaDestino.trim() : null;
  if (detalle !== undefined) payload.detalle = detalle;
  if (updatedData.tipo) payload.tipo = updatedData.tipo;
  if (updatedData.fecha) {
    payload.fecha = updatedData.fecha;
    payload.ciclo = getPayrollCycleId(updatedData.fecha);
  }

  return payload;
}

export async function updateTransaction(
  id: string | number,
  updatedData: Partial<Transaccion>
): Promise<boolean> {
  const strId = String(id);

  // Actualización optimista local en memoria
  const list = getTransacciones();
  const updatedList = list.map(t => {
    if (String(t.id) === strId) {
      return {
        ...t,
        ...updatedData,
        monto: updatedData.monto !== undefined ? Math.max(1, Math.round(sanitizeAmount(updatedData.monto))) : t.monto,
      };
    }
    return t;
  });
  saveTransacciones(updatedList);

  // Ejecución serializada con la cola bajo lock
  const res = await runOnlineMutation('update', strId, updatedData);
  if (res.status === 'confirmed' || res.status === 'pending') {
    await fetchAppData(true);
    return true;
  }
  return false;
}


// ── Motor de Gastos Recurrentes ───────────────────────────────────────────────

let isProcessingRecurring = false;

export async function processRecurringExpenses(): Promise<number> {
  if (isProcessingRecurring) {
    return 0;
  }
  isProcessingRecurring = true;

  try {
    // 1. Intentar RPC atómica en PostgreSQL
    try {
      const { data: rpcCount, error: rpcErr } = await supabase.rpc('process_recurring_expenses_rpc');
      if (!rpcErr && typeof rpcCount === 'number') {
        return rpcCount;
      }
    } catch {
      // RPC no disponible en backend, usar fallback cliente
    }

    // 2. Fallback Cliente en zona horaria America/Bogota con ciclo canónico 'YYYY-MM'
    const cycleId = getPayrollCycleId();
    const cycleLabel = getCycleLabel();

    const { data: recurrentes, error } = await supabase
      .from('gastos_recurrentes')
      .select('*')
      .eq('activo', true);

    if (error || !recurrentes || recurrentes.length === 0) {
      return 0;
    }

    const { year, month, day: diaActual } = getBogotaDateParts();
    const daysInMonth = getDaysInBogotaMonth(year, month);

    let executedCount = 0;

    for (const r of recurrentes) {
      const diaPago = Number(r.dia_pago) || 1;
      const diaPagoEfectivo = Math.min(diaPago, daysInMonth);
      const ultimoCiclo = r.ultimo_ciclo_ejecutado;

      if (diaActual >= diaPagoEfectivo && ultimoCiclo !== cycleId && ultimoCiclo !== cycleLabel) {
        const deterministicId = `REC_${r.id}_${cycleId}`;

        const txPayload: Transaccion = {
          id: deterministicId,
          fecha: new Date().toISOString(),
          tipo: 'GASTO',
          monto: sanitizeAmount(r.monto),
          macroCategoria: r.macro_categoria || '',
          categoria: r.macro_categoria || '',
          macro: r.macro_categoria || '',
          subcategoria: r.subcategoria || '',
          sub: r.subcategoria || '',
          cuenta: r.cuenta || '',
          cuentaOrigen: r.cuenta || '',
          cuentaDestino: '',
          detalle: `Débito automático programado: ${r.nombre}`,
          comentario: `Débito automático programado: ${r.nombre}`,
          sincronizado: false,
        };

        const res = await runOnlineMutation('insert', txPayload);

        if (res.status === 'confirmed') {
          executedCount++;
          // Sellar con ID canónico en Supabase
          await supabase
            .from('gastos_recurrentes')
            .update({ ultimo_ciclo_ejecutado: cycleId })
            .eq('id', r.id);
        } else {
          console.warn(`Gasto recurrente ${r.nombre} encolado o retenido (${res.reason}); no se sella ciclo aún.`);
        }
      }
    }

    return executedCount;
  } catch (err) {
    console.warn('Advertencia en processRecurringExpenses:', err);
    return 0;
  } finally {
    isProcessingRecurring = false;
  }
}

export async function getGastosRecurrentes(): Promise<GastoRecurrente[]> {
  try {
    const { data, error } = await supabase
      .from('gastos_recurrentes')
      .select('*')
      .order('dia_pago', { ascending: true });

    if (error || !data) return [];

    return data.map((r: any) => ({
      id: r.id,
      nombre: r.nombre,
      monto: sanitizeAmount(r.monto),
      macroCategoria: r.macro_categoria || '',
      subcategoria: r.subcategoria || '',
      cuenta: r.cuenta || '',
      diaPago: Number(r.dia_pago) || 1,
      activo: r.activo !== false,
      ultimoCicloEjecutado: r.ultimo_ciclo_ejecutado || undefined,
    }));
  } catch (err) {
    console.warn('Error obteniendo gastos recurrentes:', err);
    return [];
  }
}

export async function saveGastoRecurrente(gasto: {
  id?: string;
  nombre: string;
  monto: number;
  macroCategoria: string;
  subcategoria: string;
  cuenta: string;
  diaPago: number;
  activo?: boolean;
}): Promise<boolean> {
  try {
    const id = gasto.id || `rec-${crypto.randomUUID()}`;
    const payload = {
      id,
      nombre: gasto.nombre,
      monto: sanitizeAmount(gasto.monto),
      macro_categoria: gasto.macroCategoria,
      subcategoria: gasto.subcategoria,
      cuenta: gasto.cuenta,
      dia_pago: gasto.diaPago,
      activo: gasto.activo !== false,
    };

    const { error } = await supabase
      .from('gastos_recurrentes')
      .upsert([payload]);

    if (error) throw error;
    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Error guardando gasto recurrente:', err);
    throw err;
  }
}

export async function toggleGastoRecurrente(id: string, activo: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('gastos_recurrentes')
      .update({ activo })
      .eq('id', id);

    if (error) throw error;
    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Error alternando estado de gasto recurrente:', err);
    throw err;
  }
}

export async function deleteGastoRecurrente(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('gastos_recurrentes')
      .delete()
      .eq('id', id);

    if (error) throw error;
    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Error eliminando gasto recurrente:', err);
    throw err;
  }
}


export async function createCartera(cartera: Omit<Cartera, 'id' | 'saldo_actual'>): Promise<boolean> {
  try {
    const currentUserId = (await resolveCurrentUserId()) || (await supabase.auth.getUser()).data.user?.id;
    if (!currentUserId) {
      throw new Error('No se puede crear cartera sin sesión autenticada');
    }

    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10);
    const id = `wallet_${uuid}`;

    const { data: existingCarteras } = await supabase.from('carteras').select('id');
    const orden = cartera.orden ?? ((existingCarteras?.length || 0) + 1);

    const saldoInicial = Math.trunc(Number(cartera.saldo_inicial ?? cartera.saldo ?? 0));
    const saldoActual = saldoInicial;

    const { error } = await supabase.from('carteras').insert({
      id,
      user_id: currentUserId,
      nombre: cartera.nombre.trim(),
      tipo: cartera.tipo.toLowerCase(),
      saldo_inicial: saldoInicial,
      saldo_actual: saldoActual,
      icono: cartera.icono || (cartera.tipo.toLowerCase() === 'credito' ? '💳' : '🏦'),
      orden,
      permite_gasto: cartera.permite_gasto !== false,
      activa: cartera.activa !== false,
      dia_corte: cartera.dia_corte != null ? Number(cartera.dia_corte) : null,
      dia_pago: cartera.dia_pago != null ? Number(cartera.dia_pago) : null,
      limite_credito: cartera.limite_credito != null ? Math.trunc(Number(cartera.limite_credito)) : null,
    });

    if (error) {
      console.error('Error insertando cartera en Supabase:', error);
      throw error;
    }

    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Error en createCartera:', err);
    throw err;
  }
}

export async function updateCartera(id: string, patch: Partial<Cartera>): Promise<boolean> {
  try {
    const currentUserId = (await resolveCurrentUserId()) || (await supabase.auth.getUser()).data.user?.id;
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (patch.nombre !== undefined) updateData.nombre = patch.nombre.trim();
    if (patch.tipo !== undefined) updateData.tipo = patch.tipo.toLowerCase();
    if (patch.icono !== undefined) updateData.icono = patch.icono;
    if (patch.permite_gasto !== undefined) updateData.permite_gasto = patch.permite_gasto;
    if (patch.orden !== undefined) updateData.orden = patch.orden;
    if (patch.dia_corte !== undefined) updateData.dia_corte = patch.dia_corte != null ? Number(patch.dia_corte) : null;
    if (patch.dia_pago !== undefined) updateData.dia_pago = patch.dia_pago != null ? Number(patch.dia_pago) : null;
    if (patch.limite_credito !== undefined) updateData.limite_credito = patch.limite_credito != null ? Math.trunc(Number(patch.limite_credito)) : null;
    if (patch.activa !== undefined) updateData.activa = patch.activa;
    if (patch.saldo_inicial !== undefined) updateData.saldo_inicial = Math.trunc(Number(patch.saldo_inicial));

    let query = supabase.from('carteras').update(updateData).eq('id', id);
    if (currentUserId) {
      query = query.eq('user_id', currentUserId);
    }

    const { error } = await query;
    if (error) {
      console.error('Error actualizando cartera en Supabase:', error);
      throw error;
    }

    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Error en updateCartera:', err);
    throw err;
  }
}

export async function checkCarteraHasTransactions(nombre: string): Promise<number> {
  const currentUserId = (await resolveCurrentUserId()) || (await supabase.auth.getUser()).data.user?.id;
  let origenQuery = supabase.from('transacciones').select('id', { count: 'exact', head: true }).eq('cuenta_origen', nombre);
  let destinoQuery = supabase.from('transacciones').select('id', { count: 'exact', head: true }).eq('cuenta_destino', nombre);
  let cuentaQuery = supabase.from('transacciones').select('id', { count: 'exact', head: true }).eq('cuenta', nombre);

  if (currentUserId) {
    origenQuery = origenQuery.eq('user_id', currentUserId);
    destinoQuery = destinoQuery.eq('user_id', currentUserId);
    cuentaQuery = cuentaQuery.eq('user_id', currentUserId);
  }

  const [origenRes, destinoRes, cuentaRes] = await Promise.all([origenQuery, destinoQuery, cuentaQuery]);
  return (origenRes.count || 0) + (destinoRes.count || 0) + (cuentaRes.count || 0);
}

export async function archiveOrDeleteCartera(id: string, nombre: string): Promise<{ action: 'archived' | 'deleted' }> {
  try {
    const currentUserId = (await resolveCurrentUserId()) || (await supabase.auth.getUser()).data.user?.id;
    const txCount = await checkCarteraHasTransactions(nombre);

    if (txCount > 0) {
      let query = supabase.from('carteras').update({ activa: false, updated_at: new Date().toISOString() }).eq('id', id);
      if (currentUserId) {
        query = query.eq('user_id', currentUserId);
      }
      const { error } = await query;
      if (error) throw error;
      await fetchAppData(true);
      return { action: 'archived' };
    } else {
      let query = supabase.from('carteras').delete().eq('id', id);
      if (currentUserId) {
        query = query.eq('user_id', currentUserId);
      }
      const { error } = await query;
      if (error) throw error;
      await fetchAppData(true);
      return { action: 'deleted' };
    }
  } catch (err) {
    console.error('Error archivando o eliminando cartera:', err);
    throw err;
  }
}

// ── Sincronización Principal y Consulta de AppData ────────────────────────────

let currentFetchGeneration = 0;

export async function fetchAppData(forceRefresh = false): Promise<AppData> {
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(APPDATA_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
        if (Date.now() - parsed.timestamp < APPDATA_CACHE_TTL) {
          return { ...parsed.data, fromCache: true, timestamp: parsed.timestamp };
        }
      }
    } catch {
      /* ignore */
    }
  }

  const thisGen = ++currentFetchGeneration;

  try {
    await processRecurringExpenses().catch(() => {});

    const [carterasRes, catalogoRes, txsRes, recurrentesRes] = await Promise.all([
      supabase.from('carteras').select('*').order('orden', { ascending: true, nullsFirst: false }),
      supabase.from('catalogo_categorias').select('*').eq('activo', true),
      supabase.from('transacciones').select('*').order('fecha', { ascending: false }),
      supabase.from('gastos_recurrentes').select('*').order('dia_pago', { ascending: true }),
    ]);

    // Validación estricta de respuestas: Si alguna falla, lanzar y caer a caché
    if (carterasRes.error) throw carterasRes.error;
    if (catalogoRes.error) throw catalogoRes.error;
    if (txsRes.error) throw txsRes.error;
    if (recurrentesRes.error) throw recurrentesRes.error;

    // Si otra petición inició después de esta, descartar la actual para evitar condiciones de carrera
    if (thisGen !== currentFetchGeneration) {
      try {
        const raw = localStorage.getItem(APPDATA_CACHE_KEY);
        if (raw) return (JSON.parse(raw) as { data: AppData }).data;
      } catch {
        /* ignore */
      }
    }

    const carterasData = carterasRes.data || [];
    const catalogoData = catalogoRes.data || [];
    const transaccionesData = txsRes.data || [];
    const recurrentesData = recurrentesRes.data || [];

    // CORRECCIÓN D: Si carterasData.length === 0, lanzar error para impedir sobrescribir caché con ceros
    if (carterasData.length === 0) {
      throw new Error('Snapshot inválido: cero carteras retornadas');
    }

    const gastosRecurrentes: GastoRecurrente[] = recurrentesData.map((r: any) => ({
      id: r.id,
      nombre: r.nombre,
      monto: sanitizeAmount(r.monto),
      macroCategoria: r.macro_categoria || '',
      subcategoria: r.subcategoria || '',
      cuenta: r.cuenta || '',
      diaPago: Number(r.dia_pago) || 1,
      activo: r.activo !== false,
      ultimoCicloEjecutado: r.ultimo_ciclo_ejecutado || undefined,
    }));

    const updatedSaldos: Record<string, number> = { ...DEFAULT_SALDOS };
    let saldoRemunerados = 0;
    let balanceDisponible = 0;

    for (const c of carterasData) {
      // CORRECCIÓN D: Saldo autoritativo estricto calculado por trigger en Supabase
      const saldoAutoritativo = Math.trunc(Number(c.saldo_actual));
      if (!Number.isFinite(saldoAutoritativo)) {
        throw new Error(`Saldo autoritativo inválido para cartera ${c.nombre}: ${c.saldo_actual}`);
      }

      updatedSaldos[c.nombre] = saldoAutoritativo;

      const tipoLower = (c.tipo || '').toLowerCase();
      const nombreLower = (c.nombre || '').toLowerCase();

      if (tipoLower.includes('remunerado') || nombreLower.includes('bolsillo')) {
        saldoRemunerados += saldoAutoritativo;
      }

      if (
        tipoLower.includes('débito') ||
        tipoLower.includes('debito') ||
        tipoLower.includes('efectivo') ||
        tipoLower.includes('billetera') ||
        tipoLower.includes('líquido') ||
        tipoLower.includes('liquido')
      ) {
        balanceDisponible += saldoAutoritativo;
      }
    }

    const remoteTxs: Transaccion[] = transaccionesData.map((row: any) => ({
      id: row.id ?? crypto.randomUUID(),
      tipo: row.tipo,
      monto: sanitizeAmount(row.monto),
      categoria: row.macro_categoria || '',
      macroCategoria: row.macro_categoria || '',
      macro: row.macro_categoria || '',
      subcategoria: row.subcategoria || '',
      sub: row.subcategoria || '',
      cuenta: row.cuenta || row.cuenta_origen || '',
      cuentaOrigen: row.cuenta_origen || '',
      cuentaDestino: row.cuenta_destino || '',
      detalle: row.detalle || '',
      comentario: row.detalle || '',
      fecha: row.fecha || row.created_at || new Date().toISOString(),
      sincronizado: true,
    }));

    const currentUserId = await resolveCurrentUserId();
    const queue = await getQueuedMutations(currentUserId || undefined);
    const queueIds = new Set(
      queue
        .filter(q => q.op === 'insert' && q.status !== 'orphan')
        .map(q => (q as { op: 'insert'; tx: Transaccion }).tx.id)
        .map(String)
    );
    const pendingLocalTxs = getTransacciones().filter(t => queueIds.has(String(t.id)));

    const mergedMap = new Map<number | string, Transaccion>();
    for (const t of remoteTxs) {
      mergedMap.set(t.id, t);
    }
    for (const t of pendingLocalTxs) {
      if (!mergedMap.has(t.id)) {
        mergedMap.set(t.id, t);
      }
    }
    const mergedList = Array.from(mergedMap.values()).sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );
    saveTransacciones(mergedList);

    const cicloTxs = mergedList.filter(t => isDateInCurrentCycle(t.fecha));

    let totalIngresos = 0;
    let totalGastos = 0;

    for (const tx of cicloTxs) {
      const monto = sanitizeAmount(tx.monto);
      if (tx.tipo === 'GASTO') {
        totalGastos += monto;
      } else if (tx.tipo === 'INGRESO') {
        totalIngresos += monto;
      }
    }

    const presupuestos: PresupuestoItem[] = catalogoData.map((catRow: any) => {
      const macro = (catRow.macro_categoria || '').trim();
      const sub = (catRow.subcategoria || '').trim();
      const presupuesto = sanitizeAmount(catRow.presupuesto_base);

      const matchingTxs = cicloTxs.filter(t => {
        if (t.tipo !== 'GASTO') return false;
        const txSub = (t.subcategoria || t.sub || '').trim().toLowerCase();
        const pSub = sub.toLowerCase();
        if (txSub === pSub) return true;
        if (pSub === 'streaming y apps digitales' && (txSub.includes('streaming') || txSub.includes('apps digitales'))) {
          return true;
        }
        return false;
      });

      const gastado = matchingTxs.reduce((sum, t) => sum + sanitizeAmount(t.monto), 0);
      const disponible = presupuesto - gastado;
      const pct = presupuesto > 0 ? (gastado / presupuesto) * 100 : 0;
      return {
        id: catRow.id ? String(catRow.id) : undefined,
        macro,
        sub,
        presupuesto,
        gastado,
        disponible,
        pct,
      };
    });

    const gastadoPorSubcat: Record<string, number> = {};
    const gastadoPorMacro: Record<string, number> = {};

    for (const p of presupuestos) {
      gastadoPorSubcat[p.sub] = p.gastado || 0;
      gastadoPorMacro[p.macro] = (gastadoPorMacro[p.macro] ?? 0) + (p.gastado || 0);
    }

    for (const tx of cicloTxs) {
      if (tx.tipo === 'GASTO') {
        const sub = (tx.subcategoria || tx.sub || '').trim();
        const macro = (tx.categoria || tx.macro || '').trim();
        const yaContabilizado = presupuestos.some(p => {
          const pSub = p.sub.trim().toLowerCase();
          const txSub = sub.toLowerCase();
          return txSub === pSub || (pSub === 'streaming y apps digitales' && (txSub.includes('streaming') || txSub.includes('apps digitales')));
        });
        if (!yaContabilizado && sub) {
          gastadoPorSubcat[sub] = (gastadoPorSubcat[sub] ?? 0) + sanitizeAmount(tx.monto);
          if (macro) {
            gastadoPorMacro[macro] = (gastadoPorMacro[macro] ?? 0) + sanitizeAmount(tx.monto);
          }
        }
      }
    }

    const balance = totalIngresos - totalGastos;
    const tasaAhorro = totalIngresos > 0 ? (balance / totalIngresos) * 100 : 0;

    const carterasMapped: CarteraInfo[] = carterasData.map((c: any) => {
      const saldoEfectivo = updatedSaldos[c.nombre] ?? (Number(c.saldo_inicial) || 0);

      return {
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        saldo_inicial: sanitizeAmount(c.saldo_inicial),
        saldo_actual: saldoEfectivo,
        saldo: saldoEfectivo,
        saldoActual: saldoEfectivo,
        icono: c.icono || '💳',
        permite_gasto: c.permite_gasto !== false,
        orden: c.orden != null ? Number(c.orden) : 99,
        activa: c.activa !== false,
        dia_corte: c.dia_corte != null ? Number(c.dia_corte) : null,
        dia_pago: c.dia_pago != null ? Number(c.dia_pago) : null,
        limite_credito: c.limite_credito != null ? Math.trunc(Number(c.limite_credito)) : null,
      };
    }).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99));

    const result: AppData = {
      saldos: updatedSaldos,
      gastadoPorSubcat,
      gastadoPorMacro,
      kpis: {
        ingresos: totalIngresos,
        gastos: totalGastos,
        balance,
        tasaAhorro,
        saldoRemunerados,
        balanceDisponible,
      },
      historico: [
        { ciclo: getCycleLabel(), gastos: totalGastos, ingresos: totalIngresos },
      ],
      fromCache: false,
      timestamp: Date.now(),
      tasas: {
        lulo: 9.25,
        mazda: 21.35,
      },
      transacciones: mergedList,
      presupuestos,
      carteras: carterasMapped,
      gastosRecurrentes,
    };

    // Almacenar en caché solo si la generación sigue siendo la más reciente
    if (thisGen === currentFetchGeneration) {
      try {
        localStorage.setItem(APPDATA_CACHE_KEY, JSON.stringify({ timestamp: result.timestamp, data: result }));
      } catch {
        /* ignore */
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: result }));
        window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: result.saldos }));
        window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: result.transacciones }));
      }
    }

    return result;
  } catch (err) {
    console.warn('Error sincronizando con Supabase, usando caché íntegra:', err);
  }

  // Fallback limpio a la última caché disponible sin destruirla ni sobrescribir con ceros
  try {
    const raw = localStorage.getItem(APPDATA_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
      if (parsed?.data && Object.keys(parsed.data.saldos || {}).length > 0) {
        return { ...parsed.data, fromCache: true, timestamp: parsed.timestamp };
      }
    }
  } catch {
    /* ignore */
  }

  return { ...DEFAULT_APPDATA };
}

export interface SaldosResponse {
  saldos: Record<string, number>;
  fromCache: boolean;
  timestamp: number;
}

export async function getSaldos(forceRefresh = false): Promise<SaldosResponse> {
  const data = await fetchAppData(forceRefresh);
  return {
    saldos: data.saldos,
    fromCache: data.fromCache,
    timestamp: data.timestamp,
  };
}

// ── Sincronización de Cola Offline (Sin duplicar saldos) ──────────────────────

function isLeaseLostOrAbortError(err: any, signal?: AbortSignal): boolean {
  if (!err) return false;
  if (err instanceof LeaseLostError || err.name === 'LeaseLostError') return true;
  if (err.name === 'AbortError' || err.message?.includes('aborted') || err.message?.includes('AbortError')) {
    return true;
  }
  if (signal?.aborted) return true;
  return false;
}

function isNetworkOrAbortError(err: any, signal?: AbortSignal): boolean {
  if (!err) return false;
  if (isLeaseLostOrAbortError(err, signal)) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  const msg = String(err.message || '').toLowerCase();
  const name = String(err.name || '').toLowerCase();
  const code = String(err.code || '');

  if (name === 'aborterror' || name === 'timeouterror') return true;
  if (msg.includes('aborted') || msg.includes('timeout') || msg.includes('timed out')) return true;
  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch error') ||
    msg.includes('connection')
  ) {
    return true;
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') return true;
  if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) return true;

  return false;
}

export interface SyncOptions {
  isManualOrStartup?: boolean;
}

export async function syncOfflineQueue(
  signal?: AbortSignal,
  options?: SyncOptions
): Promise<{ synced: number; remaining: number }> {
  try {
    return await withQueueLock(async (lockSignal: AbortSignal) => {
      const getActiveSignal = (): AbortSignal => {
        if (!signal) return lockSignal;
        if (typeof AbortSignal.any === 'function') {
          return AbortSignal.any([signal, lockSignal]);
        }
        const controller = new AbortController();
        const onAbort = () => {
          controller.abort(signal.aborted ? signal.reason : lockSignal.reason);
        };
        if (signal.aborted || lockSignal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
          lockSignal.addEventListener('abort', onAbort, { once: true });
        }
        return controller.signal;
      };

      const effectiveSignal = getActiveSignal();

      // 1. Obtener usuario de la sesión actual; si no hay sesión o no se puede resolver, no sincronizar nada
      const expectedUserId = await resolveCurrentUserId();
      if (!expectedUserId) {
        return { synced: 0, remaining: 0 };
      }

      // 2. Procesar SOLO mutaciones del usuario actual que no sean orphan
      const allRecords = await getQueuedMutationsUnlocked();
      const userQueue = allRecords.filter(m => m.ownerUserId === expectedUserId && m.status !== 'orphan');
      if (userQueue.length === 0) return { synced: 0, remaining: 0 };

      const processedIds: string[] = [];
      const blockedEntityIds = new Set<string>();
      const confirmedInsertEntityIds = new Set<string>();
      let synced = 0;

      for (const mut of userQueue) {
        if (effectiveSignal?.aborted) {
          throw effectiveSignal.reason || new LeaseLostError('Sincronización abortada por pérdida de lease o señal');
        }

        // Re-verificar identidad antes de CADA mutación/petición remota (sin red vía getSession)
        const { data: sessionCheck } = await supabase.auth.getSession();
        const activeUid = sessionCheck?.session?.user?.id;
        if (!activeUid || activeUid !== expectedUserId) {
          throw new SessionChangedError(`Sesión activa (${activeUid || 'ninguna'}) difiere del usuario esperado (${expectedUserId})`);
        }

        const entityId = mut.op === 'insert' ? String(mut.tx.id) : String(mut.id);

        // Si la entidad ya está bloqueada por error, conflicto o no confirmada previa en este lote:
        // NO procesar mutaciones posteriores de la misma entidad (quedan en la cola: insert, updates y delete)
        if (blockedEntityIds.has(entityId)) {
          continue;
        }

        // Si la mutación ya está en estado conflict y no es sincronización manual o startup, omitir para no reintentar en bucle
        if (mut.status === 'conflict' && !options?.isManualOrStartup) {
          blockedEntityIds.add(entityId);
          continue;
        }

        try {
          if (mut.op === 'insert') {
            const res = await insertRemote(mut.tx, effectiveSignal, mut.mutationId, mut.ownerUserId);
            if (res && res.confirmed) {
              markTransactionSynced(mut.tx.id, true);
              processedIds.push(mut.mutationId);
              confirmedInsertEntityIds.add(entityId);
              synced++;
            } else {
              blockedEntityIds.add(entityId);
              if (res?.conflict) {
                await markMutationConflictUnlocked(
                  mut.mutationId,
                  res.reason || `Conflicto en inserción de entidad ${entityId}`
                );
              }
              if (res?.reason) {
                dispatchSupabaseSyncError(res.reason);
              }
              console.warn('Inserción en cola no confirmada:', mut.mutationId, res?.reason);
            }
          } else if (mut.op === 'update') {
            const payload = formatUpdatePayload(mut.patch);
            let updateQuery = supabase
              .from('transacciones')
              .update(payload)
              .eq('id', entityId)
              .eq('user_id', mut.ownerUserId)
              .select('id,user_id');

            if (effectiveSignal) {
              updateQuery = updateQuery.abortSignal(effectiveSignal);
            }

            const { data: updatedRows, error: updateError } = await updateQuery;
            if (updateError) {
              dispatchSupabaseSyncError(updateError);
              const isRls = updateError.code === '42501' || String(updateError.message).toLowerCase().includes('row-level security');
              const isNonRecoverable = isRls || updateError.code === '42703' || updateError.code === '23514';
              if (isNonRecoverable) {
                const reason = `Update rechazado por el servidor (${updateError.code || '4xx'}): ${updateError.message}`;
                await markMutationConflictUnlocked(mut.mutationId, reason);
                blockedEntityIds.add(entityId);
                console.warn(reason);
                continue;
              }
              if (isNetworkOrAbortError(updateError, effectiveSignal)) {
                throw updateError;
              }
              blockedEntityIds.add(entityId);
              console.warn('Error en update de entidad:', entityId, updateError);
            } else if (!updatedRows || updatedRows.length === 0) {
              // Confirmación de filas afectadas: 0 filas -> conflicto, conservar en cola
              const reason = `Update devolvió 0 filas para entidad ${entityId} (registro inexistente o RLS bloqueado)`;
              dispatchSupabaseSyncError(reason);
              await markMutationConflictUnlocked(mut.mutationId, reason);
              blockedEntityIds.add(entityId);
            } else {
              const returnedRow = updatedRows[0];
              if (String(returnedRow.user_id) !== String(mut.ownerUserId)) {
                const reason = `Mismatch de user_id en update: devuelto (${returnedRow.user_id}) vs esperado (${mut.ownerUserId})`;
                dispatchSupabaseSyncError(reason);
                await markMutationConflictUnlocked(mut.mutationId, reason);
                blockedEntityIds.add(entityId);
              } else {
                processedIds.push(mut.mutationId);
                synced++;
              }
            }
          } else if (mut.op === 'delete') {
            let deleteQuery = supabase
              .from('transacciones')
              .delete()
              .eq('id', entityId)
              .eq('user_id', mut.ownerUserId)
              .select('id');

            if (effectiveSignal) {
              deleteQuery = deleteQuery.abortSignal(effectiveSignal);
            }

            const { data: deletedRows, error: deleteError } = await deleteQuery;
            if (deleteError) {
              dispatchSupabaseSyncError(deleteError);
              const isRls = deleteError.code === '42501' || String(deleteError.message).toLowerCase().includes('row-level security');
              const isNonRecoverable = isRls || deleteError.code === '42703' || deleteError.code === '23514';
              if (isNonRecoverable) {
                const reason = `Delete rechazado por el servidor (${deleteError.code || '4xx'}): ${deleteError.message}`;
                await markMutationConflictUnlocked(mut.mutationId, reason);
                blockedEntityIds.add(entityId);
                console.warn(reason);
                continue;
              }
              if (isNetworkOrAbortError(deleteError, effectiveSignal)) {
                throw deleteError;
              }
              blockedEntityIds.add(entityId);
              console.warn('Error en delete de entidad:', entityId, deleteError);
            } else {
              const rowsCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
              if (rowsCount > 0) {
                processedIds.push(mut.mutationId);
                synced++;
              } else {
                // 0 filas devueltas: solo éxito idempotente si el insert de esa entidad ya fue confirmado o no existe en la cola
                const hasInsertInQueue = userQueue.some(
                  m => m.op === 'insert' && String(m.tx.id) === entityId
                );
                const insertWasConfirmed = confirmedInsertEntityIds.has(entityId);
                const isIdempotentSuccess = !hasInsertInQueue || insertWasConfirmed;

                if (isIdempotentSuccess) {
                  processedIds.push(mut.mutationId);
                  synced++;
                } else {
                  const reason = `Delete devolvió 0 filas y el insert de la entidad ${entityId} no está confirmado en el servidor`;
                  dispatchSupabaseSyncError(reason);
                  await markMutationConflictUnlocked(mut.mutationId, reason);
                  blockedEntityIds.add(entityId);
                }
              }
            }
          }
        } catch (err: any) {
          if (err instanceof SessionChangedError || err?.name === 'SessionChangedError') {
            throw err;
          }
          if (isNetworkOrAbortError(err, effectiveSignal)) {
            // Detener el lote completo ante errores de red, timeout, abort o pérdida de lease
            throw err;
          }
          dispatchSupabaseSyncError(err);
          const isRls = err?.code === '42501' || String(err?.message).toLowerCase().includes('row-level security');
          const isNonRecoverable = isRls || err?.code === '42703' || err?.code === '23514' || (typeof err?.status === 'number' && err.status >= 400 && err.status < 500);
          if (isNonRecoverable) {
            const reason = `Operación rechazada por backend (${err?.code || err?.status || '4xx'}): ${err?.message || ''}`;
            await markMutationConflictUnlocked(mut.mutationId, reason);
            blockedEntityIds.add(entityId);
            console.warn(reason);
            continue;
          }
          // Error propio de la entidad: se bloquea la entidad pero se continúa con las demás
          blockedEntityIds.add(entityId);
          console.warn('Error propio de la entidad durante sincronización:', entityId, err);
        }
      }

      if (processedIds.length > 0) {
        await removeProcessedMutationsUnlocked(processedIds);
      }

      const remainingQueue = await getQueuedMutationsUnlocked();
      const userRemaining = remainingQueue.filter(
        m => m.ownerUserId === expectedUserId && m.status !== 'orphan' && m.status !== 'conflict'
      );

      return { synced, remaining: userRemaining.length };
    });
  } catch (err: any) {
    if (err instanceof SessionChangedError || err?.name === 'SessionChangedError') {
      // Salida silenciosa: la sesión cambió, las mutaciones de la cola quedan intactas
      const current = await getQueuedMutationsUnlocked().catch(() => []);
      return { synced: 0, remaining: current.length };
    }
    dispatchSupabaseSyncError(err);
    if (err?.code === '42501' || String(err?.message).toLowerCase().includes('row-level security')) {
      console.warn('Sincronización detenida por violación RLS (42501); lote retenido en cola:', err);
      const current = await getQueuedMutationsUnlocked().catch(() => []);
      return { synced: 0, remaining: current.length };
    }
    if (isLeaseLostOrAbortError(err, signal)) {
      const current = await getQueuedMutationsUnlocked().catch(() => []);
      return { synced: 0, remaining: current.length };
    }
    throw err;
  }
}
