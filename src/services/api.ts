import type { Transaccion } from '../types/finance';
import { CATALOG_GASTOS } from '../data/catalog';

const API_URL = 'https://script.google.com/macros/s/AKfycbwMXl1h2dBkA5--xHRHw-DTvmWrQ9dXij47yIR-KAu5aw95sVS9B6UqBDA_0BVV4Haa/exec';
const QUEUE_KEY = 'finanzas_offline_queue';
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
  q.push(tx);
  saveOfflineQueue(q);
}

// ── POST transaction ───────────────────────────────────────
export async function postTransaccion(tx: Transaccion): Promise<void> {
  await fetch(API_URL, {
    method: 'POST',
    mode: 'no-cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(tx),
  });
  // no-cors → opaque response, treat any non-throw as success
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
  const payload = {
    id: Date.now(),
    fecha: new Date().toISOString(),
    ...ajuste,
    cuenta: ajuste.cuenta || (ajuste.cuentaOrigen || ajuste.cuentaDestino),
    categoria: ajuste.categoria || ajuste.macro,
    subcategoria: ajuste.subcategoria || ajuste.sub,
    comentario: ajuste.comentario || ajuste.detalle,
  };
  await fetch(API_URL, {
    method: 'POST',
    mode: 'no-cors',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
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
      };

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

// ── GET saldos (mantiene compatibilidad con componentes existentes) ──
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

// ── Sync offline queue ─────────────────────────────────────
export async function syncQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };

  const remaining: Transaccion[] = [];
  let synced = 0;

  for (const tx of queue) {
    try {
      await postTransaccion(tx);
      synced++;
    } catch {
      remaining.push(tx);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  saveOfflineQueue(remaining);
  return { synced, remaining: remaining.length };
}

