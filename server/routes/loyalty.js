const express = require('express');
const router = express.Router();
const db = require('../database/query');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireAnyPermission, hasPermission } = require('../middleware/permissions');

router.use(authenticate);

/** Frembo laundry earn rules — soft perks preferred; cash redeem capped. */
const LOYALTY_CONFIG = {
  pointsPerTSh: 1 / 20000,
  minSpendForPoint: 20000,
  minRedeemPoints: 10,
  pointsPerRedemption: 10,
  redemptionValueTSh: 10000,
  maxRedeemPercentOfSubtotal: 0.1,
  managerRedeemPointsThreshold: 20,
  partnerEarnRate: 0.5,
  defaultBrand: 'supaclean_laundry',
  tiers: {
    Bronze: { minPoints: 0, multiplier: 1 },
    Silver: { minPoints: 500, multiplier: 1.1 },
    Gold: { minPoints: 2000, multiplier: 1.25 },
    Platinum: { minPoints: 7500, multiplier: 1.5 },
  },
  upgradeBonus: {
    Silver: 25,
    Gold: 50,
    Platinum: 100,
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
}) {
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
    const loyalty = await ensureLoyaltyRow(customerId);
    const { next_tier, points_to_next_tier } = nextTierInfo(
      Number(loyalty.lifetime_points) || 0,
      loyalty.tier || 'Bronze'
    );
    res.json({
      customer_id: parseInt(customerId, 10),
      current_points: Number(loyalty.current_points) || 0,
      lifetime_points: Number(loyalty.lifetime_points) || 0,
      tier: loyalty.tier || 'Bronze',
      next_tier,
      points_to_next_tier,
      soft_perks: softPerksForTierSimple(loyalty.tier || 'Bronze'),
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

router.post('/redeem', requireAnyPermission('canManageOrders', 'canManageCash'), async (req, res) => {
  const { customerId, points, orderId, orderSubtotal, managerApproved } = req.body;

  if (!customerId || !points || points <= 0) {
    return res.status(400).json({ error: 'Customer ID and valid points amount are required' });
  }
  if (points < LOYALTY_CONFIG.minRedeemPoints) {
    return res.status(400).json({
      error: `Minimum ${LOYALTY_CONFIG.minRedeemPoints} points required to redeem (worth TSh ${LOYALTY_CONFIG.redemptionValueTSh.toLocaleString()} discount)`,
    });
  }
  if (points % LOYALTY_CONFIG.pointsPerRedemption !== 0) {
    return res.status(400).json({
      error: `Redeem in multiples of ${LOYALTY_CONFIG.pointsPerRedemption} points (${LOYALTY_CONFIG.pointsPerRedemption} points = TSh ${LOYALTY_CONFIG.redemptionValueTSh.toLocaleString()} discount)`,
    });
  }

  const isManager =
    req.user?.role === 'admin' ||
    req.user?.role === 'manager' ||
    hasPermission(req.user, 'canManageCustomers');
  if (points > LOYALTY_CONFIG.managerRedeemPointsThreshold && !isManager && !managerApproved) {
    return res.status(403).json({
      error: `Redeeming more than ${LOYALTY_CONFIG.managerRedeemPointsThreshold} points needs a manager.`,
      code: 'manager_approval_required',
    });
  }

  try {
    const loyalty = await ensureLoyaltyRow(customerId);
    if ((loyalty.current_points || 0) < points) {
      return res.status(400).json({
        error: `Insufficient points. Current balance: ${loyalty.current_points || 0} points`,
      });
    }

    let discountAmount =
      Math.floor(points / LOYALTY_CONFIG.pointsPerRedemption) * LOYALTY_CONFIG.redemptionValueTSh;

    const subtotal = Number(orderSubtotal);
    if (Number.isFinite(subtotal) && subtotal > 0) {
      const maxDiscount = Math.floor(subtotal * LOYALTY_CONFIG.maxRedeemPercentOfSubtotal);
      if (discountAmount > maxDiscount) {
        const maxBlocks = Math.floor(maxDiscount / LOYALTY_CONFIG.redemptionValueTSh);
        const allowedPoints = maxBlocks * LOYALTY_CONFIG.pointsPerRedemption;
        if (allowedPoints < LOYALTY_CONFIG.minRedeemPoints) {
          return res.status(400).json({
            error: `Loyalty discount cannot exceed ${LOYALTY_CONFIG.maxRedeemPercentOfSubtotal * 100}% of the order (max TSh ${maxDiscount.toLocaleString()}). Increase the order total or redeem fewer points.`,
            code: 'redeem_cap',
            max_discount: maxDiscount,
          });
        }
        if (points > allowedPoints) {
          return res.status(400).json({
            error: `At this order total you can redeem at most ${allowedPoints} points (TSh ${(allowedPoints / LOYALTY_CONFIG.pointsPerRedemption) * LOYALTY_CONFIG.redemptionValueTSh} / ${LOYALTY_CONFIG.maxRedeemPercentOfSubtotal * 100}% cap).`,
            code: 'redeem_cap',
            max_points: allowedPoints,
            max_discount: maxBlocks * LOYALTY_CONFIG.redemptionValueTSh,
          });
        }
        discountAmount =
          Math.floor(points / LOYALTY_CONFIG.pointsPerRedemption) * LOYALTY_CONFIG.redemptionValueTSh;
      }
    }

    const newPoints = loyalty.current_points - points;
    await db.run(
      'UPDATE loyalty_points SET current_points = ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?',
      [newPoints, customerId]
    );

    const description =
      points === LOYALTY_CONFIG.pointsPerRedemption
        ? 'Points redeemed at checkout (worth 10,000 TSh)'
        : `Points redeemed for TSh ${discountAmount.toLocaleString()} discount`;

    await insertLoyaltyTx({
      customerId,
      orderId: orderId || null,
      transactionType: 'redeemed',
      points: -points,
      description,
      balanceAfter: newPoints,
    });

    res.json({
      points_redeemed: points,
      current_points: newPoints,
      discount_amount: discountAmount,
      message: `Discount of TSh ${discountAmount.toLocaleString()} applied`,
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
    redeem: {
      minPoints: LOYALTY_CONFIG.minRedeemPoints,
      pointsPerBlock: LOYALTY_CONFIG.pointsPerRedemption,
      valuePerBlockTSh: LOYALTY_CONFIG.redemptionValueTSh,
      maxPercentOfSubtotal: LOYALTY_CONFIG.maxRedeemPercentOfSubtotal,
      managerThreshold: LOYALTY_CONFIG.managerRedeemPointsThreshold,
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
 * Award points on collection. Idempotent per order_id.
 * Fetch loyalty BEFORE applying tier multiplier (fixes prior TDZ bug).
 */
async function awardPointsOnCollection(customerId, orderId, orderAmount, options = {}) {
  if (!customerId) {
    return { points_earned: 0, skipped: true, reason: 'no_customer' };
  }

  const brand = options.brand || LOYALTY_CONFIG.defaultBrand;
  const earnSource = options.earnSource || LOYALTY_CONFIG.defaultBrand;

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
    const basePointsEarned = Math.floor(Number(orderAmount) / LOYALTY_CONFIG.minSpendForPoint);
    if (basePointsEarned <= 0 && !options.allowZero) {
      return {
        points_earned: 0,
        skipped: true,
        reason: 'below_min_spend',
        current_points: loyalty.current_points,
        tier: loyalty.tier,
      };
    }

    const tierMultiplier = LOYALTY_CONFIG.tiers[loyalty.tier]?.multiplier || 1;
    const pointsEarned = Math.floor(basePointsEarned * tierMultiplier);

    if (pointsEarned <= 0) {
      return {
        points_earned: 0,
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
      description: 'Points earned for order collection',
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
module.exports.LOYALTY_CONFIG = LOYALTY_CONFIG;
module.exports.calculateTier = calculateTier;
module.exports.SOFT_PERKS = SOFT_PERKS;
