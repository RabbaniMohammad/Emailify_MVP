# 🚀 Run Emailify Locally (Existing Application)

## 📋 Quick Start - 3 Steps

### Step 1: Start Backend Server

Open PowerShell and navigate to backend folder:

```powershell
# Navigate to backend
cd c:\Users\LaxmisathvikaVemula\Downloads\Emailify_MVP-main\Emailify_MVP-main\backend

# Install dependencies (if not done yet)
npm install

# Start development server with hot reload
npm run dev
```

**Expected Output**:
```
Server listening on port 3000
MongoDB connected successfully
```

Backend will run on: **http://localhost:3000**

---

### Step 2: Start Frontend Server

Open a **NEW PowerShell window** (keep backend running):

```powershell
# Navigate to frontend
cd c:\Users\LaxmisathvikaVemula\Downloads\Emailify_MVP-main\Emailify_MVP-main\frontend

# Install dependencies (if not done yet)
npm install

# Start Angular development server
ng serve
```

Or simply:
```powershell
npm start
```

**Expected Output**:
```
** Angular Live Development Server is listening on localhost:4200 **
✔ Compiled successfully
```

Frontend will run on: **http://localhost:4200**

---

### Step 3: Open in Browser

Open your browser and go to: **http://localhost:4200**

You should see your Emailify application running! 🎉

---

## 🔄 Alternative Backend Commands

### Development Mode (Recommended):
```powershell
npm run dev
```
- Auto-reloads on file changes
- Shows detailed logs
- Best for development

### Production Build:
```powershell
npm run build
npm start
```
- Compiles TypeScript to JavaScript
- Runs optimized production code

### Watch Mode with Hot Reload:
```powershell
npm run dev:hot
```
- Watches for changes in src folder
- Restarts automatically

---

## 🛑 Stop the Servers

Press `Ctrl + C` in each PowerShell window to stop the servers.

---

## 🐛 Common Issues

### "npm: command not found"
**Fix**: Install Node.js from https://nodejs.org/

### "Port 3000 is already in use"
**Fix**: Kill the process:
```powershell
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

### "Port 4200 is already in use"
**Fix**: Kill the process:
```powershell
netstat -ano | findstr :4200
taskkill /PID <PID_NUMBER> /F
```

### "MongoDB connection failed"
**Fix**: Check your `.env` file has correct `MONGODB_URI`:
```
MONGODB_URI=mongodb+srv://emailtool_admin:Sumanasri%233@emailtool-cluster.akt797x.mongodb.net/emailtool?retryWrites=true&w=majority&appName=emailtool-cluster
```

### "Cannot find module"
**Fix**: Install dependencies:
```powershell
# In backend folder
npm install

# In frontend folder
npm install
```

### Frontend shows errors
**Fix**: Make sure backend is running first, then start frontend

---

## 📁 What's Running?

| Service | URL | Purpose |
|---------|-----|---------|
| **Backend API** | http://localhost:3000 | Express server with all APIs |
| **Frontend** | http://localhost:4200 | Angular application |
| **MongoDB** | (Cloud) | Database (Atlas) |

---

## ✅ Verify It's Working

### Test Backend:
```powershell
curl http://localhost:3000/api/
```

### Test Frontend:
Open browser: http://localhost:4200

### Check Logs:
Look at the PowerShell windows - you'll see logs for both servers

---

## 🔧 Your Current Setup

You have:
- ✅ Mailchimp integration (email campaigns)
- ✅ OpenAI integration (template generation)
- ✅ MongoDB Atlas (database)
- ✅ Google OAuth (authentication)
- ✅ Anthropic Claude (AI features)

All of these will work when you run locally! 🎉

---

## 💡 Quick Tips

1. **Always start backend first**, then frontend
2. **Keep both terminals open** while developing
3. **Changes to backend** require restart (unless using `dev:hot`)
4. **Changes to frontend** auto-reload in browser
5. **Check `.env` file** is in backend folder with all keys

---

That's it! Just run `npm run dev` in backend, `ng serve` in frontend, and you're good to go! 🚀
