# PM2 Crash Fix - Deployment Instructions

## Issues Fixed

Your backend was crashing 69 times because of these critical issues:

1. **Wrong entry point**: PM2 was trying to run `server.js` instead of `index.js`
2. **Duplicate server start**: `server.ts` was calling `app.listen()` AND exporting the app, causing a conflict
3. **Wrong output directory**: TypeScript was compiling to `temp/` but PM2 expected `dist/`
4. **Duplicate node_args**: PM2 config had conflicting node arguments

## Changes Made

### 1. Fixed `tsconfig.prod.json`
- Changed `outDir` from `"temp"` to `"dist"`

### 2. Fixed `ecosystem.config.js`
- Changed script from `'./dist/src/server.js'` to `'./dist/src/index.js'`
- Removed duplicate `node_args` declaration

### 3. Fixed `src/server.ts`
- Removed `app.listen()` call (now handled by `index.ts`)
- Server only exports the Express app

## Deployment Steps for Lightsail

### Step 1: Commit and Push Changes
```bash
git add .
git commit -m "Fix PM2 crashes - update build config and entry point"
git push origin main
```

### Step 2: SSH into Lightsail
```bash
ssh ubuntu@YOUR_LIGHTSAIL_IP
```

### Step 3: Pull Latest Changes
```bash
cd /var/www/emailify-backend/backend
git pull origin main
```

### Step 4: Install Dependencies (if needed)
```bash
npm install
```

### Step 5: Rebuild the Application
```bash
npm run build
# This will compile TypeScript to dist/ directory
```

### Step 6: Stop Current PM2 Process
```bash
pm2 stop emailify-backend
pm2 delete emailify-backend
```

### Step 7: Start with New Configuration
```bash
pm2 start ecosystem.config.js
pm2 save
```

### Step 8: Verify It's Running
```bash
pm2 status
pm2 logs emailify-backend --lines 50
```

You should see:
- Status: `online` ✅
- Restarts: `0` ✅
- No errors in logs ✅

### Step 9: Monitor for a Few Minutes
```bash
# Watch live logs
pm2 logs emailify-backend

# Check status every few seconds
watch -n 2 pm2 status
```

## Quick Troubleshooting

### If still crashing:
```bash
# Check detailed error logs
pm2 logs emailify-backend --err --lines 100

# Check if dist/src/index.js exists
ls -la /var/www/emailify-backend/backend/dist/src/index.js

# Verify environment variables
cat /var/www/emailify-backend/backend/.env
```

### Check MongoDB Connection:
```bash
# Look for MongoDB connection errors in logs
pm2 logs emailify-backend | grep -i mongo
```

### Restart Nginx (if needed):
```bash
sudo systemctl restart nginx
sudo systemctl status nginx
```

## Expected PM2 Status

After successful deployment:
```
┌────┬────────────────────┬──────────┬──────┬────────┬──────────┬──────────┐
│ id │ name               │ mode     │ ↺    │ status │ cpu      │ memory   │
├────┼────────────────────┼──────────┼──────┼────────┼──────────┼──────────┤
│ 0  │ emailify-backend   │ fork     │ 0    │ online │ 0.2%     │ 85.6mb   │
└────┴────────────────────┴──────────┴──────┴────────┴──────────┴──────────┘
```

Note: `↺ 0` means **no restarts** = stable! 🎉

## Environment Variables to Verify

Make sure these exist in `/var/www/emailify-backend/backend/.env`:
```
NODE_ENV=production
PORT=5000
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_secret
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
SESSION_SECRET=your_session_secret
```

## Additional PM2 Commands

```bash
# Restart app
pm2 restart emailify-backend

# Reload (zero-downtime)
pm2 reload emailify-backend

# View dashboard
pm2 monit

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

## Testing After Deployment

1. **Health Check:**
   ```bash
   curl http://localhost:5000/api/ping
   ```

2. **From Browser:**
   Visit: `https://your-domain.com/api/ping`

3. **Check Nginx:**
   ```bash
   curl http://localhost
   ```

## Success Indicators

✅ PM2 shows status: `online`  
✅ Restart count: `0` (or very low)  
✅ Memory usage: stable (not growing)  
✅ API endpoints respond correctly  
✅ No errors in `pm2 logs`  

## If You See "Error: Cannot find module"

This means the build didn't work. Run:
```bash
cd /var/www/emailify-backend/backend
rm -rf dist
npm run build
ls -la dist/src/  # Verify index.js and server.js exist
pm2 restart emailify-backend
```

---

**Note:** All changes are backward compatible with your development environment. The `npm run dev` command still works the same way!
