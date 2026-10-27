import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronDown, Zap } from 'lucide-react';
import type { TipoTransaccion, CarteraInfo } from '../types/finance';
import type { AppData } from '../services/api';
import { CATALOG_GASTOS, CATALOG_INGRESOS, CATALOG_TRANSFERENCIAS, CARTERAS, PAYMENT_RULES } from '../data/catalog';
import { formatDisplay, parseAmount, formatCOP, haptic } from '../utils/format';

interface QuickRegisterProps {
  onSave: (payload: {
    tipo: TipoTransaccion;
    monto: number;
    categoria: string;
    subcategoria: string;
    cuenta: string;
    cuentaDestino?: string;
    cuentaOrigen?: string;
    macroCategoria?: string;
    macro?: string;
    sub?: string;
    comentario?: string;
    detalle?: string;
  }) => Promise<void>;
  saving: boolean;
}

const TABS: { key: TipoTransaccion; label: string }[] = [
  { key: 'GASTO', label: 'GASTO' },
  { key: 'INGRESO', label: 'INGRESO' },
  { key: 'TRANSFERENCIA', label: 'TRANSF.' },
];

const TAB_ACCENT: Record<TipoTransaccion, string> = {
  GASTO: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 shadow-sm font-bold',
  INGRESO: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 shadow-sm font-bold',
  TRANSFERENCIA: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800 shadow-sm font-bold',
  AJUSTE: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 shadow-sm font-bold',
};

const INCREMENTS = [10000, 20000, 50000, 100000];

interface QuickSubItem {
  label: string;
  monto: number;
  macro: string;
  sub: string;
  cuenta: string;
}

const QUICK_SUBS: QuickSubItem[] = [
  {
    label: 'Netflix / Spotify',
    monto: 30000,
    macro: 'Suscripciones',
    sub: 'Streaming y Apps Digitales',
    cuenta: 'TC Lulo Bank',
  },
  {
    label: 'Plan Celular',
    monto: 40000,
    macro: 'Servicios Públicos',
    sub: 'Plan Celular',
    cuenta: 'Lulo Principal (Cuenta)',
  },
  {
    label: 'Internet Hogar',
    monto: 80000,
    macro: 'Servicios Públicos',
    sub: 'Internet Hogar',
    cuenta: 'Lulo Principal (Cuenta)',
  },
  {
    label: 'Gimnasio',
    monto: 100000,
    macro: 'Salud y Bienestar',
    sub: 'Gimnasio',
    cuenta: 'TC Lulo Bank',
  },
];

export default function QuickRegister({ onSave, saving }: QuickRegisterProps) {
  const [tipo, setTipo] = useState<TipoTransaccion>('GASTO');
  const [display, setDisplay] = useState('0');
  const [categoria, setCategoria] = useState('Alimentación');
  const [subcategoria, setSubcategoria] = useState('Mercado del Hogar');
  const [cuenta, setCuenta] = useState('TC Lulo Bank');
  const [cuentaDestino, setCuentaDestino] = useState('Lulo Principal (Cuenta)');
  const [comentario, setComentario] = useState('');

  // Carteras dinámicas desde AppData
  const [carterasList, setCarterasList] = useState<CarteraInfo[]>(() => {
    try {
      const raw = localStorage.getItem('finanzas_cached_appdata_v4');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data?.carteras && parsed.data.carteras.length > 0) {
          return parsed.data.carteras;
        }
      }
    } catch {
      /* ignore */
    }
    return CARTERAS.map(c => ({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      icono: c.icono,
      permite_gasto: !['Lulo Bolsillo - Ahorro', 'Lulo Bolsillo - Vacaciones', 'Crédito Mazda 2 (Lulo)'].includes(c.nombre),
    }));
  });

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail?.carteras && custom.detail.carteras.length > 0) {
        setCarterasList(custom.detail.carteras);
      }
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  const catalog = tipo === 'GASTO' ? CATALOG_GASTOS : tipo === 'INGRESO' ? CATALOG_INGRESOS : CATALOG_TRANSFERENCIAS;

  // Filtrar carteras disponibles para el selector de origen/pago
  const carterasDisponibles = useMemo(() => {
    if (tipo === 'GASTO') {
      return carterasList.filter(c => c.permite_gasto !== false);
    }
    return carterasList;
  }, [tipo, carterasList]);

  // Asegurar que al estar en GASTO la cuenta seleccionada sea permitida
  useEffect(() => {
    if (tipo === 'GASTO') {
      const currentAllowed = carterasDisponibles.some(c => c.nombre === cuenta || c.id === cuenta);
      if (!currentAllowed && carterasDisponibles.length > 0) {
        setCuenta(carterasDisponibles[0].nombre);
      }
    }
  }, [tipo, carterasDisponibles, cuenta]);

  // Reset category when tab changes
  useEffect(() => {
    const first = catalog[0];
    setCategoria(first.nombre);
    const firstSub = first.subcategorias[0];
    setSubcategoria(firstSub.nombre);
    const rule = PAYMENT_RULES[firstSub.nombre];
    if (rule) {
      if (tipo === 'GASTO') {
        const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
        setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
      } else {
        setCuenta(rule);
      }
    } else if (tipo === 'TRANSFERENCIA') {
      setCuenta('Lulo Principal (Cuenta)');
      setCuentaDestino('Lulo Bolsillo - Ahorro');
    }
  }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentCat = catalog.find(c => c.nombre === categoria) ?? catalog[0];
  const subcats = currentCat.subcategorias;

  const amount = parseAmount(display);

  const handleIncrement = useCallback((add: number) => {
    haptic();
    setDisplay(prev => formatDisplay(String(parseAmount(prev) + add)));
  }, []);

  const handleClear = useCallback(() => {
    haptic();
    setDisplay('0');
  }, []);

  const handleInput = useCallback((raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setDisplay(digits ? formatDisplay(digits) : '0');
  }, []);

  const handleSelectCat = useCallback((catName: string) => {
    haptic();
    setCategoria(catName);
    const cat = catalog.find(c => c.nombre === catName);
    const firstSub = cat?.subcategorias[0];
    if (firstSub) {
      setSubcategoria(firstSub.nombre);
      const rule = PAYMENT_RULES[firstSub.nombre];
      if (rule) {
        if (tipo === 'GASTO') {
          const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
          setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
        } else {
          setCuenta(rule);
        }
      }
    }
  }, [catalog, tipo, carterasDisponibles]);

  const handleSelectSub = useCallback((sub: string) => {
    haptic();
    setSubcategoria(sub);
    const rule = PAYMENT_RULES[sub];
    if (rule) {
      if (tipo === 'GASTO') {
        const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
        setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
      } else {
        setCuenta(rule);
      }
    }
  }, [tipo, carterasDisponibles]);

  // Acción de Acceso Rápido / Suscripción
  const handleQuickSub = useCallback((sub: QuickSubItem) => {
    haptic();
    setTipo('GASTO');
    setDisplay(formatDisplay(String(sub.monto)));
    setCategoria(sub.macro);
    setSubcategoria(sub.sub);
    setCuenta(sub.cuenta);
    setComentario(sub.label);
  }, []);

  const handleSave = async () => {
    if (amount <= 0) return;
    haptic(50);
    const trimmedComentario = comentario.trim();
    await onSave({
      tipo,
      monto: amount,
      // Categorías (ambas variantes)
      macro: categoria,
      categoria,
      macroCategoria: categoria,
      sub: subcategoria,
      subcategoria,
      // Cuentas según el tipo
      cuenta,
      cuentaOrigen: tipo === 'GASTO' ? cuenta : (tipo === 'TRANSFERENCIA' ? cuenta : ''),
      cuentaDestino: tipo === 'INGRESO' ? cuenta : (tipo === 'TRANSFERENCIA' ? cuentaDestino : ''),
      // Comentario (ambas variantes)
      detalle: trimmedComentario,
      comentario: trimmedComentario,
    });
    setDisplay('0');
    setComentario('');
  };

  return (
    <div className="flex flex-col gap-4 px-4 pb-8 pt-3 animate-fade-in max-w-lg mx-auto w-full">

      {/* Tab selector */}
      <div className="flex gap-1 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-inner">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => { haptic(); setTipo(t.key); }}
            className={`
              flex-1 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 border
              ${tipo === t.key
                ? TAB_ACCENT[t.key]
                : 'text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-slate-200'}
            `}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Barra de Accesos Rápidos / Suscripciones */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 px-0.5">
          <Zap size={12} className="text-amber-500 flex-shrink-0" />
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Accesos Rápidos / Suscripciones
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {QUICK_SUBS.map(sub => (
            <button
              key={sub.label}
              type="button"
              onClick={() => handleQuickSub(sub)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 shadow-sm transition active:scale-95 flex items-center gap-1.5"
            >
              <span>{sub.label}</span>
              <span className="text-[10px] text-slate-400 font-mono font-normal">
                {sub.monto >= 1000 ? `${sub.monto / 1000}k` : sub.monto}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Amount display */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col items-center gap-3">
        <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
          Monto · COP
        </span>
        <div className="flex items-baseline gap-1 w-full justify-center">
          <span className="text-2xl font-extrabold text-slate-300 dark:text-slate-600">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={display}
            onFocus={e => { if (parseAmount(e.target.value) === 0) setDisplay(''); }}
            onBlur={() => { if (!display) setDisplay('0'); }}
            onChange={e => handleInput(e.target.value)}
            className="flex-1 max-w-[300px] text-center text-5xl font-black text-slate-900 dark:text-slate-100 bg-transparent focus:outline-none selection:bg-rose-100 dark:selection:bg-rose-900/50 font-mono tabular-nums"
            aria-label="Monto de la transacción"
          />
        </div>

        {/* Quick increment row */}
        <div className="grid grid-cols-5 gap-1.5 w-full">
          {INCREMENTS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => handleIncrement(v)}
              className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-[11px] font-bold text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700 transition active:scale-95 shadow-sm"
            >
              +{v >= 1000 ? `${v / 1000}k` : v}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-[11px] font-bold text-rose-600 border border-rose-200/70 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/60 transition active:scale-95 shadow-sm"
          >
            C
          </button>
        </div>
      </div>

      {/* Macro Categories Dropdown */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="select-macro" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            {tipo === 'TRANSFERENCIA' ? 'Tipo de Movimiento' : tipo === 'INGRESO' ? 'Fuente de Ingreso' : 'Macro-Categoría'}
          </label>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-200/70 dark:border-slate-700 truncate max-w-[180px]">
            {currentCat?.icono} {categoria}
          </span>
        </div>
        <div className="relative">
          <select
            id="select-macro"
            value={categoria}
            onChange={e => handleSelectCat(e.target.value)}
            className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 pr-10 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 cursor-pointer transition-colors"
          >
            {catalog.map(cat => (
              <option key={cat.nombre} value={cat.nombre} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                {cat.icono} {cat.nombre}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 dark:text-slate-500">
            <ChevronDown size={18} />
          </div>
        </div>
      </section>

      {/* Subcategory Dropdown */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="select-sub" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            Subcategoría
          </label>
          <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-0.5 rounded-lg border border-indigo-200/60 dark:border-indigo-800/60 truncate max-w-[180px]">
            {subcategoria}
          </span>
        </div>
        <div className="relative">
          <select
            id="select-sub"
            value={subcategoria}
            onChange={e => handleSelectSub(e.target.value)}
            className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 pr-10 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 cursor-pointer transition-colors"
          >
            {subcats.map(sub => (
              <option key={sub.nombre} value={sub.nombre} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                {sub.nombre}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 dark:text-slate-500">
            <ChevronDown size={18} />
          </div>
        </div>
      </section>

      {/* Account (Origen) Dropdown - Filtra exclusivamente permite_gasto !== false cuando tipo === GASTO */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="select-cuenta" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            {tipo === 'TRANSFERENCIA' ? 'Cuenta Origen' : tipo === 'INGRESO' ? 'Cuenta Receptora' : 'Medio de Pago (Permitidas)'}
          </label>
          <span className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 rounded-lg border border-emerald-200/60 dark:border-emerald-800/60 truncate max-w-[180px]">
            {cuenta}
          </span>
        </div>
        <div className="relative">
          <select
            id="select-cuenta"
            value={cuenta}
            onChange={e => { haptic(); setCuenta(e.target.value); }}
            className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 pr-10 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 cursor-pointer transition-colors"
          >
            {carterasDisponibles.map(c => (
              <option key={c.id || c.nombre} value={c.nombre} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                {c.icono} {c.nombre}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 dark:text-slate-500">
            <ChevronDown size={18} />
          </div>
        </div>
      </section>

      {/* Transfer destination Dropdown */}
      {tipo === 'TRANSFERENCIA' && (
        <section className="animate-slide-up">
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="select-destino" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Cuenta Destino
            </label>
            <span className="text-[11px] font-bold text-cyan-800 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-950/40 px-2.5 py-0.5 rounded-lg border border-cyan-200/60 dark:border-cyan-800/60 truncate max-w-[180px]">
              {cuentaDestino}
            </span>
          </div>
          <div className="relative">
            <select
              id="select-destino"
              value={cuentaDestino}
              onChange={e => { haptic(); setCuentaDestino(e.target.value); }}
              className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 pr-10 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 cursor-pointer transition-colors"
            >
              {carterasList.filter(c => c.nombre !== cuenta && c.id !== cuenta).map(c => (
                <option key={c.id || c.nombre} value={c.nombre} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                  {c.icono} {c.nombre}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 dark:text-slate-500">
              <ChevronDown size={18} />
            </div>
          </div>
        </section>
      )}

      {/* Comment */}
      <section>
        <label htmlFor="comentario" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
          Comentario (Opcional)
        </label>
        <input
          id="comentario"
          type="text"
          maxLength={80}
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="Ej. Almuerzo quincena, Gasolina Honda…"
          className="
            w-full px-3.5 py-2.5 rounded-2xl
            bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800
            text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500
            focus:outline-none focus:border-slate-400 dark:focus:border-slate-600 focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-700
            shadow-sm transition-colors
          "
        />
      </section>

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || amount <= 0}
        className="w-full py-4 rounded-2xl text-white font-extrabold text-sm tracking-wide transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500 shadow-lg shadow-slate-900/15 cursor-pointer"
      >
        {saving ? (
          <>
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Guardando…
          </>
        ) : (
          `GUARDAR ${tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : tipo === 'INGRESO' ? 'INGRESO' : 'GASTO'} · ${formatCOP(amount)}`
        )}
      </button>
    </div>
  );
}
