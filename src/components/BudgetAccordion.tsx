import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatCOP, progressColor, progressTextColor } from '../utils/format';
import type { PresupuestoItem } from '../types/finance';
import { fetchAppData, type AppData } from '../services/api';

interface ProgressBarProps {
  pct: number;
  label?: string;
}

function ProgressBar({ pct, label }: ProgressBarProps) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${progressColor(pct)}`}
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      />
    </div>
  );
}

interface DynamicSubcategoria {
  nombre: string;
  presupuesto: number;
  gastado: number;
}

interface DynamicMacroCategoria {
  nombre: string;
  icono: string;
  presupuesto: number;
  gastado: number;
  subcategorias: DynamicSubcategoria[];
}

interface AccordionRowProps {
  cat: DynamicMacroCategoria;
}

function AccordionRow({ cat }: AccordionRowProps) {
  const [open, setOpen] = useState(false);

  const totalGastado = cat.subcategorias.length > 0
    ? cat.subcategorias.reduce((s, sub) => s + (sub.gastado || 0), 0)
    : cat.gastado;
  const effectivePresupuesto = cat.presupuesto;
  const pct = effectivePresupuesto > 0 ? (totalGastado / effectivePresupuesto) * 100 : 0;
  const remaining = effectivePresupuesto - totalGastado;

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <span className="text-xl flex-shrink-0">{cat.icono}</span>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{cat.nombre}</span>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-black ${progressTextColor(pct)}`}>
                {pct.toFixed(0)}%
              </span>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                {formatCOP(totalGastado)} / {formatCOP(effectivePresupuesto)}
              </span>
            </div>
          </div>
          <ProgressBar pct={pct} label={`${cat.nombre}: ${pct.toFixed(0)}% del presupuesto`} />
          <div className="mt-1 flex items-center justify-between">
            <span className={`text-[10px] font-semibold ${remaining >= 0 ? 'text-slate-600 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400 font-bold'}`}>
              {remaining >= 0 ? `Disponible: ${formatCOP(remaining)}` : `⚠ Excedido: ${formatCOP(Math.abs(remaining))}`}
            </span>
          </div>
        </div>
        {open ? (
          <ChevronDown size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0 ml-1" />
        ) : (
          <ChevronRight size={16} className="text-slate-400 dark:text-slate-500 flex-shrink-0 ml-1" />
        )}
      </button>

      {/* Subcategory detail */}
      {open && (
        <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/70 dark:bg-slate-950/40 animate-slide-up">
          {cat.subcategorias.length === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 italic text-center">
              Sin subcategorías en este ciclo
            </div>
          ) : (
            cat.subcategorias.map(sub => {
              const subGastado = sub.gastado || 0;
              const subPct = sub.presupuesto > 0 ? (subGastado / sub.presupuesto) * 100 : 0;
              const subRemaining = sub.presupuesto - subGastado;
              return (
                <div key={sub.nombre} className="px-4 py-2.5 pl-14">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{sub.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-black ${progressTextColor(subPct)}`}>
                        {subPct.toFixed(0)}%
                      </span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {formatCOP(subGastado)} / {formatCOP(sub.presupuesto)}
                      </span>
                    </div>
                  </div>
                  <ProgressBar pct={subPct} label={`${sub.nombre}: ${subPct.toFixed(0)}%`} />
                  <p className={`text-[10px] mt-0.5 font-medium ${subRemaining >= 0 ? 'text-slate-600 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400 font-bold'}`}>
                    {subRemaining >= 0 ? `Disponible: ${formatCOP(subRemaining)}` : `⚠ Excedido: ${formatCOP(Math.abs(subRemaining))}`}
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULT_MACROS = [
  { nombre: 'Alimentación', icono: '🛒' },
  { nombre: 'Transporte', icono: '⛽' },
  { nombre: 'Vivienda / Hogar', icono: '🏠' },
  { nombre: 'Servicios Públicos', icono: '💡' },
  { nombre: 'Salud y Bienestar', icono: '🏋️' },
  { nombre: 'Mascota', icono: '🐾' },
  { nombre: 'Ocio y Viajes', icono: '✈️' },
  { nombre: 'Suscripciones', icono: '📱' },
  { nombre: 'Inversión y Ahorro', icono: '📈' },
  { nombre: 'Pago Deuda', icono: '🚗' },
  { nombre: 'Varios', icono: '📦' },
];

const MACRO_ICONS: Record<string, string> = {
  'Alimentación': '🛒',
  'Transporte': '⛽',
  'Vivienda / Hogar': '🏠',
  'Vivienda': '🏠',
  'Servicios Públicos': '💡',
  'Servicios': '💡',
  'Salud y Bienestar': '🏋️',
  'Mascota': '🐾',
  'Ocio y Viajes': '✈️',
  'Suscripciones': '📱',
  'Inversión y Ahorro': '📈',
  'Pago Deuda': '🚗',
  'Deudas Mazda 2': '🚗',
  'Varios': '📦',
};

export default function BudgetAccordion() {
  const [appData, setAppData] = useState<AppData | null>(null);

  useEffect(() => {
    fetchAppData().then(data => {
      setAppData(data);
    }).catch(() => {});

    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail) {
        setAppData(custom.detail);
      }
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  const rawPresupuestos: PresupuestoItem[] = appData?.presupuestos || [];
  const spentSubMap = appData?.gastadoPorSubcat || {};
  const spentMacroMap = appData?.gastadoPorMacro || {};

  // Descubrir macrocategorías combinando la lista estándar con las presentes en appData
  const macrosFromData = Array.from(new Set(rawPresupuestos.map(p => p.macro).filter(Boolean)));
  const allMacroNames = Array.from(new Set([
    ...DEFAULT_MACROS.map(m => m.nombre),
    ...macrosFromData,
  ]));

  const categories: DynamicMacroCategoria[] = allMacroNames.map(macroName => {
    const items = rawPresupuestos.filter(p => p.macro.toLowerCase() === macroName.toLowerCase() || p.macro === macroName);
    const icono = MACRO_ICONS[macroName] || '📊';

    const subcategorias: DynamicSubcategoria[] = items.map(p => {
      const gastado = typeof p.gastado === 'number' && p.gastado > 0 ? p.gastado : (spentSubMap[p.sub] ?? 0);
      return {
        nombre: p.sub,
        presupuesto: Number(p.presupuesto) || 0,
        gastado,
      };
    });

    const sumPresupuesto = subcategorias.reduce((acc, s) => acc + s.presupuesto, 0);
    const macroGastado = subcategorias.length > 0
      ? subcategorias.reduce((acc, s) => acc + s.gastado, 0)
      : (spentMacroMap[macroName] ?? 0);

    return {
      nombre: macroName,
      icono,
      presupuesto: sumPresupuesto,
      gastado: macroGastado,
      subcategorias,
    };
  });

  const totalPresupuesto = categories.reduce((s, c) => s + c.presupuesto, 0);
  const totalGastado = categories.reduce((s, c) => s + (c.subcategorias.length > 0 ? c.subcategorias.reduce((ss, sub) => ss + sub.gastado, 0) : c.gastado), 0) || (appData?.kpis.gastos ?? 0);
  const globalPct = totalPresupuesto > 0 ? (totalGastado / totalPresupuesto) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">
      {/* Global summary card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Total del Ciclo</p>
            <p className="text-3xl font-black text-slate-900 dark:text-slate-100 mt-0.5">{formatCOP(totalGastado)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Presupuesto</p>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{formatCOP(totalPresupuesto)}</p>
            <p className={`text-xs font-black mt-0.5 ${progressTextColor(globalPct)}`}>{globalPct.toFixed(1)}%</p>
          </div>
        </div>
        <ProgressBar pct={globalPct} label="Presupuesto total del ciclo" />
      </div>

      {/* Accordion list */}
      {categories.map(cat => (
        <AccordionRow key={cat.nombre} cat={cat} />
      ))}
    </div>
  );
}
