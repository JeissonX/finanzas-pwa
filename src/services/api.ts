import { supabase } from './supabase';
import type { Transaccion, AppDataResponse, PresupuestoItem, CarteraInfo, GastoRecurrente, RunwayData, MatrizGastos } from '../types/finance';
import { isDateInCurrentCycle, getCycleLabel } from '../utils/format';

const QUEUE_KEY = 'finanzas_offline_queue';
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

export function getOfflineQueue(): Transaccion[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as Transaccion[]) : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(queue: Transaccion[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

export function enqueue(tx: Transaccion): void {
  const q = getOfflineQueue();
  const existingIdx = q.findIndex(item => item.id === tx.id);
  if (existingIdx >= 0) {
    q[existingIdx] = tx;
  } else {
    q.push(tx);
  }
  saveOfflineQueue(q);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: q.length }));
  }
}

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

  const monto = Number(tx.monto) || 0;
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

export async function saveTransaction(tx: Transaccion): Promise<void> {
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

  const payload = {
    id: tx.id,
    fecha: tx.fecha || new Date().toISOString(),
    tipo: tx.tipo,
    monto: tx.monto,
    macro_categoria: tx.macroCategoria || tx.categoria || tx.macro || '',
    subcategoria: tx.subcategoria || tx.sub || '',
    cuenta: cuentaPrincipal,
    cuenta_origen: cuentaOrigen,
    cuenta_destino: cuentaDestino,
    detalle: tx.comentario || tx.detalle || '',
    ciclo: getCycleLabel(new Date(tx.fecha || Date.now())),
  };

  applyOptimisticTransaction({
    ...tx,
    ...payload,
    cuentaOrigen: cuentaOrigen ?? undefined,
    cuentaDestino: cuentaDestino ?? undefined,
  });

  try {
    const { error } = await supabase.from('transacciones').insert([{
      id: String(payload.id),
      fecha: payload.fecha,
      tipo: payload.tipo,
      monto: payload.monto,
      macro_categoria: payload.macro_categoria,
      subcategoria: payload.subcategoria,
      cuenta: payload.cuenta,
      cuenta_origen: payload.cuenta_origen,
      cuenta_destino: payload.cuenta_destino,
      detalle: payload.detalle,
      ciclo: payload.ciclo,
    }]);

    if (error) {
      throw error;
    }

    markTransactionSynced(tx.id, true);
  } catch (err) {
    enqueue({ ...tx, sincronizado: false });
    markTransactionSynced(tx.id, false);
    throw err;
  }
}

export const postTransaccion = saveTransaction;

export async function deleteTransaction(id: number | string): Promise<boolean> {
  const list = getTransacciones();
  const tx = list.find(t => String(t.id) === String(id));

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

    const monto = Number(tx.monto) || 0;
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

  const remainingTxs = list.filter(t => String(t.id) !== String(id));
  saveTransacciones(remainingTxs);

  const queue = getOfflineQueue();
  const filteredQueue = queue.filter(t => String(t.id) !== String(id));
  if (filteredQueue.length !== queue.length) {
    saveOfflineQueue(filteredQueue);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: filteredQueue.length }));
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: remainingTxs }));
  }

  try {
    const { error } = await supabase.from('transacciones').delete().eq('id', String(id));
    if (error) {
      console.warn('Error al eliminar transacción en Supabase:', error);
      return false;
    }
  } catch (err) {
    console.warn('Fallo al eliminar transacción en Supabase:', err);
    return false;
  }

  return true;
}

export const deleteTransaccion = deleteTransaction;

export async function updateTransaction(
  id: string | number,
  updatedData: Partial<Transaccion>
): Promise<boolean> {
  try {
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

    const payload: Record<string, any> = {
      monto: Number(updatedData.monto),
      macro_categoria: macroCategoria,
      subcategoria: subcategoria,
      cuenta: cuenta,
      cuenta_origen: cuentaOrigen,
      cuenta_destino: cuentaDestino,
      detalle: detalle,
    };

    if (updatedData.tipo) {
      payload.tipo = updatedData.tipo;
    }
    if (updatedData.fecha) {
      payload.fecha = updatedData.fecha;
      payload.ciclo = getCycleLabel(new Date(updatedData.fecha));
    }

    const { error } = await supabase
      .from('transacciones')
      .update(payload)
      .eq('id', String(id));

    if (error) {
      console.error('Error al actualizar transacción en Supabase:', error);
      return false;
    }

    await fetchAppData(true);
    return true;
  } catch (err) {
    console.error('Fallo al actualizar transacción:', err);
    return false;
  }
}

export const updateTransaccion = updateTransaction;


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
  id?: number;
}

export async function postAjuste(ajuste: AjustePayload): Promise<void> {
  const payloadId = ajuste.id || Date.now();
  const payloadDate = ajuste.fecha || new Date().toISOString();
  const macroValue = ajuste.macroCategoria || ajuste.categoria || ajuste.macro || 'Ajuste / Conciliación';
  const subValue = ajuste.subcategoria || ajuste.sub || 'Ajuste de Saldo';
  const comentarioValue = ajuste.comentario || ajuste.detalle || '';
  const cuentaPrincipal = ajuste.cuenta || ajuste.cuentaOrigen || ajuste.cuentaDestino || '';

  const payload: Transaccion = {
    id: payloadId,
    fecha: payloadDate,
    tipo: 'AJUSTE',
    monto: ajuste.monto,
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

let isProcessingRecurring = false;

export async function processRecurringExpenses(cicloActivo: string = getCycleLabel()): Promise<number> {
  if (isProcessingRecurring) {
    return 0;
  }
  isProcessingRecurring = true;

  try {
    const { data: recurrentes, error } = await supabase
      .from('gastos_recurrentes')
      .select('*')
      .eq('activo', true);

    if (error || !recurrentes || recurrentes.length === 0) {
      return 0;
    }

    // Hora local Colombia (GMT-5)
    const now = new Date();
    const colDateStr = now.toLocaleString('en-US', { timeZone: 'America/Bogota' });
    const colDate = new Date(colDateStr);
    const diaActual = colDate.getDate();

    let executedCount = 0;

    for (const r of recurrentes) {
      const diaPago = Number(r.dia_pago) || 1;
      const ultimoCiclo = r.ultimo_ciclo_ejecutado;

      if (diaActual >= diaPago && ultimoCiclo !== cicloActivo) {
        const deterministicId = 'REC_' + r.id + '_' + cicloActivo.replace(/[^a-zA-Z0-9]/g, '_');

        // Antes de insertar, verificar si ya existe una transacción con ese id exacto
        const { data: existingTx } = await supabase
          .from('transacciones')
          .select('id')
          .eq('id', deterministicId)
          .maybeSingle();

        if (!existingTx) {
          const txPayload = {
            id: deterministicId,
            fecha: new Date().toISOString(),
            tipo: 'GASTO' as const,
            monto: Number(r.monto),
            macro_categoria: r.macro_categoria || '',
            subcategoria: r.subcategoria || '',
            cuenta: r.cuenta || '',
            cuenta_origen: r.cuenta || null,
            cuenta_destino: null,
            ciclo: cicloActivo,
            detalle: `Débito automático programado: ${r.nombre}`,
          };

          const { error: txErr } = await supabase.from('transacciones').insert([txPayload]);
          if (!txErr) {
            executedCount++;
          } else {
            // Silenciosamente capturar si es duplicado
            if (txErr.code !== '23505') {
              console.warn(`Error al ejecutar gasto recurrente ${r.nombre}:`, txErr);
            }
          }
        }

        // Sellar de inmediato en Supabase
        await supabase
          .from('gastos_recurrentes')
          .update({ ultimo_ciclo_ejecutado: cicloActivo })
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
      monto: Number(r.monto) || 0,
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
    const id = gasto.id || `rec-${Date.now()}`;
    const payload = {
      id,
      nombre: gasto.nombre,
      monto: gasto.monto,
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

  try {
    const cicloActivo = getCycleLabel();
    await processRecurringExpenses(cicloActivo).catch(() => {});

    const [carterasRes, catalogoRes, txsRes, recurrentesRes] = await Promise.all([
      supabase.from('carteras').select('*').order('orden', { ascending: true, nullsFirst: false }),
      supabase.from('catalogo_categorias').select('*').eq('activo', true),
      supabase.from('transacciones').select('*').order('fecha', { ascending: false }),
      supabase.from('gastos_recurrentes').select('*').order('dia_pago', { ascending: true }),
    ]);

    const carterasData = carterasRes.data || [];
    const catalogoData = catalogoRes.data || [];
    const transaccionesData = txsRes.data || [];
    const recurrentesData = recurrentesRes.data || [];

    const gastosRecurrentes: GastoRecurrente[] = recurrentesData.map((r: any) => ({
      id: r.id,
      nombre: r.nombre,
      monto: Number(r.monto) || 0,
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
      const entradas = transaccionesData
        .filter((t: any) => t.cuenta_destino === c.nombre)
        .reduce((acc: number, t: any) => acc + Number(t.monto), 0);
      const salidas = transaccionesData
        .filter((t: any) => t.cuenta_origen === c.nombre)
        .reduce((acc: number, t: any) => acc + Number(t.monto), 0);
      const saldoCalculado = (Number(c.saldo_inicial) || 0) + entradas - salidas;

      updatedSaldos[c.nombre] = saldoCalculado;

      const tipoLower = (c.tipo || '').toLowerCase();
      const nombreLower = (c.nombre || '').toLowerCase();

      if (tipoLower.includes('remunerado') || nombreLower.includes('bolsillo')) {
        saldoRemunerados += saldoCalculado;
      }

      if (
        tipoLower.includes('débito') ||
        tipoLower.includes('debito') ||
        tipoLower.includes('efectivo') ||
        tipoLower.includes('billetera') ||
        tipoLower.includes('líquido') ||
        tipoLower.includes('liquido')
      ) {
        balanceDisponible += saldoCalculado;
      }
    }

    const remoteTxs: Transaccion[] = transaccionesData.map((row: any) => ({
      id: row.id ?? (Date.parse(row.fecha) || Date.now()),
      tipo: row.tipo,
      monto: Number(row.monto) || 0,
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

    const queue = getOfflineQueue();
    const queueIds = new Set(queue.map(q => String(q.id)));
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
      const monto = Number(tx.monto) || 0;
      if (tx.tipo === 'GASTO') {
        totalGastos += monto;
      } else if (tx.tipo === 'INGRESO') {
        totalIngresos += monto;
      }
    }

    const presupuestos: PresupuestoItem[] = catalogoData.map((catRow: any) => {
      const macro = (catRow.macro_categoria || '').trim();
      const sub = (catRow.subcategoria || '').trim();
      const presupuesto = Number(catRow.presupuesto_base) || 0;

      // Normalizar la comparación entre transacciones y catalogo:
      // t.subcategoria.trim().toLowerCase() === p.sub.trim().toLowerCase()
      const matchingTxs = cicloTxs.filter(t => {
        if (t.tipo !== 'GASTO') return false;
        const txSub = (t.subcategoria || t.sub || '').trim().toLowerCase();
        const pSub = sub.toLowerCase();
        if (txSub === pSub) return true;
        // Compatibilidad adicional para Streaming y Apps Digitales
        if (pSub === 'streaming y apps digitales' && (txSub.includes('streaming') || txSub.includes('apps digitales'))) {
          return true;
        }
        return false;
      });

      const gastado = matchingTxs.reduce((sum, t) => sum + (Number(t.monto) || 0), 0);
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

    // Para cualquier transacción no catalogada en catalogo_categorias
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
          gastadoPorSubcat[sub] = (gastadoPorSubcat[sub] ?? 0) + (Number(tx.monto) || 0);
          if (macro) {
            gastadoPorMacro[macro] = (gastadoPorMacro[macro] ?? 0) + (Number(tx.monto) || 0);
          }
        }
      }
    }

    const balance = totalIngresos - totalGastos;
    const tasaAhorro = totalIngresos > 0 ? (balance / totalIngresos) * 100 : 0;

    const carterasMapped: CarteraInfo[] = carterasData.map((c: any) => {
      const entradas = transaccionesData
        .filter((t: any) => t.cuenta_destino === c.nombre)
        .reduce((acc: number, t: any) => acc + Number(t.monto), 0);
      const salidas = transaccionesData
        .filter((t: any) => t.cuenta_origen === c.nombre)
        .reduce((acc: number, t: any) => acc + Number(t.monto), 0);
      const saldoCalculado = (Number(c.saldo_inicial) || 0) + entradas - salidas;

      return {
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        saldo_inicial: Number(c.saldo_inicial) || 0,
        saldo_actual: saldoCalculado,
        saldo: saldoCalculado,
        saldoActual: saldoCalculado,
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

    return result;
  } catch (err) {
    console.error('Error sincronizando con Supabase:', err);
  }

  try {
    const raw = localStorage.getItem(APPDATA_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
      return { ...parsed.data, fromCache: true, timestamp: parsed.timestamp };
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

export async function syncOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  const remaining: Transaccion[] = [];
  let synced = 0;

  for (const tx of queue) {
    try {
      await saveTransaction(tx);
      synced++;
    } catch {
      remaining.push(tx);
    }
  }

  saveOfflineQueue(remaining);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: remaining.length }));
  }

  return { synced, remaining: remaining.length };
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
      totalInflexibles += Number(monto) || 0;
    } else {
      totalDiscrecionales += Number(monto) || 0;
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
