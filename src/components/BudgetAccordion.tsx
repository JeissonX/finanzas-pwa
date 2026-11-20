import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Pencil,
  Plus,
  X,
  Check,
  Loader2,
  AlertCircle,
  Archive,
  RotateCcw,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  formatCOP,
  formatDisplay,
  parseAmount,
  progressColor,
  progressTextColor,
  haptic,
} from '../utils/format';
import type { PresupuestoItem, CatalogoItem, Transaccion } from '../types/finance';
import PeriodSelector from './PeriodSelector';
import {
  createDefaultPeriodFilter,
  filterTransactionsByPeriod,
  type PeriodFilter,
} from '../utils/periodFilter';
import {
  fetchAppData,
  createCategoria,
  updateCategoria,
  renameCategoriaCascade,
  renameMacroCascade,
  swapMacroOrden,
  swapSubcategoriaOrden,
  type AppData,
} from '../services/api';

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
  id?: string | number;
  tipo: 'GASTO' | 'INGRESO';
  macro: string;
  nombre: string;
  presupuesto: number;
  gastado: number;
  count: number;
  orden: number;
  medio_pago_sugerido?: string | null;
  activo?: boolean;
}

interface DynamicMacroCategoria {
  nombre: string;
  icono: string;
  orden_macro: number;
  presupuesto: number;
  gastado: number;
  count: number;
  subcategorias: DynamicSubcategoria[];
}

const DEFAULT_MACROS_GASTO = [
  { nombre: 'Alimentación', icono: '🛒' },
  { nombre: 'Transporte', icono: '⛽' },
  { nombre: 'Vivienda y Servicios', icono: '🏠' },
  { nombre: 'Salud y Bienestar', icono: '🏋️' },
  { nombre: 'Mascota', icono: '🐾' },
  { nombre: 'Ocio y Suscripciones', icono: '🎉' },
  { nombre: 'Inversión y Ahorro', icono: '📈' },
  { nombre: 'Pago Deuda', icono: '🚗' },
  { nombre: 'Varios', icono: '📦' },
];

const DEFAULT_MACROS_INGRESO = [
  { nombre: 'Ingresos Laborales', icono: '💼' },
  { nombre: 'Otros Ingresos', icono: '💰' },
];

const MACRO_ICONS: Record<string, string> = {
  'Alimentación': '🛒',
  'Transporte': '⛽',
  'Vivienda y Servicios': '🏠',
  'Vivienda / Hogar': '🏠',
  'Vivienda': '🏠',
  'Servicios Públicos': '💡',
  'Servicios': '💡',
  'Salud y Bienestar': '🏋️',
  'Mascota': '🐾',
  'Ocio y Suscripciones': '🎉',
  'Ocio y Viajes': '✈️',
  'Suscripciones': '📱',
  'Inversión y Ahorro': '📈',
  'Pago Deuda': '🚗',
  'Deudas Mazda 2': '🚗',
  'Varios': '📦',
  'Ingresos Laborales': '💼',
  'Otros Ingresos': '💰',
  'Ingresos Agencia': '🚀',
  'Rentas del Capital': '💰',
};

const MEDIOS_PAGO_DEFAULT = [
  'TC Lulo Bank',
  'RappiCard',
  'Lulo Principal (Cuenta)',
  'Nequi',
  'Efectivo',
  'Lulo Bolsillo - Carro / Moto',
];

export default function BudgetAccordion({ transacciones = [] }: { transacciones?: Transaccion[] }) {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [tipoFiltro, setTipoFiltro] = useState<'GASTO' | 'INGRESO'>('GASTO');
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);

  // ── Segmentación por Periodo ──────────────────────────────────────────────
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>(() => createDefaultPeriodFilter());

  // Estados de modales
  const [editingSub, setEditingSub] = useState<DynamicSubcategoria | null>(null);
  const [editSubNombre, setEditSubNombre] = useState('');
  const [editAmountDisplay, setEditAmountDisplay] = useState('0');
  const [editMedioPago, setEditMedioPago] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);

  const [renamingMacro, setRenamingMacro] = useState<{
    tipo: 'GASTO' | 'INGRESO';
    oldName: string;
    newName: string;
  } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  const [modalNewCat, setModalNewCat] = useState(false);
  const [newTipo, setNewTipo] = useState<'GASTO' | 'INGRESO'>('GASTO');
  const [newMacro, setNewMacro] = useState('Alimentación');
  const [newMacroCustom, setNewMacroCustom] = useState('');
  const [isCustomMacro, setIsCustomMacro] = useState(false);
  const [newSubNombre, setNewSubNombre] = useState('');
  const [newPresupuestoDisplay, setNewPresupuestoDisplay] = useState('0');
  const [newMedioPago, setNewMedioPago] = useState<string>('TC Lulo Bank');
  const [isCreating, setIsCreating] = useState(false);

  // Estado de reordenamiento en progreso
  const [isReordering, setIsReordering] = useState(false);

  // Estados de acordeón colapsable por macro
  const [openMacros, setOpenMacros] = useState<Record<string, boolean>>({});

  const toggleMacro = (macroName: string) => {
    setOpenMacros((prev) => ({ ...prev, [macroName]: !prev[macroName] }));
  };

  const [feedback, setFeedback] = useState<{ msg: string; isError?: boolean } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (msg: string, isError = false) => {
    setFeedback({ msg, isError });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 3500);
  };

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    fetchAppData()
      .then((data) => {
        setAppData(data);
      })
      .catch(() => {});

    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail) {
        setAppData(custom.detail);
      }
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  const catalogo: CatalogoItem[] = appData?.catalogo || [];
  const rawPresupuestos: PresupuestoItem[] = appData?.presupuestos || [];
  const spentSubMap = appData?.gastadoPorSubcat || {};
  const spentMacroMap = appData?.gastadoPorMacro || {};

  // Medios de pago activos desde carteras
  const mediosPagoDisponibles = useMemo(() => {
    if (appData?.carteras && appData.carteras.length > 0) {
      const activas = appData.carteras
        .filter((c) => c.activa !== false && c.permite_gasto !== false)
        .map((c) => c.nombre);
      if (activas.length > 0) return activas;
    }
    return MEDIOS_PAGO_DEFAULT;
  }, [appData?.carteras]);

  // ── Filtro de Periodos y Transacciones de Gasto del Periodo ───────────────
  const txsGastoPeriodo = useMemo(() => {
    const base = transacciones.length > 0 ? transacciones : (appData?.transacciones || []);
    const inPeriod = filterTransactionsByPeriod(base, periodFilter);
    return inPeriod.filter((t) => t.tipo === 'GASTO');
  }, [transacciones, appData?.transacciones, periodFilter]);

  const spendingBySubMap = useMemo(() => {
    const map = new Map<string, { gastado: number; count: number }>();

    for (const tx of txsGastoPeriodo) {
      const macro = (tx.categoria || tx.macroCategoria || tx.macro || '').trim().toLowerCase();
      const sub = (tx.subcategoria || tx.sub || '').trim().toLowerCase();
      const monto = Number(tx.monto) || 0;

      const key = `${macro}:::${sub}`;
      const curr = map.get(key) || { gastado: 0, count: 0 };
      curr.gastado += monto;
      curr.count += 1;
      map.set(key, curr);

      // También indexar por subcategoría sola
      const currSub = map.get(sub) || { gastado: 0, count: 0 };
      currSub.gastado += monto;
      currSub.count += 1;
      map.set(sub, currSub);
    }

    return map;
  }, [txsGastoPeriodo]);

  const isCicloCompleto =
    periodFilter.preset === 'CICLO_ACTUAL' || periodFilter.preset === 'CICLO_ANTERIOR';

  // ── 1. Construcción de Macrocategorías de GASTO ordenadas por orden_macro ───
  const categoriesGasto: DynamicMacroCategoria[] = useMemo(() => {
    const itemsCatalogoGasto = catalogo.filter(
      (c) => (c.tipo ?? 'GASTO') === 'GASTO',
    );

    const macroNamesFromCatalogo = itemsCatalogoGasto.map((c) => c.macro_categoria.trim());
    const macroNamesFromPresupuestos = rawPresupuestos.map((p) => p.macro.trim());
    const allGastoMacroNames = Array.from(
      new Set([
        ...DEFAULT_MACROS_GASTO.map((m) => m.nombre),
        ...macroNamesFromCatalogo,
        ...macroNamesFromPresupuestos,
      ]),
    ).filter(Boolean);

    const mapped = allGastoMacroNames.map((macroName) => {
      const icono = MACRO_ICONS[macroName] || '📊';

      // Filtrar subcategorías en catálogo
      let subs = itemsCatalogoGasto.filter(
        (c) => c.macro_categoria.trim().toLowerCase() === macroName.toLowerCase(),
      );

      // Si no hay subcategorías en catálogo, intentar desde appData.presupuestos
      if (subs.length === 0) {
        const fromPres = rawPresupuestos.filter(
          (p) => p.macro.trim().toLowerCase() === macroName.toLowerCase(),
        );
        subs = fromPres.map((p) => ({
          id: p.id,
          tipo: 'GASTO',
          macro_categoria: macroName,
          subcategoria: p.sub,
          presupuesto_base: p.presupuesto,
          orden_macro: p.orden_macro ?? 99,
          orden: p.orden ?? 99,
          activo: true,
        }));
      }

      // Determinar orden_macro para la macro
      const ordenMacroFromItems = subs.map((s) => Number(s.orden_macro ?? 99))[0];
      const defaultIdx = DEFAULT_MACROS_GASTO.findIndex(
        (m) => m.nombre.toLowerCase() === macroName.toLowerCase(),
      );
      const orden_macro =
        ordenMacroFromItems != null && ordenMacroFromItems !== 99
          ? ordenMacroFromItems
          : defaultIdx >= 0
            ? (defaultIdx + 1) * 10
            : 99;

      // Filtrar archivadas si mostrarArchivadas es false
      const subsFiltradas = mostrarArchivadas
        ? subs
        : subs.filter((s) => s.activo !== false);

      const subcategorias: DynamicSubcategoria[] = subsFiltradas
        .map((s): DynamicSubcategoria => {
          const macroLower = macroName.trim().toLowerCase();
          const subLower = s.subcategoria.trim().toLowerCase();

          const compoundStat = spendingBySubMap.get(`${macroLower}:::${subLower}`);
          let gastado = 0;
          let count = 0;

          if (compoundStat && compoundStat.count > 0) {
            gastado = compoundStat.gastado;
            count = compoundStat.count;
          } else if (subLower === 'streaming y apps digitales') {
            for (const tx of txsGastoPeriodo) {
              const txSub = (tx.subcategoria || tx.sub || '').trim().toLowerCase();
              if (txSub.includes('streaming') || txSub.includes('apps digitales')) {
                gastado += Number(tx.monto) || 0;
                count += 1;
              }
            }
          } else {
            const subStat = spendingBySubMap.get(subLower);
            if (subStat) {
              gastado = subStat.gastado;
              count = subStat.count;
            }
          }

          const hasTxs = transacciones.length > 0 || (appData?.transacciones && appData.transacciones.length > 0);
          if (!hasTxs && periodFilter.preset === 'CICLO_ACTUAL') {
            const presItem = rawPresupuestos.find(
              (p) =>
                p.macro.trim().toLowerCase() === macroName.toLowerCase() &&
                p.sub.trim().toLowerCase() === s.subcategoria.trim().toLowerCase(),
            );
            gastado =
              typeof presItem?.gastado === 'number' && presItem.gastado > 0
                ? presItem.gastado
                : spentSubMap[s.subcategoria] ?? 0;
          }

          return {
            id: s.id,
            tipo: 'GASTO',
            macro: macroName,
            nombre: s.subcategoria,
            presupuesto: Number(s.presupuesto_base) || 0,
            gastado,
            count,
            orden: Number(s.orden ?? 99),
            medio_pago_sugerido: s.medio_pago_sugerido,
            activo: s.activo !== false,
          };
        })
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

      const sumPresupuesto = subcategorias
        .filter((s) => s.activo !== false)
        .reduce((acc, s) => acc + s.presupuesto, 0);
      const macroGastado =
        subcategorias.length > 0
          ? subcategorias.reduce((acc, s) => acc + s.gastado, 0)
          : (spentMacroMap[macroName] ?? 0);
      const macroCount = subcategorias.reduce((acc, s) => acc + s.count, 0);

      return {
        nombre: macroName,
        icono,
        orden_macro,
        presupuesto: sumPresupuesto,
        gastado: macroGastado,
        count: macroCount,
        subcategorias,
      };
    });

    return mapped.sort((a, b) => a.orden_macro - b.orden_macro || a.nombre.localeCompare(b.nombre));
  }, [
    catalogo,
    rawPresupuestos,
    spentSubMap,
    spentMacroMap,
    mostrarArchivadas,
    spendingBySubMap,
    txsGastoPeriodo,
    transacciones,
    appData?.transacciones,
    periodFilter.preset,
  ]);

  // ── 2. Construcción de Macrocategorías de INGRESO ordenadas por orden_macro ─
  const categoriesIngreso: DynamicMacroCategoria[] = useMemo(() => {
    const itemsCatalogoIngreso = catalogo.filter((c) => c.tipo === 'INGRESO');
    const macroNamesFromCatalogo = itemsCatalogoIngreso.map((c) => c.macro_categoria.trim());
    const allIngresoMacroNames = Array.from(
      new Set([
        ...DEFAULT_MACROS_INGRESO.map((m) => m.nombre),
        ...macroNamesFromCatalogo,
      ]),
    ).filter(Boolean);

    const mapped = allIngresoMacroNames.map((macroName) => {
      const icono = MACRO_ICONS[macroName] || '💰';
      const subs = itemsCatalogoIngreso.filter(
        (c) => c.macro_categoria.trim().toLowerCase() === macroName.toLowerCase(),
      );

      const ordenMacroFromItems = subs.map((s) => Number(s.orden_macro ?? 99))[0];
      const defaultIdx = DEFAULT_MACROS_INGRESO.findIndex(
        (m) => m.nombre.toLowerCase() === macroName.toLowerCase(),
      );
      const orden_macro =
        ordenMacroFromItems != null && ordenMacroFromItems !== 99
          ? ordenMacroFromItems
          : defaultIdx >= 0
            ? (defaultIdx + 1) * 10
            : 99;

      const subsFiltradas = mostrarArchivadas
        ? subs
        : subs.filter((s) => s.activo !== false);

      const subcategorias: DynamicSubcategoria[] = subsFiltradas
        .map((s): DynamicSubcategoria => ({
          id: s.id,
          tipo: 'INGRESO',
          macro: macroName,
          nombre: s.subcategoria,
          presupuesto: 0,
          gastado: 0,
          count: 0,
          orden: Number(s.orden ?? 99),
          medio_pago_sugerido: null,
          activo: s.activo !== false,
        }))
        .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));

      return {
        nombre: macroName,
        icono,
        orden_macro,
        presupuesto: 0,
        gastado: 0,
        count: 0,
        subcategorias,
      };
    });

    return mapped.sort((a, b) => a.orden_macro - b.orden_macro || a.nombre.localeCompare(b.nombre));
  }, [catalogo, mostrarArchivadas]);

  // Totales globales para Gastos
  const totalPresupuesto = categoriesGasto.reduce((s, c) => s + c.presupuesto, 0);
  const totalGastado =
    categoriesGasto.reduce(
      (s, c) =>
        s +
        (c.subcategorias.length > 0
          ? c.subcategorias.reduce((ss, sub) => ss + sub.gastado, 0)
          : c.gastado),
      0,
    ) || (appData?.kpis.gastos ?? 0);
  const totalCount = categoriesGasto.reduce((s, c) => s + c.count, 0);
  const globalPct = totalPresupuesto > 0 ? (totalGastado / totalPresupuesto) * 100 : 0;

  // ── Reordenamiento de Macrocategorías (Optimista) ───────────────────────────
  const handleMoveMacro = async (macroIndex: number, direction: -1 | 1) => {
    const list = tipoFiltro === 'GASTO' ? categoriesGasto : categoriesIngreso;
    const targetIndex = macroIndex + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const macroA = list[macroIndex];
    const macroB = list[targetIndex];

    let ordenParaA = macroB.orden_macro;
    let ordenParaB = macroA.orden_macro;

    if (ordenParaA === ordenParaB) {
      ordenParaA = (targetIndex + 1) * 10;
      ordenParaB = (macroIndex + 1) * 10;
    }

    // Actualización optimista local en memoria
    const prevAppData = appData;
    if (appData?.catalogo) {
      const updatedCatalogo = appData.catalogo.map((c) => {
        const isMatch =
          c.tipo === tipoFiltro || (tipoFiltro === 'GASTO' && c.tipo === undefined);
        if (isMatch) {
          if (c.macro_categoria.trim().toLowerCase() === macroA.nombre.toLowerCase()) {
            return { ...c, orden_macro: ordenParaA };
          }
          if (c.macro_categoria.trim().toLowerCase() === macroB.nombre.toLowerCase()) {
            return { ...c, orden_macro: ordenParaB };
          }
        }
        return c;
      });
      setAppData({ ...appData, catalogo: updatedCatalogo });
    }

    setIsReordering(true);
    haptic(40);
    try {
      await swapMacroOrden(tipoFiltro, macroA.nombre, ordenParaA, macroB.nombre, ordenParaB);
    } catch (err: any) {
      if (prevAppData) setAppData(prevAppData);
      showFeedback(err?.message || 'Error al reordenar macrocategoría', true);
    } finally {
      setIsReordering(false);
    }
  };

  // ── Reordenamiento de Subcategorías (Optimista) ─────────────────────────────
  const handleMoveSub = async (
    sub: DynamicSubcategoria,
    subList: DynamicSubcategoria[],
    direction: -1 | 1,
  ) => {
    const subIdx = subList.findIndex((s) => s.id === sub.id || s.nombre === sub.nombre);
    const targetIdx = subIdx + direction;
    if (subIdx < 0 || targetIdx < 0 || targetIdx >= subList.length) return;

    const subA = subList[subIdx];
    const subB = subList[targetIdx];

    if (!subA.id || !subB.id) {
      showFeedback('No se puede reordenar un ítem no persistido', true);
      return;
    }

    let ordenParaA = subB.orden;
    let ordenParaB = subA.orden;

    if (ordenParaA === ordenParaB) {
      ordenParaA = (targetIdx + 1) * 10;
      ordenParaB = (subIdx + 1) * 10;
    }

    const prevAppData = appData;
    if (appData?.catalogo) {
      const updatedCatalogo = appData.catalogo.map((c) => {
        if (String(c.id) === String(subA.id)) {
          return { ...c, orden: ordenParaA };
        }
        if (String(c.id) === String(subB.id)) {
          return { ...c, orden: ordenParaB };
        }
        return c;
      });
      setAppData({ ...appData, catalogo: updatedCatalogo });
    }

    setIsReordering(true);
    haptic(40);
    try {
      await swapSubcategoriaOrden(subA.id, ordenParaA, subB.id, ordenParaB);
    } catch (err: any) {
      if (prevAppData) setAppData(prevAppData);
      showFeedback(err?.message || 'Error al reordenar subcategoría', true);
    } finally {
      setIsReordering(false);
    }
  };

  // ── Handlers de Edición y Renombrado ────────────────────────────────────────

  const handleOpenEditSub = (sub: DynamicSubcategoria) => {
    setEditingSub(sub);
    setEditSubNombre(sub.nombre);
    setEditAmountDisplay(formatDisplay(String(sub.presupuesto)));
    setEditMedioPago(sub.medio_pago_sugerido || '');
  };

  const handleOpenRenameMacro = (macroName: string, tipo: 'GASTO' | 'INGRESO') => {
    setRenamingMacro({
      tipo,
      oldName: macroName,
      newName: macroName,
    });
  };

  const handleSaveRenameMacro = async () => {
    if (!renamingMacro || !renamingMacro.newName.trim()) return;
    const oldName = renamingMacro.oldName.trim();
    const newName = renamingMacro.newName.trim();
    if (oldName === newName) {
      setRenamingMacro(null);
      return;
    }

    setIsRenaming(true);
    haptic(50);
    try {
      await renameMacroCascade(renamingMacro.tipo, oldName, newName);
      showFeedback(`Macrocategoría renombrada a "${newName}".`);
      setRenamingMacro(null);
    } catch (err: any) {
      showFeedback(err?.message || 'Error al renombrar macrocategoría', true);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSaveEditSub = async () => {
    if (!editingSub || !editSubNombre.trim()) return;
    setIsUpdating(true);
    haptic(50);
    try {
      const nuevoNombre = editSubNombre.trim();
      const nuevoPresupuesto = parseAmount(editAmountDisplay);
      const nuevoMedioPago = editMedioPago ? editMedioPago.trim() : null;

      if (nuevoNombre !== editingSub.nombre) {
        await renameCategoriaCascade(
          editingSub.tipo,
          editingSub.macro,
          editingSub.nombre,
          editingSub.macro,
          nuevoNombre,
        );
      }

      if (editingSub.tipo === 'GASTO' && editingSub.id) {
        await updateCategoria(editingSub.id, {
          presupuesto_base: nuevoPresupuesto,
          medio_pago_sugerido: nuevoMedioPago,
        });
      }

      showFeedback(`Subcategoría "${nuevoNombre}" actualizada.`);
      setEditingSub(null);
    } catch (err: any) {
      showFeedback(err?.message || 'Error al actualizar subcategoría', true);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleArchiveSub = async () => {
    if (!editingSub) return;
    if (
      !window.confirm(
        `¿Deseas archivar "${editingSub.nombre}"?\n\nEl historial de transacciones se conservará intacto, pero ya no aparecerá en nuevos registros.`,
      )
    ) {
      return;
    }

    setIsUpdating(true);
    haptic(50);
    try {
      if (editingSub.id) {
        await updateCategoria(editingSub.id, { activo: false });
      }
      showFeedback(`"${editingSub.nombre}" ha sido archivada.`);
      setEditingSub(null);
    } catch (err: any) {
      showFeedback(err?.message || 'Error al archivar subcategoría', true);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReactivateSub = async () => {
    if (!editingSub) return;
    setIsUpdating(true);
    haptic(50);
    try {
      if (editingSub.id) {
        await updateCategoria(editingSub.id, { activo: true });
      }
      showFeedback(`"${editingSub.nombre}" ha sido reactivada.`);
      setEditingSub(null);
    } catch (err: any) {
      showFeedback(err?.message || 'Error al reactivar subcategoría', true);
    } finally {
      setIsUpdating(false);
    }
  };

  // ── Creación de Nueva Categoría ─────────────────────────────────────────────

  const handleOpenNewCategory = () => {
    haptic();
    setNewTipo(tipoFiltro);
    const macroOptions =
      tipoFiltro === 'GASTO'
        ? categoriesGasto.map((c) => c.nombre)
        : categoriesIngreso.map((c) => c.nombre);
    setNewMacro(macroOptions[0] || (tipoFiltro === 'GASTO' ? 'Alimentación' : 'Ingresos Laborales'));
    setNewMacroCustom('');
    setIsCustomMacro(false);
    setNewSubNombre('');
    setNewPresupuestoDisplay('0');
    setNewMedioPago(mediosPagoDisponibles[0] || 'TC Lulo Bank');
    setModalNewCat(true);
  };

  const handleCreateCategory = async () => {
    const targetMacro = isCustomMacro ? newMacroCustom.trim() : newMacro.trim();
    const targetSub = newSubNombre.trim();
    if (!targetMacro || !targetSub) return;

    setIsCreating(true);
    haptic(50);
    try {
      const nuevoMonto = newTipo === 'GASTO' ? parseAmount(newPresupuestoDisplay) : 0;
      const nuevoMedio = newTipo === 'GASTO' && newMedioPago ? newMedioPago.trim() : null;

      await createCategoria({
        tipo: newTipo,
        macro_categoria: targetMacro,
        subcategoria: targetSub,
        presupuesto_base: nuevoMonto,
        medio_pago_sugerido: nuevoMedio,
      });

      showFeedback(`Subcategoría "${targetSub}" creada con éxito.`);
      setModalNewCat(false);
    } catch (err: any) {
      showFeedback(err?.message || 'Error al crear la subcategoría', true);
    } finally {
      setIsCreating(false);
    }
  };

  const macroOptionsForNew = useMemo(() => {
    return newTipo === 'GASTO'
      ? categoriesGasto.map((c) => c.nombre)
      : categoriesIngreso.map((c) => c.nombre);
  }, [newTipo, categoriesGasto, categoriesIngreso]);

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 shadow-sm animate-slide-up ${
            feedback.isError
              ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-200'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200'
          }`}
        >
          {feedback.isError ? (
            <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0" />
          ) : (
            <Check size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Selector superior de pestaña + Toggle Archivadas */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800/70 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              haptic();
              setTipoFiltro('GASTO');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tipoFiltro === 'GASTO'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Gastos y Presupuestos
          </button>
          <button
            type="button"
            onClick={() => {
              haptic();
              setTipoFiltro('INGRESO');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tipoFiltro === 'INGRESO'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Categorías de Ingreso
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic();
            setMostrarArchivadas(!mostrarArchivadas);
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            mostrarArchivadas
              ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300'
              : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
          title={mostrarArchivadas ? 'Ocultar archivadas' : 'Ver archivadas'}
        >
          {mostrarArchivadas ? <EyeOff size={13} /> : <Eye size={13} />}
          <span>{mostrarArchivadas ? 'Archivadas' : 'Archivadas'}</span>
        </button>
      </div>

      {/* VISTA 1: GASTOS Y PRESUPUESTOS */}
      {tipoFiltro === 'GASTO' && (
        <>
          {/* Selector de Periodo */}
          <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <PeriodSelector value={periodFilter} onChange={setPeriodFilter} />
          </div>

          {/* Card Resumen Global del Ciclo o Periodo */}
          <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  {isCicloCompleto ? 'Total del Ciclo' : 'Total del Periodo'}
                </p>
                <p className="text-3xl font-black text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCOP(totalGastado)}
                </p>
                {!isCicloCompleto && (
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                    {totalCount} {totalCount === 1 ? 'movimiento en rango' : 'movimientos en rango'}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                  {isCicloCompleto ? 'Presupuesto' : 'Presupuesto Base'}
                </p>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {formatCOP(totalPresupuesto)}
                </p>
                {isCicloCompleto && (
                  <p className={`text-xs font-black mt-0.5 ${progressTextColor(globalPct)}`}>
                    {globalPct.toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
            {isCicloCompleto && <ProgressBar pct={globalPct} label="Presupuesto total del ciclo" />}
          </div>

          {/* Acordeón de Macrocategorías de Gasto */}
          {categoriesGasto.map((cat, idx) => {
            const isOpen = openMacros[cat.nombre] ?? false;
            const totalSubGastado =
              cat.subcategorias.length > 0
                ? cat.subcategorias.reduce((s, sub) => s + (sub.gastado || 0), 0)
                : cat.gastado;
            const pct =
              cat.presupuesto > 0 ? (totalSubGastado / cat.presupuesto) * 100 : 0;
            const remaining = cat.presupuesto - totalSubGastado;

            return (
              <div
                key={cat.nombre}
                className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all"
              >
                {/* Header Macrocategoría */}
                <div className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleMacro(cat.nombre)}
                    className="flex-1 flex items-center gap-3 text-left cursor-pointer min-w-0"
                    aria-expanded={isOpen}
                  >
                    <span className="text-xl flex-shrink-0">{cat.icono}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate mr-2">
                          {cat.nombre}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCicloCompleto ? (
                            <>
                              <span className={`text-xs font-black ${progressTextColor(pct)}`}>
                                {pct.toFixed(0)}%
                              </span>
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                {formatCOP(totalSubGastado)} / {formatCOP(cat.presupuesto)}
                              </span>
                            </>
                          ) : (
                            <div className="text-right">
                              <span className="text-xs font-black text-slate-900 dark:text-slate-100 font-mono">
                                {formatCOP(totalSubGastado)}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium ml-1.5">
                                ({cat.count} {cat.count === 1 ? 'mov.' : 'mov.'})
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      {isCicloCompleto ? (
                        <>
                          <ProgressBar
                            pct={pct}
                            label={`${cat.nombre}: ${pct.toFixed(0)}% del presupuesto`}
                          />
                          <div className="mt-1 flex items-center justify-between">
                            <span
                              className={`text-[10px] font-semibold ${
                                remaining >= 0
                                  ? 'text-slate-600 dark:text-slate-400'
                                  : 'text-rose-600 dark:text-rose-400 font-bold'
                              }`}
                            >
                              {remaining >= 0
                                ? `Disponible: ${formatCOP(remaining)}`
                                : `⚠ Excedido: ${formatCOP(Math.abs(remaining))}`}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                          <span>{cat.count} {cat.count === 1 ? 'movimiento en rango' : 'movimientos en rango'}</span>
                          <span>Base mensual: {formatCOP(cat.presupuesto)}</span>
                        </div>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        haptic();
                        handleMoveMacro(idx, -1);
                      }}
                      disabled={idx === 0 || isReordering}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                      title="Subir macrocategoría"
                      aria-label="Subir macrocategoría"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        haptic();
                        handleMoveMacro(idx, 1);
                      }}
                      disabled={idx === categoriesGasto.length - 1 || isReordering}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                      title="Bajar macrocategoría"
                      aria-label="Bajar macrocategoría"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenRenameMacro(cat.nombre, 'GASTO')}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      title={`Renombrar macrocategoría "${cat.nombre}"`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMacro(cat.nombre)}
                      className="p-1 text-slate-400 dark:text-slate-500 cursor-pointer"
                    >
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                </div>

                {/* Subcategorías de la Macro */}
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/70 dark:bg-slate-950/40 animate-slide-up">
                    {cat.subcategorias.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 italic text-center">
                        Sin subcategorías en este ciclo
                      </div>
                    ) : (
                      cat.subcategorias.map((sub, subIdx) => {
                        const subGastado = sub.gastado || 0;
                        const subPct =
                          sub.presupuesto > 0 ? (subGastado / sub.presupuesto) * 100 : 0;
                        const subRemaining = sub.presupuesto - subGastado;

                        return (
                          <div
                            key={sub.nombre}
                            className="px-4 py-2.5 pl-14 flex flex-col gap-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 truncate mr-2">
                                <span
                                  className={`text-xs font-semibold truncate ${
                                    sub.activo === false
                                      ? 'text-slate-400 dark:text-slate-500 line-through'
                                      : 'text-slate-700 dark:text-slate-300'
                                  }`}
                                >
                                  {sub.nombre}
                                </span>
                                {sub.activo === false && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex-shrink-0">
                                    Archivada
                                  </span>
                                )}
                                {sub.medio_pago_sugerido && (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate hidden sm:inline flex-shrink-0">
                                    💳 {sub.medio_pago_sugerido}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {isCicloCompleto ? (
                                  <>
                                    <span
                                      className={`text-[11px] font-black ${progressTextColor(
                                        subPct,
                                      )}`}
                                    >
                                      {subPct.toFixed(0)}%
                                    </span>
                                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                      {formatCOP(subGastado)} / {formatCOP(sub.presupuesto)}
                                    </span>
                                  </>
                                ) : (
                                  <div className="text-right">
                                    <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 font-mono">
                                      {formatCOP(subGastado)}
                                    </span>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1">
                                      ({sub.count} {sub.count === 1 ? 'mov.' : 'mov.'})
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-0.5 ml-1">
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSub(sub, cat.subcategorias, -1)}
                                    disabled={subIdx === 0 || isReordering}
                                    className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                                    title="Subir subcategoría"
                                    aria-label="Subir subcategoría"
                                  >
                                    <ChevronUp size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveSub(sub, cat.subcategorias, 1)}
                                    disabled={subIdx === cat.subcategorias.length - 1 || isReordering}
                                    className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                                    title="Bajar subcategoría"
                                    aria-label="Bajar subcategoría"
                                  >
                                    <ChevronDown size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditSub(sub)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition cursor-pointer"
                                    title={`Editar subcategoría ${sub.nombre}`}
                                  >
                                    <Pencil size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                            {isCicloCompleto ? (
                              <>
                                <ProgressBar
                                  pct={subPct}
                                  label={`${sub.nombre}: ${subPct.toFixed(0)}%`}
                                />
                                <p
                                  className={`text-[10px] mt-0.5 font-medium ${
                                    subRemaining >= 0
                                      ? 'text-slate-600 dark:text-slate-400'
                                      : 'text-rose-600 dark:text-rose-400 font-bold'
                                  }`}
                                >
                                  {subRemaining >= 0
                                    ? `Disponible: ${formatCOP(subRemaining)}`
                                    : `⚠ Excedido: ${formatCOP(Math.abs(subRemaining))}`}
                                </p>
                              </>
                            ) : (
                              <p className="text-[10px] mt-0.5 text-slate-500 dark:text-slate-400 font-medium">
                                {sub.count > 0 ? `${sub.count} mov. en rango` : 'Sin movimientos en rango'} · Base: {formatCOP(sub.presupuesto)}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* VISTA 2: CATEGORÍAS DE INGRESO */}
      {tipoFiltro === 'INGRESO' && (
        <div className="flex flex-col gap-3">
          {categoriesIngreso.map((macro, idx) => {
            const isOpen = openMacros[macro.nombre] ?? true;
            return (
              <div
                key={macro.nombre}
                className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all"
              >
                <div className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleMacro(macro.nombre)}
                    className="flex-1 flex items-center gap-3 text-left cursor-pointer min-w-0"
                  >
                    <span className="text-xl flex-shrink-0">{macro.icono}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {macro.nombre}
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {macro.subcategorias.filter((s) => s.activo !== false).length}{' '}
                        subcategorías activas
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        haptic();
                        handleMoveMacro(idx, -1);
                      }}
                      disabled={idx === 0 || isReordering}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                      title="Subir macrocategoría"
                      aria-label="Subir macrocategoría"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        haptic();
                        handleMoveMacro(idx, 1);
                      }}
                      disabled={idx === categoriesIngreso.length - 1 || isReordering}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                      title="Bajar macrocategoría"
                      aria-label="Bajar macrocategoría"
                    >
                      <ChevronDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenRenameMacro(macro.nombre, 'INGRESO')}
                      className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      title={`Renombrar macrocategoría "${macro.nombre}"`}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleMacro(macro.nombre)}
                      className="p-1 text-slate-400 dark:text-slate-500 cursor-pointer"
                    >
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
                    {macro.subcategorias.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500 italic text-center">
                        Sin subcategorías registradas
                      </div>
                    ) : (
                      macro.subcategorias.map((sub, subIdx) => (
                        <div
                          key={sub.nombre}
                          className="px-4 py-2.5 pl-14 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2 truncate mr-2">
                            <span
                              className={`text-xs font-semibold truncate ${
                                sub.activo === false
                                  ? 'text-slate-400 dark:text-slate-500 line-through'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {sub.nombre}
                            </span>
                            {sub.activo === false && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex-shrink-0">
                                Archivada
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveSub(sub, macro.subcategorias, -1)}
                              disabled={subIdx === 0 || isReordering}
                              className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                              title="Subir subcategoría"
                              aria-label="Subir subcategoría"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveSub(sub, macro.subcategorias, 1)}
                              disabled={subIdx === macro.subcategorias.length - 1 || isReordering}
                              className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition cursor-pointer"
                              title="Bajar subcategoría"
                              aria-label="Bajar subcategoría"
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditSub(sub)}
                              className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                              title={`Editar ${sub.nombre}`}
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Botón "+ Nueva Categoría" */}
      <button
        type="button"
        onClick={handleOpenNewCategory}
        className="w-full py-3.5 px-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-white/70 dark:bg-slate-900/50 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 flex items-center justify-center gap-2 transition active:scale-[0.99] shadow-sm cursor-pointer mt-1"
      >
        <Plus size={16} />
        <span>
          + Nueva Subcategoría ({tipoFiltro === 'GASTO' ? 'Gasto' : 'Ingreso'})
        </span>
      </button>

      {/* MODAL 1: Renombrar Macrocategoría en Cascada */}
      {renamingMacro && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRenamingMacro(null);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Pencil size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Renombrar Macrocategoría
                  </h3>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                    {renamingMacro.tipo === 'GASTO' ? 'Gasto' : 'Ingreso'}: {renamingMacro.oldName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRenamingMacro(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label
                htmlFor="rename-macro-input"
                className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
              >
                Nuevo nombre de la Macrocategoría
              </label>
              <input
                id="rename-macro-input"
                type="text"
                value={renamingMacro.newName}
                onChange={(e) =>
                  setRenamingMacro({ ...renamingMacro, newName: e.target.value })
                }
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Ej. Vivienda y Servicios"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                💡 Este cambio renombrará en cascada la macrocategoría en el catálogo y en todas las transacciones históricas.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRenamingMacro(null)}
                disabled={isRenaming}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveRenameMacro}
                disabled={
                  isRenaming ||
                  !renamingMacro.newName.trim() ||
                  renamingMacro.newName.trim() === renamingMacro.oldName
                }
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5"
              >
                {isRenaming ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Renombrar en Cascada</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Editar / Renombrar / Archivar Subcategoría */}
      {editingSub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingSub(null);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <Pencil size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                    Editar Subcategoría
                  </h3>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                    {editingSub.macro} › {editingSub.nombre}
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

            {/* Nombre de la Subcategoría */}
            <div>
              <label
                htmlFor="edit-sub-name"
                className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
              >
                Nombre de la Subcategoría
              </label>
              <input
                id="edit-sub-name"
                type="text"
                value={editSubNombre}
                onChange={(e) => setEditSubNombre(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Solo GASTO: Presupuesto Base y Medio de Pago Sugerido */}
            {editingSub.tipo === 'GASTO' && (
              <>
                <div>
                  <label
                    htmlFor="edit-budget-input"
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
                  >
                    Presupuesto Base (COP)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 dark:text-slate-500">
                      $
                    </span>
                    <input
                      id="edit-budget-input"
                      type="text"
                      inputMode="numeric"
                      value={editAmountDisplay}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        setEditAmountDisplay(digits ? formatDisplay(digits) : '0');
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="edit-medio-pago"
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
                  >
                    Medio de Pago Sugerido
                  </label>
                  <select
                    id="edit-medio-pago"
                    value={editMedioPago}
                    onChange={(e) => setEditMedioPago(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Sin sugerencia</option>
                    {mediosPagoDisponibles.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* Botón Archivar / Reactivar */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                Estado: {editingSub.activo !== false ? 'Activa' : 'Archivada'}
              </span>
              {editingSub.activo !== false ? (
                <button
                  type="button"
                  onClick={handleArchiveSub}
                  disabled={isUpdating}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold transition cursor-pointer"
                >
                  <Archive size={12} />
                  <span>Archivar</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleReactivateSub}
                  disabled={isUpdating}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-semibold transition cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Reactivar</span>
                </button>
              )}
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
                onClick={handleSaveEditSub}
                disabled={isUpdating || !editSubNombre.trim()}
                className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5"
              >
                {isUpdating ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Guardando...</span>
                  </>
                ) : (
                  <span>Guardar Cambios</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Nueva Subcategoría / Categoría */}
      {modalNewCat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalNewCat(false);
          }}
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
                    Añadir al catálogo de {newTipo === 'GASTO' ? 'gastos' : 'ingresos'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalNewCat(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Switch de Tipo */}
            <div className="flex p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
              <button
                type="button"
                onClick={() => setNewTipo('GASTO')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  newTipo === 'GASTO'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Gasto
              </button>
              <button
                type="button"
                onClick={() => setNewTipo('INGRESO')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                  newTipo === 'INGRESO'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                Ingreso
              </button>
            </div>

            {/* Macrocategoría */}
            <div>
              <label
                htmlFor="new-macro-select"
                className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
              >
                Macrocategoría
              </label>
              <select
                id="new-macro-select"
                value={isCustomMacro ? '__custom__' : newMacro}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setIsCustomMacro(true);
                  } else {
                    setIsCustomMacro(false);
                    setNewMacro(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {macroOptionsForNew.map((m) => (
                  <option key={m} value={m}>
                    {MACRO_ICONS[m] || '📊'} {m}
                  </option>
                ))}
                <option value="__custom__">➕ Nueva Macrocategoría...</option>
              </select>
              {isCustomMacro && (
                <input
                  type="text"
                  value={newMacroCustom}
                  onChange={(e) => setNewMacroCustom(e.target.value)}
                  placeholder="Escribe el nombre de la macro"
                  className="w-full mt-1.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>

            {/* Nombre de Subcategoría */}
            <div>
              <label
                htmlFor="new-sub-name"
                className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
              >
                Nombre de la Subcategoría
              </label>
              <input
                id="new-sub-name"
                type="text"
                value={newSubNombre}
                onChange={(e) => setNewSubNombre(e.target.value)}
                placeholder="Ej. Salario, Plataformas IA, Peajes"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Si es GASTO: Presupuesto y Medio de Pago */}
            {newTipo === 'GASTO' && (
              <>
                <div>
                  <label
                    htmlFor="new-sub-budget"
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
                  >
                    Presupuesto Base (COP)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500">
                      $
                    </span>
                    <input
                      id="new-sub-budget"
                      type="text"
                      inputMode="numeric"
                      value={newPresupuestoDisplay}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        setNewPresupuestoDisplay(digits ? formatDisplay(digits) : '0');
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-black text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="new-medio-pago"
                    className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1"
                  >
                    Medio de Pago Sugerido
                  </label>
                  <select
                    id="new-medio-pago"
                    value={newMedioPago}
                    onChange={(e) => setNewMedioPago(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Sin sugerencia</option>
                    {mediosPagoDisponibles.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalNewCat(false)}
                disabled={isCreating}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={
                  isCreating ||
                  !newSubNombre.trim() ||
                  (isCustomMacro && !newMacroCustom.trim())
                }
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold shadow-md transition flex items-center justify-center gap-1.5"
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
