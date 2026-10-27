import { useEffect, useState, useRef } from 'react';
import { X, RefreshCw, TrendingUp, TrendingDown, Minus, SlidersHorizontal, Check } from 'lucide-react';
import { getSaldos, DEFAULT_SALDOS, getOfflineQueue, syncQueue, postAjuste, fetchAppData } from '../services/api';
import { supabase } from '../services/supabase';
import { formatCOP, haptic } from '../utils/format';
import { CARTERAS_DEFAULT } from '../data/catalog';
import type { CarteraInfo } from '../types/finance';

interface WalletsModalProps {
  open: boolean;
  onClose: () => void;
}

const ACCOUNT_ICONS: Record<string, string> = {
  'Lulo Principal (Cuenta)': '🏦',
  'Lulo Bolsillo - Ahorro': '💰',
  'Lulo Bolsillo - Carro / Moto': '🛵',
  'Lulo Bolsillo - Vacaciones': '✈️',
  'Nequi': '🟣',
  'Efectivo': '💵',
  'TC Lulo Bank': '💳',
  'RappiCard': '💳',
  'Crédito Mazda 2 (Lulo)': '🚗',
};

const ACCOUNT_TYPES: Record<string, string> = {
  'Lulo Principal (Cuenta)': 'Débito / Líquido',
  'Lulo Bolsillo - Ahorro': 'Ahorro Remunerado',
  'Lulo Bolsillo - Carro / Moto': 'Ahorro Remunerado',
  'Lulo Bolsillo - Vacaciones': 'Ahorro Remunerado',
  'Nequi': 'Billetera Digital',
  'Efectivo': 'Caja Física',
  'TC Lulo Bank': 'Tarjeta de Crédito',
  'RappiCard': 'Tarjeta de Crédito',
  'Crédito Mazda 2 (Lulo)': 'Crédito de Consumo',
};

export default function WalletsModal({ open, onClose }: WalletsModalProps) {
  const [saldos, setSaldos] = useState<Record<string, number>>(DEFAULT_SALDOS);
  const [carterasDb, setCarterasDb] = useState<CarteraInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromCache, setFromCache] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Estado del mini-formulario de ajuste / conciliación
  const [adjustingWallet, setAdjustingWallet] = useState<string | null>(null);
  const [nuevoSaldoInput, setNuevoSaldoInput] = useState<string>('');
  const [motivoInput, setMotivoInput] = useState<string>('');
  const [isAdjusting, setIsAdjusting] = useState<boolean>(false);
  const [adjustSuccessMsg, setAdjustSuccessMsg] = useState<string | null>(null);
  const adjustMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
    };
  }, []);

  const queueCount = getOfflineQueue().length;

  const fetchSaldos = async (force = false) => {
    setLoading(true);
    try {
      const [result, carterasRes] = await Promise.all([
        getSaldos(force),
        supabase.from('carteras').select('*').order('id'),
      ]);
      setSaldos(result.saldos);
      setFromCache(result.fromCache);
      setLastUpdated(result.timestamp);
      if (carterasRes.data) {
        setCarterasDb(carterasRes.data.map((c: any) => ({
          id: c.id,
          nombre: c.nombre,
          tipo: c.tipo,
          saldo_inicial: Number(c.saldo_inicial) || 0,
          saldo_actual: Number(c.saldo_actual) || 0,
          icono: c.icono,
          permite_gasto: c.permite_gasto !== false,
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchSaldos();
      setAdjustingWallet(null);
      setAdjustSuccessMsg(null);
    }
  }, [open]);

  useEffect(() => {
    const handleSaldosUpdated = (e: Event) => {
      const custom = e as CustomEvent<Record<string, number>>;
      if (custom.detail) {
        setSaldos(custom.detail);
        setFromCache(false);
        setLastUpdated(Date.now());
      }
    };
    window.addEventListener('finanzas_saldos_updated', handleSaldosUpdated);
    return () => window.removeEventListener('finanzas_saldos_updated', handleSaldosUpdated);
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    const result = await syncQueue();
    setSyncing(false);
    setSyncResult(result.synced > 0
      ? `✓ ${result.synced} sincronizadas`
      : result.remaining > 0
        ? `${result.remaining} pendientes aún`
        : 'Sin pendientes'
    );
  };

  const handleTogglePermiteGasto = async (walletName: string, currentPermiteGasto: boolean) => {
    haptic(40);
    const nuevoValor = !currentPermiteGasto;

    // Actualización optimista
    setCarterasDb(prev => prev.map(c => c.nombre === walletName ? { ...c, permite_gasto: nuevoValor } : c));

    try {
      const { error } = await supabase
        .from('carteras')
        .update({ permite_gasto: nuevoValor })
        .eq('nombre', walletName);

      if (error) throw error;
      await fetchAppData(true);
      setAdjustSuccessMsg(`Gasto ${nuevoValor ? 'habilitado' : 'bloqueado'} en "${walletName}".`);
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
      adjustMsgTimerRef.current = setTimeout(() => setAdjustSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Error actualizando permite_gasto:', err);
      // Revertir
      setCarterasDb(prev => prev.map(c => c.nombre === walletName ? { ...c, permite_gasto: currentPermiteGasto } : c));
    }
  };

  const handleOpenAdjust = (walletName: string, currentAmount: number) => {
    if (adjustingWallet === walletName) {
      setAdjustingWallet(null);
    } else {
      setAdjustingWallet(walletName);
      setNuevoSaldoInput(String(currentAmount));
      setMotivoInput('');
      setAdjustSuccessMsg(null);
    }
  };

  const handleApplyAdjustment = async (walletName: string, currentAmount: number) => {
    const cleaned = nuevoSaldoInput.replace(/[^0-9\-]/g, '');
    const nuevoSaldo = Number(cleaned);
    if (isNaN(nuevoSaldo)) return;

    const diferencia = nuevoSaldo - currentAmount;
    if (diferencia === 0) {
      setAdjustingWallet(null);
      return;
    }

    setIsAdjusting(true);
    const faltabaPlata = diferencia < 0;
    const comentario = motivoInput.trim() || (faltabaPlata ? 'Descuadre de Saldo' : 'Sobrante de Saldo');

    // 1. Actualizar el saldo en la UI de inmediato y notificar suscriptores
    const updatedSaldos = { ...saldos, [walletName]: nuevoSaldo };
    setSaldos(updatedSaldos);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedSaldos }));
    }

    try {
      // 2. Enviar POST con tipo "AJUSTE"
      await postAjuste({
        tipo: 'AJUSTE',
        monto: Math.abs(diferencia),
        cuentaOrigen: faltabaPlata ? walletName : '',
        cuentaDestino: faltabaPlata ? '' : walletName,
        macro: 'Ajuste / Conciliación',
        sub: faltabaPlata ? 'Descuadre de Saldo' : 'Sobrante de Saldo',
        detalle: comentario,
      });

      // 3. Refrescar fetchAppData en background
      fetchAppData(true).catch(() => {});
      setAdjustSuccessMsg(`Ajuste de ${walletName} aplicado correctamente.`);
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
      adjustMsgTimerRef.current = setTimeout(() => setAdjustSuccessMsg(null), 3000);
      setAdjustingWallet(null);
    } catch (err) {
      console.error('Error aplicando ajuste:', err);
    } finally {
      setIsAdjusting(false);
    }
  };

  // Cartera items based on official 10 CARTERAS_DEFAULT list combined with DB permite_gasto
  const walletItems = CARTERAS_DEFAULT.map(c => {
    const amount = saldos[c.nombre] ?? saldos[c.id] ?? 0;
    const dbInfo = carterasDb.find(db => db.nombre === c.nombre || db.id === c.id);
    const permiteGasto = dbInfo?.permite_gasto ?? !['Lulo Bolsillo - Ahorro', 'Lulo Bolsillo - Vacaciones', 'Crédito Mazda 2 (Lulo)'].includes(c.nombre);

    return {
      id: c.id,
      name: c.nombre,
      amount,
      type: ACCOUNT_TYPES[c.nombre] ?? 'Cuenta',
      icon: ACCOUNT_ICONS[c.nombre] ?? c.icono,
      permiteGasto,
    };
  });

  const netTotal = walletItems.reduce((s, w) => s + w.amount, 0);
  const activos = walletItems.filter(w => w.amount > 0).reduce((s, w) => s + w.amount, 0);
  const pasivos = walletItems.filter(w => w.amount < 0).reduce((s, w) => s + Math.abs(w.amount), 0);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Saldos de carteras"
    >
      <div className="
        w-full max-w-md
        bg-white dark:bg-[#131B2E] border border-slate-200 dark:border-slate-800
        rounded-t-3xl sm:rounded-3xl
        p-5 shadow-2xl
        animate-slide-up
        max-h-[90vh] overflow-y-auto
      ">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Saldos de Carteras</h2>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 font-medium">
              {loading ? 'Actualizando…' : fromCache
                ? lastUpdated > 0
                  ? `Caché · ${new Date(lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Datos locales'
                : `En vivo · ${new Date(lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchSaldos(true)}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700 transition shadow-sm cursor-pointer"
              aria-label="Actualizar saldos"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700 transition shadow-sm cursor-pointer"
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Success toast if any */}
        {adjustSuccessMsg && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fade-in">
            <Check size={14} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            <span>{adjustSuccessMsg}</span>
          </div>
        )}

        {/* Net summary */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 p-3 text-center">
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Activos</p>
            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{formatCOP(activos)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 p-3 text-center">
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Pasivos</p>
            <p className="text-sm font-black text-rose-600 dark:text-rose-400 mt-0.5">{formatCOP(pasivos)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 p-3 text-center">
            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Neto</p>
            <p className={`text-sm font-black mt-0.5 ${netTotal >= 0 ? 'text-slate-900 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {formatCOP(netTotal)}
            </p>
          </div>
        </div>

        {/* Wallet list */}
        <div className="mt-4 space-y-2.5">
          {walletItems.map((wallet) => {
            const isDebt = wallet.amount < 0;
            const Icon = isDebt ? TrendingDown : wallet.amount === 0 ? Minus : TrendingUp;
            const isSelected = adjustingWallet === wallet.name;
            const cleanedInput = nuevoSaldoInput.replace(/[^0-9\-]/g, '');
            const parsedNewSaldo = cleanedInput !== '' && cleanedInput !== '-' ? Number(cleanedInput) : wallet.amount;
            const diff = isNaN(parsedNewSaldo) ? 0 : parsedNewSaldo - wallet.amount;

            return (
              <div
                key={wallet.id}
                className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all duration-200"
              >
                <div className="flex items-center gap-3 p-3.5">
                  <span className="text-xl flex-shrink-0">{wallet.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{wallet.name}</p>
                    <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{wallet.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-right">
                      <Icon size={12} className={isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'} />
                      <span className={`text-sm font-bold tabular-nums ${isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {formatCOP(wallet.amount)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenAdjust(wallet.name, wallet.amount)}
                      className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-700 dark:text-indigo-300'
                          : 'bg-slate-50 border-slate-200/80 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                      title={`Ajustar o conciliar saldo de ${wallet.name}`}
                      aria-label={`Ajustar saldo de ${wallet.name}`}
                    >
                      <SlidersHorizontal size={13} />
                    </button>
                  </div>
                </div>

                {/* Control de Permitir Gasto */}
                <div className="px-3.5 pb-2.5 pt-1 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60">
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    Permitir registrar gastos:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleTogglePermiteGasto(wallet.name, wallet.permiteGasto)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                      wallet.permiteGasto
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                        : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                    }`}
                    title={`Alternar si ${wallet.name} permite gasto`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${wallet.permiteGasto ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span>{wallet.permiteGasto ? 'Permite gasto' : 'Gasto bloqueado'}</span>
                  </button>
                </div>

                {/* Mini-formulario de Ajuste / Conciliación */}
                {isSelected && (
                  <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 animate-slide-up flex flex-col gap-2.5">
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100">
                        Ajuste / Conciliación de Saldo
                      </span>
                      <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                        Actual: <strong className="text-slate-800 dark:text-slate-200">{formatCOP(wallet.amount)}</strong>
                      </span>
                    </div>

                    <div>
                      <label htmlFor={`nuevo-saldo-${wallet.id}`} className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                        Nuevo Saldo Real en Banco (COP)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 dark:text-slate-500">$</span>
                        <input
                          id={`nuevo-saldo-${wallet.id}`}
                          type="number"
                          step="any"
                          value={nuevoSaldoInput}
                          onChange={e => setNuevoSaldoInput(e.target.value)}
                          placeholder="0"
                          className="w-full pl-7 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                        />
                      </div>
                    </div>

                    {/* Diferencia calculada */}
                    {diff !== 0 && !isNaN(diff) && (
                      <div className={`p-2 rounded-xl text-xs flex items-center justify-between font-bold ${
                        diff > 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                      }`}>
                        <span>{diff > 0 ? 'Sobrante (+)' : 'Descuadre (-)'}</span>
                        <span className="font-mono">{diff > 0 ? `+${formatCOP(diff)}` : `-${formatCOP(Math.abs(diff))}`}</span>
                      </div>
                    )}

                    <div>
                      <label htmlFor={`motivo-${wallet.id}`} className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                        Motivo / Comentario del Ajuste
                      </label>
                      <input
                        id={`motivo-${wallet.id}`}
                        type="text"
                        value={motivoInput}
                        onChange={e => setMotivoInput(e.target.value)}
                        placeholder="Ej: Conciliación fin de semana, Gasto olvidado"
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setAdjustingWallet(null)}
                        disabled={isAdjusting}
                        className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyAdjustment(wallet.name, wallet.amount)}
                        disabled={isAdjusting || diff === 0 || isNaN(diff)}
                        className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                      >
                        {isAdjusting ? (
                          <>
                            <RefreshCw size={12} className="animate-spin" />
                            <span>Guardando…</span>
                          </>
                        ) : (
                          <span>Guardar Ajuste</span>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Offline queue sync */}
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Cola offline</p>
            <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100">{queueCount} pendiente{queueCount !== 1 ? 's' : ''}</p>
            {syncResult && <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">{syncResult}</p>}
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || queueCount === 0}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-xl
              bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60
              text-xs font-bold transition shadow-sm
              disabled:opacity-40 disabled:cursor-not-allowed
              hover:bg-indigo-100 dark:hover:bg-indigo-900/50 cursor-pointer
            "
          >
            {syncing ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sincronizar
          </button>
        </div>
      </div>
    </div>
  );
}
