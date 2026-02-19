/**
 * Export tables to PDF or Excel for printing and reporting.
 * Columns: [{ key: string, label: string }]
 * Rows: array of objects (keys match column.key).
 */
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';

/**
 * @param {string} title - Report title
 * @param {{ key: string, label: string }[]} columns
 * @param {Record<string, unknown>[]} rows
 * @param {{ branchName?: string, branchId?: number }} [options] - Optional branch for header
 */
export function exportToPDF(title, columns, rows, options = {}) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const head = [columns.map(c => c.label)];
  const body = rows.map(row => columns.map(col => {
    const v = row[col.key];
    if (v == null) return '';
    if (typeof v === 'number' && !Number.isInteger(v)) return Number(v).toFixed(2);
    return String(v);
  }));

  const branchLabel = options.branchName || (options.branchId != null ? `Branch ID ${options.branchId}` : null);
  let startY = 12;
  doc.setFontSize(14);
  doc.text(title, 14, startY);
  startY += 6;
  if (branchLabel) {
    doc.setFontSize(10);
    doc.text(`Branch: ${branchLabel}`, 14, startY);
    startY += 6;
  }
  doc.setFontSize(10);
  doc.autoTable({
    head,
    body,
    startY: startY + 2,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 139, 202] },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 20, doc.internal.pageSize.getHeight() - 8);
  }

  doc.save(sanitizeFilename(title) + '.pdf');
}

/**
 * @param {string} title - Sheet/report title
 * @param {{ key: string, label: string }[]} columns
 * @param {Record<string, unknown>[]} rows
 * @param {{ branchName?: string, branchId?: number }} [options] - Optional branch for header
 */
export function exportToExcel(title, columns, rows, options = {}) {
  const branchLabel = options.branchName || (options.branchId != null ? `Branch ID ${options.branchId}` : null);
  const headers = columns.map(c => c.label);
  const data = rows.map(row => columns.map(col => {
    const v = row[col.key];
    if (v == null) return '';
    return v;
  }));
  const titleRow = [title];
  const branchRow = branchLabel ? [`Branch: ${branchLabel}`] : [];
  const rowsForSheet = branchLabel
    ? [titleRow, branchRow, [], headers, ...data]
    : [titleRow, [], headers, ...data];
  const ws = XLSX.utils.aoa_to_sheet(rowsForSheet);
  const colWidths = columns.map((_, i) => {
    const colIndex = i;
    const maxLen = Math.max(
      String(headers[colIndex]).length,
      ...data.map(r => String(r[colIndex] ?? '').length),
      branchLabel ? String(branchLabel).length + 10 : 0
    );
    return { wch: Math.min(Math.max(maxLen + 1, 10), 50) };
  });
  ws['!cols'] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, sanitizeFilename(title) + '.xlsx');
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 100);
}
