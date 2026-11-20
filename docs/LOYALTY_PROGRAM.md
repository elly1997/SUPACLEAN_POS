# Loyalty Program — Configuration

Frembo Enterprises umbrella wallet. Laundry (Supaclean) is the primary earn engine. Soft perks protect margin; cash redeem is capped. See [FREMBO_LOYALTY_RETENTION_REPORT.md](./FREMBO_LOYALTY_RETENTION_REPORT.md) for strategy.

## Points system

### Earning
- **1 point per 20,000 TSh** spent (base).
- Awarded only when a receipt is **collected** and **paid_full**.
- Tier multipliers (on collection): Bronze 1×, Silver 1.1×, Gold 1.25×, Platinum 1.5×.
- One-time upgrade bonuses: Silver +25, Gold +50, Platinum +100.
- Earn is **idempotent per order_id** (no double credit).
- Void reverses earned points for that order.

### Cash redemption (New Order)
- Minimum **10 points**; multiples of 10 only.
- **10 points = 10,000 TSh** discount.
- Discount capped at **10% of order subtotal**.
- Redeeming **more than 20 points** requires manager approval (`canManageCustomers` or admin).
- Must pass `orderId` when redeeming at checkout so the ledger links to the order.

### Soft subscription perks (by tier)
- **Gold:** 1 free dedicated pickup credit per calendar month.
- **Platinum:** Gold pickup + quarterly car-wash voucher (Moshono) + partner intro SMS eligibility.
- Soft perks are the preferred burn path; cash redeem is optional.

### Tiers (lifetime points)
| Tier | Lifetime points |
|------|-----------------|
| Bronze | 0+ |
| Silver | 500+ |
| Gold | 2,000+ |
| Platinum | **7,500+** |

### Expiry
- Points with no earn or redeem activity for **18 months** may lapse after a warning SMS (Phase 3 job).

## Reports

**Reports → Top Customers — Loyalty**

- Monthly points earned from **`loyalty_transactions`** (not a re-estimate from order totals).
- Current points, lifetime points, tier.
- Liability and redeem summary on the loyalty panel.

## Database

### loyalty_points
- `customer_id`, `current_points`, `lifetime_points`, `tier`

### loyalty_transactions
- `customer_id`, `order_id`, `transaction_type` (`earned` / `redeemed` / `reversed` / `adjustment` / `perk`)
- `points`, `description`, `balance_after`
- `brand` / `earn_source` (default `supaclean_laundry`) for Frembo wallet

### loyalty_perks (soft subscription catalog)
- Tier-keyed perk definitions (pickup, partner vouchers)

## API (summary)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/loyalty/customer/:id` | Balance, tier, next tier, soft perks |
| GET | `/api/loyalty/customer/:id/transactions` | History |
| POST | `/api/loyalty/earn` | Staff-gated; prefers collection auto-award |
| POST | `/api/loyalty/redeem` | Checkout redeem with caps |
| GET | `/api/loyalty/rewards` | Catalog rewards |
| GET | `/api/loyalty/tiers` | Tier config |
| GET | `/api/loyalty/perks` | Soft perk catalog |
| POST | `/api/loyalty/partner-grant` | Admin partner earn / voucher (Phase 2) |

## Till SOP

1. Pull up customer — LoyaltyBadge shows tier + points.
2. Optionally redeem points at New Order (capped).
3. On collect + paid full — points credit automatically.
4. Gold/Platinum — offer soft perks (pickup / partner voucher) when available.

## Notes

1. Points are awarded on **collection**, not order create.
2. Only **paid_full** receipts earn.
3. Orders under 20,000 TSh earn 0 base points (before multiplier).
4. Tiers use **lifetime** points; redeem does not lower tier.
5. Partner brands earn at **0.5×** laundry rate until their POS is online.
