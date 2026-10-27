import type { Transaccion } from '../types/finance';
import { getCycleLabel } from './format';

function escapeCsvField(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  const str = String(val).replace(/[\r\n]+/g, ' ').trim();
  if (str.includes('"') || str.includes(';') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatFechaLocal(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('es-CO');
  } catch {
    return isoStr;
  }
}

export function exportTransactionsToCSV(transacciones: Transaccion[], cicloActivo?: string): void {
  if (!transacciones || transacciones.length === 0) {
    return;
  }

  const HEADER = 'ID_TX;Fecha_Hora;Tipo;Monto;Macro_Categoria;Subcategoria;Cuenta_Origen;Cuenta_Destino;Ciclo_Presupuestal;Detalle_Comentario';

  const rows = transacciones.map(t => {
    const idTx = escapeCsvField(t.id);
    const fechaHora = escapeCsvField(formatFechaLocal(t.fecha));
    const tipo = escapeCsvField(t.tipo);
    const monto = Math.round(Number(t.monto) || 0);
    const macro = escapeCsvField(t.macroCategoria || t.categoria || t.macro || '');
    const sub = escapeCsvField(t.subcategoria || t.sub || '');

    let cuentaOrigen = '';
    if (t.tipo === 'GASTO' || t.tipo === 'TRANSFERENCIA') {
      cuentaOrigen = t.cuentaOrigen || t.cuenta || '';
    } else if (t.tipo === 'AJUSTE') {
      cuentaOrigen = t.cuentaOrigen || '';
    }

    let cuentaDestino = '';
    if (t.tipo === 'INGRESO') {
      cuentaDestino = t.cuentaDestino || t.cuenta || '';
    } else if (t.tipo === 'TRANSFERENCIA' || t.tipo === 'AJUSTE') {
      cuentaDestino = t.cuentaDestino || '';
    }

    const cicloPresupuestal = escapeCsvField(cicloActivo || getCycleLabel(new Date(t.fecha)));
    const detalleComentario = escapeCsvField(t.comentario || t.detalle || '');

    return [
      idTx,
      fechaHora,
      tipo,
      monto,
      macro,
      sub,
      escapeCsvField(cuentaOrigen),
      escapeCsvField(cuentaDestino),
      cicloPresupuestal,
      detalleComentario,
    ].join(';');
  });

  // Byte Order Mark (BOM) UTF-8 para garantizar apertura inmediata con acentos en Excel Windows
  const BOM = '\uFEFF';
  const csvContent = BOM + [HEADER, ...rows].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const sanitizedCiclo = cicloActivo ? cicloActivo.replace(/[^a-zA-Z0-9_-]/g, '_') : 'backup';
  const dateSuffix = new Date().toISOString().slice(0, 10);
  const fileName = `finanzas_${sanitizedCiclo}_${dateSuffix}.csv`;

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
