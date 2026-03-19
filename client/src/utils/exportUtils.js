/**
 * Export tables to PDF or Excel for printing and reporting.
 * Columns: [{ key: string, label: string }]
 * Rows: array of objects (keys match column.key).
 */
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import ExcelJS from 'exceljs';

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
export async function exportToExcel(title, columns, rows, options = {}) {
  const branchLabel = options.branchName || (options.branchId != null ? `Branch ID ${options.branchId}` : null);
  const headers = columns.map(c => c.label);
  const data = rows.map(row => columns.map(col => {
    const v = row[col.key];
    if (v == null) return '';
    return v;
  }));

  const workbook = new ExcelJS.Workbook();
  const sheetName = title.slice(0, 31).replace(/[*?:/\\[\]]/g, ' ');
  const sheet = workbook.addWorksheet(sheetName, { properties: { defaultRowHeight: 18 } });

  let rowIndex = 1;
  sheet.getRow(rowIndex).getCell(1).value = title;
  rowIndex++;
  if (branchLabel) {
    sheet.getRow(rowIndex).getCell(1).value = `Branch: ${branchLabel}`;
    rowIndex++;
  }
  rowIndex++;
  sheet.addRow(headers);
  data.forEach(r => sheet.addRow(r));

  const colWidths = columns.map((_, i) => {
    const maxLen = Math.max(
      String(headers[i]).length,
      ...data.map(r => String(r[i] ?? '').length),
      branchLabel ? String(branchLabel).length + 10 : 0
    );
    return Math.min(Math.max(maxLen + 1, 10), 50);
  });
  sheet.columns.forEach((col, i) => {
    if (colWidths[i] != null) col.width = colWidths[i];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(title) + '.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 100);
}
