import { WifiOff, RefreshCw, Sun, Moon, CheckCircle2 } from 'lucide-react';
import type { TabPrincipal } from '../types/finance';
import { getCycleLabel } from '../utils/format';

interface HeaderProps {
  tema: 'dark' | 'light';
  onTemaToggle: () => void;
  online: boolean;
  sincronizando: boolean;
  queueCount: number;
  tabActiva?: TabPrincipal;
}

export default function Header({
  tema,
  onTemaToggle,
  online,
  sincronizando,
  queueCount,
}: HeaderProps) {
  const cicloLabel = getCycleLabel();

  return (
    <header className="
      sticky top-0 z-40
      bg-white/95 dark:bg-[#131B2E]/95 backdrop-blur-md
      border-b border-slate-200/80 dark:border-slate-800
      px-4 py-3
      flex items-center justify-between
      shadow-[0_1px_2px_rgba(0,0,0,0.02)]
    ">
      {/* Left: brand + status */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="
          w-8 h-8 rounded-xl flex-shrink-0
          bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-center shadow-sm border border-transparent dark:border-slate-700
        ">
          <span className="text-base leading-none">💸</span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">Finanzas</span>
            {online ? (
              sincronizando ? (
                <RefreshCw size={12} className="text-amber-500 animate-spin flex-shrink-0" />
              ) : (
                <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
              )
            ) : (
              <WifiOff size={12} className="text-rose-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate font-medium">
            {queueCount > 0
              ? `${queueCount} pendiente${queueCount > 1 ? 's' : ''}`
              : cicloLabel}
          </p>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onTemaToggle}
          className="
            p-2 rounded-xl
            text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100
            bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800
            border border-slate-200/90 dark:border-slate-700
            shadow-sm
            transition-all duration-150 cursor-pointer
          "
          aria-label={tema === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
        >
          {tema === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
