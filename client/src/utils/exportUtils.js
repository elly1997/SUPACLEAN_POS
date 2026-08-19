/**
 * Export tables to PDF or Excel for printing and reporting.
 * Heavy deps (jsPDF, ExcelJS) load only when the user runs an export.
 * Columns: [{ key: string, label: string }]
 * Rows: array of objects (keys match column.key).
 */

/**
 * Build an ExcelJS workbook with two sheets:
 *   1. "Items Detail" — one row per order line with item description, customer info, dates.
 *   2. "Receipt Summary" — one row per receipt (totals, status).
 * @param {object[]} receiptGroups  — from groupOrdersByReceipt(); each has .items[] (raw order rows)
 * @param {{ branchName?: string, branchId?: number }} exportBranch
 * @param {string} title — used as filename base
 */
export async function exportOrdersDetailedExcel(receiptGroups, exportBranch, title) {
  const ExcelJS = (await import(/* webpackChunkName: "lib-exceljs" */ 'exceljs')).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SUPACLEAN POS';
  wb.created = new Date();

  const branchLabel = exportBranch?.branchName
    || (exportBranch?.branchId != null ? `Branch ${exportBranch.branchId}` : 'All Branches');

  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2744' } };
  const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
  const ALT_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
  const BORDER     = { style: 'thin', color: { argb: 'FFD6DCE4' } };
  const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

  function fmtDate(v) {
    if (!v) return '';
    try { return new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return String(v); }
  }
  function fmtMoney(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  }

  // ── Sheet 1: Items Detail ──────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Items Detail', { properties: { defaultRowHeight: 18 } });

  const ITEM_COLS = [
    { key: 'receipt_number',           label: 'Receipt No',           width: 18 },
    { key: 'customer_id',              label: 'Customer ID',          width: 14 },
    { key: 'customer_name',            label: 'Customer Name',        width: 24 },
    { key: 'customer_phone',           label: 'Phone',                width: 16 },
    { key: 'branch_name',              label: 'Branch',               width: 18 },
    { key: 'item_no',                  label: 'Item #',               width: 8  },
    { key: 'service_name',             label: 'Service / Item',       width: 26 },
    { key: 'quantity',                 label: 'Qty',                  width: 7  },
    { key: 'color',                    label: 'Color',                width: 14 },
    { key: 'garment_type',             label: 'Garment Type',         width: 16 },
    { key: 'weight_kg',                label: 'Weight (kg)',          width: 12 },
    { key: 'special_instructions',     label: 'Special Instructions', width: 32 },
    { key: 'delivery_type',            label: 'Delivery Type',        width: 15 },
    { key: 'item_total',               label: 'Item Total (TZS)',     width: 17 },
    { key: 'order_date',               label: 'Order Date',           width: 15 },
    { key: 'estimated_collection_date',label: 'Est. Collection Date', width: 20 },
    { key: 'receipt_status',           label: 'Status',               width: 13 },
    { key: 'payment_status',           label: 'Payment Status',       width: 15 },
  ];

  // Title rows
  const titleRow1 = ws1.addRow([`SUPACLEAN — ${title.replace(/_/g, ' ')}`]);
  titleRow1.font = { bold: true, size: 14, color: { argb: 'FF0F2744' } };
  ws1.addRow([`Branch: ${branchLabel}   |   Generated: ${new Date().toLocaleString()}`]).font = { italic: true, color: { argb: 'FF475569' } };
  ws1.addRow([`Purpose: Packaging management — item-level detail for director & packaging managers`]).font = { italic: true, color: { argb: 'FF475569' } };
  ws1.addRow([]);

  ws1.columns = ITEM_COLS.map((c) => ({ key: c.key, width: c.width }));

  const headerRow1 = ws1.addRow(ITEM_COLS.map((c) => c.label));
  headerRow1.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = ALL_BORDERS;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  let dataRowIdx = 0;
  for (const receipt of receiptGroups) {
    const items = receipt.items || [];
    items.forEach((order, i) => {
      dataRowIdx++;
      const row = ws1.addRow({
        receipt_number:            receipt.receipt_number,
        customer_id:               order.customer_id ?? receipt.customer_id ?? '',
        customer_name:             receipt.customer_name || order.customer_name || '',
        customer_phone:            receipt.customer_phone || order.customer_phone || '',
        branch_name:               order.branch_name || receipt.branch_name || branchLabel,
        item_no:                   i + 1,
        service_name:              order.service_name || '',
        quantity:                  Number(order.quantity) || 1,
        color:                     order.color || '',
        garment_type:              order.garment_type || '',
        weight_kg:                 order.weight_kg != null ? Number(order.weight_kg) : '',
        special_instructions:      order.special_instructions || '',
        delivery_type:             order.delivery_type || 'standard',
        item_total:                fmtMoney(order.total_amount),
        order_date:                fmtDate(order.order_date || receipt.order_date),
        estimated_collection_date: fmtDate(order.estimated_collection_date || receipt.estimated_collection_date),
        receipt_status:            (receipt.status || '').toUpperCase(),
        payment_status:            order.payment_status === 'paid_full' ? 'Paid' : order.payment_status === 'advance' ? 'Advance' : 'Unpaid',
      });

      if (dataRowIdx % 2 === 0) {
        row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = ALT_FILL; });
      }
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = ALL_BORDERS;
        cell.alignment = { vertical: 'middle', wrapText: true };
      });
    });
  }

  ws1.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: ITEM_COLS.length } };
  ws1.views = [{ state: 'frozen', ySplit: 5 }];

  // ── Sheet 2: Receipt Summary ───────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Receipt Summary', { properties: { defaultRowHeight: 18 } });
  const SUMM_COLS = [
    { key: 'receipt_number',            label: 'Receipt No',          width: 18 },
    { key: 'customer_id',               label: 'Customer ID',         width: 14 },
    { key: 'customer_name',             label: 'Customer Name',       width: 24 },
    { key: 'customer_phone',            label: 'Phone',               width: 16 },
    { key: 'branch_name',               label: 'Branch',              width: 18 },
    { key: 'item_count',                label: 'Items',               width: 8  },
    { key: 'items_summary',             label: 'Items Description',   width: 50 },
    { key: 'total_amount',              label: 'Total (TZS)',         width: 16 },
    { key: 'paid_amount',               label: 'Paid (TZS)',          width: 14 },
    { key: 'outstanding',               label: 'Outstanding (TZS)',   width: 18 },
    { key: 'payment_status',            label: 'Payment Status',      width: 15 },
    { key: 'order_date',                label: 'Order Date',          width: 15 },
    { key: 'estimated_collection_date', label: 'Est. Collection Date',width: 20 },
    { key: 'status',                    label: 'Status',              width: 13 },
  ];

  const titleRow2 = ws2.addRow([`SUPACLEAN — ${title.replace(/_/g, ' ')} (Summary)`]);
  titleRow2.font = { bold: true, size: 14, color: { argb: 'FF0F2744' } };
  ws2.addRow([`Branch: ${branchLabel}   |   Generated: ${new Date().toLocaleString()}`]).font = { italic: true, color: { argb: 'FF475569' } };
  ws2.addRow([]);

  ws2.columns = SUMM_COLS.map((c) => ({ key: c.key, width: c.width }));

  const headerRow2 = ws2.addRow(SUMM_COLS.map((c) => c.label));
  headerRow2.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = ALL_BORDERS;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  let summIdx = 0;
  for (const receipt of receiptGroups) {
    summIdx++;
    const items = receipt.items || [];
    const itemsSummary = items.map((o, i) => {
      const parts = [`${i + 1}. ${o.service_name || 'Item'}`];
      if (Number(o.quantity) > 1) parts.push(`×${o.quantity}`);
      if (o.color) parts.push(o.color);
      if (o.garment_type) parts.push(`[${o.garment_type}]`);
      if (o.special_instructions) parts.push(`(${o.special_instructions})`);
      return parts.join(' ');
    }).join('\n');

    const outstanding = fmtMoney((receipt.total_amount || 0) - (receipt.paid_amount || 0));
    const firstItem = items[0] || {};
    const row = ws2.addRow({
      receipt_number:            receipt.receipt_number,
      customer_id:               receipt.customer_id || firstItem.customer_id || '',
      customer_name:             receipt.customer_name || '',
      customer_phone:            receipt.customer_phone || '',
      branch_name:               receipt.branch_name || branchLabel,
      item_count:                items.length,
      items_summary:             itemsSummary,
      total_amount:              fmtMoney(receipt.total_amount),
      paid_amount:               fmtMoney(receipt.paid_amount),
      outstanding,
      payment_status:            receipt.payment_status === 'paid_full' ? 'Paid' : receipt.payment_status === 'advance' ? 'Advance' : 'Unpaid',
      order_date:                fmtDate(receipt.order_date || firstItem.order_date),
      estimated_collection_date: fmtDate(receipt.estimated_collection_date || firstItem.estimated_collection_date),
      status:                    (receipt.status || '').toUpperCase(),
    });

    if (summIdx % 2 === 0) {
      row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = ALT_FILL; });
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = ALL_BORDERS;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    // Auto-height for multi-line items description
    row.height = Math.max(18, items.length * 16);
  }

  ws2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: SUMM_COLS.length } };
  ws2.views = [{ state: 'frozen', ySplit: 4 }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(title) + '_items.xlsx';
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
