// Finance domain types — strict, no any
export type TipoTransaccion = 'GASTO' | 'INGRESO' | 'TRANSFERENCIA' | 'AJUSTE';

export interface Transaccion {
  id: number | string;
  user_id?: string;
  tipo: TipoTransaccion;
  monto: number;
  categoria: string;
  subcategoria: string;
  cuenta: string;
  cuentaDestino?: string;
  cuentaOrigen?: string;
  macroCategoria?: string;
  macro?: string;
  sub?: string;
  detalle?: string;
  comentario?: string;
  fecha: string; // ISO 8601
  sincronizado?: boolean;
}

export interface Cartera {
  id: string;
  nombre: string;
  tipo: 'efectivo' | 'debito' | 'credito' | 'inversion' | 'deuda' | string;
  saldo: number;
  saldo_inicial?: number;
  saldo_actual?: number;
  icono: string;
  orden?: number;
  permite_gasto?: boolean;
  activa?: boolean;
  dia_corte?: number | null;
  dia_pago?: number | null;
  limite_credito?: number | null;
}

export interface Subcategoria {
  nombre: string;
  presupuesto: number;
  gastado: number;
  cuentaDefecto?: string;
}

export interface MacroCategoria {
  nombre: string;
  icono: string;
  presupuesto: number;
  subcategorias: Subcategoria[];
}

export type TabNavegacion = 'movimientos' | 'carteras' | 'presupuestos' | 'analiticas';

export interface PresupuestoItem {
  id?: string;
  macro: string;
  sub: string;
  presupuesto: number;
  gastado?: number;
  disponible?: number;
  pct?: number;
}

export interface CarteraInfo {
  id: string;
  nombre: string;
  tipo: string;
  saldo_inicial?: number;
  saldo_actual?: number;
  saldo?: number;
  saldoActual?: number;
  icono?: string;
  permite_gasto?: boolean;
  orden?: number;
  activa?: boolean;
  dia_corte?: number | null;
  dia_pago?: number | null;
  limite_credito?: number | null;
}

export interface GastoRecurrente {
  id: string;
  nombre: string;
  monto: number;
  macroCategoria: string;
  subcategoria: string;
  cuenta: string;
  diaPago: number;
  activo: boolean;
  ultimoCicloEjecutado?: string;
}

export interface AppDataResponse {
  saldos: Record<string, number>;
  gastadoPorSubcat: Record<string, number>;
  gastadoPorMacro: Record<string, number>;
  kpis: {
    ingresos: number;
    gastos: number;
    balance: number;
    tasaAhorro: number;
    saldoRemunerados?: number;
    balanceDisponible?: number;
  };
  historico: { ciclo: string; gastos: number; ingresos: number }[];
  fromCache: boolean;
  timestamp: number;
  tasas?: {
    lulo?: number;
    mazda?: number;
  };
  transacciones?: Transaccion[];
  presupuestos?: PresupuestoItem[];
  carteras?: CarteraInfo[];
  gastosRecurrentes?: GastoRecurrente[];
}
