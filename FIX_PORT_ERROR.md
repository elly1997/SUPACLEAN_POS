# Fix "Port 5000 Already in Use" Error

## Quick Fix

If you get the error: `Error: listen EADDRINUSE: address already in use :::5000`

This means another instance of your server is already running on port 5000.

## Solution 1: Stop the Process (Easiest)

**In PowerShell, run:**
```powershell
# Find the process using port 5000
netstat -ano | findstr :5000

# Stop it (replace PID with the number you see)
Stop-Process -Id [PID] -Force
```

**Or use this one-liner:**
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess | Stop-Process -Force
```

## Solution 2: Close the Terminal

1. Find the terminal window where the server is running
2. Press `Ctrl + C` to stop it
3. Then restart with `npm.cmd run dev`

## Solution 3: Use a Different Port

If you want to use a different port, edit `server/index.js`:

```javascript
const PORT = process.env.PORT || 5001; // Change 5000 to 5001
```

Then update `client/package.json`:
```json
"proxy": "http://localhost:5001"
```

## Prevention

- Always stop your server with `Ctrl + C` before closing the terminal
- Check if port 5000 is free before starting: `netstat -ano | findstr :5000`
- Only run one instance of the server at a time
