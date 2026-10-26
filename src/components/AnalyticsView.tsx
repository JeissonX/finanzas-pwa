import { useState, useEffect } from 'react';
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
} from 'recharts';
import { TrendingUp, Car, Sparkles, ShieldCheck, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { CATALOG_GASTOS } from '../data/catalog';
import { formatCOP } from '../utils/format';
import { fetchAppData, DEFAULT_APPDATA, type AppData } from '../services/api';

const PALETTE = [
  '#E11D48', '#2563EB', '#059669', '#D97706',
  '#7C3AED', '#0891B2', '#EA580C', '#4F46E5', '#DB2777',
];

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

  useEffect(() => {
    fetchAppData().then(data => setAppData(data)).catch(() => {});
    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail) setAppData(custom.detail);
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  const saldos = appData.saldos;
  const currentCycle = appData.historico[appData.historico.length - 1] || { ciclo: 'Ciclo Actual', gastos: 0, ingresos: 0 };
  const gastosTotal = appData.kpis.gastos;
  const ingresosTotal = appData.kpis.ingresos;
  const netAhorro = appData.kpis.balance;
  const tasa = appData.kpis.tasaAhorro.toFixed(1);

  // ── Fénix OS: Rendimientos Bolsillos Lulo (9,25% E.A.) ──
  // Se suman todos los 4 bolsillos remunerados de Lulo Bank
  const saldoBolsillo =
    (saldos['Lulo Bolsillo - Ahorro'] ?? 0) +
    (saldos['Lulo Bolsillo - Carro / Moto'] ?? 0) +
    (saldos['Lulo Bolsillo - Gastos'] ?? 0) +
    (saldos['Lulo Bolsillo - Vacaciones'] ?? 0) +
    (saldos['Lulo Ahorros (Bolsillo 9.25%)'] ?? 0);

  // +0.741% mes (+0.0242% día)
  const gananciaMesEstimada = saldoBolsillo > 0 ? Math.round(saldoBolsillo * 0.00741) : 0;
  const gananciaDiaEstimada = saldoBolsillo > 0 ? Math.round(saldoBolsillo * 0.000242) : 0;

  // ── Fénix OS: Amortización Crédito Mazda 2 (21,35% E.A.) ──
  const rawDeudaMazda = saldos['Crédito Mazda 2 (Lulo)'] ?? 0;
  const deudaViva = Math.abs(rawDeudaMazda);
  // 1,626% mes
  const interesMesBanco = deudaViva > 0 ? Math.round(deudaViva * 0.01626) : 0;
  const cuotaRegular = 815_731;
  const abonoCapitalCuota = deudaViva > 0 ? Math.max(0, cuotaRegular - interesMesBanco) : cuotaRegular;
  const ahorroPorMillon = 213_500; // $213.500/año ahorrados por cada $1M abonado a capital

  const pieData = CATALOG_GASTOS.map((cat, i) => ({
    name: cat.nombre,
    value: appData.gastadoPorMacro[cat.nombre] ?? 0,
    color: PALETTE[i % PALETTE.length],
  })).filter(d => d.value > 0);

  const formatAxisValue = (v: number) => `$${Math.round(v / 1000)}k`;

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">

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

      {/* ── CARD 1: Fénix OS - Rendimientos Bolsillos Lulo (9,25% E.A.) ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">Rendimientos Bolsillos Lulo</h2>
              <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Tasa Remunerada 9,25% E.A.</p>
            </div>
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
            9.25% E.A.
          </span>
        </div>

        {/* Saldo en Bolsillos */}
        <div className="flex items-baseline justify-between bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div>
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Saldo en Bolsillos</span>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {formatCOP(saldoBolsillo)}
            </span>
          </div>
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-2 py-0.5 rounded-lg">
            Ahorro líquido
          </span>
        </div>

        {/* Ganancias Estimadas */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-900 dark:text-emerald-300 uppercase tracking-wide">Ciclo Actual</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-1">
              <p className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                +0,741% <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">mes</span>
              </p>
              <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                +{formatCOP(gananciaMesEstimada)} {saldoBolsillo === 0 && <span className="text-[9px] font-normal text-emerald-700 dark:text-emerald-400">(ref. $1M)</span>}
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/80 dark:border-emerald-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-900 dark:text-emerald-300 uppercase tracking-wide">Ganancia Diaria</span>
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-1">
              <p className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
                +0,0242% <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">día</span>
              </p>
              <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                +{formatCOP(gananciaDiaEstimada)} {saldoBolsillo === 0 && <span className="text-[9px] font-normal text-emerald-700 dark:text-emerald-400">(ref. $1M)</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>Capital protegido con seguro Fogafín. Rendimientos acreditados a diario en tu cuenta.</span>
        </div>
      </section>

      {/* ── CARD 2: Fénix OS - Amortización Crédito Mazda 2 (21,35% E.A.) ── */}
      <section className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <Car className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-black text-slate-900 dark:text-slate-100 tracking-tight">Amortización Crédito Mazda 2</h2>
              <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Crédito de Consumo · Tasa 21,35% E.A.</p>
            </div>
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
            21.35% E.A.
          </span>
        </div>

        {/* Deuda Viva */}
        <div className="flex items-baseline justify-between bg-slate-50/80 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <div>
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block">Deuda Viva Actual</span>
            <span className="text-xl font-black text-slate-900 dark:text-slate-100 font-mono tabular-nums">
              {formatCOP(deudaViva)}
            </span>
            {deudaViva === 0 && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 block mt-0.5">Al día (Sin deuda pendiente)</span>
            )}
          </div>
          <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 px-2 py-0.5 rounded-lg">
            Pasivo bancario
          </span>
        </div>

        {/* Métricas clave: Interés banco vs Abono cuota */}
        <div className="grid grid-cols-2 gap-2">
          {/* Interés del mes que cobra el banco */}
          <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200/80 dark:border-rose-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wide">Interés Banco</span>
              <ArrowDownRight className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="mt-1">
              <p className="text-base font-black text-rose-600 dark:text-rose-400 font-mono">
                1,626% <span className="text-xs font-semibold text-rose-800 dark:text-rose-300">mes</span>
              </p>
              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-0.5 font-mono">
                {formatCOP(interesMesBanco)}/mes
              </p>
            </div>
          </div>

          {/* Abono a capital de la cuota regular */}
          <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-800/50 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wide">Abono Capital</span>
              <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/60 px-1.5 py-0.2 rounded">Cuota $815k</span>
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

        {/* Ahorro Proyectado por Abono Extra a Capital */}
        <div className="p-3 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border border-blue-200 dark:border-blue-800/60 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-slate-900 dark:text-slate-100 tracking-tight">
              Ahorro por cada $1.000.000 abonado a capital:
            </p>
            <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 mt-0.5">
              Elimina cobro compuesto y reduce el plazo del crédito
            </p>
          </div>
          <div className="text-right">
            <span className="text-sm font-black text-blue-600 dark:text-blue-400 font-mono">
              +{formatCOP(ahorroPorMillon)}
            </span>
            <span className="text-[10px] font-bold text-blue-800 dark:text-blue-300 block">/ año</span>
          </div>
        </div>
      </section>

      {/* Bar chart: Gastos vs Ingresos histórico */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-wide">Gastos vs. Ingresos — últimos ciclos</p>
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
        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-3 tracking-wide">Distribución de Gastos — Ciclo Actual</p>
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
    </div>
  );
}
