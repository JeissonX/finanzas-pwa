import { useState, useEffect, type FormEvent } from 'react';
import { X, RefreshCw, Check, AlertCircle } from 'lucide-react';
import type { CarteraInfo } from '../types/finance';
import { createCartera, updateCartera } from '../services/api';
import { haptic } from '../utils/format';

export type TipoCarteraUI = 'BOLSILLO' | 'DEBITO' | 'EFECTIVO' | 'CREDITO' | 'PRESTAMO';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletToEdit?: CarteraInfo | null;
  onSaved?: () => void;
}

const TIPO_OPTIONS: { id: TipoCarteraUI; label: string; icon: string; dbTipo: string }[] = [
  { id: 'DEBITO', label: 'Débito / Cuenta Bancaria', icon: '🏦', dbTipo: 'debito' },
  { id: 'BOLSILLO', label: 'Bolsillo / Ahorro Remunerado', icon: '💰', dbTipo: 'inversion' },
  { id: 'EFECTIVO', label: 'Efectivo / Caja Física', icon: '💵', dbTipo: 'efectivo' },
  { id: 'CREDITO', label: 'Tarjeta de Crédito', icon: '💳', dbTipo: 'credito' },
  { id: 'PRESTAMO', label: 'Préstamo / Pasivo', icon: '🚗', dbTipo: 'deuda' },
];

const AVAILABLE_ICONS = ['🏦', '💳', '💰', '💵', '🟣', '🚗', '✈️', '🛵', '🪙', '📈'];

function formatCOPNumber(val: number): string {
  if (!Number.isFinite(val)) return '$ 0';
  return '$ ' + new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.trunc(val));
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9\-]/g, '');
  if (!cleaned || cleaned === '-') return 0;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

function mapDbTipoToUI(dbTipo?: string): TipoCarteraUI {
  if (!dbTipo) return 'DEBITO';
  const lower = dbTipo.toLowerCase();
  if (lower.includes('credito') || lower === 'tarjeta de crédito') return 'CREDITO';
  if (lower.includes('inversion') || lower.includes('remunerado') || lower.includes('bolsillo')) return 'BOLSILLO';
  if (lower.includes('efectivo') || lower.includes('caja')) return 'EFECTIVO';
  if (lower.includes('deuda') || lower.includes('prestamo')) return 'PRESTAMO';
  return 'DEBITO';
}

export default function WalletModal({ isOpen, onClose, walletToEdit, onSaved }: WalletModalProps) {
  const isEditing = Boolean(walletToEdit);

  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoCarteraUI>('DEBITO');
  const [saldoInicialRaw, setSaldoInicialRaw] = useState('');
  const [limiteCreditoRaw, setLimiteCreditoRaw] = useState('');
  const [diaCorte, setDiaCorte] = useState<number>(15);
  const [diaPago, setDiaPago] = useState<number>(5);
  const [icono, setIcono] = useState('🏦');
  const [permiteGasto, setPermiteGasto] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inicializar estado cuando abre o cambia walletToEdit
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      if (walletToEdit) {
        setNombre(walletToEdit.nombre || '');
        const uiTipo = mapDbTipoToUI(walletToEdit.tipo);
        setTipo(uiTipo);
        const initialSaldo = Math.trunc(walletToEdit.saldo_inicial ?? walletToEdit.saldo ?? 0);
        setSaldoInicialRaw(initialSaldo ? String(initialSaldo) : '0');
        setLimiteCreditoRaw(
          walletToEdit.limite_credito != null ? String(Math.trunc(walletToEdit.limite_credito)) : ''
        );
        setDiaCorte(walletToEdit.dia_corte ? Math.max(1, Math.min(31, walletToEdit.dia_corte)) : 15);
        setDiaPago(walletToEdit.dia_pago ? Math.max(1, Math.min(31, walletToEdit.dia_pago)) : 5);
        setIcono(walletToEdit.icono || '💳');
        setPermiteGasto(walletToEdit.permite_gasto !== false);
      } else {
        setNombre('');
        setTipo('DEBITO');
        setSaldoInicialRaw('0');
        setLimiteCreditoRaw('');
        setDiaCorte(15);
        setDiaPago(5);
        setIcono('🏦');
        setPermiteGasto(true);
      }
    }
  }, [isOpen, walletToEdit]);

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

  // Al cambiar tipo, actualizar icono sugerido si no fue editado
  const handleTipoChange = (newTipo: TipoCarteraUI) => {
    setTipo(newTipo);
    const found = TIPO_OPTIONS.find(o => o.id === newTipo);
    if (found && !walletToEdit) {
      setIcono(found.icon);
    }
    if (newTipo === 'BOLSILLO' || newTipo === 'PRESTAMO') {
      setPermiteGasto(false);
    } else {
      setPermiteGasto(true);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanNombre = nombre.trim();
    if (!cleanNombre) {
      setErrorMsg('Ingresa un nombre para la cartera.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    haptic(40);

    try {
      const selectedOption = TIPO_OPTIONS.find(o => o.id === tipo) || TIPO_OPTIONS[0];
      const dbTipo = selectedOption.dbTipo;
      const parsedSaldoInicial = parseNumber(saldoInicialRaw);
      const parsedLimite = tipo === 'CREDITO' && limiteCreditoRaw.trim() !== ''
        ? Math.max(0, parseNumber(limiteCreditoRaw))
        : null;

      if (isEditing && walletToEdit) {
        await updateCartera(walletToEdit.id, {
          nombre: cleanNombre,
          tipo: dbTipo,
          saldo_inicial: parsedSaldoInicial,
          limite_credito: parsedLimite,
          dia_corte: tipo === 'CREDITO' ? diaCorte : null,
          dia_pago: tipo === 'CREDITO' ? diaPago : null,
          icono,
          permite_gasto: permiteGasto,
        });
      } else {
        await createCartera({
          nombre: cleanNombre,
          tipo: dbTipo,
          saldo: parsedSaldoInicial,
          saldo_inicial: parsedSaldoInicial,
          limite_credito: parsedLimite,
          dia_corte: tipo === 'CREDITO' ? diaCorte : null,
          dia_pago: tipo === 'CREDITO' ? diaPago : null,
          icono,
          permite_gasto: permiteGasto,
          activa: true,
        });
      }

      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error('Error guardando cartera:', err);
      setErrorMsg(err?.message || 'Error al guardar la cartera. Intenta nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  const parsedSaldoPreview = parseNumber(saldoInicialRaw);
  const parsedLimitePreview = parseNumber(limiteCreditoRaw);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      onClick={e => {
        if (e.target === e.currentTarget && !saving) {
          haptic();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabecera del modal */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-lg shadow-sm">
              {icono}
            </div>
            <div>
              <h2 id="wallet-modal-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
                {isEditing ? 'Editar Cartera' : 'Nueva Cartera'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isEditing ? 'Actualiza los datos y parámetros de la cuenta' : 'Configura una nueva cuenta, tarjeta o bolsillo'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic();
              onClose();
            }}
            disabled={saving}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mensaje de error si ocurre */}
        {errorMsg && (
          <div className="mx-4 sm:mx-5 mt-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-semibold flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Nombre de la cartera */}
          <div>
            <label htmlFor="wallet-name" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5">
              Nombre de la Cartera *
            </label>
            <input
              id="wallet-name"
              type="text"
              required
              maxLength={40}
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Lulo Débito, Bancolombia, TC Nu, Efectivo…"
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 transition shadow-sm"
            />
          </div>

          {/* Tipo de cartera */}
          <div>
            <label htmlFor="wallet-tipo" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5">
              Tipo de Cartera *
            </label>
            <select
              id="wallet-tipo"
              value={tipo}
              onChange={e => handleTipoChange(e.target.value as TipoCarteraUI)}
              className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 transition cursor-pointer shadow-sm"
            >
              {TIPO_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.icon} {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Icono de la cartera */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5">
              Icono Representativo
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_ICONS.map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    haptic(20);
                    setIcono(i);
                  }}
                  className={`w-9 h-9 rounded-xl text-base flex items-center justify-center transition cursor-pointer ${
                    icono === i
                      ? 'bg-indigo-100 dark:bg-indigo-900/60 border-2 border-indigo-600 dark:border-indigo-400 shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Saldo Inicial con formateo en vivo */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="wallet-saldo-inicial" className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Saldo Inicial (Pesos Enteros)
              </label>
              <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300">
                {formatCOPNumber(parsedSaldoPreview)}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500 font-mono">$</span>
              <input
                id="wallet-saldo-inicial"
                type="text"
                inputMode="numeric"
                value={saldoInicialRaw}
                onChange={e => setSaldoInicialRaw(e.target.value.replace(/[^0-9\-]/g, ''))}
                placeholder="0"
                className="w-full pl-8 pr-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 transition shadow-sm"
              />
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
              Base contable desde la cual se totalizarán los movimientos futuros.
            </p>
          </div>

          {/* Configuración específica para Tarjetas de Crédito */}
          {tipo === 'CREDITO' && (
            <div className="p-3.5 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 space-y-3.5 animate-slide-up">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                  Parámetros de Tarjeta de Crédito (1 Cuota)
                </span>
              </div>

              {/* Límite de Crédito / Cupo Total */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="wallet-limite" className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Cupo Total / Límite de Crédito
                  </label>
                  {parsedLimitePreview > 0 && (
                    <span className="text-[11px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
                      {formatCOPNumber(parsedLimitePreview)}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500 font-mono">$</span>
                  <input
                    id="wallet-limite"
                    type="text"
                    inputMode="numeric"
                    value={limiteCreditoRaw}
                    onChange={e => setLimiteCreditoRaw(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="Ej: 5000000"
                    className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-sm"
                  />
                </div>
              </div>

              {/* Días de corte y pago */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="wallet-dia-corte" className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Día de Corte (1 al 31)
                  </label>
                  <select
                    id="wallet-dia-corte"
                    value={diaCorte}
                    onChange={e => setDiaCorte(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition cursor-pointer shadow-sm"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>
                        Día {day} de cada mes
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="wallet-dia-pago" className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Día Límite de Pago (1 al 31)
                  </label>
                  <select
                    id="wallet-dia-pago"
                    value={diaPago}
                    onChange={e => setDiaPago(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition cursor-pointer shadow-sm"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>
                        Día {day} de cada mes
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Permitir registro de gastos */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Permitir registrar gastos directos
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Desactívalo en bolsillos de ahorro puro o pasivos para no elegirlos por error.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic(30);
                setPermiteGasto(prev => !prev);
              }}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                permiteGasto ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                  permiteGasto ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Botones de acción */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              disabled={saving}
              className="flex-1 py-3 rounded-2xl text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 transition cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving || !nombre.trim()}
              className="flex-1 py-3 rounded-2xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition flex items-center justify-center gap-2 shadow-lg shadow-slate-900/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Guardando…</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Guardar Cartera</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
