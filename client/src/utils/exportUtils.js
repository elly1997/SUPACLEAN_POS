/**
 * Export tables to PDF or Excel for printing and reporting.
 * Heavy deps (jsPDF, ExcelJS) load only when the user runs an export.
 * Columns: [{ key: string, label: string }]
 * Rows: array of objects (keys match column.key).
 */

/**
 * Single-sheet Excel export matching the Orders table layout (one row per receipt).
 * For packaging managers: receipt, customer, full item list, payment, dates.
 * @param {Record<string, unknown>[]} rows — pre-built from buildPackagingExportRows()
 * @param {{ branchName?: string, branchId?: number }} exportBranch
 * @param {string} title — filename base
 */
export async function exportOrdersPackagingExcel(rows, exportBranch, title) {
  const ExcelJS = (await import(/* webpackChunkName: "lib-exceljs" */ 'exceljs')).default;

  const branchLabel = exportBranch?.branchName
    || (exportBranch?.branchId != null ? `Branch ${exportBranch.branchId}` : 'All Branches');

  const COLS = [
    { key: 'branch_name', label: 'Branch', width: 16 },
    { key: 'receipt_no', label: 'Receipt No', width: 22 },
    { key: 'customer', label: 'Customer', width: 24 },
    { key: 'items', label: 'Items', width: 44 },
    { key: 'total_amount', label: 'Total Amount', width: 16 },
    { key: 'payment', label: 'Payment', width: 22 },
    { key: 'order_date', label: 'Order Date', width: 14 },
    { key: 'est_collection', label: 'Est. Collection', width: 22 },
  ];

  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2744' } };
  const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
  const ALT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  const BORDER = { style: 'thin', color: { argb: 'FFD6DCE4' } };
  const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SUPACLEAN POS';
  wb.created = new Date();

  const ws = wb.addWorksheet('Orders', { properties: { defaultRowHeight: 18 } });

  const titleRow = ws.addRow([`SUPACLEAN — ${title.replace(/_/g, ' ')}`]);
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF0F2744' } };
  ws.addRow([`Branch: ${branchLabel}  |  Generated: ${new Date().toLocaleString()}`]).font = {
    italic: true,
    color: { argb: 'FF475569' },
  };
  ws.addRow([]);

  ws.columns = COLS.map((c) => ({ key: c.key, width: c.width }));

  const headerRow = ws.addRow(COLS.map((c) => c.label));
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = ALL_BORDERS;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  const headerRowNum = headerRow.number;

  rows.forEach((rowData, idx) => {
    const row = ws.addRow(COLS.map((c) => rowData[c.key] ?? ''));
    const itemLineCount = String(rowData.items || '').split('\n').length;
    row.height = Math.max(20, itemLineCount * 15);

    if (idx % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = ALT_FILL; });
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = ALL_BORDERS;
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  });

  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: COLS.length },
  };
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(title) + '_packaging.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {string} title - Report title
 * @param {{ key: string, label: string }[]} columns
 * @param {Record<string, unknown>[]} rows
 * @param {{ branchName?: string, branchId?: number }} [options] - Optional branch for header
 */
export async function exportToPDF(title, columns, rows, options = {}) {
  const { jsPDF } = await import(/* webpackChunkName: "lib-jspdf" */ 'jspdf');
  await import(/* webpackChunkName: "lib-jspdf-autotable" */ 'jspdf-autotable');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const head = [columns.map((c) => c.label)];
  const body = rows.map((row) =>
    columns.map((col) => {
      const v = row[col.key];
      if (v == null) return '';
      if (typeof v === 'number' && !Number.isInteger(v)) return Number(v).toFixed(2);
      return String(v);
    })
  );

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
    margin: { left: 14, right: 14 }
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
  const ExcelJS = (await import(/* webpackChunkName: "lib-exceljs" */ 'exceljs')).default;

  const branchLabel = options.branchName || (options.branchId != null ? `Branch ID ${options.branchId}` : null);
  const headers = columns.map((c) => c.label);
  const data = rows.map((row) =>
    columns.map((col) => {
      const v = row[col.key];
      if (v == null) return '';
      return v;
    })
  );

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
  data.forEach((r) => sheet.addRow(r));

  const colWidths = columns.map((_, i) => {
    const maxLen = Math.max(
      String(headers[i]).length,
      ...data.map((r) => String(r[i] ?? '').length),
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
