# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

SUPACLEAN POS is a full-stack POS system for a laundry/dry cleaning business. See `README.md` for feature details.

- **Backend**: Node.js/Express on port 5000 (`server/index.js`)
- **Frontend**: React (CRA) on port 3000 (`client/`)
- **Database**: PostgreSQL (required for all API routes — see below)

### Database: PostgreSQL required

All API routes import `server/database/query.js` directly, which always creates a `pg.Pool`. The SQLite fallback in `server/database/db.js` only initializes the schema but is **not used by any route**. You must have PostgreSQL running and `DATABASE_URL` set in `.env` for the API to work.

Local dev `.env` example:
```
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supaclean_pos
```

### Starting PostgreSQL

```bash
sudo pg_ctlcluster 16 main start
```

### First-time DB setup (schema + seed)

If the database `supaclean_pos` doesn't exist yet, create it and run the full schema. The schema is not stored as a standalone migration file — it was derived from `server/database/init.js` (SQLite) converted to PostgreSQL syntax. The key tables include: `customers`, `services`, `orders`, `branches`, `users`, `user_sessions`, `transactions`, `expenses`, `settings`, etc.

After creating the schema, seed a default branch, admin user (username: `admin`, password: `admin123`), and services.

### Running services

Standard commands per `package.json`:

| Task | Command |
|------|---------|
| Install deps | `npm run install-all` |
| Backend | `node server/index.js` (or `npx nodemon server/index.js`) |
| Frontend | `cd client && BROWSER=none npm start` |
| Lint | `cd client && npx eslint src/` |
| Tests | `cd client && CI=true npx react-scripts test --watchAll=false --passWithNoTests` |
| Build | `cd client && npm run build` |

Note: `npm run dev` and `npm run server` use PowerShell scripts for port-killing which don't work on Linux. Start backend and frontend separately instead.

### Known gotchas

1. **`is_active` column type**: The `is_active` columns are `INTEGER` (0/1) in PostgreSQL, not `BOOLEAN`. Some route code may pass `true`/`false` instead of `1`/`0` — if you see "invalid input syntax for type integer: 'true'", fix the value being passed.
2. **SQLite first-run race condition**: If you try to use SQLite (no `DATABASE_URL`), the first server start will crash due to async table creation races. The tables get created but index creation fails on not-yet-created tables. A second start usually works, but PostgreSQL is the recommended path.
3. **No automated test files**: The project has zero test files. `react-scripts test` passes only with `--passWithNoTests`.
4. **Default admin credentials**: `admin` / `admin123` (created during DB seeding).
