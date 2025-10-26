# AWS Lightsail Deployment Guide - Fix Browser Refresh Issue

## The Problem
When you refresh the browser on any Angular route (e.g., `/admin`, `/qa/123`), you get redirected to the homepage or see a 404 error.

## The Solution
You need to configure your server to always serve `index.html` for all routes that aren't static files or API calls.

---

## Option 1: Using Node.js Express Server (Recommended if you're using SSR)

The `server.ts` file has already been updated with the correct configuration. 

**Steps:**

1. **Build your Angular app:**
   ```bash
   cd frontend
   npm run build
   ```

2. **Start the Express server:**
   ```bash
   node dist/frontend/server/server.mjs
   ```

3. **Use PM2 to keep it running:**
   ```bash
   pm2 start dist/frontend/server/server.mjs --name "camply-app"
   pm2 save
   pm2 startup
   ```

The server is already configured to handle all routes correctly via the catch-all route:
```javascript
server.get('*', (req, res, next) => { ... })
```

---

## Option 2: Using Nginx as Reverse Proxy (Recommended for Production)

If you're using Nginx in front of your Node.js app:

### Step 1: Install Nginx (if not already installed)
```bash
sudo apt update
sudo apt install nginx -y
```

### Step 2: Copy the Nginx configuration
```bash
sudo cp deployment/nginx-lightsail.conf /etc/nginx/sites-available/camply
```

### Step 3: Edit the configuration with your details
```bash
sudo nano /etc/nginx/sites-available/camply
```

Update these lines:
- `server_name` → your actual domain or IP
- `root` → correct path to your built Angular app
- `proxy_pass` → correct port where your Node.js backend runs

### Step 4: Enable the site
```bash
sudo ln -s /etc/nginx/sites-available/camply /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

---

## Option 3: Serving Static Files with Nginx (No SSR)

If you're NOT using Server-Side Rendering and just want to serve static files:

### Step 1: Build for production
```bash
cd frontend
npm run build
```

### Step 2: Copy files to web directory
```bash
sudo cp -r dist/frontend/browser/* /var/www/html/
```

### Step 3: Create Nginx config
```bash
sudo nano /etc/nginx/sites-available/camply
```

Paste this simple config:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Step 4: Enable and restart
```bash
sudo ln -s /etc/nginx/sites-available/camply /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Testing the Fix

After applying any of the above solutions:

1. Visit your app: `http://your-domain.com`
2. Navigate to any route (e.g., `/admin`)
3. **Refresh the browser (F5 or Ctrl+R)**
4. ✅ The page should stay on the same route instead of redirecting to home

---

## Troubleshooting

### Still redirecting to home?
- Check Nginx error logs: `sudo tail -f /var/nginx/error.log`
- Check Node.js logs: `pm2 logs camply-app`
- Verify the build output exists in the correct directory

### 404 Errors?
- Ensure the `root` path in Nginx config points to the `browser` folder
- Check file permissions: `sudo chmod -R 755 /var/www/html`

### API calls not working?
- Verify the backend is running: `pm2 status`
- Check the proxy_pass port matches your backend port

---

## Current Setup on AWS Lightsail

Your setup likely looks like this:

```
Internet → Lightsail Instance → Nginx (Port 80) → Node.js/Express (Port 3000/4000) → Angular App
```

The fix ensures Nginx always serves `index.html` for non-file requests, allowing Angular router to handle the routing.
