pm2 logs emailify-backend --lines 30# 🔧 Troubleshooting Your Lightsail Deployment

## Step 1: Check if Your App is Running

Copy and paste this command into your Lightsail SSH terminal:

```bash
pm2 status
```

**What you should see:**
- A table showing `emailify-backend` with status **"online"**

**If you see "stopped" or "errored":**
- Your app is not running. Go to **Step 2**.

**If you see "No process found":**
- Your app was never started. Go to **Step 2**.

---

## Step 2: Start Your Application

Copy and paste these commands **one by one**:

```bash
cd /var/www/emailify-backend/backend
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

**What should happen:**
- You should see `emailify-backend` status change to **"online"**

---

## Step 3: Check if Port 5000 is Working

Copy and paste this:

```bash
curl http://localhost:5000/health
```

**What you should see:**
- `{"ok":true,"mongodb":"connected"}` or similar

**If you see an error:**
- Check PM2 logs with: `pm2 logs emailify-backend --lines 30`

---

## Step 4: Check if Nginx is Working

Copy and paste this:

```bash
curl http://localhost/health
```

**What you should see:**
- Same response as Step 3: `{"ok":true,"mongodb":"connected"}`

**If you see an error:**
- Nginx might not be running. Try: `sudo systemctl status nginx`

---

## Step 5: Open Firewall Ports in Lightsail Console

**⚠️ THIS IS THE MOST COMMON ISSUE!**

1. Go to: https://lightsail.aws.amazon.com/
2. Click on your instance name
3. Click the **"Networking"** tab
4. Scroll down to **"Firewall"** section

**Check if you have these rules:**
- ✅ **HTTP** - TCP - 80
- ✅ **HTTPS** - TCP - 443

**If NOT, click "+ Add rule" and add:**
- Application: **HTTP**
- Click **Create**

Then add:
- Application: **HTTPS**
- Click **Create**

---

## Step 6: Test from Your Browser

1. Find your **Public IP** on the Lightsail instance page (e.g., `3.149.255.176`)
2. Open your browser
3. Go to: `http://YOUR-IP-HERE/health`

**Example:** `http://3.149.255.176/health`

**What you should see:**
- `{"ok":true,"mongodb":"connected"}`

**If you see this, YOUR APP IS WORKING! 🎉**

---

## 🆘 If Still Not Working

Run this command and send me the output:

```bash
pm2 logs emailify-backend --lines 50
```

Also check:

```bash
sudo tail -20 /var/log/nginx/emailify-error.log
```

---

## Quick Reference Commands

```bash
# Check if app is running
pm2 status

# View app logs
pm2 logs emailify-backend

# Restart app
pm2 restart emailify-backend

# Check Nginx status
sudo systemctl status nginx

# Restart Nginx
sudo systemctl restart nginx

# Test backend locally
curl http://localhost:5000/health

# Test through Nginx
curl http://localhost/health
```

---

**Start with Step 1 and tell me what you see!** 👍
