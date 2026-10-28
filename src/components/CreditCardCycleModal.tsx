import { useState, useEffect, useMemo } from 'react';
import {
  X,
  CreditCard,
  Calendar,
  Clock,
  ShoppingBag,
  SlidersHorizontal,
  Check,
  RefreshCw,
} from 'lucide-react';
import type { CarteraInfo, Transaccion } from '../types/finance';
import { updateCartera, getTransacciones } from '../services/api';
import { formatCOP, haptic } from '../utils/format';

interface CreditCardCycleModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: CarteraInfo;
  transacciones?: Transaccion[];
  onUpdated?: () => void;
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const SHORT_MONTHS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];

export function getBogotaDateParts() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || '0', 10);
  return {
    year: get('year'),
    month: get('month'), // 1 a 12
    day: get('day'),
  };
}

export function formatBogotaDateOnly(dateStrOrObj: string | Date): string {
  const d = typeof dateStrOrObj === 'string' ? new Date(dateStrOrObj) : dateStrOrObj;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

export default function CreditCardCycleModal({
  isOpen,
  onClose,
  wallet,
  transacciones,
  onUpdated,
}: CreditCardCycleModalProps) {
  const diaCorteActual = wallet.dia_corte ?? 15;
  const diaPagoActual = wallet.dia_pago ?? 5;

  // Estado para edición rápida de ciclo
  const [editCorte, setEditCorte] = useState<number>(diaCorteActual);
  const [editPago, setEditPago] = useState<number>(diaPagoActual);
  const [isEditingCycle, setIsEditingCycle] = useState(false);
  const [savingCycle, setSavingCycle] = useState(false);
  const [cycleSavedSuccess, setCycleSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEditCorte(wallet.dia_corte ?? 15);
      setEditPago(wallet.dia_pago ?? 5);
      setIsEditingCycle(false);
      setCycleSavedSuccess(false);
    }
  }, [isOpen, wallet.dia_corte, wallet.dia_pago]);

  // Cierre con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        haptic();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Obtener transacciones si no se pasan por props
  const allTxs = useMemo(() => {
    if (transacciones && transacciones.length > 0) return transacciones;
    return getTransacciones();
  }, [transacciones, isOpen]);

  // Cálculo del Período de Corte y Facturación (hora Colombia)
  const cycleData = useMemo(() => {
    const { year, month, day } = getBogotaDateParts();
    const diaCorte = editCorte;
    const diaPago = editPago;

    let startYear: number;
    let startMonth: number;
    let startDay: number;

    let endYear: number;
    let endMonth: number;
    let endDay: number;

    let payYear: number;
    let payMonth: number;
    let payDay: number;

    if (day <= diaCorte) {
      // Corte inició el día dia_corte + 1 del mes anterior
      // Cierra el día dia_corte de este mes
      // Fecha de pago: dia_pago de este mes
      startYear = month === 1 ? year - 1 : year;
      startMonth = month === 1 ? 12 : month - 1;
      const maxDaysStart = new Date(startYear, startMonth, 0).getDate();
      startDay = Math.min(diaCorte + 1, maxDaysStart);

      endYear = year;
      endMonth = month;
      const maxDaysEnd = new Date(endYear, endMonth, 0).getDate();
      endDay = Math.min(diaCorte, maxDaysEnd);

      payYear = year;
      payMonth = month;
      const maxDaysPay = new Date(payYear, payMonth, 0).getDate();
      payDay = Math.min(diaPago, maxDaysPay);
    } else {
      // Corte inició el día dia_corte + 1 de este mes
      // Cierra el día dia_corte del mes siguiente
      // Fecha de pago: dia_pago del mes siguiente
      startYear = year;
      startMonth = month;
      const maxDaysStart = new Date(startYear, startMonth, 0).getDate();
      startDay = Math.min(diaCorte + 1, maxDaysStart);

      endYear = month === 12 ? year + 1 : year;
      endMonth = month === 12 ? 1 : month + 1;
      const maxDaysEnd = new Date(endYear, endMonth, 0).getDate();
      endDay = Math.min(diaCorte, maxDaysEnd);

      payYear = month === 12 ? year + 1 : year;
      payMonth = month === 12 ? 1 : month + 1;
      const maxDaysPay = new Date(payYear, payMonth, 0).getDate();
      payDay = Math.min(diaPago, maxDaysPay);
    }

    const startDateStr = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
    const endDateStr = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    // Cálculo de días restantes de pago
    const todayUtc = Date.UTC(year, month - 1, day);
    const payUtc = Date.UTC(payYear, payMonth - 1, payDay);
    const diffDays = Math.round((payUtc - todayUtc) / (1000 * 60 * 60 * 24));

    const fechaPagoLegible = `${payDay} de ${MONTH_NAMES[payMonth - 1]} de ${payYear}`;
    const periodoLegible = `${startDay} ${SHORT_MONTHS[startMonth - 1]} – ${endDay} ${SHORT_MONTHS[endMonth - 1]}`;

    return {
      startDateStr,
      endDateStr,
      periodoLegible,
      fechaPagoLegible,
      diffDays,
      startDay,
      startMonth,
      endDay,
      endMonth,
      payDay,
      payMonth,
      payYear,
    };
  }, [editCorte, editPago]);

  // Consumos del corte
  const consumosDelCorte = useMemo(() => {
    return allTxs
      .filter(t => {
        if (t.tipo !== 'GASTO') return false;
        const isMatchWallet =
          (t.cuenta && (t.cuenta === wallet.nombre || t.cuenta === wallet.id)) ||
          (t.cuentaOrigen && (t.cuentaOrigen === wallet.nombre || t.cuentaOrigen === wallet.id));
        if (!isMatchWallet) return false;
        const tDateStr = formatBogotaDateOnly(t.fecha);
        return tDateStr >= cycleData.startDateStr && tDateStr <= cycleData.endDateStr;
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }, [allTxs, wallet.nombre, wallet.id, cycleData.startDateStr, cycleData.endDateStr]);

  // 1. Total a pagar en este corte
  const totalPagarEnCorte = useMemo(() => {
    return consumosDelCorte.reduce((sum, t) => sum + (Number(t.monto) || 0), 0);
  }, [consumosDelCorte]);

  // 3. Cupo Disponible y Utilización
  const limiteCredito = wallet.limite_credito ?? 0;
  // En las cuentas de crédito, si el saldo_actual es negativo representa deuda total
  const saldoConsumidoTotal =
    wallet.saldo_actual != null && wallet.saldo_actual < 0
      ? Math.abs(wallet.saldo_actual)
      : Math.max(0, totalPagarEnCorte);

  const cupoDisponible = limiteCredito > 0 ? Math.max(0, limiteCredito - saldoConsumidoTotal) : 0;
  const pctUtilizacion =
    limiteCredito > 0 ? Math.min(100, Math.max(0, (saldoConsumidoTotal / limiteCredito) * 100)) : 0;

  // Handler para guardar cambios rápidos de días de corte/pago
  const handleSaveQuickCycle = async () => {
    setSavingCycle(true);
    haptic(40);
    try {
      await updateCartera(wallet.id, {
        dia_corte: editCorte,
        dia_pago: editPago,
      });
      setCycleSavedSuccess(true);
      setTimeout(() => setCycleSavedSuccess(false), 3000);
      setIsEditingCycle(false);
      onUpdated?.();
    } catch (err) {
      console.error('Error guardando nuevo ciclo:', err);
    } finally {
      setSavingCycle(false);
    }
  };

  if (!isOpen) return null;

  let badgeDiasColor = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  let badgeDiasText = '';

  if (cycleData.diffDays > 5) {
    badgeDiasColor = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
    badgeDiasText = `Faltan ${cycleData.diffDays} días`;
  } else if (cycleData.diffDays > 1) {
    badgeDiasColor = 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
    badgeDiasText = `Faltan ${cycleData.diffDays} días`;
  } else if (cycleData.diffDays === 1) {
    badgeDiasColor = 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800';
    badgeDiasText = 'Vence mañana';
  } else if (cycleData.diffDays === 0) {
    badgeDiasColor = 'bg-rose-600 text-white border-rose-700';
    badgeDiasText = 'Vence hoy';
  } else if (cycleData.diffDays === -1) {
    badgeDiasColor = 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 border-rose-300';
    badgeDiasText = 'Venció ayer';
  } else {
    badgeDiasColor = 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200 border-rose-300';
    badgeDiasText = `Venció hace ${Math.abs(cycleData.diffDays)} días`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget && !savingCycle) {
          haptic();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-cycle-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabecera del modal */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-lg shadow-sm">
              <CreditCard size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="credit-cycle-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                  {wallet.nombre}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                  1 Cuota
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Período actual: <strong className="text-slate-800 dark:text-slate-200">{cycleData.periodoLegible}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Notificación de ciclo actualizado */}
        {cycleSavedSuccess && (
          <div className="mx-4 sm:mx-5 mt-4 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fade-in shadow-sm">
            <Check size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span>Ciclo de facturación actualizado exitosamente.</span>
          </div>
        )}

        {/* Contenido scrolleable */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Tarjeta destacada: Total a Pagar en este Corte */}
          <div className="p-4 sm:p-5 rounded-3xl bg-slate-900 dark:bg-slate-950 text-white shadow-xl relative overflow-hidden">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Total a pagar en este corte
                </p>
                <p className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-white mt-1">
                  {formatCOP(totalPagarEnCorte)}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Compras registradas entre el {cycleData.startDay} {SHORT_MONTHS[cycleData.startMonth - 1]} y el {cycleData.endDay} {SHORT_MONTHS[cycleData.endMonth - 1]}
                </p>
              </div>

              <div className="w-10 h-10 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-indigo-400 flex-shrink-0">
                <ShoppingBag size={20} />
              </div>
            </div>

            {/* Fecha límite de pago */}
            <div className="mt-4 pt-3.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-slate-400" />
                <span className="text-xs text-slate-300">
                  Fecha límite: <strong className="text-white font-semibold">{cycleData.fechaPagoLegible}</strong>
                </span>
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-xl border ${badgeDiasColor}`}>
                {badgeDiasText}
              </span>
            </div>
          </div>

          {/* Métricas de Cupo y Utilización */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Clock size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span>Estado del Cupo y Línea de Crédito</span>
              </span>
              {limiteCredito > 0 && (
                <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
                  {pctUtilizacion.toFixed(1)}% utilizado
                </span>
              )}
            </div>

            {limiteCredito > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Cupo Disponible
                    </p>
                    <p className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {formatCOP(cupoDisponible)}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Cupo Total Aprobado
                    </p>
                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      {formatCOP(limiteCredito)}
                    </p>
                  </div>
                </div>

                {/* Barra porcentual de utilización */}
                <div>
                  <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${
                        pctUtilizacion > 80
                          ? 'bg-rose-500'
                          : pctUtilizacion > 50
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${pctUtilizacion}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
                    <span>Consumido: {formatCOP(saldoConsumidoTotal)}</span>
                    <span>Límite: {formatCOP(limiteCredito)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between">
                <span>Esta tarjeta no tiene límite de crédito configurado.</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Consumo: {formatCOP(saldoConsumidoTotal)}
                </span>
              </div>
            )}
          </div>

          {/* Desglose de Consumos del Período */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShoppingBag size={14} className="text-slate-500 dark:text-slate-400" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Consumos Registrados en este Período
                </h3>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {consumosDelCorte.length} {consumosDelCorte.length === 1 ? 'movimiento' : 'movimientos'}
              </span>
            </div>

            {consumosDelCorte.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No hay compras a 1 cuota registradas en este rango de facturación.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-56 overflow-y-auto pr-1">
                {consumosDelCorte.map(tx => {
                  const txDate = new Date(tx.fecha);
                  const dia = txDate.getDate();
                  const mes = SHORT_MONTHS[txDate.getMonth()];
                  return (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
                          <span>{dia}</span>
                          <span className="text-[8px] uppercase -mt-0.5 text-slate-400">{mes}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {tx.comentario || tx.detalle || tx.subcategoria || 'Gasto TC'}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {tx.subcategoria || tx.categoria}
                          </p>
                        </div>
                      </div>

                      <span className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400 flex-shrink-0">
                        -{formatCOP(tx.monto)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Edición Rápida de Días de Corte y Pago */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <SlidersHorizontal size={14} className="text-slate-500" />
                <span>Edición Rápida de Ciclo de Facturación</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  haptic(20);
                  setIsEditingCycle(prev => !prev);
                }}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {isEditingCycle ? 'Ocultar' : 'Modificar Días'}
              </button>
            </div>

            {isEditingCycle && (
              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-3 animate-slide-up">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="quick-dia-corte" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                      Día de Corte
                    </label>
                    <select
                      id="quick-dia-corte"
                      value={editCorte}
                      onChange={e => setEditCorte(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold font-mono text-slate-900 dark:text-slate-100 outline-none cursor-pointer"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>
                          Día {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="quick-dia-pago" className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                      Día de Pago
                    </label>
                    <select
                      id="quick-dia-pago"
                      value={editPago}
                      onChange={e => setEditPago(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold font-mono text-slate-900 dark:text-slate-100 outline-none cursor-pointer"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>
                          Día {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditCorte(diaCorteActual);
                      setEditPago(diaPagoActual);
                      setIsEditingCycle(false);
                    }}
                    disabled={savingCycle}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveQuickCycle}
                    disabled={savingCycle || (editCorte === diaCorteActual && editPago === diaPagoActual)}
                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-40"
                  >
                    {savingCycle ? (
                      <>
                        <RefreshCw size={13} className="animate-spin" />
                        <span>Guardando…</span>
                      </>
                    ) : (
                      <>
                        <Check size={13} />
                        <span>Actualizar Ciclo</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
