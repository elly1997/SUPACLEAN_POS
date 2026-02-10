# Fix PowerShell Error - Simple Solution

## The Problem
PowerShell is blocking npm from running. This is a Windows security setting.

## EASY FIX - Choose ONE method:

---

## Method 1: Use Command Prompt Instead (EASIEST!)

1. **Close PowerShell**
2. **Open Command Prompt:**
   - Press `Windows Key + R`
   - Type: `cmd`
   - Press Enter

3. **Go to your project:**
   ```
   cd "C:\Users\HP\OneDrive\Desktop\TUNTCHIE\CURSOR PROJECTS"
   ```

4. **Install dependencies:**
   ```
   npm run install-all
   ```

5. **Start the program:**
   ```
   npm run dev
   ```

**This should work without any errors!**

---

## Method 2: Fix PowerShell (If you want to use PowerShell)

1. **Open PowerShell as Administrator:**
   - Press `Windows Key`
   - Type: `powershell`
   - Right-click on "Windows PowerShell"
   - Click "Run as administrator"

2. **Run this command:**
   ```
   Set-ExecutionPolicy RemoteSigned
   ```
   - Type `Y` and press Enter when asked

3. **Close the administrator window**

4. **Open regular PowerShell** and try again:
   ```
   cd "C:\Users\HP\OneDrive\Desktop\TUNTCHIE\CURSOR PROJECTS"
   npm run install-all
   ```

---

## Method 3: Bypass for Current Session Only

In your current PowerShell window, type:
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
- Type `Y` and press Enter

Then try:
```
npm run install-all
```

---

## RECOMMENDED: Use Method 1 (Command Prompt)
It's the easiest and doesn't require changing any settings!
