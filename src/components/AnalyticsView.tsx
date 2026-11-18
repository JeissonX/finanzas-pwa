import { useState, useEffect, useMemo } from 'react';
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import {
  Car,
  ArrowDownRight,
  Pencil,
  X,
  Check,
  Flame,
  ShieldCheck,
  TrendingUp,
  Layers,
  Fuel,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  formatCOP,
  calcEquivalentesEA,
  haptic,
  formatDisplay,
  parseAmount,
  isDateInCurrentCycle,
  getBogotaDateParts,
} from '../utils/format';
import {
  fetchAppData,
  DEFAULT_APPDATA,
  type AppData,
  createTanqueada,
  updateTanqueada,
  deleteTanqueada,
} from '../services/api';
import type { Tanqueada, VehiculoGasolina } from '../types/finance';

const PALETTE = [
  '#2563EB', '#059669', '#E11D48', '#D97706',
  '#7C3AED', '#0891B2', '#EA580C', '#4F46E5', '#DB2777',
];

export interface AmortizationRun {
  months: number;
  interestTotal: number;
  principalTotal: number;
  paymentsTotal: number;
  residualBalance: number;
}

/** Simula el cronograma mes a mes hasta saldo 0 con sistema de amortización francés */
function amortizeSchedule(
  principal: number,
  monthlyPayment: number,
  monthlyRate: number
): AmortizationRun {
  if (principal <= 0 || monthlyPayment <= 0) {
    return { months: 0, interestTotal: 0, principalTotal: 0, paymentsTotal: 0, residualBalance: 0 };
  }

  if (monthlyRate <= 0) {
    const months = Math.ceil(principal / monthlyPayment);
    return {
      months,
      interestTotal: 0,
      principalTotal: Math.round(principal),
      paymentsTotal: Math.round(principal),
      residualBalance: 0,
    };
  }

  const firstMonthInterest = Math.round(principal * monthlyRate);
  if (monthlyPayment <= firstMonthInterest) {
    return {
      months: 999,
      interestTotal: Infinity,
      principalTotal: Math.round(principal),
      paymentsTotal: Infinity,
      residualBalance: Math.round(principal),
    };
  }

  let balance = principal;
  let months = 0;
  let interestTotal = 0;
  let principalTotal = 0;
  let paymentsTotal = 0;
  const MAX_MONTHS = 360;

  while (balance > 0.01 && months < MAX_MONTHS) {
    months++;
    const interest = Math.round(balance * monthlyRate);
    interestTotal += interest;

    const totalDue = balance + interest;
    if (monthlyPayment >= totalDue) {
      principalTotal += balance;
      paymentsTotal += totalDue;
      balance = 0;
      break;
    } else {
      const principalPaid = monthlyPayment - interest;
      principalTotal += principalPaid;
      paymentsTotal += monthlyPayment;
      balance -= principalPaid;
    }
  }

  return {
    months,
    interestTotal: Math.round(interestTotal),
    principalTotal: Math.round(principalTotal),
    paymentsTotal: Math.round(paymentsTotal),
    residualBalance: Math.round(balance),
  };
}

/** Calcula la nueva cuota fija exacta (anualidad) sobre el nuevo saldo y meses restantes */
function calculateNewPayment(
  principal: number,
  monthlyRate: number,
  remainingMonths: number
): number {
  if (principal <= 0 || remainingMonths <= 0) return 0;
  if (monthlyRate <= 0) return Math.round(principal / remainingMonths);

  const factor = Math.pow(1 + monthlyRate, remainingMonths);
  const payment = principal * ((monthlyRate * factor) / (factor - 1));
  return Math.round(payment);
}

/** Asigna un emoji coherente a cada macrocategoría del catálogo */
function getMacroIcon(macro: string): string {
  const m = macro.toLowerCase();
  if (m.includes('vivienda') || m.includes('hogar') || m.includes('servicio')) return '🏠';
  if (m.includes('aliment') || m.includes('mercado') || m.includes('comida')) return '🛒';
  if (m.includes('transporte') || m.includes('gasolina') || m.includes('carro') || m.includes('moto')) return '🚗';
  if (m.includes('salud') || m.includes('bienestar') || m.includes('farmacia') || m.includes('médic')) return '🩺';
  if (m.includes('ocio') || m.includes('suscrip') || m.includes('viaje') || m.includes('entreten')) return '🍿';
  if (m.includes('deuda') || m.includes('obligac') || m.includes('credito') || m.includes('crédito') || m.includes('prestam')) return '💳';
  if (m.includes('educa') || m.includes('curso') || m.includes('libro')) return '📚';
  if (m.includes('mascota') || m.includes('veterin')) return '🐾';
  if (m.includes('hormiga') || m.includes('gusto') || m.includes('personal') || m.includes('ropa')) return '☕';
  return '🏷️';
}

export default function AnalyticsView() {
  const [appData, setAppData] = useState<AppData>(DEFAULT_APPDATA);

  // ── Parametrización Tasa Mazda ──────────────────────────────
  const [tasaMazda, setTasaMazda] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('finanzas_tasa_mazda');
      if (stored) {
        const val = parseFloat(stored);
        if (!isNaN(val) && val > 0) return val;
      }
    } catch { /* noop */ }
    return 21.35;
  });

  const [modalMazdaOpen, setModalMazdaOpen] = useState(false);
  const [inputMazda, setInputMazda] = useState('');

  // ── Simulador de Abono Extraordinario Mazda ─────────────────
  const [abonoSimulado, setAbonoSimulado] = useState<number>(1_000_000);
  const [abonoInput, setAbonoInput] = useState<string>('1.000.000');
  const [escenarioSimulador, setEscenarioSimulador] = useState<'plazo' | 'cuota'>('plazo');

  // ── Módulo de Control de Gasolina ───────────────────────────
  const [vehiculoGasolina, setVehiculoGasolina] = useState<VehiculoGasolina>('MAZDA_2');

  // Modal Nueva Tanqueada
  const [modalTanqueadaOpen, setModalTanqueadaOpen] = useState(false);
  const [tVehiculo, setTVehiculo] = useState<VehiculoGasolina>('MAZDA_2');
  const [tFecha, setTFecha] = useState(() => {
    const { year, month, day } = getBogotaDateParts();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  });
  const [tMonto, setTMonto] = useState('');
  const [tKm, setTKm] = useState('');
  const [tGalones, setTGalones] = useState('');
  const [tTanqueLleno, setTTanqueLleno] = useState(true);
  const [tEstacion, setTEstacion] = useState('');
  const [tNota, setTNota] = useState('');
  const [savingTanqueada, setSavingTanqueada] = useState(false);
  const [errorTanqueada, setErrorTanqueada] = useState<string | null>(null);

  // Modal Editar Tanqueada
  const [tanqueadaToEdit, setTanqueadaToEdit] = useState<Tanqueada | null>(null);
  const [editVehiculo, setEditVehiculo] = useState<VehiculoGasolina>('MAZDA_2');
  const [editFecha, setEditFecha] = useState('');
  const [editMonto, setEditMonto] = useState('');
  const [editKm, setEditKm] = useState('');
  const [editGalones, setEditGalones] = useState('');
  const [editTanqueLleno, setEditTanqueLleno] = useState(true);
  const [editEstacion, setEditEstacion] = useState('');
  const [editNota, setEditNota] = useState('');
  const [isUpdatingTanqueada, setIsUpdatingTanqueada] = useState(false);
  const [errorEditTanqueada, setErrorEditTanqueada] = useState<string | null>(null);

  useEffect(() => {
    fetchAppData().then(data => setAppData(data)).catch(() => {});
    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail) setAppData(custom.detail);
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  useEffect(() => {
    if (appData.tasas?.mazda && !localStorage.getItem('finanzas_tasa_mazda')) {
      setTasaMazda(appData.tasas.mazda);
    }
  }, [appData.tasas]);

  const saldos = appData.saldos;
  const gastosTotal = appData.kpis.gastos;
  const ingresosTotal = appData.kpis.ingresos;

  // ── Cálculo de días restantes del ciclo (corte el día 24 en Bogotá) ────
  const { year: bYear, month: bMonth, day: bDay } = getBogotaDateParts();
  let diasRestantesCorte24 = 1;
  if (bDay < 24) {
    diasRestantesCorte24 = 24 - bDay;
  } else if (bDay === 24) {
    diasRestantesCorte24 = 1;
  } else {
    const ultimoDiaMes = new Date(bYear, bMonth, 0).getDate();
    diasRestantesCorte24 = (ultimoDiaMes - bDay) + 24;
  }

  const balanceDisponible = appData.kpis.balanceDisponible ?? appData.kpis.balance;
  const ritmoDiario = Math.max(0, Math.round(balanceDisponible / diasRestantesCorte24));

  // ── BLOQUE 1: AGRUPACIÓN DINÁMICA POR MACROCATEGORÍA ────────────────
  const macrosData = useMemo(() => {
    const map = new Map<string, { macro: string; gastado: number; presupuesto: number; ordenMacro: number }>();

    // 1. Presupuestos configurados en Supabase
    (appData.presupuestos || []).forEach(p => {
      const macro = (p.macro || (p as any).macro_categoria || 'Otros').trim();
      const existing = map.get(macro) || { macro, gastado: 0, presupuesto: 0, ordenMacro: p.orden_macro ?? 99 };
      existing.presupuesto += Number(p.presupuesto) || 0;
      if (p.orden_macro != null && p.orden_macro < existing.ordenMacro) {
        existing.ordenMacro = p.orden_macro;
      }
      map.set(macro, existing);
    });

    // 2. Gastado real del ciclo activo
    Object.entries(appData.gastadoPorMacro || {}).forEach(([macro, gastado]) => {
      const m = macro.trim();
      const existing = map.get(m) || { macro: m, gastado: 0, presupuesto: 0, ordenMacro: 99 };
      existing.gastado = Number(gastado) || 0;
      map.set(m, existing);
    });

    // Filtrar únicamente aquellas con actividad o presupuesto > 0
    const list = Array.from(map.values()).filter(item => item.gastado > 0 || item.presupuesto > 0);

    // Ordenar de mayor a menor gastado (desempate por presupuesto desc)
    list.sort((a, b) => {
      if (b.gastado !== a.gastado) return b.gastado - a.gastado;
      return b.presupuesto - a.presupuesto;
    });

    const totalGastado = list.reduce((acc, m) => acc + m.gastado, 0);

    return {
      list,
      totalGastado,
    };
  }, [appData.presupuestos, appData.gastadoPorMacro]);

  const pieDataDinamico = useMemo(() => {
    return macrosData.list
      .filter(m => m.gastado > 0)
      .map((m, i) => ({
        name: m.macro,
        value: m.gastado,
        color: PALETTE[i % PALETTE.length],
      }));
  }, [macrosData.list]);

  // ── BLOQUE 3: PATRIMONIO NETO CON PRÉSTAMOS POR COBRAR Y RUNWAY DINÁMICO ──
  const activosCarteras = useMemo(() => {
    const list = (appData.carteras || []).filter(c => c.activa !== false);
    if (list.length > 0) {
      return list
        .filter(c => (c.saldo_actual ?? c.saldo ?? 0) > 0)
        .reduce((acc, c) => acc + (c.saldo_actual ?? c.saldo ?? 0), 0);
    }
    return Object.entries(saldos).reduce((acc, [cuenta, saldo]) => {
      const cl = cuenta.toLowerCase();
      if (!cl.includes('crédito') && !cl.includes('credito') && saldo > 0) {
        return acc + saldo;
      }
      return acc;
    }, 0);
  }, [appData.carteras, saldos]);

  const prestamosPorCobrar = useMemo(() => {
    return (appData.prestamos || [])
      .filter(p => p.estado === 'PENDIENTE')
      .reduce((acc, p) => acc + (Number(p.monto) || 0), 0);
  }, [appData.prestamos]);

  const pasivosDeudas = useMemo(() => {
    const list = (appData.carteras || []).filter(c => c.activa !== false);
    if (list.length > 0) {
      return list
        .filter(c => (c.saldo_actual ?? c.saldo ?? 0) < 0)
        .reduce((acc, c) => acc + Math.abs(c.saldo_actual ?? c.saldo ?? 0), 0);
    }
    return Object.entries(saldos).reduce((acc, [cuenta, saldo]) => {
      const cl = cuenta.toLowerCase();
      if (cl.includes('crédito') || cl.includes('credito') || saldo < 0) {
        return acc + Math.abs(saldo);
      }
      return acc;
    }, 0);
  }, [appData.carteras, saldos]);

  const patrimonioNetoReal = activosCarteras + prestamosPorCobrar - pasivosDeudas;

  // Runway · Fondo de Reserva dinámico según presupuesto esencial
  const costoFijoMensual = useMemo(() => {
    const ESSENTIAL_SET = new Set([
      'vivienda y servicios',
      'alimentación',
      'alimentacion',
      'transporte',
      'pago deuda',
      'obligaciones financieras',
      'vivienda / hogar',
      'servicios públicos',
      'servicios publicos',
    ]);
    let suma = 0;
    (appData.presupuestos || []).forEach(p => {
      const m = (p.macro || (p as any).macro_categoria || '').trim().toLowerCase();
      if (ESSENTIAL_SET.has(m)) {
        suma += Number(p.presupuesto) || 0;
      }
    });
    return suma > 0 ? suma : 2_264_731;
  }, [appData.presupuestos]);

  const saldoReserva = saldos['Lulo Bolsillo - Ahorro'] ?? 0;
  const runwayMeses = costoFijoMensual > 0 ? saldoReserva / costoFijoMensual : 0;
  const pctRunwayMeta = Math.min((runwayMeses / 3) * 100, 100);

  const runwayColorClass = runwayMeses >= 3
    ? 'text-emerald-600 dark:text-emerald-400'
    : runwayMeses >= 1
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-rose-600 dark:text-rose-400';

  const runwayBarClass = runwayMeses >= 3
    ? 'bg-emerald-500'
    : runwayMeses >= 1
    ? 'bg-amber-500'
    : 'bg-rose-500';

  const runwayBadgeClass = runwayMeses >= 3
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
    : runwayMeses >= 1
    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
    : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800';

  const runwayBadgeLabel = runwayMeses >= 3 ? 'Meta Superada' : runwayMeses >= 1 ? 'En Construcción' : 'Alerta Mínima';

  // ── BLOQUE 4: SIMULADOR CRÉDITO MAZDA 2 ──────────────────────
  const cuotaRegular = 815_731;
  const rawDeudaMazda = saldos['Crédito Mazda 2 (Lulo)'] ?? 0;
  const deudaViva = Math.abs(rawDeudaMazda);

  // Tasa mensual efectiva: (1 + EA)^(1/12) - 1 (~1.6259% MV con 21.35% EA)
  const i_mes = Math.pow(1 + (tasaMazda / 100), 1 / 12) - 1;
  const interesMesBanco = deudaViva > 0 ? Math.round(deudaViva * i_mes) : 0;
  const abonoCapitalCuota = deudaViva > 0 ? Math.max(0, cuotaRegular - interesMesBanco) : cuotaRegular;

  // Proyección de patrimonio a 6 meses amortizando cuota
  const evolucionPatrimonio = useMemo(() => {
    const puntos = [];
    const baseDate = new Date();
    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    for (let i = 0; i <= 5; i++) {
      const mDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const label = i === 0 ? 'Actual' : `+${i}M (${mesesNombres[mDate.getMonth()]})`;
      const capitalAbonadoAcum = abonoCapitalCuota * i;
      const netProyectado = patrimonioNetoReal + capitalAbonadoAcum;
      puntos.push({
        mes: label,
        patrimonio: netProyectado,
        activos: activosCarteras + prestamosPorCobrar,
        pasivos: Math.max(0, pasivosDeudas - capitalAbonadoAcum),
      });
    }
    return puntos;
  }, [patrimonioNetoReal, abonoCapitalCuota, activosCarteras, prestamosPorCobrar, pasivosDeudas]);

  // Abono simulado efectivo acotado a la deuda viva
  const abonoEfectivo = Math.min(abonoSimulado, deudaViva);

  // Simulación período a período con sistema francés
  const baseRun = useMemo(() => {
    return amortizeSchedule(deudaViva, cuotaRegular, i_mes);
  }, [deudaViva, cuotaRegular, i_mes]);

  const extraRun = useMemo(() => {
    const principalConAbono = Math.max(0, deudaViva - abonoEfectivo);
    return amortizeSchedule(principalConAbono, cuotaRegular, i_mes);
  }, [deudaViva, abonoEfectivo, cuotaRegular, i_mes]);

  // Escenario Reducir Plazo
  const cuotasAhorradas = Math.max(0, baseRun.months - extraRun.months);
  const interesTotalAhorrado = Math.max(0, baseRun.interestTotal - extraRun.interestTotal);

  // Escenario Reducir Cuota
  const nuevoSaldoCuota = Math.max(0, deudaViva - abonoEfectivo);
  const nuevaCuotaEstimada = baseRun.months > 0 && nuevoSaldoCuota > 0
    ? calculateNewPayment(nuevoSaldoCuota, i_mes, baseRun.months)
    : 0;
  const reduccionCuotaMensual = Math.max(0, cuotaRegular - nuevaCuotaEstimada);

  const handleOpenMazdaModal = () => {
    setInputMazda(tasaMazda.toString());
    setModalMazdaOpen(true);
    haptic();
  };

  const handleSaveMazda = (nueva: number) => {
    if (isNaN(nueva) || nueva <= 0) return;
    setTasaMazda(nueva);
    try {
      localStorage.setItem('finanzas_tasa_mazda', nueva.toString());
    } catch { /* noop */ }
    haptic();
    setModalMazdaOpen(false);
  };

  const previewMazdaRates = calcEquivalentesEA(parseFloat(inputMazda) || tasaMazda);

  // ── BLOQUE 2: CONTROL Y RENDIMIENTO DE GASOLINA ─────────────
  const datosGasolina = useMemo(() => {
    const list = (appData.tanqueadas || []).filter(
      (t) => t.vehiculo === vehiculoGasolina
    );

    // Orden ascendente cronológico (desempata por odómetro)
    const ascList = [...list].sort((a, b) => {
      const timeA = new Date(a.fecha).getTime();
      const timeB = new Date(b.fecha).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const kmA = a.kilometraje != null ? Number(a.kilometraje) : 0;
      const kmB = b.kilometraje != null ? Number(b.kilometraje) : 0;
      return kmA - kmB;
    });

    const tramosMap = new Map<
      string,
      {
        deltaKm: number | null;
        kmPorGalon: number | null;
        costoPorKm: number | null;
        galonesTramo?: number;
        montoTramo?: number;
        isBase?: boolean;
      }
    >();

    let kmAncla: number | null = null;
    let galonesAcumuladosParciales = 0;
    let montoAcumuladoParciales = 0;

    let sumaTotalKm = 0;
    let sumaTotalGalones = 0;
    let sumaTotalMonto = 0;
    let tramosCompletados = 0;

    for (let i = 0; i < ascList.length; i++) {
      const curr = ascList[i];
      const currKm =
        curr.kilometraje != null &&
        !isNaN(Number(curr.kilometraje)) &&
        Number(curr.kilometraje) > 0
          ? Number(curr.kilometraje)
          : null;
      const currGal =
        curr.galones != null &&
        !isNaN(Number(curr.galones)) &&
        Number(curr.galones) > 0
          ? Number(curr.galones)
          : 0;
      const currMonto = Number(curr.monto) || 0;

      if (curr.tanque_lleno && currKm != null) {
        if (kmAncla === null) {
          // Tanqueada base/ancla inicial: fija el odómetro de partida pero sus galones y costo no computan al tramo
          kmAncla = currKm;
          galonesAcumuladosParciales = 0;
          montoAcumuladoParciales = 0;
          tramosMap.set(curr.id, {
            deltaKm: null,
            kmPorGalon: null,
            costoPorKm: null,
            isBase: true,
          });
        } else if (currKm > kmAncla) {
          // Cierre de tramo entre dos tanqueadas llenas con avance positivo de kilometraje
          const deltaKm = currKm - kmAncla;
          const galonesTotalesTramo = currGal + galonesAcumuladosParciales;
          const montoTotalTramo = currMonto + montoAcumuladoParciales;

          if (deltaKm > 0 && galonesTotalesTramo > 0) {
            const kmPorGalon = Number((deltaKm / galonesTotalesTramo).toFixed(1));
            const costoPorKm = Math.round(montoTotalTramo / deltaKm);

            tramosMap.set(curr.id, {
              deltaKm,
              kmPorGalon,
              costoPorKm,
              galonesTramo: galonesTotalesTramo,
              montoTramo: montoTotalTramo,
              isBase: false,
            });

            sumaTotalKm += deltaKm;
            sumaTotalGalones += galonesTotalesTramo;
            sumaTotalMonto += montoTotalTramo;
            tramosCompletados += 1;
          } else {
            tramosMap.set(curr.id, {
              deltaKm: null,
              kmPorGalon: null,
              costoPorKm: null,
              isBase: false,
            });
          }

          // La actual se convierte en la nueva ancla para el siguiente tramo
          kmAncla = currKm;
          galonesAcumuladosParciales = 0;
          montoAcumuladoParciales = 0;
        } else {
          // Odómetro no avanzó o es inconsistente
          tramosMap.set(curr.id, {
            deltaKm: null,
            kmPorGalon: null,
            costoPorKm: null,
            isBase: false,
          });
        }
      } else {
        // Carga parcial o tanqueada sin odómetro válido: acumular si ya hay un ancla de inicio
        if (kmAncla !== null) {
          galonesAcumuladosParciales += currGal;
          montoAcumuladoParciales += currMonto;
        }
        tramosMap.set(curr.id, {
          deltaKm: null,
          kmPorGalon: null,
          costoPorKm: null,
          isBase: false,
        });
      }
    }

    const rendimientoPromedio =
      tramosCompletados > 0 && sumaTotalGalones > 0 && sumaTotalKm > 0
        ? `${(sumaTotalKm / sumaTotalGalones).toFixed(1)} km/gal`
        : 'Requiere 2 tanqueadas full';

    const costoPromedioKm =
      tramosCompletados > 0 && sumaTotalKm > 0 && sumaTotalMonto > 0
        ? `${formatCOP(Math.round(sumaTotalMonto / sumaTotalKm))}/km`
        : '—';

    // Gasto del ciclo actual
    const tanqueadasCiclo = list.filter((t) => isDateInCurrentCycle(t.fecha));
    const gastoCicloCOP = tanqueadasCiclo.reduce((sum, t) => sum + (Number(t.monto) || 0), 0);
    const galonesCiclo = tanqueadasCiclo.reduce((sum, t) => sum + (Number(t.galones) || 0), 0);

    // Último odómetro
    const kmList = list
      .filter((t) => t.kilometraje != null && !isNaN(Number(t.kilometraje)) && Number(t.kilometraje) > 0)
      .map((t) => Number(t.kilometraje));
    const ultimoOdometro = kmList.length > 0 ? Math.max(...kmList) : null;

    // Lista descendente
    const listDesc = [...list].sort(
      (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
    );

    return {
      listDesc,
      tramosMap,
      rendimientoPromedio,
      costoPromedioKm,
      gastoCicloCOP,
      galonesCiclo,
      ultimoOdometro,
      totalTanqueadas: list.length,
    };
  }, [appData.tanqueadas, vehiculoGasolina]);

  // Handlers para tanqueadas
  const handleOpenNewTanqueada = () => {
    haptic();
    setTVehiculo(vehiculoGasolina);
    const { year, month, day } = getBogotaDateParts();
    setTFecha(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    setTMonto('');
    setTKm('');
    setTGalones('');
    setTTanqueLleno(true);
    setTEstacion('');
    setTNota('');
    setErrorTanqueada(null);
    setModalTanqueadaOpen(true);
  };

  const handleSaveNewTanqueada = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMonto = parseAmount(tMonto);
    if (cleanMonto <= 0) {
      setErrorTanqueada('El monto debe ser mayor a 0');
      return;
    }

    setSavingTanqueada(true);
    setErrorTanqueada(null);
    haptic(50);
    try {
      const cleanKm = tKm ? parseInt(tKm.replace(/\D/g, ''), 10) : null;
      const cleanGal = tGalones ? parseFloat(tGalones.replace(',', '.')) : null;

      await createTanqueada({
        vehiculo: tVehiculo,
        fecha: new Date(tFecha + 'T12:00:00-05:00').toISOString(),
        monto: cleanMonto,
        kilometraje: cleanKm && !isNaN(cleanKm) ? cleanKm : null,
        galones: cleanGal && !isNaN(cleanGal) ? Number(cleanGal.toFixed(3)) : null,
        precio_galon: cleanGal && cleanGal > 0 ? Math.trunc(cleanMonto / cleanGal) : null,
        tanque_lleno: tTanqueLleno,
        estacion: tEstacion.trim() || null,
        nota: tNota.trim() || null,
      });

      const updated = await fetchAppData(true);
      setAppData(updated);
      setModalTanqueadaOpen(false);
    } catch (err: any) {
      console.error('Error guardando tanqueada:', err);
      setErrorTanqueada(err?.message || 'Error al guardar la tanqueada');
    } finally {
      setSavingTanqueada(false);
    }
  };

  const handleOpenEditTanqueada = (t: Tanqueada) => {
    haptic();
    setTanqueadaToEdit(t);
    setEditVehiculo(t.vehiculo);
    setEditFecha(t.fecha.slice(0, 10));
    setEditMonto(formatDisplay(String(t.monto)));
    setEditKm(t.kilometraje != null ? String(t.kilometraje) : '');
    setEditGalones(t.galones != null ? String(t.galones) : '');
    setEditTanqueLleno(t.tanque_lleno);
    setEditEstacion(t.estacion || '');
    setEditNota(t.nota || '');
    setErrorEditTanqueada(null);
  };

  const handleUpdateTanqueada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tanqueadaToEdit) return;
    const cleanMonto = parseAmount(editMonto);
    if (cleanMonto <= 0) {
      setErrorEditTanqueada('El monto debe ser mayor a 0');
      return;
    }

    setIsUpdatingTanqueada(true);
    setErrorEditTanqueada(null);
    haptic(50);
    try {
      const cleanKm = editKm ? parseInt(editKm.replace(/\D/g, ''), 10) : null;
      const cleanGal = editGalones ? parseFloat(editGalones.replace(',', '.')) : null;

      await updateTanqueada(tanqueadaToEdit.id, {
        vehiculo: editVehiculo,
        fecha: new Date(editFecha + 'T12:00:00-05:00').toISOString(),
        monto: cleanMonto,
        kilometraje: cleanKm && !isNaN(cleanKm) ? cleanKm : null,
        galones: cleanGal && !isNaN(cleanGal) ? Number(cleanGal.toFixed(3)) : null,
        precio_galon: cleanGal && cleanGal > 0 ? Math.trunc(cleanMonto / cleanGal) : null,
        tanque_lleno: editTanqueLleno,
        estacion: editEstacion.trim() || null,
        nota: editNota.trim() || null,
      });

      const updated = await fetchAppData(true);
      setAppData(updated);
      setTanqueadaToEdit(null);
    } catch (err: any) {
      console.error('Error actualizando tanqueada:', err);
      setErrorEditTanqueada(err?.message || 'Error al actualizar la tanqueada');
    } finally {
      setIsUpdatingTanqueada(false);
    }
  };

  const handleDeleteTanqueada = async (t: Tanqueada) => {
    haptic(50);
    const confirmed = window.confirm(
      `¿Deseas eliminar la tanqueada de ${formatCOP(t.monto)} del ${new Date(t.fecha).toLocaleDateString('es-CO')}?`
    );
    if (!confirmed) return;

    try {
      await deleteTanqueada(t.id);
      const updated = await fetchAppData(true);
      setAppData(updated);
    } catch (err: any) {
      console.error('Error eliminando tanqueada:', err);
      alert(err?.message || 'Error al eliminar tanqueada');
    }
  };

  const formatPatrimonioAxis = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-3 animate-fade-in max-w-lg mx-auto w-full">

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ── BLOQUE 1: PULSO DEL CICLO Y DISTRIBUCIÓN POR MACRO ──────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        {/* Pulso del Ciclo & Gasto Diario Sugerido */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                  Gasto Máximo Sugerido / Día
                </span>
                <p className={`text-2xl sm:text-3xl font-black tracking-tight font-mono tabular-nums ${balanceDisponible > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {formatCOP(ritmoDiario)}
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans ml-1">/día</span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                {diasRestantesCorte24 === 1 ? 'Último día del ciclo' : `Faltan ${diasRestantesCorte24} días`}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">
                Corte: 24 del mes
              </span>
            </div>
          </div>

          {/* 4 Indicadores clave del ciclo activo */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                Ingresos Ciclo
              </span>
              <span className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono block tabular-nums">
                {formatCOP(ingresosTotal)}
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                Gastos Ciclo
              </span>
              <span className="text-xs sm:text-sm font-black text-rose-600 dark:text-rose-400 font-mono block tabular-nums">
                {formatCOP(gastosTotal)}
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                Disponible
              </span>
              <span className={`text-xs sm:text-sm font-black font-mono block tabular-nums ${balanceDisponible >= 0 ? 'text-slate-900 dark:text-slate-100' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatCOP(balanceDisponible)}
              </span>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                Tasa Ahorro
              </span>
              <span className={`text-xs sm:text-sm font-black font-mono block tabular-nums ${appData.kpis.tasaAhorro >= 20 ? 'text-blue-600 dark:text-blue-400' : appData.kpis.tasaAhorro >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {appData.kpis.tasaAhorro.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Distribución de Gastos por Categoría (Ciclo Actual) */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  Distribución de Gastos por Categoría
                </h2>
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  Ciclo Actual · Ejecución vs. Presupuesto Base
                </p>
              </div>
            </div>
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 font-mono">
              Total: {formatCOP(macrosData.totalGastado)}
            </span>
          </div>

          {/* Gráfico Donut si hay gastos registrados */}
          {pieDataDinamico.length > 0 && (
            <div className="w-full h-44 -my-1">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieDataDinamico}
                    cx="50%"
                    cy="50%"
                    innerRadius={46}
                    outerRadius={68}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieDataDinamico.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0];
                      return (
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs shadow-lg font-sans">
                          <p className="font-bold text-slate-900 dark:text-slate-100 mb-0.5">{item.name}</p>
                          <p className="text-indigo-600 dark:text-indigo-400 font-mono font-bold">
                            {formatCOP(item.value as number)}
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Lista detallada con barras de progreso y semáforo */}
          {macrosData.list.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              No hay presupuestos ni gastos registrados en el ciclo activo.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {macrosData.list.map((m) => {
                const pctGastoTotal = macrosData.totalGastado > 0 ? (m.gastado / macrosData.totalGastado) * 100 : 0;
                const pctPresupuesto = m.presupuesto > 0 ? (m.gastado / m.presupuesto) * 100 : 0;

                let semaforoBar = 'bg-emerald-500';
                let semaforoText = 'text-emerald-600 dark:text-emerald-400';
                if (pctPresupuesto > 100) {
                  semaforoBar = 'bg-rose-500';
                  semaforoText = 'text-rose-600 dark:text-rose-400';
                } else if (pctPresupuesto >= 80) {
                  semaforoBar = 'bg-amber-500';
                  semaforoText = 'text-amber-600 dark:text-amber-400';
                }

                return (
                  <div key={m.macro} className="py-2.5 first:pt-1 last:pb-1 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-base flex-shrink-0">{getMacroIcon(m.macro)}</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                          {m.macro}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono font-medium flex-shrink-0">
                          ({pctGastoTotal.toFixed(1)}% mes)
                        </span>
                      </div>
                      <div className="text-right flex-shrink-0 font-mono">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {formatCOP(m.gastado)}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 text-[11px] font-medium ml-1">
                          / {formatCOP(m.presupuesto)}
                        </span>
                      </div>
                    </div>

                    {/* Barra de progreso con semáforo */}
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${semaforoBar}`}
                        style={{ width: `${Math.min(pctPresupuesto, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400">
                      <span className={semaforoText}>
                        {m.presupuesto > 0 ? `${pctPresupuesto.toFixed(0)}% ejecutado` : 'Sin presupuesto fijado'}
                      </span>
                      <span>
                        {m.presupuesto >= m.gastado
                          ? `Disponible: ${formatCOP(m.presupuesto - m.gastado)}`
                          : `Excedido: ${formatCOP(m.gastado - m.presupuesto)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ── BLOQUE 2: CONTROL Y RENDIMIENTO DE GASOLINA ───────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-3.5">
        {/* Encabezado con selector de vehículo y botón + Tanqueada */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <Fuel className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Control y Rendimiento de Gasolina
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Histórico de odómetro y eficiencia por combustible
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            {/* Selector de vehículo */}
            <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
              <button
                type="button"
                onClick={() => {
                  haptic();
                  setVehiculoGasolina('MAZDA_2');
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  vehiculoGasolina === 'MAZDA_2'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                🚗 Mazda 2
              </button>
              <button
                type="button"
                onClick={() => {
                  haptic();
                  setVehiculoGasolina('MOTOCICLETA');
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  vehiculoGasolina === 'MOTOCICLETA'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                🏍️ Motocicleta
              </button>
            </div>

            <button
              type="button"
              onClick={handleOpenNewTanqueada}
              className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-xs font-bold shadow-xs transition flex items-center gap-1 cursor-pointer active:scale-95"
            >
              <Plus size={13} />
              <span>Tanqueada</span>
            </button>
          </div>
        </div>

        {/* 4 KPIs calculados del vehículo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
              Rendimiento Prom.
            </span>
            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 font-mono block">
              {datosGasolina.rendimientoPromedio}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 block mt-0.5">
              Método full to full
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
              Costo por km
            </span>
            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 font-mono block">
              {datosGasolina.costoPromedioKm}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 block mt-0.5">
              Gasto real combustible
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
              Gasto Ciclo Activo
            </span>
            <span className="text-xs sm:text-sm font-black text-rose-600 dark:text-rose-400 font-mono block">
              {formatCOP(datosGasolina.gastoCicloCOP)}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 block mt-0.5">
              {datosGasolina.galonesCiclo > 0 ? `${datosGasolina.galonesCiclo.toFixed(2)} gal` : 'Sin cargas este ciclo'}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
              Último Odómetro
            </span>
            <span className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 font-mono block">
              {datosGasolina.ultimoOdometro ? `${datosGasolina.ultimoOdometro.toLocaleString('es-CO')} km` : '—'}
            </span>
            <span className="text-[9px] text-slate-400 dark:text-slate-500 block mt-0.5">
              Lectura odómetro
            </span>
          </div>
        </div>

        {/* Histórico de tanqueadas del vehículo */}
        <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900/60">
          <div className="px-3.5 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              Histórico ({datosGasolina.totalTanqueadas} registros)
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {vehiculoGasolina === 'MAZDA_2' ? 'Mazda 2' : 'Motocicleta'}
            </span>
          </div>

          {datosGasolina.listDesc.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400 dark:text-slate-500">
              No hay tanqueadas registradas aún para este vehículo.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/70 max-h-80 overflow-y-auto">
              {datosGasolina.listDesc.map((t) => {
                const tramo = datosGasolina.tramosMap.get(t.id);
                const fechaFormat = new Date(t.fecha).toLocaleDateString('es-CO', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                });

                return (
                  <div
                    key={t.id}
                    className="p-3 flex items-center justify-between gap-2.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {fechaFormat}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                            t.tanque_lleno
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {t.tanque_lleno ? 'Full' : 'Parcial'}
                        </span>
                        {t.estacion && (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                            · {t.estacion}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {t.kilometraje != null ? (
                          <span>
                            {t.kilometraje.toLocaleString('es-CO')} km
                            {tramo?.deltaKm ? (
                              <strong className="text-emerald-600 dark:text-emerald-400 ml-1">
                                (+{tramo.deltaKm} km)
                              </strong>
                            ) : tramo?.isBase ? (
                              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 ml-1">
                                (ancla)
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">Sin km</span>
                        )}
                        <span>·</span>
                        <span>{t.galones != null ? `${t.galones} gal` : '—'}</span>
                        {t.precio_galon ? <span>· {formatCOP(t.precio_galon)}/gal</span> : null}
                      </div>

                      {t.nota && (
                        <p className="text-[10px] italic text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                          {t.nota}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100 block">
                          {formatCOP(t.monto)}
                        </span>
                        {tramo?.kmPorGalon ? (
                          <>
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 font-mono block">
                              {tramo.kmPorGalon} km/gal
                            </span>
                            {tramo.costoPorKm ? (
                              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono block">
                                {formatCOP(tramo.costoPorKm)}/km
                              </span>
                            ) : null}
                          </>
                        ) : tramo?.isBase ? (
                          <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 font-mono block">
                            Base inicial
                          </span>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenEditTanqueada(t)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                        title="Editar datos de tanqueada"
                      >
                        <Pencil size={13} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteTanqueada(t)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                        title="Eliminar tanqueada"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ── BLOQUE 3: PATRIMONIO NETO CON PRÉSTAMOS Y RUNWAY DINÁMICO ─ */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <section className="space-y-3">
        {/* Card Patrimonio Neto Consolidado */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  Patrimonio Neto Consolidado
                </h2>
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  Liquidez + Préstamos por Cobrar - Deudas
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                Patrimonio Neto
              </span>
              <span className={`text-base sm:text-lg font-black font-mono tabular-nums ${patrimonioNetoReal >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {formatCOP(patrimonioNetoReal)}
              </span>
            </div>
          </div>

          {/* 3 Píldoras de desglose explícitas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* 1. Liquidez y Bolsillos */}
            <div className="p-3 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/50 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                  Liquidez y Bolsillos
                </span>
                <span className="text-xs">💰</span>
              </div>
              <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-1">
                {formatCOP(activosCarteras)}
              </p>
              <span className="text-[9px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                Cuentas y bolsillos activos
              </span>
            </div>

            {/* 2. Préstamos por Cobrar */}
            <div className="p-3 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/80 dark:border-indigo-800/50 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider">
                  Por Cobrar (Préstamos)
                </span>
                <span className="text-xs">🤝</span>
              </div>
              <p className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono tabular-nums mt-1">
                {formatCOP(prestamosPorCobrar)}
              </p>
              <span className="text-[9px] text-indigo-700/80 dark:text-indigo-400/80 mt-0.5">
                {appData.prestamos?.filter(p => p.estado === 'PENDIENTE').length || 0} préstamos pendientes
              </span>
            </div>

            {/* 3. Deuda Total */}
            <div className="p-3 rounded-2xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/50 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider">
                  Deuda Total
                </span>
                <span className="text-xs">💳</span>
              </div>
              <p className="text-sm font-black text-rose-600 dark:text-rose-400 font-mono tabular-nums mt-1">
                {formatCOP(pasivosDeudas)}
              </p>
              <span className="text-[9px] text-rose-700/80 dark:text-rose-400/80 mt-0.5">
                Mazda + Pasivos activos
              </span>
            </div>
          </div>

          {/* Gráfico de Evolución del Patrimonio Neto */}
          <div className="w-full h-44 mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolucionPatrimonio} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="patrimonioRealGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="mes"
                  tick={{ fontSize: 9, fill: 'currentColor' }}
                  className="text-slate-500 dark:text-slate-400"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={formatPatrimonioAxis}
                  tick={{ fontSize: 9, fill: 'currentColor' }}
                  className="text-slate-500 dark:text-slate-400"
                  axisLine={false}
                  tickLine={false}
                  width={45}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = payload[0];
                    return (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs shadow-lg">
                        <p className="font-bold text-slate-900 dark:text-slate-100 mb-1">{label}</p>
                        <p className="text-blue-600 dark:text-blue-400 font-mono font-bold">
                          Patrimonio: {formatCOP(item.value as number)}
                        </p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="patrimonio"
                  name="Patrimonio Neto"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#patrimonioRealGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Runway · Fondo de Reserva (100% Dinámico) */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  Runway · Fondo de Reserva
                </h2>
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  Oxígeno Financiero · Cobertura Costos Esenciales
                </p>
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide ${runwayBadgeClass}`}>
              {runwayBadgeLabel}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div>
              <span className={`text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight ${runwayColorClass}`}>
                {runwayMeses.toFixed(1)} meses
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 ml-2">
                (Meta: 3.0 meses)
              </span>
            </div>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-mono">
              {pctRunwayMeta.toFixed(0)}%
            </span>
          </div>

          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 rounded-full ${runwayBarClass}`}
              style={{ width: `${pctRunwayMeta}%` }}
            />
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium pt-0.5">
            Reserva actual: <strong className="text-slate-800 dark:text-slate-200 font-mono">{formatCOP(saldoReserva)}</strong> · Costo esencial: <strong className="text-slate-800 dark:text-slate-200 font-mono">{formatCOP(costoFijoMensual)}/mes</strong>
          </p>
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ── BLOQUE 4: SIMULADOR CRÉDITO MAZDA 2 ───────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col gap-3.5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Simulador Crédito Mazda 2
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Crédito Consumo · Cuota Fija {formatCOP(cuotaRegular)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenMazdaModal}
            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors shadow-xs cursor-pointer"
            aria-label="Editar tasa de interés crédito Mazda 2"
            title="Editar Tasa E.A. del Crédito"
          >
            <span>{tasaMazda.toFixed(2)}% E.A.</span>
            <Pencil size={10} className="opacity-75" />
          </button>
        </div>

        {/* Deuda Viva Actual */}
        <div className="flex items-baseline justify-between bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-3">
          <div>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
              Deuda Viva Actual
            </span>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {formatCOP(deudaViva)}
            </span>
            {deudaViva === 0 && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 block mt-0.5">
                Al día (Sin saldo de pasivo pendiente)
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2 py-0.5 rounded-lg">
            Pasivo bancario
          </span>
        </div>

        {/* Métricas clave: Interés banco vs Abono cuota */}
        <div className="grid grid-cols-2 gap-2">
          {/* Interés del mes */}
          <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
                Interés Mes
              </span>
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="mt-1">
              <p className="text-base font-black text-rose-600 dark:text-rose-400 font-mono">
                {(i_mes * 100).toFixed(3)}% <span className="text-xs font-semibold text-rose-800 dark:text-rose-300">mes</span>
              </p>
              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-0.5 font-mono">
                {formatCOP(interesMesBanco)}/mes
              </p>
            </div>
          </div>

          {/* Abono a capital de la cuota */}
          <div className="p-3 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wide">
                Abono Capital
              </span>
              <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.2 rounded">
                Cuota $815k
              </span>
            </div>
            <div className="mt-1">
              <p className="text-base font-black text-blue-600 dark:text-blue-400 font-mono">
                {formatCOP(abonoCapitalCuota)}
              </p>
              <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300 mt-0.5">
                de cuota {formatCOP(cuotaRegular)}
              </p>
            </div>
          </div>
        </div>

        {/* Simulador Interactivo de Abono a Capital */}
        <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Abono Extraordinario a Capital
            </span>
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              Impacto directo
            </span>
          </div>

          {/* Chips de monto rápido */}
          <div className="flex gap-1.5">
            {[500_000, 1_000_000, 2_000_000].map(val => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  haptic();
                  setAbonoSimulado(val);
                  setAbonoInput(formatDisplay(String(val)));
                }}
                className={`
                  flex-1 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer
                  ${abonoSimulado === val
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}
                `}
              >
                +${val / 1000}k
              </button>
            ))}
          </div>

          {/* Input de monto libre */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs select-none">
              $
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={abonoInput}
              onChange={e => {
                const num = parseAmount(e.target.value);
                setAbonoSimulado(num);
                setAbonoInput(num > 0 ? formatDisplay(String(num)) : '');
              }}
              placeholder="Monto personalizado a abonar..."
              className="w-full pl-7 pr-3 py-2 rounded-xl text-xs font-bold font-mono bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500 transition"
            />
          </div>

          {/* Toggle de Escenario: [Reducir Plazo] vs [Reducir Cuota] */}
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => { haptic(); setEscenarioSimulador('plazo'); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                escenarioSimulador === 'plazo'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Reducir Plazo
            </button>
            <button
              type="button"
              onClick={() => { haptic(); setEscenarioSimulador('cuota'); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                escenarioSimulador === 'cuota'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Reducir Cuota
            </button>
          </div>

          {/* Caja con resultado según el escenario */}
          <div className="bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl p-4 flex flex-col gap-2">
            {escenarioSimulador === 'plazo' ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Cuotas descontadas de deuda:
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-slate-100 font-mono">
                    ~{cuotasAhorradas} {cuotasAhorradas === 1 ? 'cuota menos' : 'cuotas menos'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Ahorro total en intereses:
                  </span>
                  <span className="text-sm font-black text-rose-600 dark:text-rose-400 font-mono">
                    +{formatCOP(interesTotalAhorrado)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Nueva cuota mensual estimada:
                  </span>
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatCOP(nuevaCuotaEstimada)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Alivio mensual en flujo de caja:
                  </span>
                  <span className="text-xs font-black text-blue-600 dark:text-blue-400 font-mono">
                    -{formatCOP(reduccionCuotaMensual)}/mes
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Alerta de saldo residual si no se amortiza a 360 meses */}
          {(baseRun.residualBalance > 0 || extraRun.residualBalance > 0) && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
              <span>
                Atención: La proyección alcanzó el límite máximo de 360 meses con un saldo residual de {formatCOP(Math.max(baseRun.residualBalance, extraRun.residualBalance))}. La cuota actual no amortiza la totalidad del capital en el plazo proyectado.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* ── MODALES ──────────────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════ */}

      {/* Modal Editar Tasa Crédito Mazda */}
      {modalMazdaOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-3.5 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center text-rose-600 dark:text-rose-400">
                  <Car size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Tasa Crédito Mazda 2
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Ajustar costo financiero del pasivo
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalMazdaOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                Tasa E.A. Personalizada (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0.1"
                  max="100"
                  value={inputMazda}
                  onChange={e => setInputMazda(e.target.value)}
                  placeholder="Ej: 21.35"
                  className="w-full px-3 py-2 rounded-xl text-sm font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-rose-500 font-mono"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  % E.A.
                </span>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-800/60 text-xs flex flex-col gap-1.5">
              <p className="text-[10px] font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
                Cálculos Recalculados en Vivo:
              </p>
              <div className="flex justify-between font-mono text-rose-800 dark:text-rose-200">
                <span>Tasa Mensual:</span>
                <span className="font-bold">{(previewMazdaRates.tasaMensual * 100).toFixed(3)}% mes</span>
              </div>
              <div className="flex justify-between font-mono text-rose-800 dark:text-rose-200">
                <span>Costo Interés Banco:</span>
                <span className="font-bold">
                  {formatCOP(deudaViva > 0 ? Math.round(deudaViva * previewMazdaRates.tasaMensual) : 0)}/mes
                </span>
              </div>
              <div className="flex justify-between font-mono pt-1 border-t border-rose-200/60 dark:border-rose-800/60 text-rose-900 dark:text-rose-100">
                <span className="font-sans font-bold">Ahorro por $1M extra:</span>
                <span className="font-black">
                  +{formatCOP(Math.round(1_000_000 * (previewMazdaRates.eaPct / 100)))}/año
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setModalMazdaOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleSaveMazda(parseFloat(inputMazda) || 21.35)}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check size={14} />
                <span>Guardar tasa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Registrar Tanqueada */}
      {modalTanqueadaOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-3.5 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <Fuel size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Registrar Tanqueada
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Control de odómetro e histórico
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalTanqueadaOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>

            {errorTanqueada && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-semibold">
                {errorTanqueada}
              </div>
            )}

            <form onSubmit={handleSaveNewTanqueada} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Vehículo
                </label>
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      setTVehiculo('MAZDA_2');
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      tVehiculo === 'MAZDA_2'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🚗 Mazda 2
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      setTVehiculo('MOTOCICLETA');
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      tVehiculo === 'MOTOCICLETA'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🏍️ Motocicleta
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Monto (COP) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={tMonto}
                    onChange={(e) => setTMonto(formatDisplay(e.target.value))}
                    placeholder="$ 0"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    required
                    value={tFecha}
                    onChange={(e) => setTFecha(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Odómetro actual (km)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tKm}
                    onChange={(e) => setTKm(formatDisplay(e.target.value))}
                    placeholder="Ej. 48750"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Galones
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tGalones}
                    onChange={(e) => setTGalones(e.target.value)}
                    placeholder="Ej. 8.45"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  ¿Tanque Lleno (Full)?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic();
                    setTTanqueLleno((prev) => !prev);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    tTanqueLleno
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                  }`}
                >
                  {tTanqueLleno ? 'Full (Lleno)' : 'Carga Parcial'}
                </button>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Estación de servicio
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={tEstacion}
                  onChange={(e) => setTEstacion(e.target.value)}
                  placeholder="Ej. Terpel, Primax"
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Nota / Observación
                </label>
                <input
                  type="text"
                  value={tNota}
                  onChange={(e) => setTNota(e.target.value)}
                  placeholder="Ej. Viaje carretera, trancones…"
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setModalTanqueadaOpen(false)}
                  disabled={savingTanqueada}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingTanqueada || parseAmount(tMonto) <= 0}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-xs font-bold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {savingTanqueada ? 'Guardando…' : 'Guardar Tanqueada'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Tanqueada */}
      {tanqueadaToEdit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-3.5 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <Pencil size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Editar Tanqueada
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Ajustar vehículo, odómetro o estado
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTanqueadaToEdit(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>

            {errorEditTanqueada && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-semibold">
                {errorEditTanqueada}
              </div>
            )}

            <form onSubmit={handleUpdateTanqueada} className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Vehículo
                </label>
                <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      setEditVehiculo('MAZDA_2');
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      editVehiculo === 'MAZDA_2'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🚗 Mazda 2
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      setEditVehiculo('MOTOCICLETA');
                    }}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      editVehiculo === 'MOTOCICLETA'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    🏍️ Motocicleta
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Monto (COP) *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={editMonto}
                    onChange={(e) => setEditMonto(formatDisplay(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    required
                    value={editFecha}
                    onChange={(e) => setEditFecha(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Odómetro actual (km)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editKm}
                    onChange={(e) => setEditKm(formatDisplay(e.target.value))}
                    placeholder="Ej. 48750"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                    Galones
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editGalones}
                    onChange={(e) => setEditGalones(e.target.value)}
                    placeholder="Ej. 8.45"
                    className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  ¿Tanque Lleno (Full)?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic();
                    setEditTanqueLleno((prev) => !prev);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                    editTanqueLleno
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                      : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                  }`}
                >
                  {editTanqueLleno ? 'Full (Lleno)' : 'Carga Parcial'}
                </button>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Estación de servicio
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={editEstacion}
                  onChange={(e) => setEditEstacion(e.target.value)}
                  placeholder="Ej. Terpel, Primax"
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Nota / Observación
                </label>
                <input
                  type="text"
                  value={editNota}
                  onChange={(e) => setEditNota(e.target.value)}
                  placeholder="Ej. Viaje carretera, trancones…"
                  className="w-full px-3 py-2 rounded-xl text-xs font-medium bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={async () => {
                    if (!tanqueadaToEdit) return;
                    await handleDeleteTanqueada(tanqueadaToEdit);
                    setTanqueadaToEdit(null);
                  }}
                  disabled={isUpdatingTanqueada}
                  className="py-2 px-2.5 rounded-xl text-xs font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition flex items-center gap-1 cursor-pointer"
                  title="Eliminar esta tanqueada"
                >
                  <Trash2 size={13} />
                  <span>Eliminar</span>
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTanqueadaToEdit(null)}
                    disabled={isUpdatingTanqueada}
                    className="py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingTanqueada || parseAmount(editMonto) <= 0}
                    className="py-2 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-xs font-bold shadow-xs transition flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    {isUpdatingTanqueada ? 'Actualizando…' : 'Guardar Cambios'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
