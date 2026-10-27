import { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
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
  CreditCard,
  ShieldCheck,
  Scale,
  TrendingUp,
  Layers,
} from 'lucide-react';
import { CATALOG_GASTOS } from '../data/catalog';
import {
  formatCOP,
  calcEquivalentesEA,
  haptic,
  formatDisplay,
  parseAmount,
  isDateInCurrentCycle,
} from '../utils/format';
import { fetchAppData, DEFAULT_APPDATA, type AppData } from '../services/api';

const PALETTE = [
  '#E11D48', '#2563EB', '#059669', '#D97706',
  '#7C3AED', '#0891B2', '#EA580C', '#4F46E5', '#DB2777',
];

// Subcategorías clasificadas como inflexibles (costos fijos obligatorios)
const SUBCATS_INFLEXIBLES_SET = new Set([
  'arriendo',
  'energía eléctrica',
  'energia electrica',
  'agua y alcantarillado',
  'gas natural',
  'internet hogar',
  'plan celular',
  'mercado del hogar',
  'cuota regular mazda 2',
  'gimnasio',
]);

interface TooltipProps {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-bold text-slate-900 dark:text-slate-100 mb-1.5">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold flex justify-between gap-3">
          <span>{p.name}:</span>
          <span>{formatCOP(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

function KPICard({ label, value, sub, accent = 'text-slate-900 dark:text-slate-100' }: KPICardProps) {
  return (
    <div className="flex-1 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm">
      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-black mt-1 ${accent}`}>{value}</p>
      {sub && <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
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
  const currentCycle = appData.historico[appData.historico.length - 1] || { ciclo: 'Ciclo Actual', gastos: 0, ingresos: 0 };
  const gastosTotal = appData.kpis.gastos;
  const ingresosTotal = appData.kpis.ingresos;
  const netAhorro = appData.kpis.balance;
  const tasa = appData.kpis.tasaAhorro.toFixed(1);

  // ── Cálculo de días restantes del ciclo nómina (corte el día 24) ────
  const now = new Date();
  const currentDay = now.getDate();
  let targetDate = new Date(now.getFullYear(), now.getMonth(), 24, 23, 59, 59);
  if (currentDay > 24) {
    targetDate = new Date(now.getFullYear(), now.getMonth() + 1, 24, 23, 59, 59);
  }
  const diffMs = targetDate.getTime() - now.getTime();
  const diasRestantes = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const balanceDisponible = appData.kpis.balanceDisponible ?? appData.kpis.balance;
  const ritmoDiario = Math.max(balanceDisponible / diasRestantes, 0);

  // ── WIDGET 1: RUNWAY EN MESES DE VIDA (OXÍGENO FINANCIERO) ─────────
  // Costos Fijos Inflexibles Base: Arriendo ($524.000) + Servicios Públicos ($325.000) + Cuota Mazda ($815.731) + Mercado Base ($600.000) = $2.264.731 COP/mes.
  const costosFijosBase = 2_264_731;
  const saldoReserva = saldos['Lulo Bolsillo - Ahorro'] ?? 0;
  const runwayMeses = costosFijosBase > 0 ? saldoReserva / costosFijosBase : 0;
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

  // ── WIDGET 2: MATRIZ DE GASTOS: INFLEXIBLES VS. ESTILO DE VIDA ─────
  const { totalInflexibles, totalDiscrecionales, pctInflexibles, pctDiscrecionales } = useMemo(() => {
    let inflexibles = 0;
    let discrecionales = 0;

    const subcats = appData.gastadoPorSubcat || {};
    Object.entries(subcats).forEach(([sub, monto]) => {
      const subNorm = sub.trim().toLowerCase();
      if (SUBCATS_INFLEXIBLES_SET.has(subNorm)) {
        inflexibles += Number(monto) || 0;
      } else {
        discrecionales += Number(monto) || 0;
      }
    });

    const total = inflexibles + discrecionales;
    return {
      totalInflexibles: inflexibles,
      totalDiscrecionales: discrecionales,
      pctInflexibles: total > 0 ? (inflexibles / total) * 100 : 50,
      pctDiscrecionales: total > 0 ? (discrecionales / total) * 100 : 50,
    };
  }, [appData.gastadoPorSubcat]);

  // ── WIDGET 3: SIMULADOR MAZDA 2 · DESPIECE A CAPITAL & ARBITRAJE ────
  const cuotaRegular = 815_731;
  const mazdaRates = calcEquivalentesEA(tasaMazda);
  const rawDeudaMazda = saldos['Crédito Mazda 2 (Lulo)'] ?? 0;
  const deudaViva = Math.abs(rawDeudaMazda);

  // i_mes exacto según fórmula de tasas equivalentes
  const i_mes = mazdaRates.tasaMensual;
  const interesMesBanco = deudaViva > 0 ? Math.round(deudaViva * i_mes) : 0;
  const abonoCapitalCuota = deudaViva > 0 ? Math.max(0, cuotaRegular - interesMesBanco) : cuotaRegular;

  // Escenario Reducir Plazo
  const cuotasAhorradas = abonoCapitalCuota > 0 ? (abonoSimulado / abonoCapitalCuota).toFixed(1) : '0';
  const interesAhorradoAnual = Math.round(abonoSimulado * (tasaMazda / 100));

  // Escenario Reducir Cuota
  const reduccionCuotaMensual = Math.round(abonoSimulado * i_mes);
  const nuevaCuotaEstimada = Math.max(cuotaRegular - reduccionCuotaMensual, 0);

  // ── WIDGET 4: EVOLUCIÓN DE PATRIMONIO NETO ─────────────────────────
  const { patrimonioNetoActual, totalActivos, totalPasivos, evolucionPatrimonio } = useMemo(() => {
    let activos = 0;
    let pasivos = 0;

    Object.entries(saldos).forEach(([cuenta, saldo]) => {
      const cuentaLower = cuenta.toLowerCase();
      if (cuentaLower.includes('crédito') || cuentaLower.includes('credito') || saldo < 0) {
        pasivos += Math.abs(saldo);
      } else {
        activos += Math.max(0, saldo);
      }
    });

    const netActual = activos - pasivos;

    // Generar 6 puntos (Actual + 5 meses proyectados con amortización a capital)
    const puntos = [];
    const baseDate = new Date();
    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    for (let i = 0; i <= 5; i++) {
      const mDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const label = i === 0 ? 'Actual' : `+${i}M (${mesesNombres[mDate.getMonth()]})`;
      // Proyección basada en el abono a capital recurrente de la cuota
      const capitalAbonadoAcum = abonoCapitalCuota * i;
      const netProyectado = netActual + capitalAbonadoAcum;
      puntos.push({
        mes: label,
        patrimonio: netProyectado,
        activos: activos,
        pasivos: Math.max(0, pasivos - capitalAbonadoAcum),
      });
    }

    return {
      patrimonioNetoActual: netActual,
      totalActivos: activos,
      totalPasivos: pasivos,
      evolucionPatrimonio: puntos,
    };
  }, [saldos, abonoCapitalCuota]);

  // ── Cálculo de Carga Financiera (DTI) ────────────────────────
  const tcWallets = new Set(['TC Lulo Bank', 'RappiCard']);
  appData.carteras?.forEach(c => {
    if (c.tipo === 'credito') tcWallets.add(c.nombre);
  });
  const cicloTxs = (appData.transacciones || []).filter(t => isDateInCurrentCycle(t.fecha));
  const totalGastosTC = cicloTxs
    .filter(t => t.tipo === 'GASTO' && (tcWallets.has(t.cuenta) || tcWallets.has(t.cuentaOrigen || '')))
    .reduce((acc, t) => acc + (Number(t.monto) || 0), 0);

  const dti = ingresosTotal > 0 ? ((cuotaRegular + totalGastosTC) / ingresosTotal) * 100 : 0;

  let dtiStatus = {
    label: 'Saludable',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    barClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  };
  if (dti > 40) {
    dtiStatus = {
      label: 'Elevado',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
      barClass: 'bg-rose-500',
      textClass: 'text-rose-600 dark:text-rose-400',
    };
  } else if (dti >= 30) {
    dtiStatus = {
      label: 'Alerta',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      barClass: 'bg-amber-500',
      textClass: 'text-amber-600 dark:text-amber-400',
    };
  }

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

  const pieData = CATALOG_GASTOS.map((cat, i) => ({
    name: cat.nombre,
    value: appData.gastadoPorMacro[cat.nombre] ?? 0,
    color: PALETTE[i % PALETTE.length],
  })).filter(d => d.value > 0);

  const formatAxisValue = (v: number) => `$${Math.round(v / 1000)}k`;
  const formatPatrimonioAxis = (v: number) => `$${(v / 1_000_000).toFixed(1)}M`;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-3 animate-fade-in max-w-lg mx-auto w-full">

      {/* ── CARD: RITMO DE GASTO DIARIO SUGERIDO (BURN RATE) ── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Gasto Máximo Sugerido / Día
            </p>
            <p className={`text-2xl font-black tracking-tight font-mono tabular-nums ${balanceDisponible > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatCOP(ritmoDiario)}
            </p>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Faltan {diasRestantes} día{diasRestantes === 1 ? '' : 's'} para el corte del 24
            </p>
          </div>
        </div>
        <div className="text-right hidden sm:block">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
            Disponible
          </span>
          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono">
            {formatCOP(balanceDisponible)}
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="flex gap-2.5">
        <KPICard
          label="Gastos Ciclo"
          value={formatCOP(gastosTotal)}
          sub={currentCycle.ciclo}
          accent="text-rose-600 dark:text-rose-400"
        />
        <KPICard
          label="Ingresos Ciclo"
          value={formatCOP(ingresosTotal)}
          sub={currentCycle.ciclo}
          accent="text-emerald-600 dark:text-emerald-400"
        />
      </div>
      <div className="flex gap-2.5">
        <KPICard
          label="Ahorro Neto"
          value={formatCOP(netAhorro)}
          accent={netAhorro >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
        />
        <KPICard
          label="Tasa de Ahorro"
          value={`${tasa}%`}
          accent={parseFloat(tasa) >= 20 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}
        />
      </div>

      {/* ── WIDGET 1: RUNWAY EN MESES DE VIDA (OXÍGENO FINANCIERO) ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
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
                Oxígeno Financiero · Cobertura Costos Fijos
              </p>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide ${runwayBadgeClass}`}>
            {runwayBadgeLabel}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <div>
            <span className={`text-3xl font-black font-mono tabular-nums tracking-tight ${runwayColorClass}`}>
              {runwayMeses.toFixed(1)} meses
            </span>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 ml-2">
              (Meta ideal: 3.0 meses)
            </span>
          </div>
          <span className="text-xs font-bold text-slate-600 dark:text-slate-400 font-mono">
            {pctRunwayMeta.toFixed(0)}%
          </span>
        </div>

        {/* Barra de progreso hacia la meta ideal de 3 meses */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${runwayBarClass}`}
            style={{ width: `${pctRunwayMeta}%` }}
          />
        </div>

        <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium pt-0.5">
          Reserva actual: <strong className="text-slate-800 dark:text-slate-200">{formatCOP(saldoReserva)}</strong> · Costo fijo: <strong className="text-slate-800 dark:text-slate-200">{formatCOP(costosFijosBase)}/mes</strong>
        </p>
      </section>

      {/* ── WIDGET 2: MATRIZ DE GASTOS: INFLEXIBLES VS. ESTILO DE VIDA ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Matriz de Gastos: Inflexibles vs. Estilo de Vida
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Esenciales obligatorios vs. Consumo discrecional
              </p>
            </div>
          </div>
        </div>

        {/* Barra proporcional bicolor */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-xl h-3.5 overflow-hidden flex shadow-inner">
          <div
            className="h-full bg-blue-600 transition-all duration-500"
            style={{ width: `${pctInflexibles}%` }}
            title={`Inflexibles: ${pctInflexibles.toFixed(1)}%`}
          />
          <div
            className="h-full bg-amber-500 transition-all duration-500"
            style={{ width: `${pctDiscrecionales}%` }}
            title={`Estilo de Vida: ${pctDiscrecionales.toFixed(1)}%`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* Bloque Inflexibles */}
          <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-800/50 flex flex-col">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
              <span className="text-[10px] font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider">
                Inflexibles
              </span>
            </div>
            <p className="text-base font-black text-blue-700 dark:text-blue-300 font-mono">
              {formatCOP(totalInflexibles)}
            </p>
            <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
              {pctInflexibles.toFixed(1)}% del ciclo
            </p>
          </div>

          {/* Bloque Discrecionales */}
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/50 flex flex-col">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
              <span className="text-[10px] font-bold text-amber-900 dark:text-amber-300 uppercase tracking-wider">
                Estilo de Vida
              </span>
            </div>
            <p className="text-base font-black text-amber-700 dark:text-amber-300 font-mono">
              {formatCOP(totalDiscrecionales)}
            </p>
            <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {pctDiscrecionales.toFixed(1)}% del ciclo
            </p>
          </div>
        </div>
      </section>

      {/* ── CARD: CARGA FINANCIERA (DTI) ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Carga Financiera (DTI)
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Deuda fija + Tarjetas sobre ingresos
              </p>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide ${dtiStatus.badgeClass}`}>
            {dtiStatus.label}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-black font-mono tabular-nums ${dtiStatus.textClass}`}>
            {dti.toFixed(1)}%
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            {formatCOP(cuotaRegular + totalGastosTC)} / {formatCOP(ingresosTotal)}
          </span>
        </div>

        {/* Barra de progreso */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${dtiStatus.barClass}`}
            style={{ width: `${Math.min(dti, 100)}%` }}
          />
        </div>

        <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
          <span>Cuota Mazda: {formatCOP(cuotaRegular)}</span>
          <span>Gastos TC: {formatCOP(totalGastosTC)}</span>
        </div>
      </section>

      {/* ── WIDGET 3: SIMULADOR MAZDA 2 · DESPIECE A CAPITAL & ARBITRAJE ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Simulador Mazda 2 · Despiece & Arbitraje
              </h2>
              <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                Crédito Consumo · Cuota Fija {formatCOP(cuotaRegular)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenMazdaModal}
            className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors shadow-sm cursor-pointer"
            aria-label="Editar tasa de interés crédito Mazda 2"
            title="Editar Tasa E.A. del Crédito"
          >
            <span>{tasaMazda.toFixed(2)}% E.A.</span>
            <Pencil size={10} className="opacity-75" />
          </button>
        </div>

        {/* Deuda Viva */}
        <div className="flex items-baseline justify-between bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div>
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">
              Deuda Viva Actual
            </span>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {formatCOP(deudaViva)}
            </span>
            {deudaViva === 0 && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 block mt-0.5">
                Al día (Sin deuda pendiente)
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
          <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/50 flex flex-col justify-between">
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
          <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-800/50 flex flex-col justify-between">
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

        {/* ── Simulador Interactivo de Abono a Capital ── */}
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
                    ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
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
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                escenarioSimulador === 'plazo'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Reducir Plazo
            </button>
            <button
              type="button"
              onClick={() => { haptic(); setEscenarioSimulador('cuota'); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                escenarioSimulador === 'cuota'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
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
                    ~{cuotasAhorradas} {cuotasAhorradas === '1.0' ? 'cuota menos' : 'cuotas menos'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Ahorro en intereses proyectado:
                  </span>
                  <span className="text-sm font-black text-rose-600 dark:text-rose-400 font-mono">
                    +{formatCOP(interesAhorradoAnual)}/año
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

          {/* INSIGHT DE ARBITRAJE FINANCIERO (SPREAD) */}
          <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5">
              <Scale size={14} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                Spread de Liquidez
              </p>
              <p className="text-[11px] text-amber-800 dark:text-amber-300/90 leading-relaxed mt-0.5">
                Amortizar este abono a capital te ahorra <strong>21.35% E.A.</strong>, mientras que en Lulo rinde <strong>9.25% E.A.</strong> Rendimiento neto de amortizar: <strong className="text-emerald-700 dark:text-emerald-300">+12.10% E.A.</strong> (+${(121000).toLocaleString('es-CO')}/año extra por cada millón).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── WIDGET 4: EVOLUCIÓN DE PATRIMONIO NETO ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Evolución de Patrimonio Neto
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                Trayectoria consolidada (Activos - Pasivos)
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
              Patrimonio Actual
            </span>
            <span className={`text-sm font-black font-mono ${patrimonioNetoActual >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatCOP(patrimonioNetoActual)}
            </span>
          </div>
        </div>

        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
          <span>Activos: <strong className="text-slate-800 dark:text-slate-200">{formatCOP(totalActivos)}</strong></span>
          <span>Pasivos: <strong className="text-rose-600 dark:text-rose-400">{formatCOP(totalPasivos)}</strong></span>
        </div>

        {/* Gráfico de Área en Recharts con tema Light Fintech (#2563EB) */}
        <div className="w-full h-48 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={evolucionPatrimonio} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="patrimonioGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} />
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
                fill="url(#patrimonioGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Bar chart: Gastos vs Ingresos histórico */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-wide">
          Gastos vs. Ingresos — últimos ciclos
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={appData.historico} barCategoryGap="30%" barGap={4}>
            <XAxis
              dataKey="ciclo"
              tick={{ fontSize: 9, fill: 'currentColor' }}
              className="text-slate-500 dark:text-slate-400"
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatAxisValue}
              tick={{ fontSize: 9, fill: 'currentColor' }}
              className="text-slate-500 dark:text-slate-400"
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
            <Bar dataKey="gastos" name="Gastos" fill="#E11D48" radius={[4, 4, 0, 0]} />
            <Bar dataKey="ingresos" name="Ingresos" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Pie chart: distribución de gastos */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-wide">
          Distribución de Gastos — Ciclo Actual
        </p>
        {pieData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="45%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} stroke="#FFFFFF" strokeWidth={1} />
                ))}
              </Pie>
              <Legend
                iconSize={8}
                iconType="circle"
                formatter={(value) => (
                  <span style={{ fontSize: 10, color: 'inherit', fontWeight: 600 }}>{value}</span>
                )}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0];
                  return (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 text-xs shadow-lg">
                      <p className="font-bold" style={{ color: item.payload.color }}>{item.name}</p>
                      <p className="text-slate-900 dark:text-slate-100 font-semibold">{formatCOP(item.value as number)}</p>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center bg-slate-50/50 dark:bg-slate-950/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
            <span className="text-2xl mb-1">📊</span>
            <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Sin gastos registrados en el ciclo</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">Todas las categorías tienen el 100% de su presupuesto disponible.</p>
          </div>
        )}
      </div>

      {/* Table: category breakdown */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40">
          <p className="text-xs font-bold text-slate-900 dark:text-slate-100">Desglose por Categoría</p>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {CATALOG_GASTOS.map((cat, i) => {
            const spent = appData.gastadoPorMacro[cat.nombre] ?? 0;
            const pct = cat.presupuesto > 0 ? (spent / cat.presupuesto) * 100 : 0;
            return (
              <div key={cat.nombre} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                />
                <span className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-300">{cat.nombre}</span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{formatCOP(spent)}</span>
                <span className={`text-[10px] font-black w-10 text-right ${
                  pct >= 90 ? 'text-rose-600 dark:text-rose-400' : pct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>{pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── MODAL EDICIÓN TASA MAZDA ─────────────────────────── */}
      {modalMazdaOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
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
                    Interés Efectivo Anual (E.A.)
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

            {/* Presets rápidos */}
            <div>
              <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                Valores frecuentes Crédito:
              </p>
              <div className="flex gap-1.5">
                {[21.35, 19.50, 18.00].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      haptic();
                      setInputMazda(val.toFixed(2));
                    }}
                    className={`
                      flex-1 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer
                      ${parseFloat(inputMazda) === val
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'}
                    `}
                  >
                    {val.toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>

            {/* Input personalizado */}
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

            {/* Recálculo dinámico en vivo */}
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

            {/* Acciones */}
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
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Check size={14} />
                <span>Guardar tasa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
