# Phase 3: Database Connection - Quick Start Guide

## ✅ What's Already Done
- PostgreSQL package (`pg`) installed ✅
- Query helper functions created ✅
- Schema imported to Supabase ✅

## 🎯 What You Need to Do Now

### Step 1: Get Supabase Connection String (5 minutes)

1. **Go to Supabase Dashboard**:
   - https://app.supabase.com
   - Select your project

2. **Get Connection String**:
   - Click "Project Settings" (gear icon in left sidebar)
   - Click "Database" in settings menu
   - Scroll to "Connection string"
   - Select "URI" tab
   - Copy the connection string (looks like):
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres
     ```

3. **Get Your Password**:
   - If you don't remember your database password:
     - Go to "Database" → "Connection string"
     - Click "Reset database password" if needed
     - Or check your saved credentials from Phase 1

---

### Step 2: Create .env File (5 minutes)

1. **Create `.env` file** in project root:
   ```bash
   # In your project root directory
   ```

2. **Add these variables**:
   ```env
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD_HERE@db.xxxxx.supabase.co:5432/postgres
   PORT=5000
   NODE_ENV=development
   CLIENT_URL=http://localhost:3000
   JWT_SECRET=generate-a-random-secret-here
   ```

3. **Replace values**:
   - Replace `YOUR_PASSWORD_HERE` with your actual Supabase database password
   - Replace `xxxxx` with your actual Supabase project reference
   - Generate JWT_SECRET (see below)

4. **Generate JWT_SECRET**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the output and paste as `JWT_SECRET` value.

---

### Step 3: Test Connection (2 minutes)

1. **Run test script**:
   ```bash
   node test-postgres-connection.js
   ```

2. **Expected output**:
   ```
   ✅ PostgreSQL connection successful!
   Current time: 2026-01-13T...
   ✅ Query test successful!
   Branches count: 1
   ```

3. **If it works**: ✅ Phase 3 Step 1-3 complete!

4. **If it fails**: Check:
   - `.env` file exists
   - `DATABASE_URL` is correct (with real password)
   - No typos in connection string
   - Supabase project is active

---

## 📋 Quick Checklist

- [ ] Supabase connection string copied
- [ ] `.env` file created in project root
- [ ] `DATABASE_URL` filled in (with real password)
- [ ] `JWT_SECRET` generated and added
- [ ] Connection test passes (`node test-postgres-connection.js`)

---

## 🚀 Once This Works

We'll move to:
- **Step 4**: Update database connection file
- **Step 5**: Test with actual routes

**Ready?** Get your connection string and create the `.env` file!
