export function formatCustomerReceiptId(receiptNumber, itemCount = null) {
  const base = String(receiptNumber || '').replace(/\s*\(\d{2}\)\s*$/, '').trim();
  const count = Number.parseInt(itemCount, 10);
  if (!Number.isFinite(count) || count <= 0) return base || String(receiptNumber || '');
  return `${base} (${count})`;
}

