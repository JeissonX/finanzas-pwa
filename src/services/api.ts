import { supabase } from './supabase';
import type { Transaccion, AppDataResponse, PresupuestoItem, CarteraInfo, GastoRecurrente, RunwayData, MatrizGastos } from '../types/finance';
import {
  isDateInCurrentCycle,
  getCycleLabel,
  getPayrollCycleId,
  getBogotaDateParts,
  getDaysInBogotaMonth,
} from '../utils/format';
import {
  getQueuedMutations,
  enqueueMutation,
  removeProcessedMutations,
  clearMutationQueue,
  withQueueLock,
  type QueuedMutation,
} from '../utils/offlineQueueDb';

export {
  getQueuedMutations,
  enqueueMutation,
  removeProcessedMutations,
  clearMutationQueue,
  withQueueLock,
};
export type { QueuedMutation };
export const getOfflineQueue = getQueuedMutations;

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
export function sanitizeAmount(m: any): number {
  const num = Number(m);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.trunc(Math.round(num));
  return Number.isSafeInteger(rounded) ? rounded : 0;
}

/** Compatibilidad hacia atrás con llamadas directas a enqueue(tx) */
export async function enqueue(txOrMut: Transaccion | QueuedMutation): Promise<void> {
  if ('op' in txOrMut) {
    await enqueueMutation(txOrMut);
  } else {
    await enqueueMutation({ op: 'insert', tx: txOrMut });
  }
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

export function saveTransacciones(txs: Transaccion[]): void {
  try {
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txs));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: txs }));
  }
}

export function markTransactionSynced(id: number | string, synced = true): void {
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

export function applyOptimisticTransaction(tx: Transaccion): AppData {
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

export async function insertRemote(tx: Transaccion): Promise<void> {
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

  const cleanMonto = sanitizeAmount(tx.monto);

  const payload = {
    id: String(tx.id),
    fecha: txDate,
    tipo: tx.tipo,
    monto: cleanMonto,
    macro_categoria: tx.macroCategoria || tx.categoria || tx.macro || '',
    subcategoria: tx.subcategoria || tx.sub || '',
    cuenta: cuentaPrincipal,
    cuenta_origen: cuentaOrigen,
    cuenta_destino: cuentaDestino,
    detalle: tx.comentario || tx.detalle || '',
    ciclo: canonicalCycle,
  };

  const { error } = await supabase.from('transacciones').insert([payload]);
  if (error) {
    // Si ya existe en PostgreSQL (error 23505), verificar coincidencia en monto y tipo antes de darlo por idempotente
    if (error.code === '23505') {
      const { data: remoteRow, error: fetchErr } = await supabase
        .from('transacciones')
        .select('monto, tipo')
        .eq('id', String(tx.id))
        .maybeSingle();

      if (fetchErr || !remoteRow) {
        throw error;
      }

      const remoteMonto = sanitizeAmount(remoteRow.monto);
      if (remoteMonto === cleanMonto && remoteRow.tipo === tx.tipo) {
        return;
      }

      throw new Error(
        `Discrepancia en colisión 23505 para transacción ${tx.id}: remoto (${remoteRow.tipo}, ${remoteMonto}) vs local (${tx.tipo}, ${cleanMonto})`
      );
    }
    throw error;
  }
}

// ── Guardado de Transacción con Contingencia Offline ──────────────────────────

export async function saveTransaction(tx: Transaccion): Promise<void> {
  let cuentaOrigen = tx.cuentaOrigen || (tx.tipo === 'GASTO' ? tx.cuenta : undefined);
  let cuentaDestino = tx.cuentaDestino || (tx.tipo === 'INGRESO' ? tx.cuenta : undefined);

  // 1. Aplicar optimista local de inmediato
  applyOptimisticTransaction({
    ...tx,
    cuentaOrigen,
    cuentaDestino,
  });

  // 2. Intentar inserción remota
  try {
    await insertRemote(tx);
    markTransactionSynced(tx.id, true);
  } catch (err) {
    // 3. Encolar mutación de inserción en caso de fallo
    await enqueueMutation({ op: 'insert', tx: { ...tx, sincronizado: false } });
    markTransactionSynced(tx.id, false);
    throw err;
  }
}

export const postTransaccion = saveTransaction;

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

  // Intentar eliminar remotamente
  try {
    const { error } = await supabase.from('transacciones').delete().eq('id', strId);
    if (error) {
      console.warn('Error al eliminar transacción en Supabase, encolando mutación:', error);
      await enqueueMutation({ op: 'delete', id: strId });
      return false;
    }
  } catch (err) {
    console.warn('Fallo de red al eliminar en Supabase, encolando mutación:', err);
    await enqueueMutation({ op: 'delete', id: strId });
    return false;
  }

  return true;
}

export const deleteTransaccion = deleteTransaction;

// ── Actualización de Transacción con Contingencia Offline ─────────────────────

function formatUpdatePayload(updatedData: Partial<Transaccion>): Record<string, any> {
  const cuenta = updatedData.cuenta || '';
  const macroCategoria = updatedData.macroCategoria || updatedData.categoria || updatedData.macro || '';
  const subcategoria = updatedData.subcategoria || updatedData.sub || '';
  const detalle = updatedData.comentario !== undefined ? updatedData.comentario : (updatedData.detalle ?? '');

  const cuentaOrigen = updatedData.tipo === 'GASTO'
    ? cuenta
    : (updatedData.cuentaOrigen || null);

  const cuentaDestino = updatedData.tipo === 'INGRESO'
    ? cuenta
    : (updatedData.cuentaDestino || null);

  const payload: Record<string, any> = {};

  if (updatedData.monto !== undefined) {
    payload.monto = sanitizeAmount(updatedData.monto);
  }
  if (macroCategoria) payload.macro_categoria = macroCategoria;
  if (subcategoria) payload.subcategoria = subcategoria;
  if (cuenta) payload.cuenta = cuenta;
  if (cuentaOrigen !== undefined) payload.cuenta_origen = cuentaOrigen;
  if (cuentaDestino !== undefined) payload.cuenta_destino = cuentaDestino;
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
        monto: updatedData.monto !== undefined ? sanitizeAmount(updatedData.monto) : t.monto,
      };
    }
    return t;
  });
  saveTransacciones(updatedList);

  const payload = formatUpdatePayload(updatedData);

  try {
    const { error } = await supabase
      .from('transacciones')
      .update(payload)
      .eq('id', strId);

    if (error) {
      console.warn('Error al actualizar transacción en Supabase, encolando mutación:', error);
      await enqueueMutation({ op: 'update', id: strId, patch: updatedData });
      return false;
    }

    await fetchAppData(true);
    return true;
  } catch (err) {
    console.warn('Fallo de red al actualizar en Supabase, encolando mutación:', err);
    await enqueueMutation({ op: 'update', id: strId, patch: updatedData });
    return false;
  }
}

export const updateTransaccion = updateTransaction;

// ── Ajuste / Conciliación de Saldo ────────────────────────────────────────────

export interface AjustePayload {
  tipo: 'AJUSTE';
  monto: number;
  cuentaOrigen: string;
  cuentaDestino: string;
  macro: string;
  sub: string;
  detalle: string;
  cuenta?: string;
  categoria?: string;
  macroCategoria?: string;
  subcategoria?: string;
  comentario?: string;
  fecha?: string;
  id?: string | number;
}

export async function postAjuste(ajuste: AjustePayload): Promise<void> {
  const payloadId = ajuste.id ? String(ajuste.id) : crypto.randomUUID();
  const payloadDate = ajuste.fecha || new Date().toISOString();
  const macroValue = ajuste.macroCategoria || ajuste.categoria || ajuste.macro || 'Ajuste / Conciliación';
  const subValue = ajuste.subcategoria || ajuste.sub || 'Ajuste de Saldo';
  const comentarioValue = ajuste.comentario || ajuste.detalle || '';
  const cuentaPrincipal = ajuste.cuenta || ajuste.cuentaOrigen || ajuste.cuentaDestino || '';

  const payload: Transaccion = {
    id: payloadId,
    fecha: payloadDate,
    tipo: 'AJUSTE',
    monto: sanitizeAmount(ajuste.monto),
    cuenta: cuentaPrincipal,
    cuentaOrigen: ajuste.cuentaOrigen || '',
    cuentaDestino: ajuste.cuentaDestino || '',
    categoria: macroValue,
    macroCategoria: macroValue,
    macro: macroValue,
    subcategoria: subValue,
    sub: subValue,
    comentario: comentarioValue,
    detalle: comentarioValue,
    sincronizado: false,
  };

  await saveTransaction(payload);
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

        const txPayload = {
          id: deterministicId,
          fecha: new Date().toISOString(),
          tipo: 'GASTO' as const,
          monto: sanitizeAmount(r.monto),
          macro_categoria: r.macro_categoria || '',
          subcategoria: r.subcategoria || '',
          cuenta: r.cuenta || '',
          cuenta_origen: r.cuenta || null,
          cuenta_destino: null,
          ciclo: cycleId,
          detalle: `Débito automático programado: ${r.nombre}`,
        };

        const { error: txErr } = await supabase.from('transacciones').insert([txPayload]);

        if (txErr) {
          if (txErr.code === '23505') {
            // Ya existía en base de datos (idempotencia)
          } else {
            // Error en base de datos: prohibido actualizar ultimo_ciclo_ejecutado
            console.warn(`Error al ejecutar gasto recurrente ${r.nombre}:`, txErr);
            continue;
          }
        } else {
          executedCount++;
        }

        // Sellar con ID canónico en Supabase
        await supabase
          .from('gastos_recurrentes')
          .update({ ultimo_ciclo_ejecutado: cycleId })
          .eq('id', r.id);
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

export async function updateCarteraOrden(id: string, orden: number): Promise<void> {
  const { error } = await supabase.from('carteras').update({ orden }).eq('id', id);
  if (error) throw error;
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

    const queue = await getQueuedMutations();
    const queueIds = new Set(
      queue
        .filter(q => q.op === 'insert')
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

export async function syncOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  return withQueueLock(async () => {
    const queue = await getQueuedMutations();
    if (queue.length === 0) return { synced: 0, remaining: 0 };

    const processed: QueuedMutation[] = [];
    let synced = 0;

    for (const mut of queue) {
      try {
        if (mut.op === 'insert') {
          // Inserción remota directa SIN ejecutar applyOptimisticTransaction
          await insertRemote(mut.tx);
          markTransactionSynced(mut.tx.id, true);
          processed.push(mut);
          synced++;
        } else if (mut.op === 'delete') {
          const { error } = await supabase.from('transacciones').delete().eq('id', String(mut.id));
          if (error) throw error;
          processed.push(mut);
          synced++;
        } else if (mut.op === 'update') {
          const payload = formatUpdatePayload(mut.patch);
          const { error } = await supabase.from('transacciones').update(payload).eq('id', String(mut.id));
          if (error) throw error;
          processed.push(mut);
          synced++;
        }
      } catch (err: any) {
        if (err?.code === '23505' && mut.op === 'insert') {
          // Idempotencia: el registro ya existía validado
          markTransactionSynced(mut.tx.id, true);
          processed.push(mut);
          synced++;
        } else {
          console.warn('Error sincronizando mutación encolada:', mut, err);
        }
      }
    }

    if (processed.length > 0) {
      await removeProcessedMutations(processed);
    }

    const remainingCount = queue.length - processed.length;
    return { synced, remaining: remainingCount };
  });
}

export const syncQueue = syncOfflineQueue;

export function computeRunway(saldos: Record<string, number>): RunwayData {
  const costosFijosBase = 2_264_731;
  const saldoReserva = saldos['Lulo Bolsillo - Ahorro'] ?? 0;
  const runwayMeses = costosFijosBase > 0 ? (saldoReserva / costosFijosBase) : 0;
  return {
    costosFijosBase,
    saldoReserva,
    runwayMeses,
    metaMeses: 3,
  };
}

export function computeMatrizGastos(gastadoPorSubcat: Record<string, number>): MatrizGastos {
  const subcategoriasInflexibles = [
    'Arriendo', 'Energía Eléctrica', 'Agua y Alcantarillado', 'Gas Natural',
    'Internet Hogar', 'Plan Celular', 'Mercado del Hogar', 'Cuota Regular Mazda 2', 'Gimnasio'
  ];
  const setInflexibles = new Set(subcategoriasInflexibles.map(s => s.toLowerCase()));
  let totalInflexibles = 0;
  let totalDiscrecionales = 0;

  Object.entries(gastadoPorSubcat || {}).forEach(([sub, monto]) => {
    if (setInflexibles.has(sub.trim().toLowerCase())) {
      totalInflexibles += sanitizeAmount(monto);
    } else {
      totalDiscrecionales += sanitizeAmount(monto);
    }
  });

  const total = totalInflexibles + totalDiscrecionales;
  return {
    totalInflexibles,
    totalDiscrecionales,
    pctInflexibles: total > 0 ? (totalInflexibles / total) * 100 : 0,
    pctDiscrecionales: total > 0 ? (totalDiscrecionales / total) * 100 : 0,
    subcategoriasInflexibles,
  };
}
