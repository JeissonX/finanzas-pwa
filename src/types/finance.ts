// Finance domain types — strict, no any
export type TipoTransaccion = 'GASTO' | 'INGRESO' | 'TRANSFERENCIA' | 'AJUSTE';

export interface Transaccion {
  id: number;
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
  tipo: 'efectivo' | 'debito' | 'credito' | 'inversion' | 'deuda';
  saldo: number;
  icono: string;
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

export interface Presupuesto {
  cicloId: string;
  fechaInicio: string;
  fechaFin: string;
  categorias: MacroCategoria[];
}

export interface Ciclo {
  id: string;
  label: string;      // "25 Sep – 24 Oct"
  fechaInicio: string;
  fechaFin: string;
  totalGastos: number;
  totalIngresos: number;
  transacciones: Transaccion[];
}

export interface KPIs {
  saldoNeto: number;
  gastadoCiclo: number;
  ingresadoCiclo: number;
  ahorroTasa: number;
  pendientesOffline: number;
}

export type TabPrincipal = 'registro' | 'movimientos' | 'presupuestos' | 'analiticas' | 'presupuesto';

export interface EstadoApp {
  tema: 'dark' | 'light';
  tabActiva: TabPrincipal;
  modalCarteras: boolean;
  online: boolean;
  sincronizando: boolean;
  colaOffline: Transaccion[];
}

export interface PresupuestoItem {
  macro: string;
  sub: string;
  presupuesto: number;
  gastado?: number;
  disponible?: number;
  pct?: number;
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
}

