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

export interface BogotaDateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

/** Extrae año, mes y día exactos en Colombia (America/Bogota) independientemente del navegador */
export function getBogotaDateParts(dateInput?: Date | string): BogotaDateParts {
  const d = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const parts = formatter.formatToParts(validDate);
  let year = validDate.getFullYear();
  let month = validDate.getMonth() + 1;
  let day = validDate.getDate();

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
  }

  return { year, month, day };
}

/** Retorna el ID canónico con año 'YYYY-MM' para el ciclo de nómina (ej. '2026-10' para 25 Oct – 24 Nov) */
export function getPayrollCycleId(dateInput?: Date | string): string {
  const { year, month, day } = getBogotaDateParts(dateInput);

  let cycleYear = year;
  let cycleMonth = month;

  if (day >= 25) {
    cycleYear = year;
    cycleMonth = month;
  } else {
    cycleMonth = month - 1;
    if (cycleMonth < 1) {
      cycleMonth = 12;
      cycleYear = year - 1;
    }
  }

  return `${cycleYear}-${String(cycleMonth).padStart(2, '0')}`;
}

/** Retorna la cantidad de días de un mes específico en el calendario gregoriano */
export function getDaysInBogotaMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Returns a label like "25 Sep – 24 Oct" for the current nómina cycle in America/Bogota. */
export function getCycleLabel(dateInput?: Date | string): string {
  const { month, day } = getBogotaDateParts(dateInput);
  const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  let startMonthIdx: number;
  let endMonthIdx: number;

  if (day >= 25) {
    startMonthIdx = month - 1;
    endMonthIdx = month % 12;
  } else {
    startMonthIdx = (month - 2 + 12) % 12;
    endMonthIdx = month - 1;
  }

  return `25 ${MONTHS[startMonthIdx]} – 24 ${MONTHS[endMonthIdx]}`;
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
    const { month, day } = getBogotaDateParts(date);
    const monthName = MONTHS[month - 1];

    // Formatear hora en horario Colombia
    const timeFormatter = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const timeStr = timeFormatter.format(date);

    return `${day} ${monthName} · ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Check if a date string, object or cycle label falls within the current payroll cycle (25th to 24th)
 * strictly evaluated in America/Bogota timezone. Supports both canonical 'YYYY-MM' and legacy labels.
 */
export function isDateInCurrentCycle(dateInput: Date | string, refDateInput?: Date | string): boolean {
  try {
    const currentCanonicalCycle = getPayrollCycleId(refDateInput);
    const currentLegacyLabel = getCycleLabel(refDateInput);

    if (typeof dateInput === 'string') {
      const trimmed = dateInput.trim();
      if (/^\d{4}-\d{2}$/.test(trimmed)) {
        return trimmed === currentCanonicalCycle;
      }
      if (/^\d{1,2}\s+[A-Za-z]{3}\s+[–-]\s+\d{1,2}\s+[A-Za-z]{3}$/.test(trimmed)) {
        return trimmed === currentLegacyLabel;
      }
    }

    const targetCycleId = getPayrollCycleId(dateInput);
    return targetCycleId === currentCanonicalCycle;
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
