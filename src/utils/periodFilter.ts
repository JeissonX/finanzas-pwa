import type { Transaccion } from '../types/finance';
import { getBogotaDateParts } from './format';

export type PeriodPreset = 'CICLO_ACTUAL' | 'CICLO_ANTERIOR' | 'ULTIMOS_30' | 'PERSONALIZADO';

export interface PeriodFilter {
  preset: PeriodPreset;
  desde: string;
  hasta: string;
}

/** Convierte una fecha ISO o Date a string YYYY-MM-DD en hora Colombia (America/Bogota). */
export function toBogotaDateStr(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

/**
 * Calcula el rango [desde, hasta] en YYYY-MM-DD para un preset dado.
 * El ciclo de corte cae el 25 de cada mes (Corte 25 de nómina):
 *   - CICLO_ACTUAL: 25 del mes inicio hasta 24 del mes siguiente.
 *   - CICLO_ANTERIOR: el ciclo Corte 25 inmediatamente anterior.
 */
export function getPeriodRange(filter: PeriodFilter): {
  desde: string;
  hasta: string;
  label: string;
  dias: number;
} {
  const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const { year, month, day } = getBogotaDateParts();

  if (filter.preset === 'CICLO_ACTUAL') {
    let startYear = year;
    let startMonth = month;

    if (day >= 25) {
      startYear = year;
      startMonth = month;
    } else {
      startMonth = month - 1;
      if (startMonth < 1) {
        startMonth = 12;
        startYear = year - 1;
      }
    }

    let endYear = startYear;
    let endMonth = startMonth + 1;
    if (endMonth > 12) {
      endMonth = 1;
      endYear = startYear + 1;
    }

    const desde = `${startYear}-${String(startMonth).padStart(2, '0')}-25`;
    const hasta = `${endYear}-${String(endMonth).padStart(2, '0')}-24`;
    const dias = daysBetween(desde, hasta);
    const label = `25 ${MONTHS_SHORT[startMonth - 1]} – 24 ${MONTHS_SHORT[endMonth - 1]}`;

    return { desde, hasta, label, dias };
  }

  if (filter.preset === 'CICLO_ANTERIOR') {
    // Encontrar el inicio del ciclo actual y retroceder un mes
    let currentStartYear = year;
    let currentStartMonth = month;

    if (day >= 25) {
      currentStartYear = year;
      currentStartMonth = month;
    } else {
      currentStartMonth = month - 1;
      if (currentStartMonth < 1) {
        currentStartMonth = 12;
        currentStartYear = year - 1;
      }
    }

    // Ciclo anterior: retroceder un mes desde el inicio del ciclo actual
    let startYear = currentStartYear;
    let startMonth = currentStartMonth - 1;
    if (startMonth < 1) {
      startMonth = 12;
      startYear = currentStartYear - 1;
    }

    const endYear = currentStartYear;
    const endMonth = currentStartMonth;

    const desde = `${startYear}-${String(startMonth).padStart(2, '0')}-25`;
    const hasta = `${endYear}-${String(endMonth).padStart(2, '0')}-24`;
    const dias = daysBetween(desde, hasta);
    const label = `25 ${MONTHS_SHORT[startMonth - 1]} – 24 ${MONTHS_SHORT[endMonth - 1]}`;

    return { desde, hasta, label, dias };
  }

  if (filter.preset === 'ULTIMOS_30') {
    const hoy = toBogotaDateStr(new Date());
    const hace29 = new Date();
    hace29.setDate(hace29.getDate() - 29);
    const desde = toBogotaDateStr(hace29);
    const hasta = hoy;
    const dias = 30;
    const [, desdeM, desdeD] = desde.split('-');
    const [, hastaM, hastaD] = hasta.split('-');
    const label = `${parseInt(desdeD)} ${MONTHS_SHORT[parseInt(desdeM) - 1]} – ${parseInt(hastaD)} ${MONTHS_SHORT[parseInt(hastaM) - 1]}`;
    return { desde, hasta, label, dias };
  }

  // PERSONALIZADO
  let desde = filter.desde;
  let hasta = filter.hasta;

  if (desde > hasta) {
    const tmp = desde;
    desde = hasta;
    hasta = tmp;
  }

  const dias = Math.max(1, daysBetween(desde, hasta));
  const [, desdeM, desdeD] = desde.split('-');
  const [, hastaM, hastaD] = hasta.split('-');
  const label = `${parseInt(desdeD)} ${MONTHS_SHORT[parseInt(desdeM) - 1]} – ${parseInt(hastaD)} ${MONTHS_SHORT[parseInt(hastaM) - 1]}`;

  return { desde, hasta, label, dias };
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00-05:00');
  const b = new Date(to + 'T00:00:00-05:00');
  const diff = b.getTime() - a.getTime();
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)) + 1);
}

/** Inicializa el filtro en CICLO_ACTUAL con rango precalculado. */
export function createDefaultPeriodFilter(): PeriodFilter {
  const range = getPeriodRange({ preset: 'CICLO_ACTUAL', desde: '', hasta: '' });
  return {
    preset: 'CICLO_ACTUAL',
    desde: range.desde,
    hasta: range.hasta,
  };
}

/** Filtra transacciones comparando su fecha en hora Bogotá contra [desde, hasta] inclusive. */
export function filterTransactionsByPeriod(
  transacciones: Transaccion[],
  filter: PeriodFilter
): Transaccion[] {
  const range = getPeriodRange(filter);
  const { desde, hasta } = range;

  return transacciones.filter((tx) => {
    const fechaTx = toBogotaDateStr(tx.fecha);
    if (!fechaTx) return false;
    return fechaTx >= desde && fechaTx <= hasta;
  });
}
