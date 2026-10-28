import { useState, useEffect, useMemo, type FormEvent } from 'react';
import {
  X,
  Pencil,
  Loader2,
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  SlidersHorizontal,
  Wallet,
  Tag,
  DollarSign,
  FileText,
} from 'lucide-react';
import type { Transaccion, CarteraInfo, TipoTransaccion } from '../types/finance';
import type { AppData } from '../services/api';
import { CATALOG_GASTOS, CATALOG_INGRESOS, CATALOG_TRANSFERENCIAS, CARTERAS } from '../data/catalog';
import { formatCOP, haptic } from '../utils/format';

interface EditTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaccion: Transaccion | null;
  onSave: (id: string | number, updated: Partial<Transaccion>) => Promise<void>;
}

export default function EditTransactionModal({
  isOpen,
  onClose,
  transaccion,
  onSave,
}: EditTransactionModalProps) {
  const [monto, setMonto] = useState<string>('');
  const [macroCategoria, setMacroCategoria] = useState<string>('');
  const [subcategoria, setSubcategoria] = useState<string>('');
  const [cuenta, setCuenta] = useState<string>('');
  const [cuentaDestino, setCuentaDestino] = useState<string>('');
  const [comentario, setComentario] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Carteras disponibles (únicamente activas)
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
    };
    window.addEventListener('finanzas_appdata_updated', handleUpdate);
    return () => window.removeEventListener('finanzas_appdata_updated', handleUpdate);
  }, []);

  // Pre-cargar valores cuando cambia la transacción o abre el modal
  useEffect(() => {
    if (transaccion && isOpen) {
      setMonto(String(transaccion.monto ?? ''));
      setMacroCategoria(transaccion.macroCategoria || transaccion.categoria || transaccion.macro || '');
      setSubcategoria(transaccion.subcategoria || transaccion.sub || '');
      setCuenta(transaccion.cuenta || transaccion.cuentaOrigen || '');
      setCuentaDestino(transaccion.cuentaDestino || '');
      setComentario(transaccion.comentario || transaccion.detalle || '');
      setSaving(false);
    }
  }, [transaccion, isOpen]);

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

  // Catálogo reactivo según el tipo de transacción
  const catalog = useMemo(() => {
    if (!transaccion) return CATALOG_GASTOS;
    if (transaccion.tipo === 'INGRESO') return CATALOG_INGRESOS;
    if (transaccion.tipo === 'TRANSFERENCIA') return CATALOG_TRANSFERENCIAS;
    return CATALOG_GASTOS;
  }, [transaccion]);

  // Subcategorías correspondientes a la macro-categoría seleccionada
  const availableSubcategorias = useMemo(() => {
    const found = catalog.find(m => m.nombre === macroCategoria);
    const subs = found ? found.subcategorias.map(s => s.nombre) : [];
    if (subcategoria && !subs.includes(subcategoria)) {
      return [subcategoria, ...subs];
    }
    return subs;
  }, [catalog, macroCategoria, subcategoria]);

  // Manejador del cambio de macro-categoría
  const handleMacroChange = (newMacro: string) => {
    setMacroCategoria(newMacro);
    const found = catalog.find(m => m.nombre === newMacro);
    if (found && found.subcategorias.length > 0) {
      setSubcategoria(found.subcategorias[0].nombre);
    }
  };

  // Filtrado de carteras según tipo
  const carterasDisponibles = useMemo(() => {
    if (transaccion?.tipo === 'GASTO') {
      return carterasList.filter(c => c.permite_gasto !== false);
    }
    return carterasList;
  }, [transaccion?.tipo, carterasList]);

  if (!isOpen || !transaccion) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsedMonto = parseFloat(monto);
    if (isNaN(parsedMonto) || parsedMonto <= 0) {
      alert('Ingresa un monto válido mayor a 0');
      return;
    }

    setSaving(true);
    try {
      const cleanMonto = Math.max(1, Math.trunc(Math.round(parsedMonto)));
      const updated: Partial<Transaccion> = {
        tipo: transaccion.tipo,
        monto: cleanMonto,
        macroCategoria,
        categoria: macroCategoria,
        macro: macroCategoria,
        subcategoria,
        sub: subcategoria,
        cuenta,
        cuentaOrigen: transaccion.tipo === 'GASTO' ? cuenta : (transaccion.cuentaOrigen || cuenta),
        cuentaDestino: transaccion.tipo === 'INGRESO'
          ? cuenta
          : transaccion.tipo === 'TRANSFERENCIA'
            ? cuentaDestino
            : undefined,
        comentario: comentario.trim(),
        detalle: comentario.trim(),
      };

      await onSave(transaccion.id, updated);
      haptic(40);
      onClose();
    } catch (err) {
      console.error('Error al guardar cambios de transacción:', err);
    } finally {
      setSaving(false);
    }
  };

  // Configuración de visualización del tipo
  const getTipoBadge = (tipo: TipoTransaccion) => {
    switch (tipo) {
      case 'GASTO':
        return {
          label: 'Gasto',
          Icon: ArrowDownRight,
          classes: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
        };
      case 'INGRESO':
        return {
          label: 'Ingreso',
          Icon: ArrowUpRight,
          classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
        };
      case 'TRANSFERENCIA':
        return {
          label: 'Transferencia',
          Icon: ArrowLeftRight,
          classes: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
        };
      case 'AJUSTE':
        return {
          label: 'Ajuste',
          Icon: SlidersHorizontal,
          classes: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        };
    }
  };

  const badge = getTipoBadge(transaccion.tipo);
  const BadgeIcon = badge.Icon;
  const numPreview = parseFloat(monto) || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={e => {
        if (e.target === e.currentTarget) {
          haptic();
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Editar movimiento"
    >
      <div
        className="
          w-full max-w-lg
          bg-white dark:bg-[#131B2E]
          border-t sm:border border-slate-200 dark:border-slate-800
          rounded-t-3xl sm:rounded-3xl
          shadow-2xl
          flex flex-col
          max-h-[92vh] sm:max-h-[90vh]
          overflow-hidden
          animate-slide-up
        "
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera del modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center shadow-sm">
              <Pencil size={14} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Editar Movimiento
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border uppercase tracking-wide ${badge.classes}`}>
              <BadgeIcon size={11} strokeWidth={2.5} />
              <span>{badge.label}</span>
            </span>

            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition shadow-sm cursor-pointer"
              aria-label="Cerrar modal de edición"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Formulario scrolleable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto overscroll-y-contain px-5 py-4 flex flex-col gap-4">
          {/* Monto */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-tx-monto" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <DollarSign size={13} className="text-slate-400" />
              <span>Monto (COP)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm select-none">
                $
              </span>
              <input
                id="edit-tx-monto"
                type="number"
                inputMode="numeric"
                min="1"
                step="any"
                required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                placeholder="0"
                className="
                  w-full pl-8 pr-3.5 py-2.5 rounded-xl
                  bg-slate-50 dark:bg-slate-950/60
                  border border-slate-200 dark:border-slate-800
                  text-slate-900 dark:text-slate-100
                  font-mono font-bold text-base
                  focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                  transition
                "
              />
            </div>
            {numPreview > 0 && (
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 font-mono pl-1">
                Equivalente: {formatCOP(numPreview)}
              </p>
            )}
          </div>

          {/* Macro-categoría y Subcategoría */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-tx-macro" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Tag size={13} className="text-slate-400" />
                <span>Macro-categoría</span>
              </label>
              <select
                id="edit-tx-macro"
                value={macroCategoria}
                onChange={e => handleMacroChange(e.target.value)}
                className="
                  w-full px-3 py-2 rounded-xl
                  bg-slate-50 dark:bg-slate-950/60
                  border border-slate-200 dark:border-slate-800
                  text-slate-900 dark:text-slate-100
                  text-xs font-medium
                  focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                  transition cursor-pointer
                "
              >
                {catalog.map(cat => (
                  <option key={cat.nombre} value={cat.nombre}>
                    {cat.icono} {cat.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-tx-sub" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Tag size={13} className="text-slate-400" />
                <span>Subcategoría</span>
              </label>
              <select
                id="edit-tx-sub"
                value={subcategoria}
                onChange={e => setSubcategoria(e.target.value)}
                className="
                  w-full px-3 py-2 rounded-xl
                  bg-slate-50 dark:bg-slate-950/60
                  border border-slate-200 dark:border-slate-800
                  text-slate-900 dark:text-slate-100
                  text-xs font-medium
                  focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                  transition cursor-pointer
                "
              >
                {availableSubcategorias.map(sub => (
                  <option key={sub} value={sub}>
                    {sub}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Carteras / Medios de pago */}
          {transaccion.tipo === 'TRANSFERENCIA' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-tx-cuenta-origen" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Wallet size={13} className="text-slate-400" />
                  <span>Cuenta Origen</span>
                </label>
                <select
                  id="edit-tx-cuenta-origen"
                  value={cuenta}
                  onChange={e => setCuenta(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded-xl
                    bg-slate-50 dark:bg-slate-950/60
                    border border-slate-200 dark:border-slate-800
                    text-slate-900 dark:text-slate-100
                    text-xs font-medium
                    focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                    transition cursor-pointer
                  "
                >
                  {carterasList.map(c => (
                    <option key={c.id || c.nombre} value={c.nombre}>
                      {c.icono || '💳'} {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="edit-tx-cuenta-destino" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Wallet size={13} className="text-slate-400" />
                  <span>Cuenta Destino</span>
                </label>
                <select
                  id="edit-tx-cuenta-destino"
                  value={cuentaDestino}
                  onChange={e => setCuentaDestino(e.target.value)}
                  className="
                    w-full px-3 py-2 rounded-xl
                    bg-slate-50 dark:bg-slate-950/60
                    border border-slate-200 dark:border-slate-800
                    text-slate-900 dark:text-slate-100
                    text-xs font-medium
                    focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                    transition cursor-pointer
                  "
                >
                  {carterasList.map(c => (
                    <option key={c.id || c.nombre} value={c.nombre}>
                      {c.icono || '💳'} {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-tx-cuenta" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Wallet size={13} className="text-slate-400" />
                <span>
                  {transaccion.tipo === 'INGRESO' ? 'Cuenta de Depósito' : 'Medio de Pago / Cartera'}
                </span>
              </label>
              <select
                id="edit-tx-cuenta"
                value={cuenta}
                onChange={e => setCuenta(e.target.value)}
                className="
                  w-full px-3 py-2 rounded-xl
                  bg-slate-50 dark:bg-slate-950/60
                  border border-slate-200 dark:border-slate-800
                  text-slate-900 dark:text-slate-100
                  text-xs font-medium
                  focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                  transition cursor-pointer
                "
              >
                {carterasDisponibles.map(c => (
                  <option key={c.id || c.nombre} value={c.nombre}>
                    {c.icono || '💳'} {c.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Comentario / Detalle */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-tx-detalle" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText size={13} className="text-slate-400" />
              <span>Comentario o Detalle</span>
            </label>
            <input
              id="edit-tx-detalle"
              type="text"
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Opcional..."
              className="
                w-full px-3.5 py-2 rounded-xl
                bg-slate-50 dark:bg-slate-950/60
                border border-slate-200 dark:border-slate-800
                text-slate-900 dark:text-slate-100
                text-xs font-medium placeholder-slate-400
                focus:outline-none focus:ring-2 focus:ring-slate-400 dark:focus:ring-slate-600
                transition
              "
            />
          </div>

          {/* Botones de acción */}
          <div className="pt-2 flex items-center gap-2 border-t border-slate-100 dark:border-slate-800/80">
            <button
              type="button"
              onClick={() => {
                haptic();
                onClose();
              }}
              disabled={saving}
              className="
                flex-1 py-2.5 px-4 rounded-xl
                bg-slate-100 hover:bg-slate-200 text-slate-700
                dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200
                border border-slate-200 dark:border-slate-700
                text-xs font-bold tracking-wide transition cursor-pointer disabled:opacity-50
              "
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={saving}
              className="
                flex-1 py-2.5 px-4 rounded-xl
                bg-slate-900 hover:bg-slate-800 text-white
                dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900
                text-xs font-bold tracking-wide shadow-md hover:shadow-lg
                active:scale-[0.98] transition flex items-center justify-center gap-2
                cursor-pointer disabled:opacity-50
              "
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Guardando...</span>
                </>
              ) : (
                <span>Guardar Cambios</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
