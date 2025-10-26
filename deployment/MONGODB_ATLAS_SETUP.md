# MongoDB Atlas Setup Guide for Emailify

## Overview
This guide walks you through setting up MongoDB Atlas (cloud-hosted MongoDB) for your Emailify application. MongoDB Atlas will be accessed via API only - no database server needed on Lightsail!

---

## Step 1: Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
2. Sign up for a **free account**
3. Verify your email address

---

## Step 2: Create a Free Cluster

### 2.1 Create New Cluster
1. Click **"Build a Database"** or **"Create"**
2. Select **"M0 Free"** tier (no credit card required!)
3. Choose cloud provider: **AWS**
4. Choose region: **us-east-2 (Ohio)** ✅ *Closest to Chicago*
5. Cluster Name: `emailify-cluster` (or your choice)
6. Click **"Create Cluster"**

⏱️ *Wait 3-5 minutes for cluster to deploy*

### Free Tier Specifications:
- **RAM:** 512 MB
- **Storage:** 5 GB
- **Connections:** Up to 500 concurrent
- **Backups:** Automatic snapshots
- **Cost:** **$0/month forever!**

---

## Step 3: Configure Database Security

### 3.1 Create Database User

1. In Atlas Dashboard, go to **"Database Access"** (left sidebar)
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Username: `emailify-admin` (or your choice)
5. Password: Click **"Autogenerate Secure Password"** and **SAVE IT!**
   - Or create your own strong password
6. Database User Privileges: **"Read and write to any database"**
7. Click **"Add User"**

📝 **Save these credentials securely!**

### 3.2 Configure Network Access (IP Whitelist)

1. Go to **"Network Access"** (left sidebar)
2. Click **"Add IP Address"**

**For Development (Testing):**
- Click **"Allow Access from Anywhere"** (0.0.0.0/0)
- Temporary description: "Development Testing"
- Click **"Confirm"**

**For Production (Recommended):**
- Add your Lightsail instance's static IP address
- Description: "Lightsail Production Server"
- Click **"Confirm"**

⚠️ **Security Note:** For production, only whitelist your Lightsail instance IP!

---

## Step 4: Get Connection String

### 4.1 Find Your Connection String

1. Go to **"Database"** in left sidebar
2. Click **"Connect"** on your cluster
3. Choose **"Connect your application"**
4. Driver: **Node.js**
5. Version: **5.5 or later**
6. Copy the connection string - it looks like:

```
mongodb+srv://emailify-admin:<password>@emailify-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

### 4.2 Format for Your .env File

Replace `<password>` with your actual password and add database name:

```bash
# Before (from Atlas)
mongodb+srv://emailify-admin:<password>@emailify-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority

# After (for your .env file)
MONGODB_URI=mongodb+srv://emailify-admin:YourActualPassword123@emailify-cluster.xxxxx.mongodb.net/emailify?retryWrites=true&w=majority
```

**Important Changes:**
- Replace `<password>` with your actual password
- Add database name `/emailify` after `.net`
- Keep the query parameters `?retryWrites=true&w=majority`

---

## Step 5: Create Database and Collections (Optional)

MongoDB will automatically create the database and collections when your app first writes data, but you can create them manually:

### 5.1 Using MongoDB Compass (GUI)

1. Download [MongoDB Compass](https://www.mongodb.com/products/compass)
2. Connect using your connection string
3. Create database: `emailify`
4. Create collections:
   - `users`
   - `generatedtemplates`
   - `templateconversations`

### 5.2 Using Atlas UI

1. In Atlas, go to **"Database"** → **"Browse Collections"**
2. Click **"Add My Own Data"**
3. Database name: `emailify`
4. Collection name: `users`
5. Repeat for other collections

---

## Step 6: Test Connection Locally

Before deploying, test the connection from your local machine:

### 6.1 Update Your Local .env

```bash
MONGODB_URI=mongodb+srv://emailify-admin:YourPassword@emailify-cluster.xxxxx.mongodb.net/emailify?retryWrites=true&w=majority
```

### 6.2 Test Backend Connection

```bash
cd backend
npm install
npm run dev
```

Check console output for:
```
✅ MongoDB connected successfully
```

### 6.3 Test API Endpoint

Visit: `http://localhost:5000/health`

Should return:
```json
{
  "ok": true,
  "mongodb": "connected"
}
```

✅ **If you see "connected" - you're all set!**

---

## Step 7: Production Configuration

### 7.1 Update Lightsail Environment

When deploying to Lightsail, add to your `/var/www/emailify-backend/backend/.env`:

```bash
MONGODB_URI=mongodb+srv://emailify-admin:YourPassword@emailify-cluster.xxxxx.mongodb.net/emailify?retryWrites=true&w=majority&maxPoolSize=50&minPoolSize=5
```

**Additional Options for Production:**
- `maxPoolSize=50` - Maximum connection pool size
- `minPoolSize=5` - Minimum connection pool size
- `serverSelectionTimeoutMS=5000` - Timeout for server selection
- `socketTimeoutMS=45000` - Socket timeout

### 7.2 Whitelist Lightsail IP

1. Get your Lightsail instance's static IP
2. In Atlas → Network Access → Add IP Address
3. Enter your Lightsail IP
4. Description: "Lightsail Production"
5. Save

---

## Step 8: Monitoring & Maintenance

### 8.1 Monitor Database Usage

In Atlas Dashboard:
- **Metrics:** View CPU, memory, connections, operations
- **Performance Advisor:** Get index recommendations
- **Real-time Performance Panel:** See slow queries

### 8.2 View Logs

- Go to **"Database"** → Select cluster → **"..."** → **"View Monitoring"**
- Check for errors, slow queries, connection issues

### 8.3 Backup & Restore

**Free Tier Backups:**
- Automatic snapshots (cannot be downloaded)
- Data Explorer for manual data export

**Upgrade for:**
- Point-in-time recovery
- Downloadable snapshots
- Custom backup schedules

---

## Step 9: When to Upgrade

### Stay on FREE M0 if:
✅ Under 100 active users
✅ Under 2 GB data
✅ Basic performance acceptable
✅ 500 concurrent connections enough

### Upgrade to M10 ($9/month) when:
❌ Need more performance
❌ Growing beyond 100 users
❌ Need automated backups
❌ Need VPC peering
❌ Need point-in-time recovery

---

## Security Best Practices

### ✅ DO:
- Use strong passwords (20+ characters)
- Whitelist only specific IPs in production
- Rotate passwords periodically
- Use environment variables (never hardcode!)
- Enable 2FA on Atlas account
- Regularly review Database Access logs

### ❌ DON'T:
- Don't allow access from anywhere (0.0.0.0/0) in production
- Don't commit .env files to Git
- Don't use weak passwords
- Don't share credentials
- Don't use admin credentials in application

---

## Troubleshooting

### Connection Timeout
**Problem:** App can't connect to MongoDB
**Solutions:**
1. Check IP whitelist in Atlas Network Access
2. Verify connection string format
3. Check Lightsail firewall allows outbound port 27017
4. Verify username/password are correct

### Authentication Failed
**Problem:** "Authentication failed" error
**Solutions:**
1. Verify password is correct (special characters need URL encoding)
2. Ensure user has correct database privileges
3. Check database name in connection string

### Too Many Connections
**Problem:** "Too many connections" error on free tier
**Solutions:**
1. Reduce maxPoolSize in connection string
2. Ensure connections are properly closed
3. Check for connection leaks in your code
4. Consider upgrading to M10

### URL Encoding Special Characters
If your password has special characters, encode them:

| Character | Encoded |
|-----------|---------|
| @ | %40 |
| : | %3A |
| / | %2F |
| ? | %3F |
| # | %23 |
| [ | %5B |
| ] | %5D |

Example:
```
Password: My@Pass#123
Encoded: My%40Pass%23123
```

---

## Useful MongoDB Atlas Resources

- [Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Connection String Format](https://docs.mongodb.com/manual/reference/connection-string/)
- [Security Checklist](https://docs.atlas.mongodb.com/security-checklist/)
- [M0 Free Tier Limits](https://docs.atlas.mongodb.com/reference/free-shared-limitations/)

---

## Quick Reference Card

```bash
# Connection String Template
mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority

# Your Configuration
Cluster: emailify-cluster
Region: AWS us-east-2 (Ohio)
Database: emailify
Username: emailify-admin
Password: [SECURE_PASSWORD]

# Collections
- users
- generatedtemplates
- templateconversations

# Environment Variable
MONGODB_URI=mongodb+srv://emailify-admin:[PASSWORD]@emailify-cluster.xxxxx.mongodb.net/emailify?retryWrites=true&w=majority
```

---

✅ **Setup complete! Your MongoDB Atlas is ready for production use.**

**Next:** Continue with Lightsail deployment → Configure .env → Deploy backend 🚀
