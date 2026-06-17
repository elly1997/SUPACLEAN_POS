const moment = require('moment');
const QRCode = require('qrcode');
const db = require('../database/query');

/**
 * Parse receipt strings such as "UH 1-17-6", "1-17-6", or legacy "15-15-03 (26)".
 */
function parseReceiptNumber(receiptNumber) {
  const strippedYear = String(receiptNumber || '')
    .trim()
    .replace(/\s*\(\d{2}\)\s*$/, '')
    .trim();
  const prefixed = strippedYear.match(/^([A-Za-z]{2,6})\s+(\d+)-(\d{1,2})-(\d{1,2})$/);
  if (prefixed) {
    return {
      prefix: prefixed[1].toUpperCase(),
      sequence: parseInt(prefixed[2], 10),
      day: parseInt(prefixed[3], 10),
      month: parseInt(prefixed[4], 10),
      core: `${prefixed[2]}-${prefixed[3]}-${prefixed[4]}`,
    };
  }
  const plain = strippedYear.match(/^(\d+)-(\d{1,2})-(\d{1,2})$/);
  if (plain) {
    return {
      prefix: null,
      sequence: parseInt(plain[1], 10),
      day: parseInt(plain[2], 10),
      month: parseInt(plain[3], 10),
      core: `${plain[1]}-${plain[2]}-${plain[3]}`,
    };
  }
  return { prefix: null, sequence: null, day: null, month: null, core: strippedYear };
}

function buildPrefixedReceiptNumber(prefix, sequence, day, month) {
  const p = String(prefix || '').trim().toUpperCase();
  const seq = Number(sequence);
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  if (!p || !Number.isFinite(seq) || seq < 1) return '';
  return `${p} ${seq}-${d}-${m}`;
}

async function getBranchReceiptPrefix(branchId) {
  if (branchId == null || branchId === '') return null;
  try {
    const row = await db.get(
      'SELECT receipt_prefix, code, name FROM branches WHERE id = ?',
      [branchId]
    );
    if (!row) return null;
    const explicit = String(row.receipt_prefix || '').trim();
    if (explicit) return explicit.toUpperCase();
    const code = String(row.code || '').trim();
    if (code.length >= 2 && code.length <= 4 && /^[A-Za-z0-9]+$/.test(code)) {
      return code.toUpperCase();
    }
    const letters = String(row.name || '').replace(/[^A-Za-z]/g, '');
    return (letters.slice(0, 2) || 'BR').toUpperCase();
  } catch (e) {
    console.warn('getBranchReceiptPrefix:', e.message);
    return null;
  }
}

async function nextBranchReceiptSequence(branchId, prefix, day, month, dateStr) {
  const rows = await db.all(
    `SELECT receipt_number FROM orders WHERE branch_id = ? AND DATE(order_date) = ?`,
    [branchId, dateStr]
  );
  let maxSeq = 0;
  const targetDay = parseInt(day, 10);
  const targetMonth = parseInt(month, 10);
  for (const row of rows || []) {
    const p = parseReceiptNumber(row.receipt_number);
    if (p.prefix && prefix && p.prefix !== prefix) continue;
    if (p.day === targetDay && p.month === targetMonth && Number.isFinite(p.sequence)) {
      maxSeq = Math.max(maxSeq, p.sequence);
    }
  }
  return maxSeq + 1;
}

/**
 * For bulk import: attach branch prefix to spreadsheet ids like "1-17-6" → "UH 1-17-6".
 */
async function normalizeReceiptNumberForBranch(receiptId, branchId) {
  const raw = String(receiptId || '').trim();
  if (!raw) return { ok: false, error: 'Receipt id is empty' };
  const prefix = await getBranchReceiptPrefix(branchId);
  const parsed = parseReceiptNumber(raw);
  if (!parsed.core || !/^\d+-\d{1,2}-\d{1,2}$/.test(parsed.core)) {
    return { ok: false, error: `Invalid receipt format: ${raw}` };
  }
  if (!prefix) {
    return { ok: true, receiptNumber: parsed.core };
  }
  if (parsed.prefix) {
    if (parsed.prefix !== prefix) {
      return {
        ok: false,
        error: `Receipt prefix "${parsed.prefix}" does not match branch prefix "${prefix}"`,
      };
    }
    return { ok: true, receiptNumber: buildPrefixedReceiptNumber(parsed.prefix, parsed.sequence, parsed.day, parsed.month) };
  }
  return {
    ok: true,
    receiptNumber: buildPrefixedReceiptNumber(prefix, parsed.sequence, parsed.day, parsed.month),
  };
}

// Generate unique receipt number: {prefix }?{sequence}-{DD}-{MM} (per branch when branchId set).
async function generateReceiptNumberAsync(targetDate = new Date(), branchId = null, retryCount = 0) {
  const today = new Date(targetDate);
  if (Number.isNaN(today.getTime())) {
    throw new Error('Invalid date provided for receipt generation');
  }
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const dateStr = moment(today).format('YYYY-MM-DD');

  try {
    const prefix = branchId != null ? await getBranchReceiptPrefix(branchId) : null;

    if (prefix && branchId != null) {
      const sequence = await nextBranchReceiptSequence(branchId, prefix, day, month, dateStr);
      return buildPrefixedReceiptNumber(prefix, sequence, day, month);
    }

    const receiptRegex = `^[0-9]+-${day}-${month}( \\([0-9]{2}\\))?$`;
    const row = await db.get(
      `SELECT MAX(CAST(SPLIT_PART(receipt_number, '-', 1) AS INTEGER)) as max_seq
       FROM orders
       WHERE DATE(order_date) = ?
       AND receipt_number ~ ?`,
      [dateStr, receiptRegex]
    );

    let sequence = 1;
    if (row && row.max_seq !== null) {
      sequence = row.max_seq + 1;
    }

    return `${sequence}-${day}-${month}`;
  } catch (err) {
    console.error('Error generating receipt number:', err);
    if (retryCount < 3) {
      return generateReceiptNumberAsync(today, branchId, retryCount + 1);
    }
    const timestampSeq = Date.now() % 100000;
    const prefix = branchId != null ? await getBranchReceiptPrefix(branchId) : null;
    const core = `${timestampSeq}-${day}-${month}`;
    return prefix ? `${prefix} ${core}` : core;
  }
}

function generateReceiptNumber(callback, retryCount = 0) {
  generateReceiptNumberAsync(undefined, null, retryCount)
    .then((receiptNumber) => callback(null, receiptNumber))
    .catch((err) => callback(err, null));
}

async function generateReceiptNumberPromise(targetDate = new Date(), branchId = null) {
  return generateReceiptNumberAsync(targetDate, branchId);
}

function generateReceiptNumberFallback(callback, day, month, year, dateStr, receiptPattern, retryCount = 0) {
  generateReceiptNumberAsync()
    .then((receiptNumber) => callback(null, receiptNumber))
    .catch(() => {
      const timestampSeq = Date.now() % 100000;
      const d = String(new Date().getDate()).padStart(2, '0');
      const m = String(new Date().getMonth() + 1).padStart(2, '0');
      callback(null, `${timestampSeq}-${d}-${m}`);
    });
}

function generateReceiptNumberSync() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const sequence = Date.now() % 10000;
  return `${sequence}-${day}-${month}`;
}

/**
 * Customer-facing receipt label. Uses stored prefix when present; otherwise optional branchPrefix.
 */
function formatCustomerReceiptId(receiptNumber, itemCount = null, branchPrefix = null) {
  let base = String(receiptNumber || '')
    .replace(/\s*\(\d{2}\)\s*$/, '')
    .trim();
  const alreadyPrefixed = /^[A-Za-z]{2,6}\s+\d/.test(base);
  if (!alreadyPrefixed && branchPrefix) {
    const p = String(branchPrefix).trim().toUpperCase();
    if (p) base = `${p} ${base}`;
  }
  const count = Number.parseInt(itemCount, 10);
  if (!Number.isFinite(count) || count <= 0) return base || String(receiptNumber || '');
  return `${base} (${count})`;
}

function formatBranchReceiptLine(order) {
  const name = order?.branch_name;
  const prefix = order?.branch_receipt_prefix || order?.branch_code;
  if (name && prefix) return `Branch: ${name} (${prefix})\n`;
  if (name) return `Branch: ${name}\n`;
  if (prefix) return `Branch ID: ${prefix}\n`;
  if (order?.branch_id) return `Branch ID: ${order.branch_id}\n`;
  return '';
}

async function calculateTotal(service, quantity = 1, weight = 0, deliveryType = 'standard', expressMultiplier = 0) {
  let baseTotal = (service.base_price || 0) * quantity;
  if (service.price_per_item > 0) {
    baseTotal += service.price_per_item * quantity;
  }
  if (service.price_per_kg > 0 && weight > 0) {
    baseTotal += service.price_per_kg * weight;
  }
  if (deliveryType !== 'standard' && expressMultiplier > 0) {
    return baseTotal * expressMultiplier;
  }
  return baseTotal;
}

function calculateTotalSync(service, quantity = 1, weight = 0, deliveryType = 'standard', expressMultiplier = 0) {
  let baseTotal = (service.base_price || 0) * quantity;
  if (service.price_per_item > 0) {
    baseTotal += service.price_per_item * quantity;
  }
  if (service.price_per_kg > 0 && weight > 0) {
    baseTotal += service.price_per_kg * weight;
  }
  if (deliveryType !== 'standard' && expressMultiplier > 0) {
    return baseTotal * expressMultiplier;
  }
  return baseTotal;
}

async function generateReceiptQRCode(order, customer, service) {
  try {
    const qrData = {
      receiptNumber: order.receipt_number,
      date: moment(order.order_date).format('DD/MM/YYYY HH:mm'),
      customer: customer.name,
      phone: customer.phone,
      service: service.name,
      quantity: order.quantity,
      color: order.color || '',
      amount: order.total_amount,
      status: order.status,
      estimatedCollection: order.estimated_collection_date
        ? moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm')
        : '',
      branch: order.branch_name || null,
      branchPrefix: order.branch_receipt_prefix || order.branch_code || null,
    };
    const qrString = JSON.stringify(qrData);
    const qrCodeDataURL = await QRCode.toDataURL(qrString, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    return qrCodeDataURL;
  } catch (error) {
    console.error('Error generating QR code:', error);
    return null;
  }
}

async function formatReceiptAsync(order, customer, service) {
  const estimatedCollectionDate = order.estimated_collection_date
    ? `Est. Collection: ${moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm')}\n`
    : '';
  const itemName = order.garment_type || service.name;
  let cleanNotes = order.special_instructions || '';
  if (cleanNotes) {
    cleanNotes = cleanNotes.replace(/Item ID:\s*\d+/gi, '').trim();
    cleanNotes = cleanNotes.replace(/^[\s|]*|[\s|]*$/g, '').trim();
  }
  const totalAmount = parseFloat(order.total_amount) || 0;
  const qrCodeDataURL = await generateReceiptQRCode(order, customer, service);
  const branchLine = formatBranchReceiptLine(order);
  const branchLocation = order.branch_name ? `${order.branch_name}, Tanzania` : 'Arusha, Tanzania';
  const displayReceiptNo = formatCustomerReceiptId(
    order.receipt_number,
    null,
    order.branch_receipt_prefix || order.branch_code
  );
  const receipt = {
    text: `
═══════════════════════════════════
         SUPACLEAN
   Laundry & Dry Cleaning
   ${branchLocation}
═══════════════════════════════════

Receipt No: ${displayReceiptNo}
${branchLine}Date: ${moment(order.order_date).format('DD/MM/YYYY HH:mm')}
${estimatedCollectionDate}
Customer: ${customer.name}
Phone: ${customer.phone}
───────────────────────────────────
${itemName} x${order.quantity}
${order.color ? `Color: ${order.color}\n` : ''}
───────────────────────────────────
Total: TSh ${totalAmount.toLocaleString()}
${order.payment_status === 'not_paid' ? 'Status: NOT PAID' : order.payment_status === 'paid_full' ? `Status: PAID (${(order.payment_method || 'cash').toUpperCase()})` : `Status: ADVANCE (${(order.payment_method || 'cash').toUpperCase()})\nPaid: TSh ${(order.paid_amount || 0).toLocaleString()}\nBalance: TSh ${(totalAmount - (order.paid_amount || 0)).toLocaleString()}`}
───────────────────────────────────

═══════════════════════════════════
`,
    qrCode: qrCodeDataURL,
  };
  return receipt;
}

function formatReceipt(order, customer, service) {
  const estimatedCollectionDate = order.estimated_collection_date
    ? `Est. Collection: ${moment(order.estimated_collection_date).format('DD/MM/YYYY HH:mm')}\n`
    : '';
  const itemName = order.garment_type || service.name;
  let cleanNotes = order.special_instructions || '';
  if (cleanNotes) {
    cleanNotes = cleanNotes.replace(/Item ID:\s*\d+/gi, '').trim();
    cleanNotes = cleanNotes.replace(/^[\s|]*|[\s|]*$/g, '').trim();
  }
  const totalAmount = parseFloat(order.total_amount) || 0;
  const branchLine = formatBranchReceiptLine(order);
  const displayReceiptNo = formatCustomerReceiptId(
    order.receipt_number,
    null,
    order.branch_receipt_prefix || order.branch_code
  );
  const receipt = `
═══════════════════════════════════
         SUPACLEAN
   Laundry & Dry Cleaning
   ${order.branch_name ? order.branch_name + ', Tanzania' : 'Arusha, Tanzania'}
═══════════════════════════════════

Receipt No: ${displayReceiptNo}
${branchLine}Date: ${moment(order.order_date).format('DD/MM/YYYY HH:mm')}
${estimatedCollectionDate}
Customer: ${customer.name}
Phone: ${customer.phone}
───────────────────────────────────
${itemName} x${order.quantity}
${order.color ? `Color: ${order.color}\n` : ''}
───────────────────────────────────
Total: TSh ${totalAmount.toLocaleString()}
${order.payment_status === 'not_paid' ? 'Status: NOT PAID' : order.payment_status === 'paid_full' ? `Status: PAID (${(order.payment_method || 'cash').toUpperCase()})` : `Status: ADVANCE (${(order.payment_method || 'cash').toUpperCase()})\nPaid: TSh ${(order.paid_amount || 0).toLocaleString()}\nBalance: TSh ${(totalAmount - (order.paid_amount || 0)).toLocaleString()}`}
───────────────────────────────────

═══════════════════════════════════
`;
  return receipt;
}

module.exports = {
  generateReceiptNumber,
  generateReceiptNumberAsync,
  generateReceiptNumberPromise,
  calculateTotal: calculateTotalSync,
  calculateTotalAsync: calculateTotal,
  formatReceipt,
  formatReceiptAsync,
  generateReceiptQRCode,
  formatCustomerReceiptId,
  parseReceiptNumber,
  getBranchReceiptPrefix,
  buildPrefixedReceiptNumber,
  normalizeReceiptNumberForBranch,
  formatBranchReceiptLine,
};
