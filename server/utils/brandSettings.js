/**
 * White-label brand settings from the settings table.
 */
const db = require('../database/query');

const DEFAULTS = {
  business_name: 'SUPACLEAN',
  business_tagline: 'Laundry & Dry Cleaning',
  receipt_footer: 'Thank you for your business!',
};

async function getBrandSettings() {
  try {
    const rows = await db.all(
      `SELECT setting_key, setting_value FROM settings
       WHERE setting_key IN ('business_name', 'business_tagline', 'receipt_footer')`,
      []
    );
    const map = { ...DEFAULTS };
    for (const row of rows || []) {
      const v = row.setting_value != null ? String(row.setting_value).trim() : '';
      if (v) map[row.setting_key] = v;
    }
    return map;
  } catch (err) {
    console.error('getBrandSettings:', err.message);
    return { ...DEFAULTS };
  }
}

module.exports = { getBrandSettings, BRAND_DEFAULTS: DEFAULTS };
