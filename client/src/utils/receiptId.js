/** Total garment/piece count across order line rows (matches print / SMS logic). */
export function receiptQuantityTotal(ordersOrItems) {
  if (!ordersOrItems || !ordersOrItems.length) return 0;
  return ordersOrItems.reduce((sum, o) => sum + (parseFloat(o?.quantity) || 1), 0);
}

function branchPrefixFromContext(branchPrefix, ordersOrItems) {
  if (branchPrefix) return branchPrefix;
  const items = Array.isArray(ordersOrItems) ? ordersOrItems : [];
  return items[0]?.branch_code || null;
}

/**
 * Strip legacy " (YY)" year suffix from stored receipt numbers, then optionally append item count.
 * Adds branch prefix (e.g. UH) when missing on legacy rows.
 */
export function formatCustomerReceiptId(receiptNumber, itemCount = null, branchPrefix = null) {
  let base = String(receiptNumber || '')
    .replace(/\s*\(\d{2}\)\s*$/, '')
    .trim();
  const alreadyPrefixed = /^[A-Za-z0-9]{2,10}\s+\d/.test(base);
  if (!alreadyPrefixed && branchPrefix) {
    const p = String(branchPrefix).trim().toUpperCase();
    if (p) base = `${p} ${base}`;
  }
  const count = Number.parseInt(itemCount, 10);
  if (!Number.isFinite(count) || count <= 0) return base || String(receiptNumber || '');
  return `${base} (${count})`;
}

/** Receipt label for grouped UI: branch prefix + canonical number + total pieces. */
export function formatReceiptForDisplay(receiptNumber, ordersOrItems, branchPrefix = null) {
  const prefix = branchPrefixFromContext(branchPrefix, ordersOrItems);
  return formatCustomerReceiptId(receiptNumber, receiptQuantityTotal(ordersOrItems), prefix);
}

/** Branch line for printed receipts. */
export function formatBranchReceiptLine(orderOrGroup) {
  const name = orderOrGroup?.branch_name;
  const prefix = orderOrGroup?.branch_code;
  if (name && prefix) return `Branch: ${name} (${prefix})\n`;
  if (name) return `Branch: ${name}\n`;
  if (prefix) return `Branch ID: ${prefix}\n`;
  if (orderOrGroup?.branch_id) return `Branch ID: ${orderOrGroup.branch_id}\n`;
  return '';
}
