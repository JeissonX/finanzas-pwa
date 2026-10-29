import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { TipoTransaccion, CarteraInfo, CatalogoItem } from '../types/finance';
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
  onSuccess?: () => void;
  onClose?: () => void;
  catalogo?: CatalogoItem[];
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
  'Ingresos Laborales': '💼',
  'Ingresos Agencia': '🚀',
  'Rentas del Capital': '💰',
  'Otros Ingresos': '📥',
  'Movimientos Propios': '🔄',
};

function getMacroIcon(macro: string, fallbackTipo: TipoTransaccion): string {
  if (MACRO_ICONS[macro]) return MACRO_ICONS[macro];
  const cat = [...CATALOG_GASTOS, ...CATALOG_INGRESOS, ...CATALOG_TRANSFERENCIAS].find(c => c.nombre === macro);
  if (cat?.icono) return cat.icono;
  return fallbackTipo === 'INGRESO' ? '💰' : fallbackTipo === 'TRANSFERENCIA' ? '🔄' : '📊';
}

export default function QuickRegister({ onSave, saving, onSuccess, catalogo }: QuickRegisterProps) {
  const [tipo, setTipo] = useState<TipoTransaccion>('GASTO');
  const [display, setDisplay] = useState('0');
  const [categoria, setCategoria] = useState('Alimentación');
  const [subcategoria, setSubcategoria] = useState('Mercado del Hogar');
  const [cuenta, setCuenta] = useState('TC Lulo Bank');
  const [cuentaDestino, setCuentaDestino] = useState('Lulo Principal (Cuenta)');
  const [comentario, setComentario] = useState('');

  // Catálogo dinámico unificado con fallback a caché local
  const [internalCatalogo, setInternalCatalogo] = useState<CatalogoItem[]>(() => {
    if (catalogo && catalogo.length > 0) return catalogo;
    try {
      const raw = localStorage.getItem('finanzas_cached_appdata_v4');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data?.catalogo && Array.isArray(parsed.data.catalogo)) {
          return parsed.data.catalogo;
        }
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  useEffect(() => {
    if (catalogo && catalogo.length > 0) {
      setInternalCatalogo(catalogo);
    }
  }, [catalogo]);

  // Carteras dinámicas desde AppData (únicamente activas)
  const [carterasList, setCarterasList] = useState<CarteraInfo[]>(() => {
    try {
      const raw = localStorage.getItem('finanzas_cached_appdata_v4');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.data?.carteras && parsed.data.carteras.length > 0) {
          return (parsed.data.carteras as CarteraInfo[]).filter(c => c.activa !== false);
        }
      }
    } catch {
      /* ignore */
    }
    return CARTERAS.filter(c => c.activa !== false).map(c => ({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      icono: c.icono,
      permite_gasto: !['Lulo Bolsillo - Ahorro', 'Lulo Bolsillo - Vacaciones', 'Crédito Mazda 2 (Lulo)'].includes(c.nombre),
      activa: true,
    }));
  });

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const custom = e as CustomEvent<AppData>;
      if (custom.detail?.carteras && custom.detail.carteras.length > 0) {
        setCarterasList(custom.detail.carteras.filter(c => c.activa !== false));
      }
      if (custom.detail?.catalogo && Array.isArray(custom.detail.catalogo)) {
        setInternalCatalogo(custom.detail.catalogo);
      }
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  const activeCatalogo = (catalogo && catalogo.length > 0) ? catalogo : internalCatalogo;

  // Filtrar carteras disponibles para el selector de origen/pago (únicamente activas)
  const carterasDisponibles = useMemo(() => {
    const activas = carterasList.filter(c => c.activa !== false);
    if (tipo === 'GASTO') {
      return activas.filter(c => c.permite_gasto !== false);
    }
    return activas;
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

  // Derivar las Macro-categorías disponibles dinámicamente
  const macrosDisponibles = useMemo(() => {
    if (tipo === 'GASTO') {
      const fromLive = (activeCatalogo || [])
        .filter(c => c.activo !== false && c.macro_categoria)
        .map(c => c.macro_categoria.trim());
      const fromBase = CATALOG_GASTOS.map(c => c.nombre);
      const unified = Array.from(new Set([...fromLive, ...fromBase]));
      return unified.length > 0 ? unified : ['Alimentación'];
    }
    if (tipo === 'INGRESO') {
      return CATALOG_INGRESOS.map(c => c.nombre);
    }
    return CATALOG_TRANSFERENCIAS.map(c => c.nombre);
  }, [activeCatalogo, tipo]);

  // Derivar las Subcategorías disponibles en función de la Macro seleccionada
  const subcategoriasDisponibles = useMemo(() => {
    if (!categoria) return [];
    if (tipo === 'GASTO') {
      const fromLive = (activeCatalogo || [])
        .filter(c => c.macro_categoria.trim().toLowerCase() === categoria.trim().toLowerCase() && c.activo !== false)
        .map(c => c.subcategoria.trim());
      const baseCat = CATALOG_GASTOS.find(c => c.nombre.trim().toLowerCase() === categoria.trim().toLowerCase());
      const fromBase = baseCat ? baseCat.subcategorias.map(s => s.nombre.trim()) : [];
      return Array.from(new Set([...fromLive, ...fromBase]));
    }
    const currentList = tipo === 'INGRESO' ? CATALOG_INGRESOS : CATALOG_TRANSFERENCIAS;
    const found = currentList.find(c => c.nombre === categoria);
    return found ? found.subcategorias.map(s => s.nombre) : [];
  }, [activeCatalogo, categoria, tipo]);

  // Regla de sugerencia de cuenta/medio de pago
  const getSuggestedPayment = useCallback((macroName: string, subName: string) => {
    const item = activeCatalogo.find(
      c => c.macro_categoria.trim().toLowerCase() === macroName.trim().toLowerCase() &&
           c.subcategoria.trim().toLowerCase() === subName.trim().toLowerCase()
    );
    return item?.medio_pago_sugerido || PAYMENT_RULES[subName];
  }, [activeCatalogo]);

  // Reset de categoría cuando cambia la pestaña de tipo
  useEffect(() => {
    if (macrosDisponibles.length > 0) {
      const firstMacro = macrosDisponibles[0];
      setCategoria(firstMacro);
      let firstSub = '';
      if (tipo === 'GASTO') {
        const liveSubs = (activeCatalogo || [])
          .filter(c => c.macro_categoria.trim().toLowerCase() === firstMacro.trim().toLowerCase() && c.activo !== false)
          .map(c => c.subcategoria.trim());
        const baseCat = CATALOG_GASTOS.find(c => c.nombre.trim().toLowerCase() === firstMacro.trim().toLowerCase());
        const baseSubs = baseCat ? baseCat.subcategorias.map(s => s.nombre.trim()) : [];
        firstSub = Array.from(new Set([...liveSubs, ...baseSubs]))[0] || '';
      } else {
        const currentList = tipo === 'INGRESO' ? CATALOG_INGRESOS : CATALOG_TRANSFERENCIAS;
        const found = currentList.find(c => c.nombre === firstMacro);
        firstSub = found?.subcategorias[0]?.nombre || '';
      }
      setSubcategoria(firstSub);
      if (firstSub) {
        const rule = getSuggestedPayment(firstMacro, firstSub);
        if (rule) {
          if (tipo === 'GASTO') {
            const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
            setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
          } else {
            setCuenta(rule);
          }
        }
      }
    }
    if (tipo === 'TRANSFERENCIA') {
      setCuenta('Lulo Principal (Cuenta)');
      setCuentaDestino('Lulo Bolsillo - Ahorro');
    }
  }, [tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si la subcategoría seleccionada previamente no existe en la nueva lista, seleccionar la primera disponible
  useEffect(() => {
    if (subcategoriasDisponibles.length > 0 && !subcategoriasDisponibles.includes(subcategoria)) {
      const nextSub = subcategoriasDisponibles[0];
      setSubcategoria(nextSub);
      const rule = getSuggestedPayment(categoria, nextSub);
      if (rule) {
        if (tipo === 'GASTO') {
          const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
          setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
        } else {
          setCuenta(rule);
        }
      }
    }
  }, [subcategoriasDisponibles, subcategoria, categoria, tipo, carterasDisponibles, getSuggestedPayment]);

  const amount = parseAmount(display);

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
    let nextSubs: string[] = [];
    if (tipo === 'GASTO') {
      const liveSubs = (activeCatalogo || [])
        .filter(c => c.macro_categoria.trim().toLowerCase() === catName.trim().toLowerCase() && c.activo !== false)
        .map(c => c.subcategoria.trim());
      const baseCat = CATALOG_GASTOS.find(c => c.nombre.trim().toLowerCase() === catName.trim().toLowerCase());
      const baseSubs = baseCat ? baseCat.subcategorias.map(s => s.nombre.trim()) : [];
      nextSubs = Array.from(new Set([...liveSubs, ...baseSubs]));
    } else {
      const currentList = tipo === 'INGRESO' ? CATALOG_INGRESOS : CATALOG_TRANSFERENCIAS;
      const found = currentList.find(c => c.nombre === catName);
      nextSubs = found ? found.subcategorias.map(s => s.nombre) : [];
    }
    const firstSub = nextSubs[0] || '';
    setSubcategoria(firstSub);
    if (firstSub) {
      const rule = getSuggestedPayment(catName, firstSub);
      if (rule) {
        if (tipo === 'GASTO') {
          const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
          setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
        } else {
          setCuenta(rule);
        }
      }
    }
  }, [tipo, activeCatalogo, carterasDisponibles, getSuggestedPayment]);

  const handleSelectSub = useCallback((sub: string) => {
    haptic();
    setSubcategoria(sub);
    const rule = getSuggestedPayment(categoria, sub);
    if (rule) {
      if (tipo === 'GASTO') {
        const isPermitida = carterasDisponibles.some(c => c.nombre === rule || c.id === rule);
        setCuenta(isPermitida ? rule : (carterasDisponibles[0]?.nombre || rule));
      } else {
        setCuenta(rule);
      }
    }
  }, [tipo, categoria, carterasDisponibles, getSuggestedPayment]);

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
    onSuccess?.();
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

      {/* Contenedor de input numérico directo y limpio */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 p-5 shadow-sm flex flex-col items-center gap-2">
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Monto · COP
        </span>
        <div className="relative flex items-center justify-center w-full max-w-sm">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={amount > 0 ? formatCOP(amount) : ''}
            placeholder="$0"
            onChange={e => handleInput(e.target.value)}
            className="w-full text-center text-4xl font-black text-slate-900 dark:text-slate-100 bg-transparent focus:outline-none selection:bg-rose-100 dark:selection:bg-rose-900/50 font-mono tabular-nums pr-12 pl-12"
            aria-label="Monto de la transacción"
          />
          {amount > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer flex items-center gap-1 text-[11px] font-bold"
              aria-label="Borrar monto"
              title="Borrar monto"
            >
              <X size={18} />
              <span className="hidden sm:inline">Borrar</span>
            </button>
          )}
        </div>
      </div>

      {/* Macro Categories Dropdown */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="select-macro" className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            {tipo === 'TRANSFERENCIA' ? 'Tipo de Movimiento' : tipo === 'INGRESO' ? 'Fuente de Ingreso' : 'Macro-Categoría'}
          </label>
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-200/70 dark:border-slate-700 truncate max-w-[180px]">
            {getMacroIcon(categoria, tipo)} {categoria}
          </span>
        </div>
        <div className="relative">
          <select
            id="select-macro"
            value={categoria}
            onChange={e => handleSelectCat(e.target.value)}
            className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3.5 pr-10 text-sm font-semibold text-slate-900 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-100 cursor-pointer transition-colors"
          >
            {macrosDisponibles.map(macro => (
              <option key={macro} value={macro} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                {getMacroIcon(macro, tipo)} {macro}
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
            {subcategoriasDisponibles.map(sub => (
              <option key={sub} value={sub} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-medium py-1">
                {sub}
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
