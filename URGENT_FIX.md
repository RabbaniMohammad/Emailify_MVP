# 🚨 URGENT FIX - Run These Commands on Lightsail

## The server needs tsc-alias installed ONE TIME ONLY

Copy and paste these commands on your Lightsail server:

```bash
cd /var/www/emailify-backend/backend
```

```bash
npm install --save-dev tsc-alias --legacy-peer-deps
```

```bash
npm run build
```

```bash
pm2 delete emailify-backend
```

```bash
pm2 start ecosystem.config.js
```

```bash
pm2 save
```

```bash
pm2 status
```

## Why This Works:

1. ✅ `tsc-alias` was added to `package.json` devDependencies
2. ✅ Build script now runs: `tsc && tsc-alias` (converts @src/* to relative paths)
3. ✅ After this ONE-TIME setup, future deployments just need `git pull` and `pm2 restart`

## Expected Result:

```
┌────┬──────────────────┬──────┬──────┬────────┐
│ id │ name             │ mode │ ↺    │ status │
├────┼──────────────────┼──────┼──────┼────────┤
│ 0  │ emailify-backend │ fork │ 0    │ online │
└────┴──────────────────┴──────┴──────┴────────┘
```

**Zero restarts = Success!** 🎉
