/** Shared receipt money helpers for Orders / Collection detail panels. */

export const roundMoney = (x) =>
  typeof x !== 'number' || Number.isNaN(x) ? 0 : Math.round(x * 100) / 100;

export function getReceiptTotals(order, allReceiptOrders) {
  const items =
    allReceiptOrders && allReceiptOrders.length > 0
      ? allReceiptOrders
      : order
        ? [order]
        : [];
  const receiptTotal = roundMoney(
    order?.total_amount ?? items.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0)
  );
  const receiptPaid = roundMoney(
    order?.paid_amount !== undefined && order?.paid_amount !== null
      ? order.paid_amount
      : items.reduce((sum, o) => sum + (parseFloat(o.paid_amount) || 0), 0)
  );
  const balanceDue = roundMoney(receiptTotal - receiptPaid);
  return { receiptTotal, receiptPaid, balanceDue };
}

export const formatReceiptMoney = (n) =>
  n != null && !Number.isNaN(n)
    ? `TSh ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : 'TSh 0';
