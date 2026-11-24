/** Client mirror of server LOYALTY_CONFIG (1 token / TSh 20,000 paid cash per single receipt). */
export const TOKEN_EARN_SPEND_TSH = 20000;
export const TOKEN_REDEEM_MIN = 1;
export const TOKEN_VALUE_TSH = 500;
export const TOKEN_REDEEM_STEP = 1;
/** Discount may cover the full ticket; never more than subtotal. */
export const TOKEN_MAX_PERCENT_OF_TICKET = 1;

/** What a redemption pays for. `onReceipt` purposes reduce the receipt total. */
export const REDEEM_PURPOSES = [
  { key: 'discount', label: 'Discount on receipt', valueLabel: 'Discount amount (TSh)', onReceipt: true },
  { key: 'delivery', label: 'Free pickup / delivery', valueLabel: 'Pickup / delivery cost (TSh)', onReceipt: false },
  { key: 'service', label: 'Other service (e.g. blanket cleaning)', valueLabel: 'Service price (TSh)', onReceipt: true },
];

export const redeemPurposeInfo = (key) => REDEEM_PURPOSES.find((p) => p.key === key) || REDEEM_PURPOSES[0];

export function tokensToTsh(tokens) {
  const n = Math.floor(Number(tokens) || 0);
  if (n <= 0) return 0;
  return n * TOKEN_VALUE_TSH;
}

/** Tokens needed to cover a TSh value (rounded up to a whole token). */
export function tshToTokens(valueTsh) {
  const v = Math.round(Number(valueTsh) || 0);
  if (v <= 0) return 0;
  return Math.ceil(v / TOKEN_VALUE_TSH);
}

/**
 * Check whether a wallet can cover a TSh value.
 * Returns { ok, tokensNeeded, available, maxValueTsh, shortfall, error }.
 */
export function checkTokenCover(valueTsh, availableTokens) {
  const tokensNeeded = tshToTokens(valueTsh);
  const available = Math.max(0, Math.floor(Number(availableTokens) || 0));
  const maxValueTsh = tokensToTsh(available);
  if (tokensNeeded <= 0) {
    return { ok: false, tokensNeeded, available, maxValueTsh, shortfall: 0, error: 'Enter an amount (TSh)' };
  }
  if (tokensNeeded > available) {
    return {
      ok: false,
      tokensNeeded,
      available,
      maxValueTsh,
      shortfall: tokensNeeded - available,
      error: `Not enough tokens: TSh ${Math.round(valueTsh).toLocaleString()} needs ${tokensNeeded} token${tokensNeeded === 1 ? '' : 's'}, customer has ${available} (worth TSh ${maxValueTsh.toLocaleString()})`,
    };
  }
  return { ok: true, tokensNeeded, available, maxValueTsh, shortfall: 0, error: '' };
}

export function formatTokenBalance(tokens) {
  const n = Math.max(0, Math.floor(Number(tokens) || 0));
  return `${n} token${n === 1 ? '' : 's'}`;
}
