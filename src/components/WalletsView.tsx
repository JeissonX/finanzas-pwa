import { useEffect, useState, useRef } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  SlidersHorizontal,
  Check,
  Wallet,
  Zap,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import {
  getSaldos,
  DEFAULT_SALDOS,
  getOfflineQueue,
  syncOfflineQueue,
  saveTransaction,
  fetchAppData,
  getGastosRecurrentes,
  saveGastoRecurrente,
  toggleGastoRecurrente,
  deleteGastoRecurrente,
} from '../services/api';
import { supabase } from '../services/supabase';
import { formatCOP, haptic, getCycleLabel } from '../utils/format';
import { CARTERAS_DEFAULT, CATALOG_GASTOS } from '../data/catalog';
import type { CarteraInfo, Transaccion, GastoRecurrente } from '../types/finance';

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

export default function WalletsView() {
  const [saldos, setSaldos] = useState<Record<string, number>>(DEFAULT_SALDOS);
  const [carterasDb, setCarterasDb] = useState<CarteraInfo[]>(() =>
    CARTERAS_DEFAULT.map((c, idx) => ({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      saldo_inicial: 0,
      saldo_actual: 0,
      saldo: 0,
      saldoActual: 0,
      icono: c.icono,
      permite_gasto: !['Lulo Bolsillo - Ahorro', 'Lulo Bolsillo - Vacaciones', 'Crédito Mazda 2 (Lulo)'].includes(c.nombre),
      orden: c.orden ?? (idx + 1),
    })).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99))
  );
  const [recurrentes, setRecurrentes] = useState<GastoRecurrente[]>([]);
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
      if (adjustMsgTimerRef.current) {
        clearTimeout(adjustMsgTimerRef.current);
      }
    };
  }, []);

  // Estado del gestor de gastos recurrentes
  const [isRecurrentesCollapsed, setIsRecurrentesCollapsed] = useState(false);
  const [isFormRecurrenteOpen, setIsFormRecurrenteOpen] = useState(false);
  const [recNombre, setRecNombre] = useState('');
  const [recMonto, setRecMonto] = useState('');
  const [recMacro, setRecMacro] = useState(CATALOG_GASTOS[0].nombre);
  const [recSub, setRecSub] = useState(CATALOG_GASTOS[0].subcategorias[0].nombre);
  const [recCuenta, setRecCuenta] = useState('TC Lulo Bank');
  const [recDia, setRecDia] = useState(1);
  const [isSavingRec, setIsSavingRec] = useState(false);

  const queueCount = getOfflineQueue().length;
  const cicloActivo = getCycleLabel();

  const fetchSaldos = async (force = false) => {
    setLoading(true);
    try {
      const [result, carterasRes, recList] = await Promise.all([
        getSaldos(force),
        supabase.from('carteras').select('*').order('orden', { ascending: true, nullsFirst: false }),
        getGastosRecurrentes(),
      ]);
      setSaldos(result.saldos);
      setFromCache(result.fromCache);
      setLastUpdated(result.timestamp);
      setRecurrentes(recList);
      if (carterasRes.data && carterasRes.data.length > 0) {
        setCarterasDb(carterasRes.data.map((c: any, idx: number) => ({
          id: c.id,
          nombre: c.nombre,
          tipo: c.tipo,
          saldo_inicial: Number(c.saldo_inicial) || 0,
          saldo_actual: Number(c.saldo_actual) || 0,
          saldo: Number(c.saldo_actual) || 0,
          saldoActual: Number(c.saldo_actual) || 0,
          icono: c.icono,
          permite_gasto: c.permite_gasto !== false,
          orden: c.orden != null ? Number(c.orden) : (idx + 1),
        })).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99)));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSaldos();
  }, []);

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
    haptic();
    const result = await syncOfflineQueue();
    setSyncing(false);
    setSyncResult(result.synced > 0
      ? `✓ ${result.synced} sincronizadas`
      : result.remaining > 0
        ? `${result.remaining} pendientes aún`
        : 'Sin pendientes'
    );
  };

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return;
    haptic(30);

    const current = carterasDb[index];
    const neighbor = carterasDb[index - 1];

    const targetOrderCurrent = index;
    const targetOrderNeighbor = index + 1;

    const newArr = [...carterasDb];
    newArr[index] = neighbor;
    newArr[index - 1] = current;

    const updatedWithOrders = newArr.map((item, i) => ({
      ...item,
      orden: i + 1,
    }));

    setCarterasDb(updatedWithOrders);

    try {
      const { error: rpcErr } = await supabase.rpc('swap_carteras_orden', {
        id_a: current.id,
        orden_a: targetOrderCurrent,
        id_b: neighbor.id,
        orden_b: targetOrderNeighbor,
      });

      if (rpcErr) {
        // Fallback si la RPC no existe en la base de datos
        await Promise.all([
          supabase.from('carteras').update({ orden: targetOrderCurrent }).eq('id', current.id),
          supabase.from('carteras').update({ orden: targetOrderNeighbor }).eq('id', neighbor.id),
        ]);
      }
    } catch (err) {
      console.error('Error actualizando orden de carteras:', err);
      fetchSaldos(true);
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index >= carterasDb.length - 1) return;
    haptic(30);

    const current = carterasDb[index];
    const neighbor = carterasDb[index + 1];

    const targetOrderCurrent = index + 2;
    const targetOrderNeighbor = index + 1;

    const newArr = [...carterasDb];
    newArr[index] = neighbor;
    newArr[index + 1] = current;

    const updatedWithOrders = newArr.map((item, i) => ({
      ...item,
      orden: i + 1,
    }));

    setCarterasDb(updatedWithOrders);

    try {
      const { error: rpcErr } = await supabase.rpc('swap_carteras_orden', {
        id_a: current.id,
        orden_a: targetOrderCurrent,
        id_b: neighbor.id,
        orden_b: targetOrderNeighbor,
      });

      if (rpcErr) {
        // Fallback si la RPC no existe en la base de datos
        await Promise.all([
          supabase.from('carteras').update({ orden: targetOrderCurrent }).eq('id', current.id),
          supabase.from('carteras').update({ orden: targetOrderNeighbor }).eq('id', neighbor.id),
        ]);
      }
    } catch (err) {
      console.error('Error actualizando orden de carteras:', err);
      fetchSaldos(true);
    }
  };

  const handleTogglePermiteGasto = async (walletName: string, currentPermiteGasto: boolean) => {
    haptic(40);
    const nuevoValor = !currentPermiteGasto;

    setCarterasDb(prev => prev.map(c => c.nombre === walletName ? { ...c, permite_gasto: nuevoValor } : c));

    try {
      const { error } = await supabase
        .from('carteras')
        .update({ permite_gasto: nuevoValor })
        .eq('nombre', walletName);

      if (error) throw error;
      await fetchAppData(true);
      setAdjustSuccessMsg(`Gasto ${nuevoValor ? 'habilitado' : 'bloqueado'} en "${walletName}".`);
      setTimeout(() => setAdjustSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Error actualizando permite_gasto:', err);
      setCarterasDb(prev => prev.map(c => c.nombre === walletName ? { ...c, permite_gasto: currentPermiteGasto } : c));
    }
  };

  const handleOpenAdjust = (walletName: string, currentAmount: number) => {
    haptic();
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
    haptic(50);
    const faltabaPlata = diferencia < 0;
    const comentario = motivoInput.trim() || (faltabaPlata ? 'Descuadre de Saldo' : 'Sobrante de Saldo');

    const updatedSaldos = { ...saldos, [walletName]: nuevoSaldo };
    setSaldos(updatedSaldos);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('finanzas_saldos_updated', { detail: updatedSaldos }));
    }

    try {
      const tx: Transaccion = {
        id: crypto.randomUUID(),
        fecha: new Date().toISOString(),
        tipo: 'AJUSTE',
        monto: Math.abs(diferencia),
        cuenta: walletName,
        cuentaOrigen: faltabaPlata ? walletName : undefined,
        cuentaDestino: faltabaPlata ? undefined : walletName,
        macro: 'Ajuste / Conciliación',
        categoria: 'Ajuste / Conciliación',
        macroCategoria: 'Ajuste / Conciliación',
        sub: faltabaPlata ? 'Descuadre de Saldo' : 'Sobrante de Saldo',
        subcategoria: faltabaPlata ? 'Descuadre de Saldo' : 'Sobrante de Saldo',
        detalle: comentario,
        comentario: comentario,
        sincronizado: false,
      };

      await saveTransaction(tx);
      await fetchAppData(true);

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

  // Handlers para gastos recurrentes
  const handleToggleRecurrente = async (id: string, currentActivo: boolean) => {
    haptic(40);
    const nuevo = !currentActivo;
    setRecurrentes(prev => prev.map(r => r.id === id ? { ...r, activo: nuevo } : r));
    try {
      await toggleGastoRecurrente(id, nuevo);
      setAdjustSuccessMsg(`Gasto programado ${nuevo ? 'activado' : 'pausado'}.`);
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
      adjustMsgTimerRef.current = setTimeout(() => setAdjustSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Error alternando recurrente:', err);
      setRecurrentes(prev => prev.map(r => r.id === id ? { ...r, activo: currentActivo } : r));
    }
  };

  const handleDeleteRecurrente = async (id: string, nombre: string) => {
    haptic(50);
    setRecurrentes(prev => prev.filter(r => r.id !== id));
    try {
      await deleteGastoRecurrente(id);
      setAdjustSuccessMsg(`"${nombre}" eliminado de gastos programados.`);
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
      adjustMsgTimerRef.current = setTimeout(() => setAdjustSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Error eliminando recurrente:', err);
      const list = await getGastosRecurrentes();
      setRecurrentes(list);
    }
  };

  const handleSaveRecurrente = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMonto = Number(recMonto.replace(/[^0-9]/g, ''));
    if (!recNombre.trim() || cleanMonto <= 0) return;

    setIsSavingRec(true);
    haptic(50);
    try {
      await saveGastoRecurrente({
        nombre: recNombre.trim(),
        monto: cleanMonto,
        macroCategoria: recMacro,
        subcategoria: recSub,
        cuenta: recCuenta,
        diaPago: Math.max(1, Math.min(31, Number(recDia) || 1)),
        activo: true,
      });

      const updated = await getGastosRecurrentes();
      setRecurrentes(updated);
      setIsFormRecurrenteOpen(false);
      setRecNombre('');
      setRecMonto('');
      setAdjustSuccessMsg('Gasto programado registrado exitosamente.');
      if (adjustMsgTimerRef.current) clearTimeout(adjustMsgTimerRef.current);
      adjustMsgTimerRef.current = setTimeout(() => setAdjustSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Error guardando gasto recurrente:', err);
    } finally {
      setIsSavingRec(false);
    }
  };

  const walletItems = carterasDb.map((c, index) => {
    const amount = saldos[c.nombre] ?? saldos[c.id] ?? 0;
    const permiteGasto = c.permite_gasto !== false;

    return {
      id: c.id,
      name: c.nombre,
      amount,
      type: ACCOUNT_TYPES[c.nombre] ?? c.tipo ?? 'Cuenta',
      icon: ACCOUNT_ICONS[c.nombre] ?? c.icono ?? '💳',
      permiteGasto,
      orden: c.orden ?? (index + 1),
    };
  });

  const netTotal = walletItems.reduce((s, w) => s + w.amount, 0);
  const activos = walletItems.filter(w => w.amount > 0).reduce((s, w) => s + w.amount, 0);
  const pasivos = walletItems.filter(w => w.amount < 0).reduce((s, w) => s + Math.abs(w.amount), 0);

  const selectedMacroCat = CATALOG_GASTOS.find(c => c.nombre === recMacro) || CATALOG_GASTOS[0];

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Encabezado */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-800 dark:text-slate-100">
            <Wallet size={20} />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900 dark:text-slate-100 tracking-tight">
              Mis Carteras
            </h1>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {loading
                ? 'Actualizando…'
                : fromCache
                  ? lastUpdated > 0
                    ? `Caché · ${new Date(lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Datos locales'
                  : `En vivo · ${new Date(lastUpdated).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
              }
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            haptic();
            fetchSaldos(true);
          }}
          disabled={loading}
          className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition shadow-sm cursor-pointer disabled:opacity-50"
          aria-label="Actualizar saldos de carteras"
          title="Actualizar saldos"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Alerta de confirmación */}
      {adjustSuccessMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2 animate-fade-in shadow-sm">
          <Check size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>{adjustSuccessMsg}</span>
        </div>
      )}

      {/* Métricas de resumen: Activos, Pasivos, Patrimonio Neto */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Activos
          </p>
          <p className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">
            {formatCOP(activos)}
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Pasivos
          </p>
          <p className="text-sm sm:text-base font-black text-rose-600 dark:text-rose-400 mt-1 font-mono">
            {formatCOP(pasivos)}
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-[10px] sm:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Patrimonio Neto
          </p>
          <p className={`text-sm sm:text-base font-black mt-1 font-mono ${netTotal >= 0 ? 'text-slate-900 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {formatCOP(netTotal)}
          </p>
        </div>
      </div>

      {/* SECCIÓN: ⚡ Débitos y Gastos Programados */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all duration-200">
        <div className="p-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => {
              haptic();
              setIsRecurrentesCollapsed(prev => !prev);
            }}
          >
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-sm">
              <Zap size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                  Débitos y Gastos Programados
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {recurrentes.filter(r => r.activo).length}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Cobro automático silencioso por ciclo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                haptic();
                setIsFormRecurrenteOpen(prev => !prev);
              }}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-xs font-bold shadow-sm transition flex items-center gap-1 cursor-pointer active:scale-95"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Programar Gasto</span>
              <span className="sm:hidden">Nuevo</span>
            </button>

            <button
              type="button"
              onClick={() => {
                haptic();
                setIsRecurrentesCollapsed(prev => !prev);
              }}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
              aria-label="Colapsar sección"
            >
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${isRecurrentesCollapsed ? '-rotate-90' : 'rotate-0'}`}
              />
            </button>
          </div>
        </div>

        {/* Formulario desplegable: + Programar Gasto */}
        {isFormRecurrenteOpen && (
          <form
            onSubmit={handleSaveRecurrente}
            className="p-4 bg-slate-50/90 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800 animate-slide-up flex flex-col gap-3"
          >
            <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Nuevo Gasto Recurrente Automático
              </span>
              <button
                type="button"
                onClick={() => setIsFormRecurrenteOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X size={15} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                  Nombre del Servicio
                </label>
                <input
                  type="text"
                  required
                  value={recNombre}
                  onChange={e => setRecNombre(e.target.value)}
                  placeholder="Ej: YouTube Premium, Seguro Auto"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                  Monto Mensual (COP)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={recMonto}
                  onChange={e => setRecMonto(e.target.value)}
                  placeholder="20900"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                  Macro-Categoría
                </label>
                <select
                  value={recMacro}
                  onChange={e => {
                    const newMacro = e.target.value;
                    setRecMacro(newMacro);
                    const cat = CATALOG_GASTOS.find(c => c.nombre === newMacro);
                    if (cat?.subcategorias[0]) setRecSub(cat.subcategorias[0].nombre);
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 font-medium outline-none cursor-pointer"
                >
                  {CATALOG_GASTOS.map(c => (
                    <option key={c.nombre} value={c.nombre}>
                      {c.icono} {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                  Subcategoría
                </label>
                <select
                  value={recSub}
                  onChange={e => setRecSub(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 font-medium outline-none cursor-pointer"
                >
                  {selectedMacroCat.subcategorias.map(s => (
                    <option key={s.nombre} value={s.nombre}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                  Cuenta Débito
                </label>
                <select
                  value={recCuenta}
                  onChange={e => setRecCuenta(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 font-medium outline-none cursor-pointer"
                >
                  {CARTERAS_DEFAULT.map(c => (
                    <option key={c.id || c.nombre} value={c.nombre}>
                      {ACCOUNT_ICONS[c.nombre] || '💳'} {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
                Día de Pago del Mes (1 al 31)
              </label>
              <input
                type="number"
                required
                min={1}
                max={31}
                value={recDia}
                onChange={e => setRecDia(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                className="w-full sm:w-48 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 outline-none"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsFormRecurrenteOpen(false)}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingRec}
                className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isSavingRec ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Guardando…</span>
                  </>
                ) : (
                  <span>Guardar Gasto Programado</span>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Lista de Gastos Recurrentes */}
        {!isRecurrentesCollapsed && (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {recurrentes.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                No tienes gastos recurrentes programados aún.
              </div>
            ) : (
              recurrentes.map(r => {
                const isCobradoEsteCiclo = r.ultimoCicloEjecutado === cicloActivo;
                return (
                  <div
                    key={r.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm flex-shrink-0">
                        {ACCOUNT_ICONS[r.cuenta] || '💳'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                            {r.nombre}
                          </p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            r.activo
                              ? isCobradoEsteCiclo
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                          }`}>
                            {!r.activo
                              ? 'Pausado'
                              : isCobradoEsteCiclo
                                ? '✓ Cobrado este ciclo'
                                : `Próximo cobro: Día ${r.diaPago}`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {r.subcategoria} · {r.cuenta} · Día {r.diaPago} de cada mes
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-10 sm:pl-0">
                      <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                        {formatCOP(r.monto)}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleRecurrente(r.id, r.activo)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer active:scale-95 ${
                            r.activo
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                              : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                          }`}
                          title={r.activo ? 'Pausar gasto recurrente' : 'Activar gasto recurrente'}
                        >
                          {r.activo ? 'Activo' : 'Pausado'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteRecurrente(r.id, r.nombre)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title="Eliminar gasto recurrente"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Lista de 9 carteras en orden numérico establecido */}
      <div className="space-y-3">
        {walletItems.map((wallet, index) => {
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
              <div className="flex items-center gap-3 p-4">
                {/* Botones discretos de reordenamiento */}
                <div className="flex flex-col gap-0.5 -my-1 -ml-1 flex-shrink-0">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveUp(index);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-400 transition rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Mover ${wallet.name} hacia arriba`}
                    title="Subir cartera"
                  >
                    <ChevronUp size={13} strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    disabled={index === walletItems.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveDown(index);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-20 disabled:hover:text-slate-400 transition rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                    aria-label={`Mover ${wallet.name} hacia abajo`}
                    title="Bajar cartera"
                  >
                    <ChevronDown size={13} strokeWidth={2.5} />
                  </button>
                </div>

                <span className="text-2xl flex-shrink-0" role="img" aria-label={wallet.name}>
                  {wallet.icon}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {wallet.name}
                  </p>
                  <p className="text-[10px] sm:text-xs font-medium text-slate-500 dark:text-slate-400">
                    {wallet.type}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-right">
                    <Icon size={14} className={isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'} />
                    <span className={`text-sm sm:text-base font-bold tabular-nums font-mono ${isDebt ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                      {formatCOP(wallet.amount)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenAdjust(wallet.name, wallet.amount)}
                    className={`p-2 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-700 dark:text-indigo-300'
                        : 'bg-slate-50 border-slate-200/80 text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                    title={`Ajustar o conciliar saldo de ${wallet.name}`}
                    aria-label={`Ajustar saldo de ${wallet.name}`}
                  >
                    <SlidersHorizontal size={14} />
                  </button>
                </div>
              </div>

              {/* Control de Permitir Gasto */}
              <div className="px-4 pb-3 pt-1.5 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Permitir registrar gastos:
                </span>
                <button
                  type="button"
                  onClick={() => handleTogglePermiteGasto(wallet.name, wallet.permiteGasto)}
                  className={`px-3 py-1 rounded-xl text-[11px] font-bold border transition flex items-center gap-1.5 cursor-pointer active:scale-95 ${
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

              {/* Formulario desplegable para Ajustar saldo */}
              {isSelected && (
                <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/50 animate-slide-up flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Ajuste / Conciliación de Saldo
                    </span>
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Actual: <strong className="text-slate-800 dark:text-slate-200 font-mono">{formatCOP(wallet.amount)}</strong>
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
                        className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  {/* Diferencia calculada */}
                  {diff !== 0 && !isNaN(diff) && (
                    <div className={`p-2.5 rounded-xl text-xs flex items-center justify-between font-bold ${
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
                      placeholder="Ej: Conciliación bancaria, descuadre caja"
                      className="w-full px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setAdjustingWallet(null)}
                      disabled={isAdjusting}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyAdjustment(wallet.name, wallet.amount)}
                      disabled={isAdjusting || diff === 0 || isNaN(diff)}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      {isAdjusting ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
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

      {/* Sincronización de cola offline */}
      {queueCount > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-4 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
              Cola de pendientes offline
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {queueCount} movimiento{queueCount > 1 ? 's' : ''} pendiente{queueCount > 1 ? 's' : ''}
              {syncResult && ` · ${syncResult}`}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200/80 dark:border-slate-700 transition shadow-sm cursor-pointer disabled:opacity-50"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
      )}
    </div>
  );
}
