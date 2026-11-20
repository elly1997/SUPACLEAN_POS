# Frembo Enterprises Loyalty Retention Report

**Audience:** Leadership and POS maintainers  
**Scope:** Supaclean laundry POS as the earn engine; Frembo umbrella brands for soft perks and awareness  
**Model:** Soft subscription (service/partner perks) + unified Frembo points wallet  
**Goal:** Retain laundry customers and introduce sister brands without a costly cash club

---

## 1. Current state audit (POS)

| Area | Status | Impact |
|------|--------|--------|
| Auto-award on collect | Broken (TDZ bug in `awardPointsOnCollection`) | Points rarely credited when laundry is collected |
| Manual earn API | Works but no tier multiplier | Staff workaround only |
| Redeem | Deducts points; did not apply checkout discount | Cashiers could not use points at till |
| Reports | Base `floor(amount/20000)` only | Understates earned points vs ledger |
| Docs | Platinum 5,000 vs code 7,500; redeem “applies to orders” | Staff confusion |
| SMS marketing | Tag / all-audience only | No loyalty or dormancy segments |
| Cross-brand wallet | Not present | Laundry-only ledger |

**Conclusion:** Loyalty was not intact for tracking or reporting. Phase 0 repairs laundry truthfulness; later phases add soft perks, SMS segments, and a Frembo-ready wallet.

---

## 2. Retention goals

1. Keep the share of customers already washing at Supaclean (reduce dormancy).
2. Increase visit frequency among Bronze/Silver customers.
3. Convert high-value laundry customers into awareness visits for:
   - **Supafundi** (hardware)
   - **Frembo Homes & serviced apartments**
   - **Supaclean Car wash & detailing (Moshono)**
   - **Dedicated pickup service**
   - **Giftopia Groove**
4. Cap cash giveaways so laundry margin stays healthy; fund retention with soft perks and sister-brand CAC savings.

**Economics target:** outstanding points liability ≤ ~1–2% of laundry revenue; cash redeem capped at 10% of ticket subtotal.

---

## 3. Program design (B + C)

### Unified Frembo wallet (C)

One `loyalty_points` balance per customer. Earn and burn may carry a `brand` / `earn_source` (default `supaclean_laundry`). Sister brands can later post earn events or redeem vouchers against the same wallet.

### Soft subscription (B) — profitability shield

Higher tiers unlock **service and partner perks** first. Cash discounts at laundry remain optional, capped, and till-controlled.

### Operating rules (suggested)

| Rule | Specification |
|------|----------------|
| Earn (laundry) | Whole tokens: 1 per **20,000 TSh paid cash on a single receipt** (40,000 = 2; no decimals; not pooled) on **collected + paid_full** |
| Tier thresholds | Bronze 0 / Silver 500 / Gold 2,000 / Platinum **7,500** lifetime points |
| Tier earn boost | Bronze 1×, Silver **1.1×**, Gold **1.25×**, Platinum **1.5×** |
| Upgrade bonus (one-time) | Silver +25, Gold +50, Platinum +100 |
| Soft perks | Gold: 1 free pickup / month. Platinum: pickup + quarterly car-wash voucher + partner intro SMS |
| Cash redeem | 10 points = 10,000 TSh at New Order only; multiples of 10; **max 10% of subtotal**; manager approval above 20 points |
| Expiry | Points with no earn/redeem for **18 months** lapse after warning SMS |
| Fraud | Idempotent earn per `order_id`; void reverses earned points |
| Partner earn (until partner POS) | 0.5× laundry rate when staff grants partner spend; vouchers via SMS / staff tag |

### Example journeys

1. **Dormant laundry (60 days)** → SMS: “You have X points — book a wash or claim a free pickup if Gold+” → optional car-wash CTA in Moshono.  
2. **Near Gold** → SMS: “Y points to Gold unlocks free monthly pickup.”  
3. **Gift season** → Giftopia Groove wrap offer tagged to Gold/Platinum phones.  
4. **Homes interest** → Tag `homes-interest` + SMS tour credit for Platinum.

---

## 4. SMS + loyalty playbook

### Segments

| Segment | Filter |
|---------|--------|
| Dormant 30 / 60 / 90 | Last collected order older than N days |
| Near-tier upgrade | Lifetime within 10% of next tier |
| Gold / Platinum | `tier` in (`Gold`, `Platinum`) |
| High balance unused | `current_points >= 20` and no redeem in 90 days |
| Tag audiences | `carwash-interest`, `homes-interest`, `supafundi`, `giftopia`, `pickup` |

### Template themes

- Points balance reminder  
- Perk unlock (Gold / Platinum)  
- Sister-brand CTA (Car wash, Homes, Supafundi, Giftopia, pickup)  
- Always respect `sms_notifications_enabled` and global SMS kill switch  

### Awareness without cost

SMS drives **footfall to sister brands** using soft perks and intros, not laundry cash discounts. Soft perk COGS (pickup slot, wash voucher) is planned and capped; cash redeem remains the exception.

---

## 5. Cross-brand channel map

| Brand | Earn (now / later) | Burn / awareness (now) |
|-------|--------------------|-------------------------|
| Supaclean laundry | Primary earn in POS | Capped cash redeem + Soft perks |
| Dedicated pickup | — | Gold/Platinum free pickup credits |
| Car wash Moshono | Manual / Phase 2 partner earn | Quarterly Platinum voucher + SMS |
| Supafundi | Phase 2 | Promo SMS + staff voucher codes |
| Frembo Homes | Phase 2 | Tour / stay credit SMS for top tier |
| Giftopia Groove | Phase 2 | Seasonal wrap / gift credit SMS |

---

## 6. KPIs

| KPI | Definition |
|-----|------------|
| Retention | % of customers with ≥1 collect in prior 90 days who collect again in next 90 |
| Repeat order % | Customers with 2+ receipts / active customers |
| Earn vs burn | Points earned / redeemed in period (from `loyalty_transactions`) |
| Soft-perk redemption | Pickup / voucher claims vs eligible tier customers |
| SMS conversion | Customers who ordered within 14 days of campaign |
| Liability % | Sum of `current_points` × TSh value / laundry revenue |
| Redeemed ticket margin | Average margin on tickets with loyalty cash redeem |

---

## 7. Phased rollout

| Phase | What | Staff impact |
|-------|------|--------------|
| **0** | Fix awards, redeem at New Order, truthful reports | Cashiers see points; can apply capped redeem |
| **1** | Soft perk catalog + SMS segments + Frembo templates | Admin runs dormancy / tier campaigns |
| **2** | Wallet brand fields + partner grant / vouchers | Sister brands can receive vouchers |
| **3** | Expiry job, manager PIN for large redeem, KPI tiles | Controls liability |

**Till SOP (Phase 0+):** Select customer → note LoyaltyBadge → optional redeem (multiples of 10, ≤10% of subtotal) → complete order → on collect + paid full, points credit automatically.

---

## 8. What success looks like

- Collect + paid_full reliably credits points; Reports match `loyalty_transactions`.
- Cashiers see tier/points and apply capped redeem at New Order.
- SMS can target loyalty and dormancy segments with Frembo CTAs.
- Soft perks retain customers; sister brands gain awareness without a cash club.
