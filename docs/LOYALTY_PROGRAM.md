# Loyalty Program — Tokens

Supaclean loyalty units are called **tokens**.

## Earn
- **1 token per TSh 20,000** spent.
- Awarded when a receipt is **collected** and **paid_full**.
- Tier multipliers on collection: Bronze 1×, Silver 1.1×, Gold 1.25×, Platinum 1.5×.
- Idempotent per `order_id`. Void reverses earn for that order.

## Redeem
- Minimum **50 tokens**.
- **1 token = TSh 500** (laundry discount, pickup/delivery, or partner service).
- Available balance drops when redeemed; lifetime tokens stay for tiering.
- Redeeming **more than 100 tokens** needs a manager.

## Display
- Show **available tokens** and **lifetime tokens** (tier progress).
- Month/year earn breakdown stays on **Reports → Customers / Loyalty** only.

## Tiers (lifetime tokens)
| Tier | Lifetime tokens | Step |
|------|-----------------|------|
| Bronze | 0+ | — |
| Silver | **51+** | +51 from Bronze |
| Gold | **86+** | +35 from Silver |
| Platinum | **136+** | +50 from Gold |

## API
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/loyalty/customer/:id` | Available + lifetime tokens, tier |
| GET | `/api/loyalty/customer/:id/transactions` | History |
| POST | `/api/loyalty/redeem` | Deducts available tokens |
| GET | `/api/loyalty/tiers` | Earn + redeem + tier config |
