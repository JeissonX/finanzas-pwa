import { useEffect } from 'react';
import { X, PlusCircle } from 'lucide-react';
import QuickRegister from './QuickRegister';
import type { TipoTransaccion } from '../types/finance';
import { haptic } from '../utils/format';

interface QuickRegisterModalProps {
  open: boolean;
  onClose: () => void;
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

export default function QuickRegisterModal({
  open,
  onClose,
  onSave,
  saving,
}: QuickRegisterModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        haptic();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSuccess = () => {
    setTimeout(() => {
      haptic(50);
      onClose();
    }, 500);
  };

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
      aria-label="Registrar nuevo movimiento"
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
        {/* Encabezado del modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex items-center justify-center shadow-sm">
              <PlusCircle size={15} />
            </div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Registrar Movimiento
            </h2>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic();
              onClose();
            }}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 transition shadow-sm cursor-pointer"
            aria-label="Cerrar modal de registro"
          >
            <X size={15} />
          </button>
        </div>

        {/* Contenido scrolleable con QuickRegister */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain pt-2 pb-6">
          <QuickRegister
            onSave={onSave}
            saving={saving}
            onSuccess={handleSuccess}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
