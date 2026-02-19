# SUPACLEAN POS - Complete Setup Guide

## Quick Start

1. **Install Node.js** (if not already installed)
   - Download from: https://nodejs.org/
   - Install version 14 or higher

2. **Navigate to project folder:**
   ```bash
   cd "C:\Users\HP\OneDrive\Desktop\TUNTCHIE\CURSOR PROJECTS"
   ```

3. **Install dependencies:**
   ```bash
   npm run install-all
   ```

4. **Start the application:**
   ```bash
   npm run dev
   ```

5. **Open browser:**
   - Go to: http://localhost:3000
   - The POS system should be running!

## Offline and online (backup & login)

You can use the app **offline** after logging in, and **online** for login and backup:

- **Login** requires the server to be reachable (online).
- After login, your session is cached. If the connection drops, the app can still open and you stay logged in.
- Actions that fail because of no connection (e.g. new order, receive payment) are **queued** and **synced automatically** when you are back online.

See **[OFFLINE_AND_ONLINE.md](OFFLINE_AND_ONLINE.md)** for full details.

## Features Overview

### ✅ What's Included:

1. **Customer Management**
   - Add new customers (name, phone, email, address)
   - Search customers by name or phone
   - View customer history

2. **Order Creation**
   - Select customer (or create new)
   - Choose service type
   - Enter garment details (type, color, quantity, weight)
   - Automatic price calculation
   - Generate and print receipts

3. **Order Management**
   - View all orders
   - Filter by status (pending, processing, ready, collected)
   - Update order status
   - Track order lifecycle
   - **Upload Stock Excel:** import existing (uncollected) stock. Key columns: **id**, **name**, **phone**, **amount**, **paid/not paid**. All uploaded rows are created as uncollected (Ready). See **[UPLOAD_STOCK_FORMAT.md](UPLOAD_STOCK_FORMAT.md)** for the full format.

4. **Collection System**
   - Search orders by receipt number
   - Verify receipt details
   - Mark orders as collected
   - Prevents collection of non-ready orders

5. **Cash Management**
   - Track daily transactions
   - View income summaries
   - Cash vs non-cash payments
   - Daily reports

6. **Reports & Analytics**
   - Daily sales summary
   - Service performance
   - Top customers
   - Date range reports

7. **SMS Notifications**
   - Automatic SMS when order is ready (requires SMS API setup)

8. **Cleaning Services (independent from laundry)**
   - **Separate customers** — cleaning customers are stored in `cleaning_customers` (not shared with laundry).
   - Create and print **quotations** and **invoices**; invoices have a default **due date of 30 days**. Use **Receive payment** to record income (cleaning cash flow).
   - **Expenses** — record cleaning-related purchases (rugs, soap, equipment, tools) in the Cleaning Services section.
   - **Financial summary** — view total income (payments), expenses and balance for cleaning only (no impact on laundry reports).
   - **Access** — only **administrators** see Cleaning Services by default; admins can enable the **Cleaning services** feature per branch in **Admin → Branches → Manage privileges**.
   - One-time setup: run **scripts/cleaning-documents-schema.sql** then **scripts/cleaning-services-full-schema.sql** in your PostgreSQL (e.g. Supabase) SQL editor.

## Default Services & Pricing

The system comes with pre-configured services:

1. **Wash, Dry & Fold**
   - Base: TSh 5,000
   - Per kg: TSh 2,000

2. **Pressing**
   - Base: TSh 3,000
   - Per item: TSh 1,000

3. **Express Service** (Same-day)
   - Base: TSh 8,000
   - Per kg: TSh 3,000

4. **Standard Wash**
   - Base: TSh 4,000
   - Per kg: TSh 1,500

**You can modify these prices** by editing the database or through API calls.

## SMS Setup (Africa's Talking)

SMS notifications (order ready, receipt, reminders, balance reminder) use **Africa's Talking**. Credentials are configured in `.env`:

- **SMS_API_KEY** – Your Africa's Talking API key (already set).
- **SMS_USERNAME** – Use `sandbox` for testing; for **production** replace with your Africa's Talking app username from the [dashboard](https://account.africastalking.com).
- **SMS_SENDER_ID** – Sender name (e.g. `SUPACLEAN`); request an alphanumeric sender in Africa's Talking for production.

**For production (live SMS):** In `.env` set `SMS_USERNAME` to your Africa's Talking app username (not `sandbox`), ensure you have credit, and remove or comment out `SMS_API_URL` so the app uses the live API.

For full details (sandbox URL, Twilio option, phone format), see **[SMS_INTEGRATION.md](SMS_INTEGRATION.md)**.

## Daily Closing Report – WhatsApp

When you **Reconcile Day** in Cash Management, the system tries to send the SUPACLEAN Daily Closing Report to the **Director WhatsApp number** (set in **Admin → Branches → Admin settings**).

- **Automatic send:** The server sends the message via **WhatsApp Business API** (Meta, Twilio, or 360dialog). No app opens on your computer; the director receives the message in their WhatsApp like a normal chat. To enable this, add WhatsApp API credentials to the server `.env` (e.g. for Meta: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`). See **FEATURES_ADDED.md** for provider setup.
- **If WhatsApp is not configured:** After reconciling, you’ll see a green banner: **"Open WhatsApp to send report"**. Click it to open WhatsApp (app or web) with the director’s chat and the report text pre-filled so you can send it yourself.

The system never “opens another app” for you when using the API; the message is sent from the server. Use the **Open WhatsApp** button when the API is not set up.

## Daily Workflow

1. **Opening the POS:**
   - Start the application
   - Dashboard shows today's summary

2. **Taking an Order:**
   - Click "New Order"
   - Search/select customer (or create new)
   - Select service type
   - Enter garment details
   - Review total amount
   - Create order → Receipt prints automatically

3. **Processing Orders:**
   - Go to "Orders" page
   - Find pending orders
   - Update status: Pending → Processing → Ready
   - When marked "Ready", SMS is sent automatically (if configured)

4. **Collection:**
   - Go to "Collection" page
   - Enter receipt number
   - Verify order details
   - Mark as collected

5. **End of Day:**
   - Check "Reports" page
   - Review daily summary
   - Check cash vs other payments
   - Print/export reports if needed

## Receipt Number Format

Receipts follow this format: `SC-YYMMDD-XXXX`
- Example: `SC-241201-1234` (December 1, 2024, order #1234)
- Customers use this to collect their laundry

## Troubleshooting

### Login fails: "Connection terminated due to connection timeout" or "Cannot connect to server"
This means the **backend is not running or not reachable**.

1. **Start the app correctly**
   - Run `npm run dev` from the project root. This starts both the backend (port 5000) and frontend (port 3000).
2. **Check the backend**
   - Open http://localhost:5000/api/health in a browser. You should see `{"status":"OK",...}`. If not, the backend is down.
3. **Default credentials**
   - Use **admin** / **admin123** for the default admin account.
4. **Branch manager / other users**
   - Ensure the user exists and is active. If you use PostgreSQL (`DATABASE_URL` in `.env`), ensure the database is running and reachable.

### Port Already in Use
If port 5000 or 3000 is in use:
- Change `PORT` in `.env` file
- Or stop other applications using those ports
- On Windows: `npm run kill-port` then `npm run dev`

### Database Issues
- Database is automatically created on first run
- Location: `database/supaclean.db`
- To reset: Delete the database file and restart

### Cannot Install Dependencies
- Make sure Node.js is installed correctly
- Try: `npm cache clean --force`
- Then: `npm install` in both root and `client/` folders

## Support

For issues or questions:
1. Check the console/terminal for error messages
2. Review the README.md file
3. Check database file permissions

## Receipt “Scan for Terms / Masharti” QR – so it loads when scanned

The QR code on receipts links to your **Terms (Masharti)** page. If receipts are printed from **localhost** (e.g. `http://localhost:3000`), scanning the QR on a phone will **not** load the page, because “localhost” on the phone means the phone itself.

**To fix:** use a **public URL** for the Terms link:

1. In the **client** folder, create or edit `.env` and set:
   ```bash
   REACT_APP_PUBLIC_ORIGIN=https://your-pos-domain.com
   ```
   Use your real public URL (no trailing slash), e.g. `https://pos.supaclean.com` or `https://your-server-ip:3000` if you use the IP.

2. Rebuild the client and deploy:
   ```bash
   cd client && npm run build
   ```

3. Ensure your server serves the app for the `/terms` path (e.g. SPA fallback to `index.html` for all routes). The included production server already does this.

After this, the QR on receipts will point to `https://your-pos-domain.com/terms`, and scanning from a phone will open the Terms (Masharti) page.

- **“Scan for details” QR** has been removed from New Order receipts; only the **“Scan for Terms / Masharti”** QR is printed.

## How to save changes to your deployed system

If your app is deployed on **Render** (or similar), use this flow to get your latest code and config live.

### 1. Code changes (features, fixes, UI)

1. In your project folder, open a terminal.
2. Stage and commit:
   ```bash
   git add .
   git commit -m "Describe your changes (e.g. Daily report to director, customer auto-select)"
   ```
3. Push to the branch Render uses (usually `main`):
   ```bash
   git push origin main
   ```
4. **Render**: If the service is connected to this repo, it will **auto-deploy** after the push. Check **Dashboard → your Web Service → Logs** to see the build. When it finishes, the live site has your changes.

   If auto-deploy is off: **Dashboard → your Web Service → Manual Deploy → Deploy latest commit**.

### 2. Config / secrets (e.g. new SMS API key, database URL)

Your **local** `.env` is not used on Render. To change what the **deployed** app uses:

1. Go to **https://dashboard.render.com** → your **Web Service** (e.g. `supaclean-pos`).
2. Open **Environment**.
3. Add or edit variables (e.g. `SMS_API_KEY`, `SMS_USERNAME`, `DATABASE_URL`). Use the same names as in your local `.env`.
4. Click **Save Changes**.
5. Trigger **Manual Deploy** → **Deploy latest commit** so the server restarts with the new values.

After that, the live system uses the updated code and/or config.

## Recent fixes (ready for deploy)

- **Reports page**: Fixed "column total_orders does not exist" by correcting SQL `HAVING` clauses in customer/loyalty reports (aliases are not allowed in `HAVING`; use expressions instead).
- **Reconcile button**: Fixed "Daily summary not found" by creating the daily cash summary for the selected date from calculated values when it does not exist, then marking it reconciled. You can reconcile without having to save the day first.
- **SQLite**: Migration added to add `branch_id` to `daily_cash_summaries` when missing (for multi-branch cash and reconcile).

## Before launch (multi-branch, scale, thermal POS)

If you run **multiple branches** or use **thermal POS** with item photos:

1. Run the SQL scripts in `scripts/`:
   - `add-order-item-photos.sql` — table for item photos (camera/thermal POS).
   - `indexes-multi-branch-scale.sql` — indexes for better performance with lots of data.
2. See **`PRE_LAUNCH_CHECKLIST.md`** for fixes, pagination, UI stabilisation, and a step-by-step go-live plan.

### Responsive interface (thermal POS, tablet, desktop)

The app adapts to screen size:

- **Small screens (e.g. thermal POS, phone):** Sidebar becomes a hamburger menu; content uses compact padding so the full UI fits. Use the **menu button** (top-left) to open the sidebar, then tap a page.
- **Tablet (e.g. iPad):** Same layout with comfortable spacing.
- **Desktop:** Full sidebar and wide content.

### Thermal and other printers

- **Receipts** are formatted for **80mm thermal** paper. When you complete an order or print from Collection, the print dialog opens — **choose your thermal printer** if it is not the default.
- If the receipt **preview is blank** or does not print: the app now waits for the receipt to render before opening the dialog. Ensure the thermal printer is installed and selected in the dialog. On some POS devices, set the thermal printer as the **default** printer so it is pre-selected.
- If the **print window is blocked**, the app falls back to an in-page print area; use **Print** and select your thermal printer.

## Next Steps

After setup:
1. Customize service prices
2. Set up SMS notifications
3. Train staff on the system
4. Test with a few sample orders
5. Go live!

---

**Good luck with SUPACLEAN!** 🎉
