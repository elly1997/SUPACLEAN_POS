# Phase 1: Cloud Infrastructure Setup Guide

## Overview
Set up cloud accounts and infrastructure for hosting your POS system.

**Time Required**: 2-3 hours  
**Cost**: Free (free tiers available for all services)

---

## Step 1.1: Set Up Supabase (Database) ⏱️ 30 minutes

### Actions:
1. **Go to https://supabase.com**
2. **Click "Start your project" or "Sign Up"**
3. **Sign up** (choose one):
   - GitHub (recommended - easiest)
   - Google account
   - Email/password
4. **Create New Project**:
   - Click "New Project"
   - Fill in:
     - **Organization**: Create new or use default
     - **Name**: `supaclean-pos`
     - **Database Password**: ⚠️ **SAVE THIS SECURELY** - you'll need it!
       - Use a strong password (mix of letters, numbers, symbols)
       - Save in password manager or secure note
     - **Region**: Choose closest to Tanzania
       - Options: Europe (West), US (East/West), Asia Pacific
       - Recommendation: **Europe (West)** for Tanzania
     - **Pricing Plan**: **Free** (upgrade later if needed)
5. **Click "Create new project"**
6. **Wait 2-3 minutes** for project setup

### Get Connection String:
1. Go to **Project Settings** (gear icon, bottom left)
2. Click **"Database"** section
3. Find **"Connection string"** → **"URI"** tab
4. **Copy the connection string** - looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxxx.supabase.co:5432/postgres
   ```
5. **Save this securely** - you'll add it to `.env` file later
   - Replace `[YOUR-PASSWORD]` with the password you created
   - The connection string should NOT have brackets

### ✅ Checklist:
- [ ] Supabase account created
- [ ] Project created (`supaclean-pos`)
- [ ] Database password saved securely
- [ ] Connection string copied and saved
- [ ] Project is "Active" (green status)

---

## Step 1.2: Set Up Railway (Backend Hosting) ⏱️ 20 minutes

### Actions:
1. **Go to https://railway.app**
2. **Click "Start a New Project"** or **"Sign Up"**
3. **Sign up** (GitHub recommended - easiest)
4. **Create New Project**:
   - Click **"New Project"**
   - Choose **"Deploy from GitHub repo"** (if you have code on GitHub)
     - OR **"Empty Project"** (if not using GitHub yet)
   - If GitHub: Select your repository
   - If Empty: Name it `supaclean-backend`

### Get Your Project Info:
1. Click on your project
2. Note your project name (visible at top)
3. You'll deploy here later

### ✅ Checklist:
- [ ] Railway account created
- [ ] Project created
- [ ] GitHub connected (optional but recommended)
- [ ] Project name noted

**Alternative: Render.com**
- If you prefer Render: https://render.com
- Similar process: Sign up → Create Web Service
- Free tier available

---

## Step 1.3: Set Up Vercel (Frontend Hosting) ⏱️ 15 minutes

### Actions:
1. **Go to https://vercel.com**
2. **Click "Sign Up"**
3. **Sign up** (GitHub recommended - easiest)
4. **Import Project** (for later):
   - Click **"Add New..."** → **"Project"**
   - You'll connect your repository here later
   - For now, just have the account ready

### ✅ Checklist:
- [ ] Vercel account created
- [ ] GitHub connected (if using)
- [ ] Account ready for deployment

**Alternative: Netlify**
- If you prefer Netlify: https://netlify.com
- Similar process
- Free tier available

---

## Step 1.4: Test Database Connection ⏱️ 30 minutes

### Goal:
Verify you can connect to Supabase from your computer.

### Option A: Use Supabase Web Interface (Easiest)
1. Go to Supabase Dashboard
2. Click **"SQL Editor"** (left sidebar)
3. Click **"New query"**
4. Type: `SELECT version();`
5. Click **"Run"** (or press Ctrl+Enter)
6. You should see PostgreSQL version info

✅ **If this works, you're good to go!** Skip Option B.

### Option B: Install PostgreSQL Client (Advanced)
If you want to test from command line:

1. **Download PostgreSQL** (includes psql):
   - Go to: https://www.postgresql.org/download/windows/
   - Download and install **PostgreSQL**
   - During installation, note the password for `postgres` user (or skip - we won't use local PostgreSQL)

2. **Test Connection** (PowerShell):
   ```powershell
   # Replace with your actual connection string
   psql "postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxxx.supabase.co:5432/postgres"
   ```
   - If connected: You'll see `postgres=#`
   - Type: `\q` to quit

### ✅ Checklist:
- [ ] Can access Supabase SQL Editor
- [ ] Can run queries (or tested psql connection)
- [ ] Connection works

---

## Step 1.5: Save Your Credentials ⏱️ 10 minutes

### Create a Secure Credentials File:

Create file: `CREDENTIALS.txt` (⚠️ **DO NOT COMMIT TO GIT**)

```
SUPACLEAN CLOUD MIGRATION CREDENTIALS
====================================
Created: 2026-01-13

SUPABASE:
---------
Project Name: supaclean-pos
Database Password: [YOUR-PASSWORD-HERE]
Connection String: postgresql://postgres:[PASSWORD]@db.xxx.supabase.co:5432/postgres
Dashboard URL: https://app.supabase.com/project/[PROJECT-ID]

RAILWAY:
--------
Project Name: [YOUR-PROJECT-NAME]
Dashboard URL: https://railway.app/project/[PROJECT-ID]

VERCEL:
-------
Project Name: [YOUR-PROJECT-NAME]
Dashboard URL: https://vercel.com/dashboard

IMPORTANT:
----------
- Keep this file SECURE
- DO NOT commit to Git
- Store in secure location
- Add to .gitignore
```

### Add to .gitignore:
Check if `.gitignore` exists in root, add:
```
CREDENTIALS.txt
*.env
.env.local
```

### ✅ Checklist:
- [ ] Credentials saved securely
- [ ] File NOT committed to Git
- [ ] .gitignore updated

---

## Phase 1 Summary

### ✅ Completed:
- [ ] Supabase account created
- [ ] Supabase project created
- [ ] Connection string saved
- [ ] Railway account created
- [ ] Vercel account created
- [ ] Database connection tested
- [ ] Credentials saved securely

### 📝 Notes:
- All services are on FREE tiers
- You can upgrade later if needed
- Keep credentials secure
- Connection strings will be added to `.env` file in Phase 3

### 🚀 Next: Phase 2 - Database Schema Migration

Once Phase 1 is complete, we'll:
1. Export your SQLite schema
2. Convert it to PostgreSQL
3. Import it to Supabase

---

## Troubleshooting

### Supabase Issues:
- **Project creation stuck**: Wait 5 minutes, refresh page
- **Can't find connection string**: Project Settings → Database → Connection string → URI
- **Connection fails**: Check password, ensure no brackets in connection string

### Railway Issues:
- **GitHub connection fails**: Try again, check GitHub permissions
- **Project not created**: Check email for confirmation

### Vercel Issues:
- **Sign up fails**: Try different sign-up method (GitHub vs Email)

### Connection Issues:
- **Can't connect to Supabase**: Check internet, firewall settings
- **psql not found**: Install PostgreSQL client (Option B above)

---

**Ready to continue?** Complete Phase 1, then let me know and we'll proceed to Phase 2!
