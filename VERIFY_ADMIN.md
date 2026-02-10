# Admin User Verification

## Quick Fix for Login Issues

If you're having trouble logging in with admin credentials, run this script to verify and create the admin user:

```bash
npm run verify-admin
```

Or directly:

```bash
node server/utils/verifyAdmin.js
```

## What the Script Does

1. **Checks** if the admin user exists in the database
2. **Displays** admin user information if found
3. **Creates** the admin user if it doesn't exist

## Default Admin Credentials

- **Username:** `admin`
- **Password:** `admin123`

⚠️ **Important:** Change the password after first login!

## When to Use This Script

- Login fails with "Invalid username or password"
- Admin user was accidentally deleted
- Database was reset or recreated
- Setting up the system for the first time

## Expected Output

### If Admin Exists:
```
✅ Admin user found:
   ID: 1
   Username: admin
   Full Name: System Administrator
   Role: admin
   Active: Yes
   Branch ID: None (Admin access to all branches)
   Last Login: 2024-01-15 10:30:00

✅ Admin user is ready to use!
   Username: admin
   Password: admin123
```

### If Admin Doesn't Exist:
```
❌ Admin user NOT found.
🔧 Creating admin user...

✅ Admin user created successfully!

📋 Admin Credentials:
   Username: admin
   Password: admin123

⚠️  IMPORTANT: Please change the password after first login!

✅ You can now log in with these credentials.
```

## Troubleshooting

If the script shows errors:
1. Make sure the database file exists: `database/supaclean.db`
2. Check that the server is not running (close it first)
3. Verify Node.js and npm are installed correctly
4. Check file permissions on the database directory
