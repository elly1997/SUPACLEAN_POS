# Loyalty Program — Tokens

Supaclean loyalty units are called **tokens**.

## Earn
- **1 token per TSh 20,000** spent.
- Awarded when a receipt is **collected** and **paid_full**.
- Tier multipliers on collection: Bronze 1×, Silver 1.1×, Gold 1.25×, Platinum 1.5×.
- Idempotent per `order_id` (no double credit). Void reverses earn for that order.

## Redeem
- Minimum **50 tokens**.
- **1 token = TSh 500** value (laundry discount, pickup/delivery credit, or partner/business service of that value).
- Discount cannot exceed the order subtotal.
- Redeeming **more than 100 tokens** needs a manager.

## Visibility
- New Order: selected customer shows available tokens, earned this month, earned this year, lifetime.
- Customers → Loyalty: same balances + transaction history.
- Orders / badges: tier + token balance (`tok`).

## Tiers (lifetime tokens)
| Tier | Lifetime tokens |
|------|-----------------|
| Bronze | 0+ |
| Silver | 500+ |
| Gold | 2,000+ |
| Platinum | 7,500+ |

## API
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/loyalty/customer/:id` | Balance, month/year earn, redeem rules |
| GET | `/api/loyalty/customer/:id/transactions` | History |
| POST | `/api/loyalty/redeem` | Checkout / counter redeem |
| GET | `/api/loyalty/tiers` | Earn + redeem config |
