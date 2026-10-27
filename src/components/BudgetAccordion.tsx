import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Pencil, Plus, X, Check, Loader2 } from 'lucide-react';
import { formatCOP, formatDisplay, parseAmount, progressColor, progressTextColor, haptic } from '../utils/format';
import type { PresupuestoItem } from '../types/finance';
import { fetchAppData, type AppData } from '../services/api';
import { supabase } from '../services/supabase';

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
  onEditSub: (subNombre: string, currentBudget: number) => void;
}

function AccordionRow({ cat, onEditSub }: AccordionRowProps) {
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
                <div key={sub.nombre} className="px-4 py-2.5 pl-14 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate mr-2">{sub.nombre}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[11px] font-black ${progressTextColor(subPct)}`}>
                        {subPct.toFixed(0)}%
                      </span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        {formatCOP(subGastado)} / {formatCOP(sub.presupuesto)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          haptic();
                          onEditSub(sub.nombre, sub.presupuesto);
                        }}
                        className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        title={`Editar presupuesto de ${sub.nombre}`}
                        aria-label={`Editar presupuesto de ${sub.nombre}`}
                      >
                        <Pencil size={12} />
                      </button>
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

const MEDIOS_PAGO = [
  'TC Lulo Bank',
  'RappiCard',
  'Lulo Principal (Cuenta)',
  'Nequi',
  'Efectivo',
  'Lulo Bolsillo - Carro / Moto',
];

export default function BudgetAccordion() {
  const [appData, setAppData] = useState<AppData | null>(null);

  // Estados de modales
  const [editingSub, setEditingSub] = useState<{ nombre: string; presupuesto: number } | null>(null);
  const [editAmountDisplay, setEditAmountDisplay] = useState('0');
  const [isUpdating, setIsUpdating] = useState(false);

  const [modalNewSub, setModalNewSub] = useState(false);
  const [newMacro, setNewMacro] = useState('Alimentación');
  const [newSubNombre, setNewSubNombre] = useState('');
  const [newPresupuestoDisplay, setNewPresupuestoDisplay] = useState('0');
  const [newMedioPago, setNewMedioPago] = useState('TC Lulo Bank');
  const [isCreating, setIsCreating] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

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

  // Abrir modal de edición
  const handleOpenEdit = (subNombre: string, currentBudget: number) => {
    setEditingSub({ nombre: subNombre, presupuesto: currentBudget });
    setEditAmountDisplay(formatDisplay(String(currentBudget)));
  };

  // Guardar edición de presupuesto en Supabase
  const handleSaveEdit = async () => {
    if (!editingSub) return;
    const nuevoMonto = parseAmount(editAmountDisplay);
    setIsUpdating(true);
    haptic(50);
    try {
      const { error } = await supabase
        .from('catalogo_categorias')
        .update({ presupuesto_base: nuevoMonto })
        .eq('subcategoria', editingSub.nombre);

      if (error) throw error;

      await fetchAppData(true);
      showFeedback(`Presupuesto de "${editingSub.nombre}" actualizado.`);
      setEditingSub(null);
    } catch (err) {
      console.error('Error actualizando presupuesto:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Guardar nueva subcategoría en Supabase
  const handleCreateNewSub = async () => {
    if (!newSubNombre.trim()) return;
    const nuevoMonto = parseAmount(newPresupuestoDisplay);
    setIsCreating(true);
    haptic(50);
    try {
      const { error } = await supabase
        .from('catalogo_categorias')
        .insert([{
          macro_categoria: newMacro.trim(),
          subcategoria: newSubNombre.trim(),
          presupuesto_base: nuevoMonto,
          medio_pago_sugerido: newMedioPago,
          activo: true,
        }]);

      if (error) throw error;

      await fetchAppData(true);
      showFeedback(`Subcategoría "${newSubNombre.trim()}" creada con éxito.`);
      setModalNewSub(false);
      setNewSubNombre('');
      setNewPresupuestoDisplay('0');
    } catch (err) {
      console.error('Error insertando nueva subcategoría:', err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">
      {/* Notificación de feedback */}
      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2 shadow-sm animate-slide-up">
          <Check size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

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
        <AccordionRow key={cat.nombre} cat={cat} onEditSub={handleOpenEdit} />
      ))}

      {/* Botón "+ Nueva Subcategoría" al final del acordeón */}
      <button
        type="button"
        onClick={() => {
          haptic();
          setModalNewSub(true);
        }}
        className="w-full py-3.5 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-white/70 dark:bg-slate-900/50 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 flex items-center justify-center gap-2 transition active:scale-[0.99] shadow-sm cursor-pointer mt-1"
      >
        <Plus size={16} />
        <span>+ Nueva Subcategoría</span>
      </button>

      {/* Modal Editar Presupuesto Base */}
      {editingSub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingSub(null); }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Pencil size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Editar Presupuesto Base
                  </h3>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                    {editingSub.nombre}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSub(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label htmlFor="edit-budget-input" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Nuevo Presupuesto Base (COP)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 dark:text-slate-500">$</span>
                <input
                  id="edit-budget-input"
                  type="text"
                  inputMode="numeric"
                  value={editAmountDisplay}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setEditAmountDisplay(digits ? formatDisplay(digits) : '0');
                  }}
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-black text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingSub(null)}
                disabled={isUpdating}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isUpdating}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5"
              >
                {isUpdating ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar Presupuesto</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nueva Subcategoría */}
      {modalNewSub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setModalNewSub(false); }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-3.5 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Plus size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Nueva Subcategoría
                  </h3>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Añadir al catálogo de presupuestos
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalNewSub(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Macro-categoría */}
            <div>
              <label htmlFor="new-macro-select" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Macro-Categoría
              </label>
              <select
                id="new-macro-select"
                value={newMacro}
                onChange={e => setNewMacro(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {allMacroNames.map(m => (
                  <option key={m} value={m}>
                    {MACRO_ICONS[m] || '📊'} {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Nombre de la Subcategoría */}
            <div>
              <label htmlFor="new-sub-name" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Nombre de la Subcategoría
              </label>
              <input
                id="new-sub-name"
                type="text"
                value={newSubNombre}
                onChange={e => setNewSubNombre(e.target.value)}
                placeholder="Ej. Plataformas IA, Peajes"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Presupuesto Base */}
            <div>
              <label htmlFor="new-sub-budget" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Presupuesto Base (COP)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500">$</span>
                <input
                  id="new-sub-budget"
                  type="text"
                  inputMode="numeric"
                  value={newPresupuestoDisplay}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setNewPresupuestoDisplay(digits ? formatDisplay(digits) : '0');
                  }}
                  className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Medio de pago sugerido */}
            <div>
              <label htmlFor="new-medio-pago" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Medio de Pago Sugerido
              </label>
              <select
                id="new-medio-pago"
                value={newMedioPago}
                onChange={e => setNewMedioPago(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {MEDIOS_PAGO.map(m => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalNewSub(false)}
                disabled={isCreating}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateNewSub}
                disabled={isCreating || !newSubNombre.trim()}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5"
              >
                {isCreating ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Creando...</span>
                  </>
                ) : (
                  <span>Crear Subcategoría</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
