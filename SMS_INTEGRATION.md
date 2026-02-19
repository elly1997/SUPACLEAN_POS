# SMS Integration – Send SMS to Customers via a Phone Carrier

The POS can send SMS to customers (order ready, collection reminder, receipt, balance reminder) using a real SMS provider. Two options are supported: **Africa's Talking** (recommended for Tanzania) and **Twilio**.

---

## How it works in the app

- **New order created & receipt printed** → Order confirmation SMS sent automatically to the customer (receipt number, amount, est. ready date). Disable with `SEND_ORDER_CONFIRMATION_SMS=false` in `.env`.
- **Order marked “Ready”** → SMS sent automatically (if configured and customer has SMS enabled).
- **Send receipt SMS** → From Orders or after creating an order (optional; detailed receipt text).
- **Collection reminder** → From Orders or Collection page.
- **Balance reminder** → From Customers page.

If no SMS provider is configured, messages are **logged only** (no real SMS sent).

---

## Option 1: Africa's Talking (recommended for Tanzania)

1. **Sign up**
   - Go to [https://africastalking.com](https://africastalking.com) and create an account.
   - For testing, use the **sandbox**; for production, go live and add credit.

2. **Get credentials**
   - **Dashboard** → **Settings** (or **API**):
     - **Username** (e.g. `sandbox` for sandbox).
     - **API Key** (generate if needed).
   - **Sender ID** (optional): request an alphanumeric sender (e.g. `SUPACLEAN`) for production; sandbox may use a shortcode.

3. **Environment variables**
   - **Local:** add to `.env` in the project root (Africa's Talking API key and username are already in `.env`).
   - **Render:** Service → **Environment** → Add each variable.

   | Variable        | Value                                                                 | Required |
   |-----------------|-----------------------------------------------------------------------|----------|
   | `SMS_PROVIDER`  | `africastalking` (or leave unset; this is the default)                | No       |
   | `SMS_API_KEY`   | Your Africa's Talking API key                                         | Yes      |
   | `SMS_USERNAME`  | `sandbox` for testing; your Africa's Talking app username for production | Yes    |
   | `SMS_API_URL`   | Leave empty for live; for sandbox use: `https://api.sandbox.africastalking.com/version1/messaging` | No (optional) |
   | `SMS_SENDER_ID` | Sender name (e.g. `SUPACLEAN`); may be ignored in sandbox              | No       |

4. **Restart / redeploy**
   - Local: restart the server.
   - Render: save env vars and **Manual Deploy** so the new build uses them.

---

## Option 2: Twilio

1. **Sign up**
   - Go to [https://www.twilio.com](https://www.twilio.com) and create an account.
   - Add a **phone number** (or use trial number) and ensure you have credit.

2. **Get credentials**
   - **Console** → **Account** → **API keys & tokens**:
     - **Account SID**
     - **Auth Token**
   - **Phone Numbers** → **Manage** → **Active numbers**: note your **Twilio number** (e.g. `+1...` or a local number if available for Tanzania).

3. **Environment variables**
   - **Local:** add to `.env`.
   - **Render:** Service → **Environment** → Add each variable.

   | Variable              | Value                          | Required |
   |-----------------------|--------------------------------|----------|
   | `SMS_PROVIDER`        | `twilio`                       | Yes      |
   | `TWILIO_ACCOUNT_SID`  | Your Twilio Account SID        | Yes      |
   | `TWILIO_AUTH_TOKEN`   | Your Twilio Auth Token         | Yes      |
   | `TWILIO_PHONE_NUMBER` | Your Twilio number (e.g. +1234567890) | Yes  |

4. **Restart / redeploy**
   - Same as for Africa's Talking.

---

## Phone number format

- Numbers are normalized to **international format** (e.g. `+255...` for Tanzania).
- If the customer’s number is stored as `0712 345 678`, the system sends to `+255712345678`.

---

## Deployed app (Render)

1. Open your **Web Service** on Render → **Environment**.
2. Add the variables for your chosen provider (see tables above).
3. **Save**.
4. Trigger a **Manual Deploy** (or push a commit) so the server restarts with the new env.

SMS will then be sent when the app triggers notifications (order ready, reminders, etc.), as long as the customer has a phone number and SMS is enabled for them.

---

## Testing

- **Africa's Talking sandbox:** use their test numbers and sandbox URL; no real SMS is sent to arbitrary numbers until you go live and add credit.
- **Twilio trial:** you can only send to verified numbers until you upgrade.
- With **no API key** set, the app logs the message and does not call any provider (useful for local testing without sending real SMS).

---

## What can stop SMS (checklist)

If SMS is not sending, work through this list:

1. **Environment variables**
   - **SMS_API_KEY** and **SMS_USERNAME** must be set (for Africa's Talking). Call **GET /api/sms-status** (e.g. `http://localhost:5000/api/sms-status`) to see if the server sees them (`configured: true`).
   - Restart the server after changing `.env`.

2. **Africa's Talking account**
   - **Credit:** Production SMS only works if your Africa's Talking account has **airtime/SMS balance**. Top up in the dashboard.
   - **Sandbox vs production:** Use **SMS_USERNAME=sandbox** and **SMS_API_URL=https://api.sandbox.africastalking.com/version1/messaging** for testing (sandbox only sends to their test numbers). For real SMS use your **app username** and leave **SMS_API_URL** unset (live API).
   - **API key and username must match:** Use a production key with production username; use sandbox key with `sandbox` username.

3. **Sender ID (production)**
   - Alphanumeric sender (e.g. **SUPACLEAN**) often must be **registered/approved** for your country (e.g. Tanzania). If it isn’t, the API may reject the send. In the Africa's Talking dashboard, check **SMS** → **Sender IDs** and request/activate one if needed.

4. **Customer**
   - Customer must have a **phone number** and **SMS notifications** enabled (customer profile). Missing or disabled = no send.

5. **Server logs**
   - When you trigger an SMS (e.g. mark order **Ready**), watch the **terminal where the Node server runs**. You’ll see either success (`Ready notification sent via sms to +255...`) or the real error (`Africa's Talking SMS failed: ...`). That message is the main clue.

---

## Where SMS is sent from in code

- **Server:** `server/utils/sms.js` – `sendSMS()`; supports Africa's Talking and Twilio based on `SMS_PROVIDER` and env vars.
- **Notifications:** `server/utils/notifications.js` – uses `sendSMS()` for “ready”, “reminder”, “confirmation”, etc.
- **Routes:** e.g. order ready, send receipt SMS, send reminder – all go through the same SMS layer.

To add another carrier, add a new branch in `server/utils/sms.js` (e.g. `if (provider === 'yourcarrier')`) and call the carrier’s HTTP API, then set the env vars and document them in this file.
