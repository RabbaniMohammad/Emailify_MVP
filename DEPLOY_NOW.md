# Quick Deploy Instructions for Lightsail

## What Was Fixed?
Your backend was crashing 69 times because:
1. PM2 tried to run the wrong file (`server.js` instead of `index.js`)
2. TypeScript compiled to `temp/` but PM2 expected `dist/`
3. `server.ts` had duplicate `app.listen()` causing conflicts

## SSH into Lightsail and Run These Commands:

```bash
# 1. Navigate to project directory
cd /var/www/emailify-backend/backend

# 2. Pull the latest changes from GitHub (includes pre-built dist/ folder)
git pull origin main

# 3. ⚠️ SKIP npm install - dependencies already installed, will cause conflicts!

# 4. ⚠️ SKIP npm run build - dist/ folder already included from GitHub!

# 5. Verify the build is there (pre-built from local machine)
ls -la dist/src/index.js  # Should exist from GitHub!

# 6. Stop and remove old PM2 process
pm2 delete emailify-backend

# 7. Start with the fixed configuration
pm2 start ecosystem.config.js

# 8. Save PM2 configuration
pm2 save

# 9. Check the status - should see ↺ 0 (no restarts!)
pm2 status

# 10. Monitor logs for a minute to ensure stability
pm2 logs emailify-backend --lines 50
```

## ⚠️ CRITICAL: DO NOT BUILD ON SERVER!

**Why?**
- Your `dist/` folder is already committed to GitHub (pre-built on your local machine)
- Running `npm install` on the server causes dependency conflicts (Zod version mismatch)
- The server's Node.js environment may be different, causing build issues

**The `dist/` folder is already ready to run!** Just pull from GitHub and restart PM2.

## Expected Result:

```
┌────┬──────────────────┬──────┬──────┬────────┬──────┬────────┐
│ id │ name             │ mode │ ↺    │ status │ cpu  │ memory │
├────┼──────────────────┼──────┼──────┼────────┼──────┼────────┤
│ 0  │ emailify-backend │ fork │ 0    │ online │ 0.2% │ 85.6mb │
└────┴──────────────────┴──────┴──────┴────────┴──────┴────────┘
```

**Key indicator:** `↺ 0` = **Zero restarts** = SUCCESS! 🎉

## If You See Any Issues:

```bash
# Check detailed logs
pm2 logs emailify-backend --err --lines 100

# Verify environment variables
cat .env | grep -v "SECRET"  # Don't expose secrets

# Check if dist directory exists
ls -la dist/

# Restart Nginx if needed
sudo systemctl restart nginx
```

## Rollback (if needed):

```bash
cd /var/www/emailify-backend/backend
git log --oneline -5  # See recent commits
git reset --hard 1854198  # Replace with previous commit hash
npm run build
pm2 restart emailify-backend
```

---

**Questions?** Check the detailed guide: `DEPLOYMENT_FIX.md`
