import type { Transaccion } from '../types/finance';
import { CATALOG_GASTOS } from '../data/catalog';

export const API_URL = 'https://script.google.com/macros/s/AKfycbwMXl1h2dBkA5--xHRHw-DTvmWrQ9dXij47yIR-KAu5aw95sVS9B6UqBDA_0BVV4Haa/exec';
const QUEUE_KEY = 'finanzas_offline_queue';
const TRANSACTIONS_KEY = 'finanzas_transacciones_ciclo_v2';
const APPDATA_CACHE_KEY = 'finanzas_cached_appdata_v4';
const APPDATA_CACHE_TTL = 5 * 60 * 1000; // 5 min

// Saldos oficiales por defecto (exactamente las 10 carteras oficiales en Saldo: 0)
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

export interface AppData {
  saldos: Record<string, number>;
  gastadoPorSubcat: Record<string, number>;
  gastadoPorMacro: Record<string, number>;
  kpis: {
    ingresos: number;
    gastos: number;
    balance: number;
    tasaAhorro: number;
  };
  historico: { ciclo: string; gastos: number; ingresos: number }[];
  fromCache: boolean;
  timestamp: number;
  tasas?: {
    lulo?: number;
    mazda?: number;
  };
}

export const DEFAULT_APPDATA: AppData = {
  saldos: { ...DEFAULT_SALDOS },
  gastadoPorSubcat: {},
  gastadoPorMacro: {},
  kpis: {
    ingresos: 0,
    gastos: 0,
    balance: 0,
    tasaAhorro: 0,
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
};

// Purgar cachés obsoletas con datos ficticios
try {
  localStorage.removeItem('finanzas_cached_balances');
  localStorage.removeItem('finanzas_cached_balances_v2');
  localStorage.removeItem('finanzas_cached_balances_v3');
  localStorage.removeItem('finanzas_cached_appdata');
  localStorage.removeItem('finanzas_cached_appdata_v2');
} catch {
  // Ignorar en entornos sin localStorage
}

// ── Queue helpers ──────────────────────────────────────────
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
    // Ignorar si hay cuota excedida
  }
}

export function enqueue(tx: Transaccion): void {
  const q = getOfflineQueue();
  // Evitar duplicados por id
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

// ── Local Transactions Storage ──────────────────────────────
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
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_transacciones_updated', { detail: txs }));
  }
}

export function markTransactionSynced(id: number, synced = true): void {
  const list = getTransacciones();
  let changed = false;
  const updated = list.map(t => {
    if (t.id === id) {
      changed = true;
      return { ...t, sincronizado: synced };
    }
    return t;
  });
  if (changed) {
    saveTransacciones(updated);
  }
}

// ── Optimistic update in-memory and in-cache ────────────────
export function applyOptimisticTransaction(tx: Transaccion): AppData {
  // 1. Guardar en historial local de transacciones
  const txList = getTransacciones();
  const existingIdx = txList.findIndex(t => t.id === tx.id);
  let updatedList: Transaccion[];
  if (existingIdx >= 0) {
    updatedList = [...txList];
    updatedList[existingIdx] = tx;
  } else {
    updatedList = [tx, ...txList];
  }
  saveTransacciones(updatedList);

  // 2. Cargar AppData actual en caché o por defecto
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
  const kpis = { ...(current.kpis || { ingresos: 0, gastos: 0, balance: 0, tasaAhorro: 0 }) };

  const monto = Number(tx.monto) || 0;
  const subcatNombre = tx.subcategoria || tx.sub || '';
  const macroNombre = tx.categoria || tx.macro || '';
  const cuentaNombre = tx.cuenta || tx.cuentaOrigen || '';
  const cuentaDestino = tx.cuentaDestino || '';

  if (tx.tipo === 'GASTO') {
    // Reducir saldo de la cuenta
    if (cuentaNombre) {
      saldos[cuentaNombre] = (saldos[cuentaNombre] ?? 0) - monto;
    }
    // Incrementar gasto en subcategoría y macrocategoría
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

  // Notificar inmediatamente a toda la UI reactiva
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: updatedData }));
    window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedData.saldos }));
  }

  return updatedData;
}

// ── SAVE TRANSACTION (CORS Simple Request + Optimistic Update) ──
export async function saveTransaction(tx: Transaccion): Promise<void> {
  const payload = {
    id: tx.id,
    fecha: tx.fecha,
    tipo: tx.tipo,
    monto: tx.monto,
    // Categorías (ambas variantes)
    macro: tx.macroCategoria || tx.categoria,
    categoria: tx.macroCategoria || tx.categoria,
    sub: tx.subcategoria,
    subcategoria: tx.subcategoria,
    // Cuentas según el tipo
    cuentaOrigen: tx.tipo === 'GASTO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaOrigen : ''),
    cuentaDestino: tx.tipo === 'INGRESO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaDestino : ''),
    cuenta: tx.cuenta || '',
    // Comentario
    detalle: tx.comentario || '',
    comentario: tx.comentario || ''
  };

  // 1. Actualización optimista inmediata en memoria y localStorage
  applyOptimisticTransaction({ ...tx, ...payload });

  // 2. Envío como Simple Request: text/plain;charset=utf-8
  // Evita CORS Preflight (OPTIONS) rechazado por Apps Script en Safari/iOS
  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    // no-cors en petición exitosa se marca como sincronizado
    markTransactionSynced(tx.id, true);
  } catch (err) {
    // Si falla la red, se guarda en la cola offline para sync posterior
    enqueue({ ...tx, ...payload, sincronizado: false });
    markTransactionSynced(tx.id, false);
    throw err;
  }
}

// Alias de compatibilidad con App.tsx
export const postTransaccion = saveTransaction;

// ── DELETE TRANSACTION (Reversión local y en Webhook) ───────
export async function deleteTransaccion(id: number): Promise<boolean> {
  const list = getTransacciones();
  const tx = list.find(t => t.id === id);
  if (!tx) return false;

  // 1. Revertir impacto financiero en AppData
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
  const kpis = { ...(current.kpis || { ingresos: 0, gastos: 0, balance: 0, tasaAhorro: 0 }) };

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

  // 2. Eliminar del listado local
  const remainingTxs = list.filter(t => t.id !== id);
  saveTransacciones(remainingTxs);

  // 3. Eliminar de la cola offline si estaba encolado
  const queue = getOfflineQueue();
  const filteredQueue = queue.filter(t => t.id !== id);
  if (filteredQueue.length !== queue.length) {
    saveOfflineQueue(filteredQueue);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: filteredQueue.length }));
    }
  }

  // 4. Notificar a la UI
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: updatedData }));
    window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedData.saldos }));
  }

  // 5. Registrar la reversión al Webhook mediante Simple Request
  const reversalPayload = {
    id: Date.now(),
    tipo: 'AJUSTE',
    reversionDeId: tx.id,
    monto: tx.monto,
    cuenta: tx.cuenta,
    cuentaDestino: tx.cuentaDestino,
    categoria: tx.categoria,
    subcategoria: tx.subcategoria,
    comentario: `Reversión local: Eliminada transacción ID ${tx.id} (${tx.tipo} ${formatMontoShort(tx.monto)})`,
    fecha: new Date().toISOString(),
  };

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(reversalPayload),
    });
  } catch {
    // Si no hay red, la reversión queda aplicada en la UI
  }

  return true;
}

function formatMontoShort(m: number): string {
  return `$${m.toLocaleString('es-CO')}`;
}

// ── POST ajuste / conciliación ─────────────────────────────
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
  subcategoria?: string;
  comentario?: string;
  fecha?: string;
  id?: number;
}

export async function postAjuste(ajuste: AjustePayload): Promise<void> {
  const payloadId = ajuste.id || Date.now();
  const payloadDate = ajuste.fecha || new Date().toISOString();
  const payload: Transaccion = {
    id: payloadId,
    fecha: payloadDate,
    tipo: 'AJUSTE',
    monto: ajuste.monto,
    cuenta: ajuste.cuenta || (ajuste.cuentaOrigen || ajuste.cuentaDestino),
    cuentaOrigen: ajuste.cuentaOrigen,
    cuentaDestino: ajuste.cuentaDestino,
    categoria: ajuste.categoria || ajuste.macro,
    subcategoria: ajuste.subcategoria || ajuste.sub,
    comentario: ajuste.comentario || ajuste.detalle,
    macro: ajuste.macro,
    sub: ajuste.sub,
    detalle: ajuste.detalle,
    sincronizado: false,
  };

  // Optimistic update
  applyOptimisticTransaction(payload);

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    markTransactionSynced(payloadId, true);
  } catch (err) {
    enqueue(payload);
    throw err;
  }
}

// ── GET AppData (Sincronización real con Google Sheets) ─────
export async function fetchAppData(forceRefresh = false): Promise<AppData> {
  // 1. Revisar caché local válida
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

  // 2. Consultar Webhook de Google Sheets
  try {
    const res = await fetch(API_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });

    if (res.ok) {
      const incoming = (await res.json()) as Record<string, unknown>;

      // A. Mapear saldos
      const rawSaldos = (
        'saldos' in incoming
          ? incoming.saldos
          : 'carteras' in incoming
          ? incoming.carteras
          : {}
      ) as Record<string, unknown>;

      const updatedSaldos: Record<string, number> = { ...DEFAULT_SALDOS };
      if (rawSaldos && typeof rawSaldos === 'object') {
        for (const [key, val] of Object.entries(rawSaldos)) {
          if (key.toLowerCase().includes('bancolombia')) continue;
          const valNum = typeof val === 'number' ? val : Number(val) || 0;
          if (key === 'Lulo Principal (Banco)') {
            updatedSaldos['Lulo Principal (Cuenta)'] = valNum;
          } else if (key === 'RappiCard (Davivienda)') {
            updatedSaldos['RappiCard'] = valNum;
          } else if (key === 'Lulo Ahorros (Bolsillo 9.25%)') {
            if (updatedSaldos['Lulo Bolsillo - Ahorro'] === 0) {
              updatedSaldos['Lulo Bolsillo - Ahorro'] = valNum;
            }
          } else {
            updatedSaldos[key] = valNum;
          }
        }
      }

      // B. Mapear gastos por subcategoría
      const rawSubcats = (
        'gastadoPorSubcat' in incoming
          ? incoming.gastadoPorSubcat
          : 'gastosPorSubcat' in incoming
          ? incoming.gastosPorSubcat
          : 'gastado' in incoming
          ? incoming.gastado
          : {}
      ) as Record<string, unknown>;

      const updatedGastadoSub: Record<string, number> = {};
      if (rawSubcats && typeof rawSubcats === 'object') {
        for (const [key, val] of Object.entries(rawSubcats)) {
          updatedGastadoSub[key] = typeof val === 'number' ? val : Number(val) || 0;
        }
      }

      // C. Consolidar gastos por macrocategoría
      const updatedGastadoMacro: Record<string, number> = {};
      for (const cat of CATALOG_GASTOS) {
        let sum = 0;
        for (const sub of cat.subcategorias) {
          sum += updatedGastadoSub[sub.nombre] ?? 0;
        }
        updatedGastadoMacro[cat.nombre] = sum;
      }

      // D. Mapear KPIs
      const rawKpis = (incoming.kpis || {}) as Record<string, unknown>;
      const totalGastos = typeof incoming.gastos === 'number'
        ? incoming.gastos
        : typeof rawKpis.gastos === 'number'
        ? (rawKpis.gastos as number)
        : Object.values(updatedGastadoMacro).reduce((a, b) => a + b, 0);

      const totalIngresos = typeof incoming.ingresos === 'number'
        ? incoming.ingresos
        : typeof rawKpis.ingresos === 'number'
        ? (rawKpis.ingresos as number)
        : 0;

      const balance = totalIngresos - totalGastos;
      const tasaAhorro = totalIngresos > 0 ? (balance / totalIngresos) * 100 : 0;

      // E. Mapear histórico
      let historico = [
        { ciclo: 'Ciclo Actual', gastos: totalGastos, ingresos: totalIngresos },
      ];
      if (Array.isArray(incoming.historico) && incoming.historico.length > 0) {
        historico = incoming.historico as { ciclo: string; gastos: number; ingresos: number }[];
      }

      // F. Mapear tasas si las retorna Google Sheets
      const incomingTasas = (incoming.tasas || {}) as Record<string, unknown>;
      const tasaLuloSheet = typeof incoming.tasaLulo === 'number'
        ? incoming.tasaLulo
        : typeof incomingTasas.lulo === 'number'
        ? incomingTasas.lulo
        : undefined;

      const tasaMazdaSheet = typeof incoming.tasaMazda === 'number'
        ? incoming.tasaMazda
        : typeof incomingTasas.mazda === 'number'
        ? incomingTasas.mazda
        : undefined;

      const result: AppData = {
        saldos: updatedSaldos,
        gastadoPorSubcat: updatedGastadoSub,
        gastadoPorMacro: updatedGastadoMacro,
        kpis: {
          ingresos: totalIngresos,
          gastos: totalGastos,
          balance,
          tasaAhorro,
        },
        historico,
        fromCache: false,
        timestamp: Date.now(),
        tasas: {
          lulo: tasaLuloSheet ?? 9.25,
          mazda: tasaMazdaSheet ?? 21.35,
        },
      };

      // Si Google Sheets devuelve transacciones, sincronizarlas con el almacenamiento local
      if (Array.isArray(incoming.transacciones)) {
        const remoteTxs = incoming.transacciones as Transaccion[];
        const localTxs = getTransacciones();
        const mergedMap = new Map<number, Transaccion>();
        // Primero añadir remotas
        for (const t of remoteTxs) {
          mergedMap.set(t.id, { ...t, sincronizado: true });
        }
        // Conservar locales recientes
        for (const t of localTxs) {
          mergedMap.set(t.id, t);
        }
        const mergedList = Array.from(mergedMap.values()).sort(
          (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
        );
        saveTransacciones(mergedList);
      }

      // Guardar en caché local
      try {
        localStorage.setItem(APPDATA_CACHE_KEY, JSON.stringify({ timestamp: result.timestamp, data: result }));
      } catch {
        /* ignore */
      }

      // Notificar suscriptores reactivos
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('finanzas_appdata_updated', { detail: result }));
        window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: result.saldos }));
      }

      return result;
    }
  } catch {
    /* Fallback en caso de desconexión o respuesta opaca */
  }

  // 3. Fallback a caché previa si existe
  try {
    const raw = localStorage.getItem(APPDATA_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { timestamp: number; data: AppData };
      return { ...parsed.data, fromCache: true, timestamp: parsed.timestamp };
    }
  } catch {
    /* ignore */
  }

  // 4. Fallback por defecto estricto: Todo en $0 (sin montos simulados)
  return { ...DEFAULT_APPDATA };
}

// ── GET saldos (compatibilidad) ─────────────────────────────
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

// ── Sync offline queue (vaciar cola acumulada enviando cada transacción) ──
export async function syncOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  const remaining: Transaccion[] = [];
  let synced = 0;

  for (const tx of queue) {
    try {
      const payload = {
        id: tx.id,
        fecha: tx.fecha,
        tipo: tx.tipo,
        monto: tx.monto,
        // Categorías (ambas variantes)
        macro: tx.macroCategoria || tx.categoria,
        categoria: tx.macroCategoria || tx.categoria,
        sub: tx.subcategoria,
        subcategoria: tx.subcategoria,
        // Cuentas según el tipo
        cuentaOrigen: tx.tipo === 'GASTO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaOrigen : ''),
        cuentaDestino: tx.tipo === 'INGRESO' ? tx.cuenta : (tx.tipo === 'TRANSFERENCIA' ? tx.cuentaDestino : ''),
        cuenta: tx.cuenta || '',
        // Comentario
        detalle: tx.comentario || '',
        comentario: tx.comentario || ''
      };

      await fetch(API_URL, {
        method: 'POST',
        mode: 'no-cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });
      markTransactionSynced(tx.id, true);
      synced++;
    } catch {
      remaining.push(tx);
    }
    // Breve pausa para no saturar Apps Script
    await new Promise((r) => setTimeout(r, 200));
  }

  // Vaciar o actualizar la cola acumulada limpiando el storage
  saveOfflineQueue(remaining);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finanzas_queue_updated', { detail: remaining.length }));
  }

  return { synced, remaining: remaining.length };
}

// Alias de compatibilidad
export const syncQueue = syncOfflineQueue;
