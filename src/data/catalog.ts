import type { MacroCategoria, Cartera } from '../types/finance';

export const CATALOG_GASTOS: MacroCategoria[] = [
  {
    nombre: 'Alimentación',
    icono: '🛒',
    presupuesto: 600000,
    subcategorias: [
      { nombre: 'Mercado del Hogar', presupuesto: 500000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
      { nombre: 'Restaurantes y Almuerzos', presupuesto: 250000, gastado: 0, cuentaDefecto: 'Nequi' },
    ],
  },
  {
    nombre: 'Transporte',
    icono: '⛽',
    presupuesto: 420000,
    subcategorias: [
      { nombre: 'Gasolina', presupuesto: 280000, gastado: 0, cuentaDefecto: 'RappiCard' },
      { nombre: 'Lavado / Mantenimiento', presupuesto: 60000, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Carro / Moto' },
      { nombre: 'Peajes / Parqueadero', presupuesto: 50000, gastado: 0, cuentaDefecto: 'Efectivo' },
      { nombre: 'Uber / Taxi', presupuesto: 30000, gastado: 0, cuentaDefecto: 'RappiCard' },
    ],
  },
  {
    nombre: 'Salud y Bienestar',
    icono: '🏋️',
    presupuesto: 280000,
    subcategorias: [
      { nombre: 'Gimnasio', presupuesto: 120000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
      { nombre: 'Odontología', presupuesto: 80000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Farmacia / Medicina', presupuesto: 50000, gastado: 0, cuentaDefecto: 'Nequi' },
      { nombre: 'Citas Médicas', presupuesto: 30000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
    ],
  },
  {
    nombre: 'Mascota',
    icono: '🐾',
    presupuesto: 120000,
    subcategorias: [
      { nombre: 'Comida Mascota', presupuesto: 70000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
      { nombre: 'Veterinaria', presupuesto: 30000, gastado: 0, cuentaDefecto: 'Nequi' },
      { nombre: 'Farmacia / Aseo Mascota', presupuesto: 20000, gastado: 0, cuentaDefecto: 'Nequi' },
    ],
  },
  {
    nombre: 'Ocio y Viajes',
    icono: '✈️',
    presupuesto: 200000,
    subcategorias: [
      { nombre: 'Vacaciones', presupuesto: 100000, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Vacaciones' },
      { nombre: 'Salidas / Entretenimiento', presupuesto: 60000, gastado: 0, cuentaDefecto: 'Nequi' },
      { nombre: 'Suscripciones / Streaming', presupuesto: 30000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
      { nombre: 'Hobbies', presupuesto: 10000, gastado: 0, cuentaDefecto: 'Efectivo' },
    ],
  },
  {
    nombre: 'Servicios',
    icono: '⚡',
    presupuesto: 150000,
    subcategorias: [
      { nombre: 'Celular / Internet', presupuesto: 80000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Energía / Agua / Gas', presupuesto: 50000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Streaming / Software', presupuesto: 20000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
    ],
  },
  {
    nombre: 'Vivienda',
    icono: '🏠',
    presupuesto: 300000,
    subcategorias: [
      { nombre: 'Arriendo / Administración', presupuesto: 200000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Mantenimiento Hogar', presupuesto: 60000, gastado: 0, cuentaDefecto: 'Efectivo' },
      { nombre: 'Aseo / Artículos Hogar', presupuesto: 40000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
    ],
  },
  {
    nombre: 'Inversión y Ahorro',
    icono: '📈',
    presupuesto: 500000,
    subcategorias: [
      { nombre: 'Fondo de Emergencia', presupuesto: 200000, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Ahorro' },
      { nombre: 'Acciones / ETFs', presupuesto: 150000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'CDT / Renta Fija', presupuesto: 100000, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Ahorro' },
      { nombre: 'Ahorro Programado', presupuesto: 50000, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Ahorro' },
    ],
  },
  {
    nombre: 'Deudas Mazda 2',
    icono: '🚗',
    presupuesto: 750000,
    subcategorias: [
      { nombre: 'Cuota Mazda 2', presupuesto: 620000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Seguro Mazda 2', presupuesto: 80000, gastado: 0, cuentaDefecto: 'TC Lulo Bank' },
      { nombre: 'Impuesto / SOAT', presupuesto: 50000, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
    ],
  },
];

export const CATALOG_INGRESOS: MacroCategoria[] = [
  {
    nombre: 'Ingresos Laborales',
    icono: '💼',
    presupuesto: 0,
    subcategorias: [
      { nombre: 'Salario / Honorarios', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Bonos / Comisiones', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Prima / Cesantías', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
    ],
  },
  {
    nombre: 'Ingresos Agencia',
    icono: '🚀',
    presupuesto: 0,
    subcategorias: [
      { nombre: 'Servicios Pauta / Clientes', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Consultoría BI / Dev', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Ventas Directas', presupuesto: 0, gastado: 0, cuentaDefecto: 'Nequi' },
    ],
  },
  {
    nombre: 'Rentas del Capital',
    icono: '💰',
    presupuesto: 0,
    subcategorias: [
      { nombre: 'Rendimientos Lulo', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Ahorro' },
      { nombre: 'Dividendos / Acciones', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'CDT / Renta Fija', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Bolsillo - Ahorro' },
    ],
  },
  {
    nombre: 'Otros Ingresos',
    icono: '📥',
    presupuesto: 0,
    subcategorias: [
      { nombre: 'Reembolsos', presupuesto: 0, gastado: 0, cuentaDefecto: 'Nequi' },
      { nombre: 'Préstamos Cobrados', presupuesto: 0, gastado: 0, cuentaDefecto: 'Efectivo' },
      { nombre: 'Varios', presupuesto: 0, gastado: 0, cuentaDefecto: 'Efectivo' },
    ],
  },
];

export const CATALOG_TRANSFERENCIAS: MacroCategoria[] = [
  {
    nombre: 'Movimientos Propios',
    icono: '🔄',
    presupuesto: 0,
    subcategorias: [
      { nombre: 'Entre Cuentas Propias', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Pago Tarjeta de Crédito', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
      { nombre: 'Aporte Ahorro / Inversión', presupuesto: 0, gastado: 0, cuentaDefecto: 'Lulo Principal (Cuenta)' },
    ],
  },
];

// Lista oficial y única de 10 Carteras (CARTERAS_DEFAULT) — Todas estrictamente con saldo inicial 0
export const CARTERAS_DEFAULT: Cartera[] = [
  { id: 'Lulo Principal (Cuenta)', nombre: 'Lulo Principal (Cuenta)', tipo: 'debito', saldo: 0, icono: '🏦' },
  { id: 'Lulo Bolsillo - Ahorro', nombre: 'Lulo Bolsillo - Ahorro', tipo: 'inversion', saldo: 0, icono: '💰' },
  { id: 'Lulo Bolsillo - Carro / Moto', nombre: 'Lulo Bolsillo - Carro / Moto', tipo: 'inversion', saldo: 0, icono: '🛵' },
  { id: 'Lulo Bolsillo - Gastos', nombre: 'Lulo Bolsillo - Gastos', tipo: 'inversion', saldo: 0, icono: '👛' },
  { id: 'Lulo Bolsillo - Vacaciones', nombre: 'Lulo Bolsillo - Vacaciones', tipo: 'inversion', saldo: 0, icono: '✈️' },
  { id: 'Nequi', nombre: 'Nequi', tipo: 'debito', saldo: 0, icono: '🟣' },
  { id: 'Efectivo', nombre: 'Efectivo', tipo: 'efectivo', saldo: 0, icono: '💵' },
  { id: 'TC Lulo Bank', nombre: 'TC Lulo Bank', tipo: 'credito', saldo: 0, icono: '💳' },
  { id: 'RappiCard', nombre: 'RappiCard', tipo: 'credito', saldo: 0, icono: '💳' },
  { id: 'Crédito Mazda 2 (Lulo)', nombre: 'Crédito Mazda 2 (Lulo)', tipo: 'deuda', saldo: 0, icono: '🚗' },
];

export const CARTERAS = CARTERAS_DEFAULT;

export const PAYMENT_RULES: Record<string, string> = {
  // Gasolina -> RappiCard
  'Gasolina': 'RappiCard',
  'Uber / Taxi': 'RappiCard',

  // Mercado del Hogar / Suscripciones / Gym -> TC Lulo Bank
  'Mercado del Hogar': 'TC Lulo Bank',
  'Restaurantes y Almuerzos': 'Nequi',
  'Aseo / Artículos Hogar': 'TC Lulo Bank',
  'Comida Mascota': 'TC Lulo Bank',
  'Gimnasio': 'TC Lulo Bank',
  'Suscripciones / Streaming': 'TC Lulo Bank',
  'Streaming / Software': 'TC Lulo Bank',
  'Seguro Mazda 2': 'TC Lulo Bank',

  // Arriendo / Servicios / Cuota Mazda -> Lulo Principal (Cuenta)
  'Arriendo / Administración': 'Lulo Principal (Cuenta)',
  'Energía / Agua / Gas': 'Lulo Principal (Cuenta)',
  'Celular / Internet': 'Lulo Principal (Cuenta)',
  'Cuota Mazda 2': 'Lulo Principal (Cuenta)',
  'Impuesto / SOAT': 'Lulo Principal (Cuenta)',
  'Odontología': 'Lulo Principal (Cuenta)',
  'Citas Médicas': 'Lulo Principal (Cuenta)',
  'Acciones / ETFs': 'Lulo Principal (Cuenta)',
  'Salario / Honorarios': 'Lulo Principal (Cuenta)',
  'Bonos / Comisiones': 'Lulo Principal (Cuenta)',
  'Prima / Cesantías': 'Lulo Principal (Cuenta)',
  'Servicios Pauta / Clientes': 'Lulo Principal (Cuenta)',
  'Consultoría BI / Dev': 'Lulo Principal (Cuenta)',
  'Dividendos / Acciones': 'Lulo Principal (Cuenta)',
  'Entre Cuentas Propias': 'Lulo Principal (Cuenta)',
  'Pago Tarjeta de Crédito': 'Lulo Principal (Cuenta)',
  'Aporte Ahorro / Inversión': 'Lulo Principal (Cuenta)',

  // Restaurantes / Salidas / Farmacia -> Nequi
  'Restaurante / Domicilios': 'Nequi',
  'Cafetería / Snacks': 'Nequi',
  'Salidas / Entretenimiento': 'Nequi',
  'Farmacia / Medicina': 'Nequi',
  'Farmacia / Aseo Mascota': 'Nequi',
  'Veterinaria': 'Nequi',
  'Ventas Directas': 'Nequi',
  'Reembolsos': 'Nequi',

  // Parqueaderos -> Efectivo
  'Peajes / Parqueadero': 'Efectivo',
  'Panadería / Varios': 'Efectivo',
  'Mantenimiento Hogar': 'Efectivo',
  'Hobbies': 'Efectivo',
  'Préstamos Cobrados': 'Efectivo',
  'Varios': 'Efectivo',

  // Mantenimiento Carro/Moto -> Lulo Bolsillo - Carro / Moto
  'Lavado / Mantenimiento': 'Lulo Bolsillo - Carro / Moto',
  'Mantenimiento Carro / Moto': 'Lulo Bolsillo - Carro / Moto',
  'Mantenimiento Carro/Moto': 'Lulo Bolsillo - Carro / Moto',

  // Vacaciones -> Lulo Bolsillo - Vacaciones
  'Vacaciones': 'Lulo Bolsillo - Vacaciones',

  // Inversión y Ahorro -> Lulo Bolsillo - Ahorro
  'Fondo de Emergencia': 'Lulo Bolsillo - Ahorro',
  'CDT / Renta Fija': 'Lulo Bolsillo - Ahorro',
  'Ahorro Programado': 'Lulo Bolsillo - Ahorro',
  'Rendimientos Lulo': 'Lulo Bolsillo - Ahorro',
};



