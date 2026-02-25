# AGENTS.md

## Cursor Cloud specific instructions

### Overview
SUPACLEAN POS is a laundry/dry-cleaning Point of Sale system with an Express backend (port 5000) and React frontend (port 3000). See `README.md` for feature list and project structure.

### Database
- **All route handlers** import `server/database/query.js` (PostgreSQL) directly — not `server/database/db.js`.
- Local development requires PostgreSQL. The `.env` file must contain `DATABASE_URL=postgresql://supaclean:supaclean123@localhost:5432/supaclean`.
- The SQLite path (`server/database/init.js`) is only used for table initialization when `DATABASE_URL` is unset, but routes will fail because they use `query.js`. Always use PostgreSQL.
- Boolean columns (`is_active`, `is_enabled`, `is_reconciled`, `sms_notifications_enabled`) must be PostgreSQL `BOOLEAN` type — the code passes JS `true`/`false` values.

### Starting PostgreSQL
```bash
sudo pg_ctlcluster 16 main start
```

### Starting services
```bash
# Backend (port 5000) — uses nodemon in dev
cd /workspace && npx nodemon server/index.js

# Frontend (port 3000)
cd /workspace/client && BROWSER=none npm start
```
The `npm run dev` script in `package.json` uses PowerShell (`kill-ports.ps1`) and does **not** work on Linux. Start backend and frontend separately.

### Default credentials
- Username: `admin`, Password: `admin123`

### Lint
```bash
cd /workspace/client && npx eslint src/
```
There are ~22 pre-existing warnings (unused vars, missing hook deps). Zero errors.

### Tests
No automated tests exist in the codebase. `react-scripts test` exits with "no tests found".

### Build
```bash
cd /workspace/client && npm run build
```
Note: `CI=true` causes build to fail because CRA treats lint warnings as errors. Omit `CI=true` for local builds.

### Pre-launch migrations
Run `node scripts/pre-launch-sqlite.js` (SQLite) or `node scripts/run-pre-launch.js` (auto-detects DB) before first server start to create `order_item_photos` table and multi-branch indexes.

### Known gotcha — fresh SQLite init race condition
If you ever run without `DATABASE_URL` (SQLite mode), the first server start crashes due to a race condition: `createIndexes()` in `server/database/init.js` queues index creation before `migrateDatabase()` has added the `estimated_collection_date` column. Restarting the server 1-2 times or manually adding the column via `sqlite3` resolves it. This is not an issue when using PostgreSQL.
