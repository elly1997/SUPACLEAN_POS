# Simple Installation Guide - SUPACLEAN POS

## Step-by-Step Instructions (Easy to Follow!)

### Step 1: Open PowerShell or Command Prompt
- Press `Windows Key + R`
- Type: `powershell` or `cmd`
- Press Enter

### Step 2: Go to Your Project Folder
Copy and paste this command, then press Enter:
```
cd "C:\Users\HP\OneDrive\Desktop\TUNTCHIE\CURSOR PROJECTS"
```

### Step 3: Install All Dependencies (ONE COMMAND!)

**If using PowerShell, use:**
```
c
```

**If using Command Prompt (cmd), use:**
```
npm run install-all
```

**This will:**
- Install backend dependencies (takes 1-2 minutes)
- Install frontend dependencies (takes 2-3 minutes)
- Total time: About 3-5 minutes

### Step 4: Start the Program
After installation is complete:

**If using PowerShell, use:**
```
npm.cmd run dev
```

**If using Command Prompt (cmd), use:**
```
npm run dev
```

**This will:**
- Start the backend server (port 5000)
- Start the frontend app (port 3000)
- Open your browser automatically to http://localhost:3000

---

## What to Expect

### During Installation:
- You'll see lots of text scrolling
- This is NORMAL - it's installing packages
- Wait until you see "added X packages" messages
- Don't close the window!

### When Starting:
- Two windows might open (one for server, one for client)
- You'll see messages like "Server running on port 5000"
- Your browser should open automatically
- If not, manually go to: http://localhost:3000

---

## Troubleshooting

### If you get "npm is not recognized":
1. Node.js is not installed
2. Download from: https://nodejs.org/
3. Install it, then restart your computer
4. Try again from Step 2

### If installation fails:
1. Make sure you're in the correct folder (Step 2)
2. Try running: `npm install` first
3. Then: `cd client && npm install`
4. Then: `npm run dev`

### If the program won't start:
1. Make sure nothing else is using ports 5000 or 3000
2. Close any other programs
3. Try restarting your computer
4. Run `npm run dev` again

---

## Quick Reference

**Install everything:**
```
npm run install-all
```

**Start the program:**
```
npm run dev
```

**Stop the program:**
- Press `Ctrl + C` in the terminal window
