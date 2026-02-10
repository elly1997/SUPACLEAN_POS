# Fix: IPv4 Connection Issue

## ✅ Problem Identified!

Your Supabase project shows: **"Not IPv4 compatible"**

This means:
- The **Direct connection** requires IPv6 (which your network doesn't support)
- You need to use the **Session Pooler** instead (works with IPv4)

---

## 🔧 Solution: Use Session Pooler Connection String

### Step 1: Get Session Pooler Connection String

1. **In Supabase Dashboard**:
   - You're already on the "Connect to your project" page
   - Look at the "Method" dropdown
   - **Change it from "Direct connection" to "Session pooler"**

2. **Copy the New Connection String**:
   - The connection string will change
   - It will look like: `postgresql://postgres.xxxxx:6543/postgres?pgbouncer=true`
   - Notice: It uses port `6543` (not `5432`)
   - Notice: It has `pgbouncer=true` parameter

3. **Copy the Full String**:
   - Click the copy button or select all and copy
   - Make sure to include the password: `postgresql://postgres:YOUR_PASSWORD@postgres.xxxxx:6543/postgres?pgbouncer=true`

---

### Step 2: Update .env File

1. **Open your `.env` file**

2. **Replace the DATABASE_URL line**:
   ```env
   # OLD (Direct connection - doesn't work with IPv4)
   DATABASE_URL=postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres
   
   # NEW (Session Pooler - works with IPv4)
   DATABASE_URL=postgresql://postgres:password@postgres.xxxxx.supabase.co:6543/postgres?pgbouncer=true
   ```

3. **Key Differences**:
   - Hostname: `postgres.xxx` (not `db.xxx`)
   - Port: `6543` (not `5432`)
   - Parameter: `?pgbouncer=true` at the end

4. **Save the file**

---

### Step 3: Test Connection

Run the test script:
```bash
node test-postgres-connection.js
```

**Expected output:**
```
✅ PostgreSQL connection successful!
Current time: 2026-01-13T...
✅ Query test successful!
Branches count: 1
```

---

## 📋 Quick Checklist

- [ ] Changed "Method" to "Session pooler" in Supabase
- [ ] Copied the Session Pooler connection string
- [ ] Updated DATABASE_URL in .env file
- [ ] Connection string has port 6543
- [ ] Connection string has `?pgbouncer=true` parameter
- [ ] Tested connection successfully

---

## 🔍 How to Verify

After updating, check your connection string format:
```bash
node -e "require('dotenv').config(); const url = process.env.DATABASE_URL; console.log('Hostname:', url.match(/@([^:]+)/)?.[1]); console.log('Port:', url.match(/:(\d+)\//)?.[1]); console.log('Has pgbouncer:', url.includes('pgbouncer=true') ? '✅' : '❌');"
```

Should show:
- Hostname: `postgres.xxx` (not `db.xxx`)
- Port: `6543` (not `5432`)
- Has pgbouncer: ✅

---

## ⚠️ Important Notes

1. **Session Pooler vs Direct Connection**:
   - Session Pooler: Works with IPv4, uses port 6543, has connection limits
   - Direct Connection: Requires IPv6, uses port 5432, no connection limits
   - For development, Session Pooler is perfect!

2. **Connection Limits**:
   - Session Pooler has connection limits (usually fine for development)
   - If you need more connections later, you can purchase IPv4 add-on

3. **Production**:
   - For production, consider:
     - Using Session Pooler (recommended for most apps)
     - Or purchasing IPv4 add-on for direct connection

---

## 🆘 Still Not Working?

If Session Pooler connection still fails:

1. **Verify connection string**:
   - Check it has `postgres.xxx` (not `db.xxx`)
   - Check port is `6543`
   - Check it has `?pgbouncer=true`

2. **Check password**:
   - Make sure password is correct
   - Special characters might need URL encoding

3. **Verify project status**:
   - Check project is "Active" in Supabase

4. **Test network**:
   - Try accessing Supabase dashboard in browser
   - Check internet connection

---

**Ready?** Switch to Session Pooler and update your `.env` file!
