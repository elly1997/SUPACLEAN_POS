/** Client mirror of server LOYALTY_CONFIG token economics. */
export const TOKEN_EARN_SPEND_TSH = 20000;
export const TOKEN_REDEEM_MIN = 50;
export const TOKEN_VALUE_TSH = 500;
export const TOKEN_REDEEM_STEP = 1;
export const TOKEN_MANAGER_THRESHOLD = 100;
/** Discount may cover the full ticket; never more than subtotal. */
export const TOKEN_MAX_PERCENT_OF_TICKET = 1;

export function tokensToTsh(tokens) {
  const n = Math.floor(Number(tokens) || 0);
  if (n <= 0) return 0;
  return n * TOKEN_VALUE_TSH;
}

export function formatTokenBalance(tokens) {
  const n = Math.max(0, Math.floor(Number(tokens) || 0));
  return `${n} token${n === 1 ? '' : 's'}`;
}
