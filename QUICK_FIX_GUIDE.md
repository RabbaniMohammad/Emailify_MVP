# Quick Fix Guide - Deployment Issues

## Problem Summary
1. **Organization name shows "Unknown Org"** → Fixed by correcting the populate field
2. **Duplicate users in admin panel** → Fixed by preventing duplicate creation in auth flow

## What Was Fixed

### Code Changes
- ✅ `backend/src/routes/auth.ts` - Fixed organization populate
- ✅ `backend/src/config/passport.ts` - Prevented duplicate user creation

### New Utilities Added
- ✅ `backend/scripts/cleanup-duplicate-users.ts` - Remove existing duplicates
- ✅ `backend/scripts/verify-organization-data.ts` - Diagnose org issues

## Deploy to Production

### Quick Deploy (PowerShell)
```powershell
# Navigate to backend
cd backend

# Build the changes
npm run build

# Optional: Verify organization data first
npm run verify:org

# Clean up any existing duplicate users
npm run cleanup:users

# Deploy to Lightsail (or your hosting)
# Copy built files to server
scp -r dist/* your-server:/path/to/app/

# SSH into server and restart
ssh your-server
pm2 restart all
```

### Run Cleanup Scripts on Production
```bash
# SSH into your production server
ssh your-lightsail-instance

# Navigate to app directory
cd /path/to/your/app/backend

# Set environment variables
export MONGO_URI="your-mongodb-connection-string"

# Verify organization data
npm run verify:org

# Clean up duplicates
npm run cleanup:users
```

## Expected Results
- ✅ Organization name displays correctly
- ✅ Each user appears only once
- ✅ No more duplicate user creation

## Test After Deploy
1. Login → Check organization name in dropdown
2. Admin Dashboard → Verify no duplicate users
3. Try logging out and back in → Should work smoothly

---
**Need to rollback?** The changes are backward compatible. Just don't run the cleanup script if you want to keep existing data as-is.
