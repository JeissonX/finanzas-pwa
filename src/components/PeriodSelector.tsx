import type { PeriodFilter, PeriodPreset } from '../utils/periodFilter';
import { getPeriodRange } from '../utils/periodFilter';

interface PeriodSelectorProps {
  value: PeriodFilter;
  onChange: (filter: PeriodFilter) => void;
}

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'CICLO_ACTUAL', label: 'Ciclo actual' },
  { key: 'CICLO_ANTERIOR', label: 'Ciclo anterior' },
  { key: 'ULTIMOS_30', label: '30 días' },
  { key: 'PERSONALIZADO', label: 'Rango' },
];

export default function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const range = getPeriodRange(value);

  function handlePreset(preset: PeriodPreset) {
    if (preset === 'PERSONALIZADO') {
      onChange({ ...value, preset });
    } else {
      const newRange = getPeriodRange({ preset, desde: '', hasta: '' });
      onChange({ preset, desde: newRange.desde, hasta: newRange.hasta });
    }
  }

  function handleDesde(val: string) {
    onChange({ ...value, preset: 'PERSONALIZADO', desde: val });
  }

  function handleHasta(val: string) {
    onChange({ ...value, preset: 'PERSONALIZADO', hasta: val });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Botones segmentados */}
      <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 gap-0.5">
        {PRESETS.map(({ key, label }) => {
          const active = value.preset === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handlePreset(key)}
              className={`
                flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-150 cursor-pointer truncate
                ${active
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}
              `}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Inputs de fecha cuando preset es PERSONALIZADO */}
      {value.preset === 'PERSONALIZADO' && (
        <div className="flex gap-2 items-center">
          <div className="flex-1 flex flex-col gap-0.5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Desde
            </label>
            <input
              type="date"
              value={value.desde}
              onChange={e => handleDesde(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-600 transition"
            />
          </div>
          <div className="flex-1 flex flex-col gap-0.5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Hasta
            </label>
            <input
              type="date"
              value={value.hasta}
              onChange={e => handleHasta(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-600 transition"
            />
          </div>
        </div>
      )}

      {/* Rango activo legible */}
      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-center">
        {range.label}
        <span className="ml-1.5 text-slate-300 dark:text-slate-600">·</span>
        <span className="ml-1.5">{range.dias} días</span>
      </p>
    </div>
  );
}
