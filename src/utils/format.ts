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
