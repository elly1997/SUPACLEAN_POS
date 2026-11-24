const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { getYearTokens, currentYearEat } = require('../utils/loyaltyYear');

router.use(authenticate);

/**
 * Supaclean tokens (loyalty wallet unit):
 * - Earn 1 whole token per TSh 20,000 paid cash on a single receipt (not pooled across receipts)
 * - Multiples count: TSh 40,000 = 2 tokens; remainder below 20,000 does not earn (no decimals)
 * - Cash only (payment_method = cash); awarded on collect + paid_full
 * - Redeem any whole number of tokens; 1 token = TSh 500. The cashier/manager states the value
 *   (receipt discount, pickup/delivery cost, or another service's price) and the wallet must cover it.
 * - Every wallet resets to 0 tokens (and Bronze) on 1 Jan — see utils/loyaltyRollover.js
 */
const LOYALTY_CONFIG = {
  unitLabel: 'token',
  unitLabelPlural: 'tokens',
  pointsPerTSh: 1 / 20000,
  minSpendForPoint: 20000,
  minRedeemPoints: 1,
  pointsPerRedemption: 1,
  redemptionValueTSh: 500,
  /** Discount may cover the full ticket; never more than subtotal. */
  maxRedeemPercentOfSubtotal: 1,
  partnerEarnRate: 0.5,
  defaultBrand: 'supaclean_laundry',
  // Lifetime tokens: Bronze → Silver at 51, Gold at 86 (+35), Platinum at 136 (+50).
  tiers: {
    Bronze: { minPoints: 0, multiplier: 1 },
    Silver: { minPoints: 51, multiplier: 1.1 },
    Gold: { minPoints: 86, multiplier: 1.25 },
    Platinum: { minPoints: 136, multiplier: 1.5 },
  },
  upgradeBonus: {
    Silver: 5,
    Gold: 10,
    Platinum: 15,
  },
};

const SOFT_PERKS = [
  {
    key: 'gold_pickup',
    tier: 'Gold',
    name: 'Free dedicated pickup',
    description: '1 free pickup credit per calendar month',
    cadence: 'monthly',
  },
  {
    key: 'platinum_pickup',
    tier: 'Platinum',
    name: 'Free dedicated pickup',
    description: '1 free pickup credit per calendar month',
    cadence: 'monthly',
  },
  {
    key: 'platinum_carwash',
    tier: 'Platinum',
    name: 'Car wash voucher (Moshono)',
    description: 'Quarterly Supaclean car wash & detailing voucher',
    cadence: 'quarterly',
  },
  {
    key: 'platinum_partner_intro',
    tier: 'Platinum',
    name: 'Partner intro SMS',
    description: 'Eligible for Frembo Homes / Supafundi / Giftopia intro offers',
    cadence: 'on_demand',
  },
];

function calculateTier(lifetimePoints) {
  if (lifetimePoints >= LOYALTY_CONFIG.tiers.Platinum.minPoints) return 'Platinum';
  if (lifetimePoints >= LOYALTY_CONFIG.tiers.Gold.minPoints) return 'Gold';
  if (lifetimePoints >= LOYALTY_CONFIG.tiers.Silver.minPoints) return 'Silver';
  return 'Bronze';
}

function nextTierInfo(lifetimePoints, tier) {
  const order = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const idx = order.indexOf(tier);
  const nextTier = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const pointsToNext = nextTier
    ? Math.max(0, LOYALTY_CONFIG.tiers[nextTier].minPoints - lifetimePoints)
    : 0;
  return { next_tier: nextTier, points_to_next_tier: pointsToNext };
}

function softPerksForTierSimple(tier) {
  if (tier === 'Platinum') {
    return SOFT_PERKS.filter((p) => p.tier === 'Platinum');
  }
  if (tier === 'Gold') {
    return SOFT_PERKS.filter((p) => p.tier === 'Gold');
  }
  return [];
}

async function ensureLoyaltyRow(customerId) {
  let loyalty = await db.get('SELECT * FROM loyalty_points WHERE customer_id = ?', [customerId]);
  if (loyalty) return loyalty;
  await db.run(
    'INSERT INTO loyalty_points (customer_id, current_points, lifetime_points, tier) VALUES (?, ?, ?, ?) RETURNING id',
    [customerId, 0, 0, 'Bronze']
  );
  loyalty = await db.get('SELECT * FROM loyalty_points WHERE customer_id = ?', [customerId]);
  return loyalty;
}

function insertTxColumns() {
  return `(customer_id, order_id, transaction_type, points, description, balance_after, brand, earn_source)`;
}

async function insertLoyaltyTx({
  customerId,
  orderId = null,
  transactionType,
  points,
  description,
  balanceAfter,
  brand = LOYALTY_CONFIG.defaultBrand,
  earnSource = LOYALTY_CONFIG.defaultBrand,
  redeemPurpose = null,
  valueTsh = null,
}) {
  try {
    await db.run(
      `INSERT INTO loyalty_transactions
       (customer_id, order_id, transaction_type, points, description, balance_after, brand, earn_source, redeem_purpose, value_tsh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, orderId, transactionType, points, description, balanceAfter, brand, earnSource, redeemPurpose, valueTsh]
    );
    return;
  } catch (err) {
    if (!/column|redeem_purpose|value_tsh/i.test(String(err.message || ''))) throw err;
  }
  try {
    await db.run(
      `INSERT INTO loyalty_transactions ${insertTxColumns()}
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, orderId, transactionType, points, description, balanceAfter, brand, earnSource]
    );
  } catch (err) {
    // Fallback if brand columns not migrated yet
    if (/column|brand|earn_source/i.test(String(err.message || ''))) {
      await db.run(
        `INSERT INTO loyalty_transactions
         (customer_id, order_id, transaction_type, points, description, balance_after)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [customerId, orderId, transactionType, points, description, balanceAfter]
      );
      return;
    }
    throw err;
  }
}

router.get('/customer/:customerId', async (req, res) => {
  const { customerId } = req.params;
  try {
    let loyalty = await ensureLoyaltyRow(customerId);
    const current = Number(loyalty.current_points) || 0;
    const lifetime = Number(loyalty.lifetime_points) || 0;
    const tier = calculateTier(lifetime);
    if (tier !== (loyalty.tier || 'Bronze')) {
      await db.run(
        'UPDATE loyalty_points SET tier = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [tier, customerId]
      );
      loyalty = { ...loyalty, tier };
    }
    const { next_tier, points_to_next_tier } = nextTierInfo(lifetime, tier);
    const yearTokens = await getYearTokens(db, customerId).catch(() => 0);

    res.json({
      customer_id: parseInt(customerId, 10),
      current_points: current,
      lifetime_points: lifetime,
      current_tokens: current,
      lifetime_tokens: lifetime,
      year_tokens: yearTokens,
      year: currentYearEat(),
      resets_on: `${currentYearEat() + 1}-01-01`,
      redeem_purposes: REDEEM_PURPOSES,
      token_value_tsh: LOYALTY_CONFIG.redemptionValueTSh,
      min_redeem_tokens: LOYALTY_CONFIG.minRedeemPoints,
      earn_rule: `1 whole token per TSh ${LOYALTY_CONFIG.minSpendForPoint.toLocaleString()} paid cash on a single receipt (e.g. 40,000 = 2; no decimals)`,
      redeem_rule: `Any whole number of tokens · 1 token = TSh ${LOYALTY_CONFIG.redemptionValueTSh.toLocaleString()} · tokens reset to 0 on 1 Jan`,
      unit: LOYALTY_CONFIG.unitLabelPlural,
      tier,
      next_tier,
      points_to_next_tier,
      tokens_to_next_tier: points_to_next_tier,
      soft_perks: softPerksForTierSimple(tier),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/customer/:customerId/transactions', async (req, res) => {
  const { customerId } = req.params;
  const { limit = 50 } = req.query;
  try {
    const rows = await db.all(
      `SELECT lt.*, o.receipt_number
       FROM loyalty_transactions lt
       LEFT JOIN orders o ON lt.order_id = o.id
       WHERE lt.customer_id = ?
       ORDER BY lt.created_at DESC
       LIMIT ?`,
      [customerId, parseInt(limit, 10)]
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/earn', requireAnyPermission('canManageOrders', 'canManageCash'), async (req, res) => {
  const { customerId, orderId, orderAmount, brand, earn_source: earnSource } = req.body;
  if (!customerId || orderAmount == null) {
    return res.status(400).json({ error: 'Customer ID and order amount are required' });
  }
  try {
    const result = await awardPointsOnCollection(
      customerId,
      orderId || null,
      Number(orderAmount) || 0,
      {
        brand: brand || LOYALTY_CONFIG.defaultBrand,
        earnSource: earnSource || LOYALTY_CONFIG.defaultBrand,
        allowZero: false,
      }
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const REDEEM_PURPOSES = {
  discount: 'Discount on receipt',
  delivery: 'Free pickup / delivery',
  service: 'Other service (e.g. blanket cleaning)',
};

/**
 * Redeem tokens. The cashier/manager states the VALUE (TSh) being covered — a discount, the
 * pickup/delivery cost, or the price of another service — and we check the wallet can cover it.
 *   tokens needed = ceil(value / 500)
 * purpose:
 *   discount — receipt is discounted by `valueTSh` (value is capped at the receipt subtotal)
 *   service  — receipt line for that service is covered (discounted) by `valueTSh`
 *   delivery — pickup/delivery cost is waived; nothing is deducted from the receipt
 * Legacy callers may send `points` instead of `valueTSh` (value = points x 500).
 * `dryRun: true` validates everything and returns the quote without touching the wallet.
 */
router.post('/redeem', requireAnyPermission('canManageOrders', 'canManageCash'), async (req, res) => {
  const {
    customerId,
    points,
    valueTSh,
    purpose: purposeIn,
    note,
    orderId,
    orderSubtotal,
    dryRun,
  } = req.body;

  const purpose = String(purposeIn || 'discount').toLowerCase();
  if (!REDEEM_PURPOSES[purpose]) {
    return res.status(400).json({ error: `Unknown redeem purpose. Use: ${Object.keys(REDEEM_PURPOSES).join(', ')}` });
  }
  if (!customerId) {
    return res.status(400).json({ error: 'Customer ID is required' });
  }

  const unit = LOYALTY_CONFIG.redemptionValueTSh;
  let value = Number(valueTSh);
  if (!Number.isFinite(value) || value <= 0) {
    const pts = Number(points);
    value = Number.isFinite(pts) && pts > 0 ? Math.floor(pts) * unit : 0;
  }
  value = Math.round(value);
  if (value <= 0) {
    return res.status(400).json({
      error:
        purpose === 'delivery'
          ? 'Enter the pickup/delivery cost (TSh) to redeem tokens against.'
          : purpose === 'service'
            ? 'Enter the service price (TSh) to cover with tokens.'
            : 'Enter the discount amount (TSh).',
    });
  }

  try {
    const loyalty = await ensureLoyaltyRow(customerId);
    const available = Math.max(0, Math.floor(Number(loyalty.current_points) || 0));

    // Receipt-based purposes can never cover more than the receipt itself.
    const subtotal = Number(orderSubtotal);
    if (purpose !== 'delivery' && Number.isFinite(subtotal) && subtotal > 0) {
      const maxValue = Math.floor(subtotal * LOYALTY_CONFIG.maxRedeemPercentOfSubtotal);
      if (value > maxValue) {
        return res.status(400).json({
          error: `Receipt total is TSh ${maxValue.toLocaleString()} — a TSh ${value.toLocaleString()} ${purpose === 'service' ? 'service cover' : 'discount'} is too high.`,
          code: 'redeem_cap',
          max_value_tsh: maxValue,
        });
      }
    }

    const tokensNeeded = Math.ceil(value / unit);
    const maxAffordableValue = available * unit;

    if (tokensNeeded < LOYALTY_CONFIG.minRedeemPoints) {
      return res.status(400).json({
        error: `Minimum ${LOYALTY_CONFIG.minRedeemPoints} token(s) (TSh ${(LOYALTY_CONFIG.minRedeemPoints * unit).toLocaleString()}) per redemption.`,
      });
    }

    if (tokensNeeded > available) {
      const label =
        purpose === 'delivery' ? 'the pickup/delivery cost' : purpose === 'service' ? 'this service' : 'this discount';
      return res.status(400).json({
        error: `Not enough tokens for ${label}: TSh ${value.toLocaleString()} needs ${tokensNeeded} token(s) but the customer has ${available} (worth TSh ${maxAffordableValue.toLocaleString()}).`,
        code: 'insufficient_tokens',
        tokens_needed: tokensNeeded,
        tokens_available: available,
        max_value_tsh: maxAffordableValue,
      });
    }

    const receiptDiscount = purpose === 'delivery' ? 0 : value;
    const quote = {
      purpose,
      value_tsh: value,
      tokens_needed: tokensNeeded,
      tokens_available: available,
      tokens_after: available - tokensNeeded,
      receipt_discount: receiptDiscount,
    };

    if (dryRun) {
      return res.json({ ok: true, dry_run: true, ...quote });
    }

    // Atomic deduction: only succeeds if the wallet still covers it (no double-spend race).
    const updated = await db.get(
      `UPDATE loyalty_points
       SET current_points = current_points - ?, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ? AND current_points >= ?
       RETURNING current_points`,
      [tokensNeeded, customerId, tokensNeeded]
    );
    if (!updated) {
      return res.status(409).json({
        error: 'Tokens changed while redeeming — refresh and try again.',
        code: 'insufficient_tokens',
      });
    }
    const newPoints = Number(updated.current_points) || 0;

    const noteText = note ? String(note).trim().slice(0, 120) : '';
    const description = `${REDEEM_PURPOSES[purpose]}: ${tokensNeeded} token(s) for TSh ${value.toLocaleString()}${noteText ? ` — ${noteText}` : ''}`;

    await insertLoyaltyTx({
      customerId,
      orderId: orderId || null,
      transactionType: 'redeemed',
      points: -tokensNeeded,
      description,
      balanceAfter: newPoints,
      redeemPurpose: purpose,
      valueTsh: value,
    });

    res.json({
      ...quote,
      points_redeemed: tokensNeeded,
      tokens_redeemed: tokensNeeded,
      current_points: newPoints,
      current_tokens: newPoints,
      discount_amount: receiptDiscount,
      message:
        purpose === 'delivery'
          ? `Free pickup/delivery (TSh ${value.toLocaleString()}) covered with ${tokensNeeded} token(s)`
          : `TSh ${value.toLocaleString()} ${purpose === 'service' ? 'service cover' : 'discount'} applied with ${tokensNeeded} token(s)`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rewards', async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT * FROM loyalty_rewards WHERE is_active = ? ORDER BY points_required ASC',
      [true]
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tiers', (req, res) => {
  res.json({
    ...LOYALTY_CONFIG.tiers,
    upgradeBonus: LOYALTY_CONFIG.upgradeBonus,
    unit: LOYALTY_CONFIG.unitLabelPlural,
    earn: {
      tokensPerTSh: LOYALTY_CONFIG.pointsPerTSh,
      minSpendForToken: LOYALTY_CONFIG.minSpendForPoint,
      rule: `1 whole token per TSh ${LOYALTY_CONFIG.minSpendForPoint.toLocaleString()} paid cash on a single receipt (e.g. 40,000 = 2; no decimals)`,
      basis: 'paid_cash',
      scope: 'single_receipt',
      wholeTokensOnly: true,
    },
    redeem: {
      minPoints: LOYALTY_CONFIG.minRedeemPoints,
      minTokens: LOYALTY_CONFIG.minRedeemPoints,
      pointsPerBlock: LOYALTY_CONFIG.pointsPerRedemption,
      valuePerBlockTSh: LOYALTY_CONFIG.redemptionValueTSh,
      valuePerTokenTSh: LOYALTY_CONFIG.redemptionValueTSh,
      maxPercentOfSubtotal: LOYALTY_CONFIG.maxRedeemPercentOfSubtotal,
      rule: `Any whole number of tokens · 1 token = TSh ${LOYALTY_CONFIG.redemptionValueTSh.toLocaleString()} · tokens reset to 0 on 1 Jan`,
    },
  });
});

router.get('/perks', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT perk_key AS key, tier, name, description, cadence
       FROM loyalty_perks
       WHERE COALESCE(is_active, TRUE) = TRUE
       ORDER BY
         CASE tier WHEN 'Gold' THEN 1 WHEN 'Platinum' THEN 2 ELSE 3 END,
         perk_key`
    );
    res.json(rows && rows.length ? rows : SOFT_PERKS);
  } catch (err) {
    res.json(SOFT_PERKS);
  }
});

router.get('/config', (req, res) => {
  res.json(LOYALTY_CONFIG);
});

/** Admin: grant partner earn or voucher adjustment onto the unified wallet. */
router.post('/partner-grant', requireRole('admin'), async (req, res) => {
  const {
    customerId,
    amountTSh,
    points: pointsIn,
    brand = 'frembo_partner',
    earn_source: earnSource = 'partner_manual',
    description,
    voucher_code: voucherCode,
  } = req.body;

  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  try {
    let points = Number(pointsIn);
    if (!Number.isFinite(points) || points === 0) {
      const amount = Number(amountTSh) || 0;
      points = Math.floor((amount / LOYALTY_CONFIG.minSpendForPoint) * LOYALTY_CONFIG.partnerEarnRate);
    }
    if (!Number.isFinite(points) || points === 0) {
      return res.status(400).json({ error: 'Provide points or amountTSh that yields points' });
    }

    const loyalty = await ensureLoyaltyRow(customerId);
    const newCurrent = (Number(loyalty.current_points) || 0) + points;
    const newLifetime =
      points > 0
        ? (Number(loyalty.lifetime_points) || 0) + points
        : Number(loyalty.lifetime_points) || 0;
    const newTier = calculateTier(Math.max(0, newLifetime));

    await db.run(
      `UPDATE loyalty_points
       SET current_points = ?, lifetime_points = ?, tier = ?, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ?`,
      [Math.max(0, newCurrent), Math.max(0, newLifetime), newTier, customerId]
    );

    await insertLoyaltyTx({
      customerId,
      orderId: null,
      transactionType: points > 0 ? 'earned' : 'adjustment',
      points,
      description:
        description ||
        (voucherCode
          ? `Partner grant / voucher ${voucherCode}`
          : `Partner grant (${brand})`),
      balanceAfter: Math.max(0, newCurrent),
      brand,
      earnSource,
    });

    res.json({
      customer_id: Number(customerId),
      points,
      current_points: Math.max(0, newCurrent),
      lifetime_points: Math.max(0, newLifetime),
      tier: newTier,
      brand,
      earn_source: earnSource,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Sum cash payments for one receipt's order line(s).
 * Tokens earn only on paid cash for that receipt — never pooled across receipts.
 */
async function sumPaidCashForOrders(orderIds, receiptNumber = null) {
  const ids = (orderIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const receiptClause = receiptNumber ? ' AND UPPER(o.receipt_number) = UPPER(?)' : '';
  const receiptParams = receiptNumber ? [receiptNumber] : [];

  try {
    const fromTx = await db.get(
      `SELECT COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       WHERE t.order_id IN (${placeholders})
         AND t.transaction_type = 'payment_received'
         AND COALESCE(t.is_voided, FALSE) = FALSE
         AND LOWER(REPLACE(COALESCE(t.payment_method, 'cash'), ' ', '_')) = 'cash'
         ${receiptClause}`,
      [...ids, ...receiptParams]
    );
    const txTotal = Number(fromTx?.total) || 0;
    if (txTotal > 0) return txTotal;
  } catch (err) {
    console.warn('sumPaidCashForOrders transactions:', err.message);
  }

  try {
    const fromOrders = await db.get(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total
       FROM orders o
       WHERE o.id IN (${placeholders})
         AND COALESCE(o.is_voided, FALSE) = FALSE
         AND LOWER(REPLACE(COALESCE(o.payment_method, 'cash'), ' ', '_')) = 'cash'
         ${receiptClause}`,
      [...ids, ...receiptParams]
    );
    return Number(fromOrders?.total) || 0;
  } catch (err) {
    console.warn('sumPaidCashForOrders orders fallback:', err.message);
    return 0;
  }
}

/**
 * Award tokens on collection for one receipt only. Idempotent per order_id.
 * Earn base = floor(that_receipt_paid_cash / 20000) — whole tokens only, no decimals, no cross-receipt carry.
 * Fetch loyalty BEFORE tier multiplier.
 */
async function awardPointsOnCollection(customerId, orderId, orderAmount, options = {}) {
  if (!customerId) {
    return { points_earned: 0, skipped: true, reason: 'no_customer' };
  }

  const brand = options.brand || LOYALTY_CONFIG.defaultBrand;
  const earnSource = options.earnSource || LOYALTY_CONFIG.defaultBrand;
  const orderIds = Array.isArray(options.orderIds) && options.orderIds.length
    ? options.orderIds
    : orderId
      ? [orderId]
      : [];

  try {
    if (orderId) {
      const existing = await db.get(
        `SELECT id FROM loyalty_transactions
         WHERE order_id = ? AND transaction_type = 'earned'
         LIMIT 1`,
        [orderId]
      );
      if (existing) {
        const loyalty = await ensureLoyaltyRow(customerId);
        return {
          points_earned: 0,
          skipped: true,
          reason: 'already_awarded',
          current_points: loyalty.current_points,
          tier: loyalty.tier,
        };
      }
    }

    let loyalty = await ensureLoyaltyRow(customerId);

    // Earn from this receipt's paid cash only — never from order total or other receipts.
    let cashPaid = Number(options.cashPaid);
    if (!Number.isFinite(cashPaid) || cashPaid < 0) {
      cashPaid = await sumPaidCashForOrders(orderIds, options.receiptNumber || null);
    }
    if (!Number.isFinite(cashPaid) || cashPaid < 0) {
      cashPaid = 0;
    }

    const basePointsEarned = Math.floor(cashPaid / LOYALTY_CONFIG.minSpendForPoint);
    if (basePointsEarned <= 0 && !options.allowZero) {
      return {
        points_earned: 0,
        skipped: true,
        reason: cashPaid > 0 ? 'below_min_spend' : 'no_paid_cash',
        cash_paid: cashPaid,
        current_points: loyalty.current_points,
        tier: loyalty.tier,
      };
    }

    const tierMultiplier = LOYALTY_CONFIG.tiers[loyalty.tier]?.multiplier || 1;
    const pointsEarned = Math.floor(basePointsEarned * tierMultiplier);

    if (pointsEarned <= 0) {
      return {
        points_earned: 0,
        cash_paid: cashPaid,
        current_points: loyalty.current_points,
        tier: loyalty.tier,
      };
    }

    let newLifetimePoints = (Number(loyalty.lifetime_points) || 0) + pointsEarned;
    let newCurrentPoints = (Number(loyalty.current_points) || 0) + pointsEarned;
    let newTier = calculateTier(newLifetimePoints);
    const tierUpgraded = newTier !== loyalty.tier;
    const tierUpgradeBonus = tierUpgraded ? LOYALTY_CONFIG.upgradeBonus[newTier] || 0 : 0;

    if (tierUpgradeBonus > 0) {
      newLifetimePoints += tierUpgradeBonus;
      newCurrentPoints += tierUpgradeBonus;
      newTier = calculateTier(newLifetimePoints);
    }

    await db.run(
      `UPDATE loyalty_points
       SET current_points = ?, lifetime_points = ?, tier = ?, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = ?`,
      [newCurrentPoints, newLifetimePoints, newTier, customerId]
    );

    await insertLoyaltyTx({
      customerId,
      orderId: orderId || null,
      transactionType: 'earned',
      points: pointsEarned,
      description: `Tokens earned from TSh ${Math.round(cashPaid).toLocaleString()} paid cash`,
      balanceAfter: newCurrentPoints - (tierUpgradeBonus || 0),
      brand,
      earnSource,
    });

    if (tierUpgradeBonus > 0) {
      await insertLoyaltyTx({
        customerId,
        orderId: orderId || null,
        transactionType: 'earned',
        points: tierUpgradeBonus,
        description: `Tier upgrade bonus for reaching ${newTier}`,
        balanceAfter: newCurrentPoints,
        brand,
        earnSource,
      });
    }

    return {
      points_earned: pointsEarned,
      cash_paid: cashPaid,
      current_points: newCurrentPoints,
      lifetime_points: newLifetimePoints,
      tier: newTier,
      tier_upgraded: tierUpgraded,
      tier_upgrade_bonus: tierUpgradeBonus,
    };
  } catch (err) {
    console.error('Error awarding loyalty points:', err);
    throw err;
  }
}

module.exports = router;
module.exports.awardPointsOnCollection = awardPointsOnCollection;
module.exports.sumPaidCashForOrders = sumPaidCashForOrders;
module.exports.LOYALTY_CONFIG = LOYALTY_CONFIG;
module.exports.calculateTier = calculateTier;
module.exports.SOFT_PERKS = SOFT_PERKS;
