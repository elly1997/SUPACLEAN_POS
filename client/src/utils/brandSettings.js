/**
 * Client white-label brand settings (cached briefly).
 */
import { getSettings } from '../api/api';

const DEFAULTS = {
  business_name: 'SUPACLEAN',
  business_tagline: 'Laundry & Dry Cleaning',
  receipt_footer: 'Thank you for your business!',
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 5 * 60 * 1000;

export async function loadBrandSettings(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const res = await getSettings();
    const s = res.data || {};
    cache = {
      business_name: (s.business_name?.value || DEFAULTS.business_name).trim() || DEFAULTS.business_name,
      business_tagline: (s.business_tagline?.value || DEFAULTS.business_tagline).trim() || DEFAULTS.business_tagline,
      receipt_footer: (s.receipt_footer?.value || DEFAULTS.receipt_footer).trim() || DEFAULTS.receipt_footer,
    };
    cacheAt = Date.now();
    return cache;
  } catch (_) {
    return { ...DEFAULTS };
  }
}

export function getCachedBrandSettings() {
  return cache || { ...DEFAULTS };
}

export function clearBrandSettingsCache() {
  cache = null;
  cacheAt = 0;
}
