# Deployment Issues - Fixes Applied

## Issues Found

### 1. Organization Name Missing ("Unknown Org")
**Symptom:** In deployed environment, the dropdown shows "Unknown Org" instead of the actual organization name.

**Root Cause:** 
- The `/api/auth/me` endpoint was trying to populate `organizationId` with a field called `isOwner` that doesn't exist in the Organization model
- This could cause the `.populate()` to fail silently in production, resulting in `organizationId` being null

**Fix Applied:**
- Changed `.populate('organizationId', 'name slug domain isActive isOwner')` to `.populate('organizationId', 'name slug domain isActive owner')`
- Added proper logic to check if current user is the owner by comparing `user._id` with `organization.owner`

### 2. Duplicate Users in Admin Panel
**Symptom:** The same user appears multiple times in the "All Users" tab.

**Root Cause:**
- Users can be created in **two places**: `passport.ts` (during OAuth) and `auth.ts` callback
- The User model has a composite unique index `{ email: 1, organizationId: 1 }` which allows the same email to exist multiple times (once per organization)
- In certain edge cases during login flow, both passport and auth callback could create user records

**Fix Applied:**
- Enhanced passport.ts to check for existing users more thoroughly before creating new ones
- Added logic to detect if user exists with no organization or in a different organization
- Prevents creation of duplicate user records by properly handling all edge cases

## Files Modified

### Backend Changes

1. **`backend/src/routes/auth.ts`**
   - Fixed organization population to use correct field names
   - Improved owner detection logic

2. **`backend/src/config/passport.ts`**
   - Enhanced duplicate user detection
   - Added safeguards against creating multiple user records
   - Better handling of users switching organizations

3. **`backend/scripts/cleanup-duplicate-users.ts`** (NEW)
   - Utility script to remove existing duplicate users from database
   - Keeps the most appropriate user record (prioritizes super_admin, then oldest)
   - Safe to run on production database

4. **`backend/scripts/verify-organization-data.ts`** (NEW)
   - Diagnostic script to verify organization data integrity
   - Tests population functionality
   - Shows all organizations and their users

5. **`backend/package.json`**
   - Added script: `npm run cleanup:users` - Remove duplicate users
   - Added script: `npm run verify:org` - Verify organization data

## Deployment Steps

### Step 1: Deploy Code Changes
```bash
# Build and deploy the updated backend
cd backend
npm run build
```

### Step 2: Verify Organization Data (Optional)
```bash
# Connect to production database and run verification
npm run verify:org
```

### Step 3: Clean Up Duplicate Users
```bash
# Remove any existing duplicate user records
npm run cleanup:users
```

### Step 4: Restart Application
```bash
# Restart your backend service
pm2 restart all
# OR
systemctl restart your-app-service
```

## Expected Results After Fix

✅ Organization name should display correctly in the dropdown menu  
✅ No duplicate users in the admin panel  
✅ Users can only exist once per organization  
✅ OAuth flow properly handles new and existing users  

## Testing

### Test Organization Name Display
1. Log in to the deployed application
2. Click on the user profile dropdown in the top right
3. Verify that the organization name appears (not "Unknown Org")

### Test No Duplicate Users
1. Navigate to Admin Dashboard
2. Click on "All Users" tab
3. Verify each user appears only once
4. Check that user count matches actual unique users

## Rollback Plan

If issues occur after deployment:

1. Revert code changes in `auth.ts` and `passport.ts`
2. Restore database from backup (if cleanup script was run)
3. Redeploy previous version

## Monitoring

After deployment, monitor:
- User login success rate
- Organization data loading in frontend
- Database logs for duplicate key errors
- Application logs for authentication issues

## Notes

- The composite unique index `{ email: 1, organizationId: 1 }` is intentional - it allows the same email address to exist in different organizations
- The cleanup script is safe to run multiple times
- Future logins will not create duplicates due to the passport.ts fixes
