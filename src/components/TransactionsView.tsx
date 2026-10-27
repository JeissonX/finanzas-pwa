import { useState, useMemo } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  SlidersHorizontal,
  Trash2,
  Calendar,
  Search,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Clock,
  Wallet,
} from 'lucide-react';
import type { Transaccion, TipoTransaccion } from '../types/finance';
import {
  formatCOP,
  formatDateSpanish,
  isDateInCurrentCycle,
  getCycleLabel,
  haptic,
} from '../utils/format';

interface TransactionsViewProps {
  onNavigateToRegister?: () => void;
  transacciones: Transaccion[];
  onDeleteTransaction: (id: number | string) => Promise<boolean>;
}

type FiltroTipo = 'TODOS' | TipoTransaccion;

export default function TransactionsView({
  onNavigateToRegister,
  transacciones,
  onDeleteTransaction,
}: TransactionsViewProps) {
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('TODOS');
  const [soloCicloActivo, setSoloCicloActivo] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  
  // Modal de confirmación de eliminación
  const [txToDelete, setTxToDelete] = useState<Transaccion | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Filtrado de transacciones
  const filteredTxs = useMemo(() => {
    return transacciones.filter(tx => {
      // 1. Filtro por ciclo
      if (soloCicloActivo && !isDateInCurrentCycle(tx.fecha)) {
        return false;
      }
      // 2. Filtro por tipo
      if (filtroTipo !== 'TODOS' && tx.tipo !== filtroTipo) {
        return false;
      }
      // 3. Filtro por búsqueda de texto
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase().trim();
        const sub = (tx.subcategoria || tx.sub || '').toLowerCase();
        const macro = (tx.categoria || tx.macro || '').toLowerCase();
        const cuenta = (tx.cuenta || tx.cuentaOrigen || '').toLowerCase();
        const destino = (tx.cuentaDestino || '').toLowerCase();
        const comment = (tx.comentario || tx.detalle || '').toLowerCase();
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
  }, [transacciones, soloCicloActivo, filtroTipo, busqueda]);

  // Totales calculados sobre la lista filtrada
  const stats = useMemo(() => {
    let gastos = 0;
    let ingresos = 0;
    for (const tx of filteredTxs) {
      if (tx.tipo === 'GASTO') gastos += tx.monto;
      if (tx.tipo === 'INGRESO') ingresos += tx.monto;
    }
    return { gastos, ingresos, count: filteredTxs.length };
  }, [filteredTxs]);

  // Confirmar y procesar eliminación con reversión
  const handleDeleteConfirm = async () => {
    if (!txToDelete) return;
    setIsDeleting(true);
    haptic(50);
    try {
      const ok = await onDeleteTransaction(txToDelete.id);
      if (ok) {
        setFeedbackMsg(`Transacción revertida y eliminada correctamente.`);
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
    } finally {
      setIsDeleting(false);
      setTxToDelete(null);
    }
  };

  const cicloLabel = getCycleLabel();

  // Badges y estilos sobrios según el tipo de transacción
  const getBadgeConfig = (tipo: TipoTransaccion) => {
    switch (tipo) {
      case 'GASTO':
        return {
          label: 'Gasto',
          Icon: ArrowDownRight,
          classes: 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60',
          amountClass: 'text-rose-600 dark:text-rose-400',
          prefix: '-',
        };
      case 'INGRESO':
        return {
          label: 'Ingreso',
          Icon: ArrowUpRight,
          classes: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60',
          amountClass: 'text-emerald-600 dark:text-emerald-400',
          prefix: '+',
        };
      case 'TRANSFERENCIA':
        return {
          label: 'Transferencia',
          Icon: ArrowLeftRight,
          classes: 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60',
          amountClass: 'text-blue-600 dark:text-blue-400',
          prefix: '',
        };
      case 'AJUSTE':
        return {
          label: 'Ajuste',
          Icon: SlidersHorizontal,
          classes: 'bg-slate-100 text-slate-700 border-slate-300/80 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
          amountClass: 'text-slate-700 dark:text-slate-300',
          prefix: '',
        };
    }
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3 animate-fade-in max-w-lg mx-auto w-full">
      {/* Notificación de feedback */}
      {feedbackMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2 shadow-sm animate-slide-up">
          <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
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
                <span>{soloCicloActivo ? `Ciclo activo: ${cicloLabel}` : 'Todos los ciclos'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic();
              setSoloCicloActivo(prev => !prev);
            }}
            className={`
              px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors
              ${soloCicloActivo
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'}
            `}
          >
            {soloCicloActivo ? 'Solo este ciclo' : 'Ver todo'}
          </button>
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

        {/* Barra de búsqueda */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por categoría, cuenta o comentario..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition"
          />
        </div>

        {/* Tabs de tipo de transacción */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          {(['TODOS', 'GASTO', 'INGRESO', 'TRANSFERENCIA', 'AJUSTE'] as FiltroTipo[]).map(t => {
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
                  ${active
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 shadow-sm'
                    : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200/90 dark:border-slate-700 hover:text-slate-900 dark:hover:text-slate-100'}
                `}
              >
                {t === 'TODOS' ? `Todos (${stats.count})` : t}
              </button>
            );
          })}
        </div>
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
              ? 'No hay movimientos que coincidan con el término de búsqueda.'
              : `No se han registrado transacciones dentro del ciclo activo (${cicloLabel}).`}
          </p>
          {onNavigateToRegister && !busqueda && (
            <button
              type="button"
              onClick={() => {
                haptic();
                onNavigateToRegister();
              }}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-bold shadow-md hover:opacity-90 transition active:scale-95"
            >
              <PlusCircle size={14} />
              <span>Registrar primer movimiento</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredTxs.map(tx => {
            const badge = getBadgeConfig(tx.tipo);
            const { label, Icon, classes, amountClass, prefix } = badge;
            const subcat = tx.subcategoria || tx.sub || 'General';
            const macro = tx.categoria || tx.macro || '';
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
                        setTxToDelete(tx);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
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
                    <span className={`text-base font-black font-mono tracking-tight ${amountClass}`}>
                      {prefix}{formatCOP(tx.monto)}
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
                    {tx.tipo === 'TRANSFERENCIA' && destino ? (
                      <>
                        <span>{cuenta}</span>
                        <span className="mx-1 text-blue-500 font-bold">➔</span>
                        <span>{destino}</span>
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

      {/* Modal de confirmación de eliminación y reversión */}
      {txToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 flex items-center justify-center">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">
                  ¿Eliminar este movimiento?
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Esta acción revertirá los saldos y actualizará el presupuesto.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-1.5">
              <div className="flex justify-between font-bold">
                <span className="text-slate-600 dark:text-slate-400">Concepto:</span>
                <span className="text-slate-900 dark:text-slate-100">
                  {txToDelete.subcategoria || txToDelete.categoria}
                </span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-slate-600 dark:text-slate-400">Monto:</span>
                <span className="font-mono text-slate-900 dark:text-slate-100">
                  {formatCOP(txToDelete.monto)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">Cuenta:</span>
                <span className="text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[180px]">
                  {txToDelete.cuenta || txToDelete.cuentaOrigen}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
              Se eliminará del historial local y se registrará un evento de reversión en Google Sheets para mantener la contabilidad exacta.
            </p>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTxToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition flex items-center justify-center gap-1.5"
              >
                {isDeleting ? (
                  <span>Revirtiendo...</span>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Eliminar y revertir</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
