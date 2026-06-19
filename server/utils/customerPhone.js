const crypto = require('crypto');

/** Internal marker stored in DB when a customer has no phone yet (bulk import, etc.) */
const PLACEHOLDER_PREFIX = 'NO-PHONE:';

function generatePlaceholderPhone() {
  return `${PLACEHOLDER_PREFIX}${crypto.randomBytes(8).toString('hex')}`;
}

function isPlaceholderPhone(phone) {
  if (phone == null) return true;
  const trimmed = String(phone).trim();
  return trimmed === '' || trimmed.startsWith(PLACEHOLDER_PREFIX);
}

function normalizePhoneDigits(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (isPlaceholderPhone(trimmed)) return '';
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  // Tanzania mobile: 0XXXXXXXXX (10 digits) -> drop leading 0
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 9) {
    return '255' + digits;
  }
  if (digits.length === 12 && digits.startsWith('255')) {
    return digits;
  }
  return digits;
}

/** Values from Excel that should be treated as "no phone" during bulk import. */
const IMPORT_PHONE_EMPTY = /^(n\/a|na|none|nil|null|no|no phone|no number|-|—|\.+)$/i;

function sanitizeImportPhone(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (IMPORT_PHONE_EMPTY.test(s)) return '';
  // Excel sometimes stores TZ mobiles as numbers (loses leading zero).
  if (/^\d{9}$/.test(s)) s = '0' + s;
  if (/^\d{12}$/.test(s) && s.startsWith('255')) s = '0' + s.slice(3);
  return s;
}

function resolveInsertId(result) {
  if (!result) return null;
  const id = result.row?.id ?? result.lastID;
  if (id == null || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

module.exports = {
  PLACEHOLDER_PREFIX,
  generatePlaceholderPhone,
  isPlaceholderPhone,
  normalizePhoneDigits,
  sanitizeImportPhone,
  resolveInsertId,
};
