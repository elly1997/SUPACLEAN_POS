/** Shared receipt money helpers for Orders / Collection detail panels. */

export const roundMoney = (x) =>
  typeof x !== 'number' || Number.isNaN(x) ? 0 : Math.round(x * 100) / 100;

/**
 * Prefer summing every line on the receipt.
 * Never trust a single rolled `order.total_amount` / `order.paid_amount` alone —
 * list pagination used to return partial receipts, which made Balance Due wrong
 * (e.g. card showed 10,000 while details showed 82,000).
 */
export function getReceiptTotals(order, allReceiptOrders) {
  const fromArg =
    Array.isArray(allReceiptOrders) && allReceiptOrders.length > 0 ? allReceiptOrders : null;
  const fromOrder =
    Array.isArray(order?.all_items) && order.all_items.length > 0 ? order.all_items : null;
  const items = fromArg || fromOrder || (order ? [order] : []);

  const summedTotal = items.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const summedPaid = items.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0);

  // If we only have one synthetic row that already carries rolled totals, keep it.
  const receiptTotal = roundMoney(
    items.length > 1 || fromArg || fromOrder
      ? summedTotal
      : order?.total_amount != null && order?.total_amount !== ''
        ? parseFloat(order.total_amount) || summedTotal
        : summedTotal
  );
  const receiptPaid = roundMoney(
    items.length > 1 || fromArg || fromOrder
      ? summedPaid
      : order?.paid_amount != null && order?.paid_amount !== ''
        ? parseFloat(order.paid_amount) || summedPaid
        : summedPaid
  );
  const balanceDue = roundMoney(Math.max(0, receiptTotal - receiptPaid));
  return { receiptTotal, receiptPaid, balanceDue };
}

export const formatReceiptMoney = (n) =>
  n != null && !Number.isNaN(n)
    ? `TSh ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : 'TSh 0';
