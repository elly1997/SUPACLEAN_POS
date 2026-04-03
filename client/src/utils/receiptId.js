/** Total garment/piece count across order line rows (matches print / SMS logic). */
export function receiptQuantityTotal(ordersOrItems) {
  if (!ordersOrItems || !ordersOrItems.length) return 0;
  return ordersOrItems.reduce((sum, o) => sum + (parseFloat(o?.quantity) || 1), 0);
}

/**
 * Strip legacy " (YY)" year suffix from stored receipt numbers, then optionally append item count.
 * Use for on-screen labels; URLs and API calls must use the canonical `receipt_number` from the server.
 */
export function formatCustomerReceiptId(receiptNumber, itemCount = null) {
  const base = String(receiptNumber || '').replace(/\s*\(\d{2}\)\s*$/, '').trim();
  const count = Number.parseInt(itemCount, 10);
  if (!Number.isFinite(count) || count <= 0) return base || String(receiptNumber || '');
  return `${base} (${count})`;
}

/** Receipt label for grouped UI: canonical number + total pieces. */
export function formatReceiptForDisplay(receiptNumber, ordersOrItems) {
  return formatCustomerReceiptId(receiptNumber, receiptQuantityTotal(ordersOrItems));
}
