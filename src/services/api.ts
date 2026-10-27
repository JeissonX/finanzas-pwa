import { supabase } from './supabase';
import type { Transaccion, AppDataResponse, PresupuestoItem, CarteraInfo } from '../types/finance';
import { isDateInCurrentCycle, getCycleLabel } from '../utils/format';

const QUEUE_KEY = 'finanzas_offline_queue';
const TRANSACTIONS_KEY = 'finanzas_transacciones_ciclo_v2';
const APPDATA_CACHE_KEY = 'finanzas_cached_appdata_v4';
const APPDATA_CACHE_TTL = 5 * 60 * 1000;

export const DEFAULT_SALDOS: Record<string, number> = {
  'Lulo Principal (Cuenta)': 0,
  'Lulo Bolsillo - Ahorro': 0,
  'Lulo Bolsillo - Carro / Moto': 0,
  'Lulo Bolsillo - Gastos': 0,
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
    if (cuentaNombre && cuentaDestino) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) - monto;
      saldos[cuentaDestino] = (saldos[cuentaDestino] ?? 0) + monto;
    } else if (cuentaNombre) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) + monto;
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
  const payload = {
    id: tx.id,
    fecha: tx.fecha || new Date().toISOString(),
    tipo: tx.tipo,
    monto: tx.monto,
    macro_categoria: tx.macroCategoria || tx.categoria || tx.macro || '',
    subcategoria: tx.subcategoria || tx.sub || '',
    cuenta: tx.cuenta || (tx.tipo === 'GASTO' ? tx.cuentaOrigen : (tx.tipo === 'INGRESO' ? tx.cuentaDestino : '')) || '',
    cuenta_origen:
      tx.tipo === 'GASTO'
        ? (tx.cuenta || tx.cuentaOrigen || '')
        : (tx.tipo === 'TRANSFERENCIA' || tx.tipo === 'AJUSTE'
            ? (tx.cuentaOrigen || tx.cuenta || '')
            : ''),
    cuenta_destino:
      tx.tipo === 'INGRESO'
        ? (tx.cuenta || tx.cuentaDestino || '')
        : (tx.tipo === 'TRANSFERENCIA' || tx.tipo === 'AJUSTE'
            ? (tx.cuentaDestino || '')
            : ''),
    detalle: tx.comentario || tx.detalle || '',
    ciclo: getCycleLabel(new Date(tx.fecha || Date.now())),
  };

  applyOptimisticTransaction({ ...tx, ...payload });

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
  if (!tx) return false;

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
    window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: updatedData }));
    window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedData.saldos }));
    window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: remainingTxs }));
  }

  try {
    await supabase.from('transacciones').delete().eq('id', String(id));
  } catch (err) {
    console.warn('Fallo al eliminar transacción en Supabase:', err);
  }

  return true;
}

export const deleteTransaccion = deleteTransaction;

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
    const [carterasRes, catalogoRes, txsRes] = await Promise.all([
      supabase.from('carteras').select('*').order('id'),
      supabase.from('catalogo_categorias').select('*').eq('activo', true),
      supabase.from('transacciones').select('*').order('fecha', { ascending: false }).limit(100),
    ]);

    const carterasData = carterasRes.data || [];
    const catalogoData = catalogoRes.data || [];
    const txsData = txsRes.data || [];

    const updatedSaldos: Record<string, number> = { ...DEFAULT_SALDOS };
    let saldoRemunerados = 0;
    let balanceDisponible = 0;

    for (const c of carterasData) {
      const saldoVal = Number(c.saldo_actual) || 0;
      updatedSaldos[c.nombre] = saldoVal;

      const tipoLower = (c.tipo || '').toLowerCase();
      const nombreLower = (c.nombre || '').toLowerCase();

      if (tipoLower.includes('remunerado') || nombreLower.includes('bolsillo')) {
        saldoRemunerados += saldoVal;
      }

      if (
        tipoLower.includes('débito') ||
        tipoLower.includes('debito') ||
        tipoLower.includes('efectivo') ||
        tipoLower.includes('billetera') ||
        tipoLower.includes('líquido') ||
        tipoLower.includes('liquido')
      ) {
        balanceDisponible += saldoVal;
      }
    }

    const remoteTxs: Transaccion[] = txsData.map((row: any) => ({
      id: Number(row.id) || Date.parse(row.fecha) || Date.now(),
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

    const localTxs = getTransacciones();
    const mergedMap = new Map<number | string, Transaccion>();
    for (const t of remoteTxs) {
      mergedMap.set(t.id, t);
    }
    for (const t of localTxs) {
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

    const carterasMapped: CarteraInfo[] = carterasData.map((c: any) => ({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      saldo_inicial: Number(c.saldo_inicial) || 0,
      saldo_actual: Number(c.saldo_actual) || 0,
      icono: c.icono || '💳',
      permite_gasto: c.permite_gasto !== false,
    }));

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
