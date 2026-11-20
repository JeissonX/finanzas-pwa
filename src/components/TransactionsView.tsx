import { useState, useMemo, useRef, useEffect } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  SlidersHorizontal,
  Trash2,
  Calendar,
  Search,
  PlusCircle,
  CheckCircle2,
  Clock,
  Wallet,
  Download,
  Pencil,
} from "lucide-react";
import type {
  Transaccion,
  TipoTransaccion,
  CatalogoItem,
} from "../types/finance";
import {
  formatCOP,
  formatDateSpanish,
  isDateInCurrentCycle,
  getCycleLabel,
  haptic,
} from "../utils/format";
import { exportTransactionsToCSV } from "../utils/exportCsv";
import { toBogotaDateStr } from "../utils/periodFilter";
import EditTransactionModal from "./EditTransactionModal";

interface TransactionsViewProps {
  onOpenRegister?: () => void;
  onNavigateToRegister?: () => void;
  transacciones: Transaccion[];
  onDeleteTransaction: (id: number | string) => Promise<boolean>;
  onUpdateTransaction?: (
    id: number | string,
    updated: Partial<Transaccion>,
  ) => Promise<boolean | void>;
  catalogo?: CatalogoItem[];
}

type FiltroTipo = "TODOS" | TipoTransaccion;

export default function TransactionsView({
  onOpenRegister,
  onNavigateToRegister,
  transacciones,
  onDeleteTransaction,
  onUpdateTransaction,
  catalogo,
}: TransactionsViewProps) {
  const [editingTx, setEditingTx] = useState<Transaccion | null>(null);
  const handleRegister = () => {
    haptic();
    if (onOpenRegister) {
      onOpenRegister();
    } else if (onNavigateToRegister) {
      onNavigateToRegister();
    }
  };
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("TODOS");
  const [soloCicloActivo, setSoloCicloActivo] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  // ── Filtros Avanzados ──────────────────────────────────────
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [filtroFechaDesde, setFiltroFechaDesde] = useState("");
  const [filtroFechaHasta, setFiltroFechaHasta] = useState("");
  const [filtroMacro, setFiltroMacro] = useState("");
  const [filtroSub, setFiltroSub] = useState("");
  const [filtroCuenta, setFiltroCuenta] = useState("");

  // Opciones dinámicas para selects de filtros
  const macroOptions = useMemo(() => {
    const set = new Set<string>();
    (catalogo || []).forEach((c) => {
      if (c.macro_categoria?.trim()) set.add(c.macro_categoria.trim());
    });
    transacciones.forEach((tx) => {
      const m = (tx.categoria || tx.macroCategoria || tx.macro || "").trim();
      if (m) set.add(m);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [catalogo, transacciones]);

  const subOptions = useMemo(() => {
    const set = new Set<string>();
    const targetMacro = filtroMacro.trim().toLowerCase();
    (catalogo || []).forEach((c) => {
      if (!targetMacro || c.macro_categoria?.trim().toLowerCase() === targetMacro) {
        if (c.subcategoria?.trim()) set.add(c.subcategoria.trim());
      }
    });
    transacciones.forEach((tx) => {
      const m = (tx.categoria || tx.macroCategoria || tx.macro || "").trim().toLowerCase();
      if (!targetMacro || m === targetMacro) {
        const s = (tx.subcategoria || tx.sub || "").trim();
        if (s) set.add(s);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [catalogo, transacciones, filtroMacro]);

  const cuentaOptions = useMemo(() => {
    const set = new Set<string>();
    transacciones.forEach((tx) => {
      if (tx.cuenta?.trim()) set.add(tx.cuenta.trim());
      if (tx.cuentaOrigen?.trim()) set.add(tx.cuentaOrigen.trim());
      if (tx.cuentaDestino?.trim()) set.add(tx.cuentaDestino.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [transacciones]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filtroFechaDesde) count++;
    if (filtroFechaHasta) count++;
    if (filtroMacro) count++;
    if (filtroSub) count++;
    if (filtroCuenta) count++;
    return count;
  }, [filtroFechaDesde, filtroFechaHasta, filtroMacro, filtroSub, filtroCuenta]);

  const handleClearFilters = () => {
    haptic();
    setFiltroFechaDesde("");
    setFiltroFechaHasta("");
    setFiltroMacro("");
    setFiltroSub("");
    setFiltroCuenta("");
  };

  const handleMacroChange = (macro: string) => {
    setFiltroMacro(macro);
    setFiltroSub("");
  };

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedbackMsg(null), 3000);
  };

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // Filtrado de transacciones
  const filteredTxs = useMemo(() => {
    return transacciones.filter((tx) => {
      const txFecha = toBogotaDateStr(tx.fecha);

      // 1. Filtro por ciclo (solo si no se fijó un rango de fechas explícito)
      if (soloCicloActivo && !filtroFechaDesde && !filtroFechaHasta) {
        if (!isDateInCurrentCycle(tx.fecha)) {
          return false;
        }
      }

      // 2. Filtro por fechas Desde / Hasta
      if (filtroFechaDesde && txFecha < filtroFechaDesde) {
        return false;
      }
      if (filtroFechaHasta && txFecha > filtroFechaHasta) {
        return false;
      }

      // 3. Filtro por tipo
      if (filtroTipo !== "TODOS" && tx.tipo !== filtroTipo) {
        return false;
      }

      // 4. Filtro por Macrocategoría
      if (filtroMacro) {
        const m = (tx.categoria || tx.macroCategoria || tx.macro || "").trim().toLowerCase();
        if (m !== filtroMacro.trim().toLowerCase()) return false;
      }

      // 5. Filtro por Subcategoría
      if (filtroSub) {
        const s = (tx.subcategoria || tx.sub || "").trim().toLowerCase();
        if (s !== filtroSub.trim().toLowerCase()) return false;
      }

      // 6. Filtro por Cartera / Cuenta
      if (filtroCuenta) {
        const target = filtroCuenta.trim().toLowerCase();
        const c = (tx.cuenta || "").trim().toLowerCase();
        const cOrig = (tx.cuentaOrigen || (tx as any).cuenta_origen || "").trim().toLowerCase();
        const cDest = (tx.cuentaDestino || (tx as any).cuenta_destino || "").trim().toLowerCase();
        if (c !== target && cOrig !== target && cDest !== target) {
          return false;
        }
      }

      // 7. Filtro por búsqueda de texto
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase().trim();
        const sub = (tx.subcategoria || tx.sub || "").toLowerCase();
        const macro = (tx.categoria || tx.macro || "").toLowerCase();
        const cuenta = (tx.cuenta || tx.cuentaOrigen || "").toLowerCase();
        const destino = (tx.cuentaDestino || "").toLowerCase();
        const comment = (tx.comentario || tx.detalle || "").toLowerCase();
        if (
          !sub.includes(query) &&
          !macro.includes(query) &&
          !cuenta.includes(query) &&
          !destino.includes(query) &&
          !comment.includes(query)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    transacciones,
    soloCicloActivo,
    filtroFechaDesde,
    filtroFechaHasta,
    filtroTipo,
    filtroMacro,
    filtroSub,
    filtroCuenta,
    busqueda,
  ]);

  // Totales calculados sobre la lista filtrada
  const stats = useMemo(() => {
    let gastos = 0;
    let ingresos = 0;
    for (const tx of filteredTxs) {
      if (tx.tipo === "GASTO") gastos += tx.monto;
      if (tx.tipo === "INGRESO") ingresos += tx.monto;
    }
    return { gastos, ingresos, count: filteredTxs.length };
  }, [filteredTxs]);

  // Eliminar transacción con confirmación nativa window.confirm
  const handleDelete = async (id: number | string) => {
    if (
      window.confirm("¿Estás seguro de que deseas eliminar este movimiento?")
    ) {
      haptic(50);
      try {
        const ok = await onDeleteTransaction(id);
        if (ok) {
          showFeedback("Movimiento eliminado correctamente.");
        }
      } catch (err) {
        console.error("Error al eliminar movimiento:", err);
      }
    }
  };

  const cicloLabel = getCycleLabel();

  // Exportar a CSV nativo compatible con Excel es_CO
  const handleExportCSV = () => {
    haptic(40);
    const toExport = filteredTxs;
    if (toExport.length === 0) {
      showFeedback("No hay movimientos para exportar.");
      return;
    }
    const label =
      soloCicloActivo && !filtroFechaDesde && !filtroFechaHasta
        ? cicloLabel
        : filtroFechaDesde || filtroFechaHasta
          ? `${filtroFechaDesde || "Inicio"}_a_${filtroFechaHasta || "Fin"}`
          : "Movimientos_Filtrados";
    exportTransactionsToCSV(toExport, label);
    showFeedback(`Se exportaron ${toExport.length} movimientos a CSV.`);
  };

  // Badges y estilos sobrios según el tipo de transacción
  const getBadgeConfig = (tipo: TipoTransaccion) => {
    switch (tipo) {
      case "GASTO":
        return {
          label: "Gasto",
          Icon: ArrowDownRight,
          classes:
            "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60",
          amountClass: "text-rose-600 dark:text-rose-400",
          prefix: "-",
        };
      case "INGRESO":
        return {
          label: "Ingreso",
          Icon: ArrowUpRight,
          classes:
            "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60",
          amountClass: "text-emerald-600 dark:text-emerald-400",
          prefix: "+",
        };
      case "TRANSFERENCIA":
        return {
          label: "Transferencia",
          Icon: ArrowLeftRight,
          classes:
            "bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60",
          amountClass: "text-blue-600 dark:text-blue-400",
          prefix: "",
        };
      case "AJUSTE":
        return {
          label: "Ajuste",
          Icon: SlidersHorizontal,
          classes:
            "bg-slate-100 text-slate-700 border-slate-300/80 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
          amountClass: "text-slate-700 dark:text-slate-300",
          prefix: "",
        };
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">
      {/* Notificación de feedback */}
      {feedbackMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2 shadow-sm animate-slide-up">
          <CheckCircle2
            size={16}
            className="text-emerald-600 dark:text-emerald-400 flex-shrink-0"
          />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Header y Filtro de Ciclo */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold">
              <Clock size={16} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                Historial de Movimientos
              </h2>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <Calendar size={11} />
                <span>
                  {soloCicloActivo
                    ? `Ciclo activo: ${cicloLabel}`
                    : "Todos los ciclos"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCSV}
              className="p-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-sm cursor-pointer"
              title="Exportar movimientos a CSV"
              aria-label="Exportar movimientos a CSV"
            >
              <Download size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                haptic();
                setSoloCicloActivo((prev) => !prev);
              }}
              className={`
                px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer
                ${
                  soloCicloActivo
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                    : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                }
              `}
            >
              {soloCicloActivo ? "Solo este ciclo" : "Ver todo"}
            </button>
          </div>
        </div>

        {/* Resumen rápido del ciclo/filtro */}
        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          <div className="p-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40">
            <span className="text-[10px] font-bold text-rose-800 dark:text-rose-300 uppercase tracking-wider block">
              Gastos Filtrados
            </span>
            <span className="text-base font-black text-rose-600 dark:text-rose-400 font-mono">
              {formatCOP(stats.gastos)}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
            <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
              Ingresos Filtrados
            </span>
            <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">
              {formatCOP(stats.ingresos)}
            </span>
          </div>
        </div>

        {/* Botón principal: + REGISTRAR MOVIMIENTO */}
        <button
          type="button"
          onClick={handleRegister}
          className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 font-bold text-xs uppercase tracking-wider shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <PlusCircle size={16} />
          <span>+ REGISTRAR MOVIMIENTO</span>
        </button>

        {/* Barra de búsqueda, botón de Filtros y exportación */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por categoría, cuenta o comentario..."
              className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              haptic();
              setMostrarFiltros((prev) => !prev);
            }}
            className={`
              px-2.5 py-2 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 flex-shrink-0 cursor-pointer
              ${
                mostrarFiltros || activeFiltersCount > 0
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 shadow-sm"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:border-slate-700"
              }
            `}
            title="Filtros avanzados"
          >
            <SlidersHorizontal size={14} />
            <span className="hidden sm:inline">Filtros</span>
            {activeFiltersCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeFiltersCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 transition shadow-sm active:scale-95 flex items-center justify-center flex-shrink-0 cursor-pointer"
            title="Exportar movimientos a CSV"
            aria-label="Exportar movimientos a CSV"
          >
            <Download size={15} />
          </button>
        </div>

        {/* Panel Desplegable de Filtros Avanzados */}
        {mostrarFiltros && (
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col gap-3 animate-slide-up">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Filtros Avanzados
              </span>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Limpiar filtros ({activeFiltersCount})
                </button>
              )}
            </div>

            {/* Fechas Desde / Hasta */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Desde
                </label>
                <input
                  type="date"
                  value={filtroFechaDesde}
                  onChange={(e) => {
                    setFiltroFechaDesde(e.target.value);
                    if (soloCicloActivo && e.target.value) setSoloCicloActivo(false);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Hasta
                </label>
                <input
                  type="date"
                  value={filtroFechaHasta}
                  onChange={(e) => {
                    setFiltroFechaHasta(e.target.value);
                    if (soloCicloActivo && e.target.value) setSoloCicloActivo(false);
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            {/* Macrocategoría y Subcategoría */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Macrocategoría
                </label>
                <select
                  value={filtroMacro}
                  onChange={(e) => handleMacroChange(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="">Todas las macros</option>
                  {macroOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Subcategoría
                </label>
                <select
                  value={filtroSub}
                  onChange={(e) => setFiltroSub(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="">Todas las subs</option>
                  {subOptions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cartera / Cuenta */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Cartera / Cuenta
              </label>
              <select
                value={filtroCuenta}
                onChange={(e) => setFiltroCuenta(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">Todas las cuentas</option>
                {cuentaOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Tabs de tipo de transacción */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          {(
            [
              "TODOS",
              "GASTO",
              "INGRESO",
              "TRANSFERENCIA",
              "AJUSTE",
            ] as FiltroTipo[]
          ).map((t) => {
            const active = filtroTipo === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  haptic();
                  setFiltroTipo(t);
                }}
                className={`
                  px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap border transition-all duration-150
                  ${
                    active
                      ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 shadow-sm"
                      : "bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200/90 dark:border-slate-700 hover:text-slate-900 dark:hover:text-slate-100"
                  }
                `}
              >
                {t === "TODOS" ? `Todos (${stats.count})` : t}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pastilla resumen viva del segmento filtrado */}
      <div className="flex items-center justify-between px-3.5 py-2 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-sm">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-slate-900 dark:text-slate-100">
            {stats.count} {stats.count === 1 ? "movimiento" : "movimientos"}
          </span>
          <span>·</span>
          <span>
            Gastos: <strong className="text-rose-600 dark:text-rose-400 font-mono font-bold">{formatCOP(stats.gastos)}</strong>
          </span>
          {stats.ingresos > 0 && (
            <>
              <span>·</span>
              <span>
                Ingresos: <strong className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{formatCOP(stats.ingresos)}</strong>
              </span>
            </>
          )}
        </div>
        {activeFiltersCount > 0 && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-[11px] text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 underline cursor-pointer ml-2 flex-shrink-0"
          >
            Limpiar ({activeFiltersCount})
          </button>
        )}
      </div>

      {/* Lista de transacciones */}
      {filteredTxs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
            <Clock size={28} />
          </div>
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
            Sin movimientos en este ciclo
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs leading-relaxed">
            {busqueda
              ? "No hay movimientos que coincidan con el término de búsqueda."
              : `No se han registrado transacciones dentro del ciclo activo (${cicloLabel}).`}
          </p>
          {(onOpenRegister || onNavigateToRegister) && !busqueda && (
            <button
              type="button"
              onClick={handleRegister}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-bold shadow-md hover:opacity-90 transition active:scale-95 cursor-pointer"
            >
              <PlusCircle size={14} />
              <span>Registrar primer movimiento</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredTxs.map((tx) => {
            const badge = getBadgeConfig(tx.tipo);
            const { label, Icon, classes, amountClass, prefix } = badge;
            const subcat = tx.subcategoria || tx.sub || "General";
            const macro = tx.categoria || tx.macro || "";
            const comentario = tx.comentario || tx.detalle;
            const cuenta = tx.cuenta || tx.cuentaOrigen;
            const destino = tx.cuentaDestino;
            const isOffline = tx.sincronizado === false;

            return (
              <div
                key={tx.id}
                className="
                  rounded-2xl bg-white dark:bg-slate-900/80
                  border border-slate-200/90 dark:border-slate-800
                  p-3.5 shadow-sm hover:shadow transition flex flex-col gap-2.5
                "
              >
                {/* Fila superior: Badge de tipo + Fecha + Botón eliminar */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`
                        inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide
                        ${classes}
                      `}
                    >
                      <Icon size={12} strokeWidth={2.5} />
                      <span>{label}</span>
                    </span>

                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      {formatDateSpanish(tx.fecha)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isOffline && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                        title="Pendiente de sincronizar con el Webhook"
                      >
                        <Clock size={10} />
                        <span>Offline</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        haptic();
                        setEditingTx(tx);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      aria-label="Editar movimiento"
                      title="Editar movimiento"
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(tx.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                      aria-label="Eliminar y revertir movimiento"
                      title="Eliminar y revertir movimiento"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Fila central: Categorías y Monto */}
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight truncate">
                      {subcat}
                    </p>
                    {macro && (
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                        {macro}
                      </p>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span
                      className={`text-base font-black font-mono tracking-tight ${amountClass}`}
                    >
                      {prefix}
                      {formatCOP(tx.monto)}
                    </span>
                  </div>
                </div>

                {/* Comentario opcional */}
                {comentario && (
                  <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-300 italic">
                    «{comentario}»
                  </div>
                )}

                {/* Fila inferior: Cuenta / Cartera asociada */}
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                  <Wallet size={12} className="text-slate-400 flex-shrink-0" />
                  <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                    {tx.tipo === "TRANSFERENCIA" && destino ? (
                      <>
                        <span>{cuenta}</span>
                        <span className="mx-1 text-blue-500 font-bold">➔</span>
                        <span>{destino}</span>
                      </>
                    ) : tx.tipo === "GASTO" && destino ? (
                      <>
                        <span>{cuenta}</span>
                        <span className="mx-1 text-rose-500 font-bold">➔</span>
                        <span className="text-slate-800 dark:text-slate-200">
                          Abono: {destino}
                        </span>
                      </>
                    ) : (
                      cuenta
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de edición */}
      <EditTransactionModal
        isOpen={Boolean(editingTx)}
        onClose={() => setEditingTx(null)}
        transaccion={editingTx}
        catalogo={catalogo}
        onSave={async (id, updated) => {
          if (onUpdateTransaction) {
            await onUpdateTransaction(id, updated);
            showFeedback("Movimiento actualizado correctamente.");
          }
        }}
      />
    </div>
  );
}
