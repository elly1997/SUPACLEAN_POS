# How to Start the Application

## After Migration - Starting the Servers

### 🚀 Quick Start (Recommended)

**Start both backend and frontend together:**
```bash
npm run dev
```

This command will:
- Start backend server on `http://localhost:5000`
- Start frontend React app on `http://localhost:3000`
- Automatically open your browser to `http://localhost:3000`

---

### 📋 Alternative Methods

#### Option 1: Start Servers Together
```bash
npm run dev
```
- ✅ Easiest method
- ✅ Starts both servers at once
- ✅ Opens browser automatically

#### Option 2: Start Frontend Only (if backend already running)
```bash
cd client
npm start
```
- Use this if backend is already running
- Frontend will start on `http://localhost:3000`

#### Option 3: Start Servers Separately

**Terminal 1 (Backend):**
```bash
npm run server
```
- Backend runs on `http://localhost:5000`

**Terminal 2 (Frontend):**
```bash
cd client
npm start
```
- Frontend runs on `http://localhost:3000`

---

## 🌐 Access the Application

Once both servers are running:

1. **Open your browser**
2. **Navigate to:** `http://localhost:3000`
3. **Login page should appear**

---

## ✅ Verify Servers Are Running

### Check Backend (Port 5000)
- Open: `http://localhost:5000/api/health`
- Should see: `{"status":"OK","message":"SUPACLEAN POS API is running"}`

### Check Frontend (Port 3000)
- Open: `http://localhost:3000`
- Should see: Login page or dashboard (if logged in)

---

## 🔧 Troubleshooting

### Port Already in Use

If port 5000 is in use:
```bash
npm run kill-port
npm run server
```

If port 3000 is in use:
- React will automatically ask to use a different port
- Or kill the process using port 3000

### Backend Not Starting

1. Check `.env` file exists
2. Verify `DATABASE_URL` is set correctly
3. Check PostgreSQL connection: `node test-postgres-connection.js`

### Frontend Not Starting

1. Make sure you're in the `client` directory (if starting separately)
2. Check `node_modules` installed: `npm install` (in client directory)
3. Check for errors in terminal

### Cannot Connect to Server

- Make sure backend is running on port 5000
- Check browser console (F12) for errors
- Verify `CLIENT_URL` in `.env` matches frontend URL

---

## 📝 Current Server Status

After migration to PostgreSQL:

- ✅ Backend: Uses PostgreSQL (via Supabase)
- ✅ Database connection: Configured in `.env`
- ✅ Routes: All converted to async/await
- ✅ SQL queries: Converted to PostgreSQL syntax

**No changes needed** - just start the servers as normal!

---

## 🎯 Next Steps After Starting

1. **Login** with your admin credentials
2. **Test creating orders** (most critical test)
3. **Test customer search**
4. **Test payment processing**
5. **Check browser console** for any errors (F12)
6. **Check server logs** for any database errors

---

## 💡 Pro Tips

- Keep terminal windows open to see logs
- Watch for errors in real-time
- Use browser DevTools (F12) to monitor network requests
- Check both browser console AND server logs for errors

---

**Ready to test! Start with `npm run dev` and navigate to `http://localhost:3000`**
