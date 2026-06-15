/** Matches server-side placeholder phones for customers without a number yet */
const PLACEHOLDER_PREFIX = 'NO-PHONE:';

export function isMissingCustomerPhone(phone) {
  if (phone == null) return true;
  const trimmed = String(phone).trim();
  return trimmed === '' || trimmed.startsWith(PLACEHOLDER_PREFIX);
}

export function formatCustomerPhoneDisplay(phone) {
  return isMissingCustomerPhone(phone) ? 'No phone' : String(phone).trim();
}

/** True when SMS/reminder actions should be blocked for this stored phone value. */
export function canSendSmsToCustomerPhone(phone) {
  return !isMissingCustomerPhone(phone);
}
