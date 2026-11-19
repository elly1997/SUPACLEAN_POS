/**
 * Frembo unified loyalty wallet columns + soft-perk catalog.
 * Idempotent — safe on every boot.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) return;

const db = require('./query');
const { shouldRunSchemaEnsure } = require('./schemaEnsure');

async function ensure() {
  if (!shouldRunSchemaEnsure()) return;
  try {
    await db.run(
      `ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS brand TEXT`,
      []
    );
    await db.run(
      `ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS earn_source TEXT`,
      []
    );
    await db.run(
      `UPDATE loyalty_transactions
       SET brand = COALESCE(brand, 'supaclean_laundry'),
           earn_source = COALESCE(earn_source, 'supaclean_laundry')
       WHERE brand IS NULL OR earn_source IS NULL`,
      []
    ).catch(() => {});

    await db.run(
      `CREATE TABLE IF NOT EXISTS loyalty_perks (
        id SERIAL PRIMARY KEY,
        perk_key TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        cadence TEXT DEFAULT 'monthly',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      []
    );

    const seed = [
      ['gold_pickup', 'Gold', 'Free dedicated pickup', '1 free pickup credit per calendar month', 'monthly'],
      ['platinum_pickup', 'Platinum', 'Free dedicated pickup', '1 free pickup credit per calendar month', 'monthly'],
      [
        'platinum_carwash',
        'Platinum',
        'Car wash voucher (Moshono)',
        'Quarterly Supaclean car wash & detailing voucher',
        'quarterly',
      ],
      [
        'platinum_partner_intro',
        'Platinum',
        'Partner intro SMS',
        'Eligible for Frembo Homes / Supafundi / Giftopia intro offers',
        'on_demand',
      ],
    ];

    for (const [perk_key, tier, name, description, cadence] of seed) {
      await db.run(
        `INSERT INTO loyalty_perks (perk_key, tier, name, description, cadence, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)
         ON CONFLICT (perk_key) DO UPDATE SET
           tier = EXCLUDED.tier,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           cadence = EXCLUDED.cadence,
           is_active = TRUE`,
        [perk_key, tier, name, description, cadence]
      ).catch(async () => {
        const existing = await db.get('SELECT id FROM loyalty_perks WHERE perk_key = ?', [perk_key]);
        if (!existing) {
          await db.run(
            `INSERT INTO loyalty_perks (perk_key, tier, name, description, cadence, is_active)
             VALUES (?, ?, ?, ?, ?, TRUE)`,
            [perk_key, tier, name, description, cadence]
          );
        }
      });
    }

    console.log('OK:  Loyalty wallet + soft perks schema ready');
  } catch (err) {
    console.error('ERROR: ensureLoyaltyWalletSchema:', err.message);
  }
}

if (require.main === module || process.env.SCHEMA_ENSURE_CONTROLLED !== '1') {
  ensure();
}

module.exports = { ensure };
