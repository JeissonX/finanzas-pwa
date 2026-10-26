/** Format number as Colombian pesos (no decimals). */
export function formatCOP(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  }).format(abs);
  return (amount < 0 ? '-$' : '$') + formatted;
}

/** Format raw number string for display (adds thousand separators). */
export function formatDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '0';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(
    parseInt(digits, 10)
  );
}

/** Parse formatted display string back to integer. */
export function parseAmount(formatted: string): number {
  return parseInt(formatted.replace(/\D/g, '') || '0', 10);
}

/** Returns a label like "25 Sep – 24 Oct" for the current nómina cycle. */
export function getCycleLabel(date: Date = new Date()): string {
  const day = date.getDate();
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  let startDay = 25;
  let startMonth: number;
  let endDay = 24;
  let endMonth: number;

  if (day >= 25) {
    startMonth = date.getMonth();
    endMonth = (date.getMonth() + 1) % 12;
  } else {
    startMonth = (date.getMonth() - 1 + 12) % 12;
    endMonth = date.getMonth();
  }

  return `${startDay} ${MONTHS[startMonth]} – ${endDay} ${MONTHS[endMonth]}`;
}

/** Haptic feedback (30 ms, silent on platforms without support). */
export function haptic(ms = 30): void {
  try { navigator.vibrate?.(ms); } catch { /* noop */ }
}

/** Compute progress color class by percentage. */
export function progressColor(pct: number): string {
  if (pct >= 100) return 'bg-rose-500';
  if (pct >= 90) return 'bg-rose-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

/** Compute text color class by percentage (for labels). */
export function progressTextColor(pct: number): string {
  if (pct >= 90) return 'text-rose-600 dark:text-rose-400';
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-700 dark:text-emerald-400';
}

/** Format an ISO date string in Spanish (e.g. "26 oct · 5:30 p. m.") */
export function formatDateSpanish(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const day = date.getDate();
    const month = MONTHS[date.getMonth()];
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'p. m.' : 'a. m.';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day} ${month} · ${hours}:${minutes} ${ampm}`;
  } catch {
    return isoString;
  }
}

/** Check if a date string or object falls within the current payroll cycle (25th to 24th) */
export function isDateInCurrentCycle(dateInput: Date | string, refDate: Date = new Date()): boolean {
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return true;
    const refDay = refDate.getDate();
    let startYear = refDate.getFullYear();
    let startMonth: number;
    let endYear = refDate.getFullYear();
    let endMonth: number;

    if (refDay >= 25) {
      startMonth = refDate.getMonth();
      endMonth = refDate.getMonth() + 1;
      if (endMonth > 11) {
        endMonth = 0;
        endYear++;
      }
    } else {
      startMonth = refDate.getMonth() - 1;
      if (startMonth < 0) {
        startMonth = 11;
        startYear--;
      }
      endMonth = refDate.getMonth();
    }

    const startDate = new Date(startYear, startMonth, 25, 0, 0, 0, 0);
    const endDate = new Date(endYear, endMonth, 24, 23, 59, 59, 999);
    return date.getTime() >= startDate.getTime() && date.getTime() <= endDate.getTime();
  } catch {
    return true;
  }
}

/**
 * Recalcula tasas equivalentes mensuales y diarias a partir de una Tasa Efectiva Anual (E.A. en porcentaje).
 * Fórmula:
 *   tasaMensual = (1 + EA)^(1/12) - 1
 *   tasaDiaria  = (1 + EA)^(1/365) - 1
 */
export function calcEquivalentesEA(eaPct: number) {
  const ea = eaPct / 100;
  const tasaMensual = Math.pow(1 + ea, 1 / 12) - 1;
  const tasaDiaria = Math.pow(1 + ea, 1 / 365) - 1;
  return {
    ea,
    eaPct,
    tasaMensual,
    tasaDiaria,
    tasaMensualPct: tasaMensual * 100,
    tasaDiariaPct: tasaDiaria * 100,
  };
}

