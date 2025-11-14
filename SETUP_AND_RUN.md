# 🚀 How to Run Emailify Locally & Install Multi-Channel Packages

## 📋 Prerequisites Check

✅ **You already have**:
- Node.js installed (check: `node --version`)
- MongoDB running (check your .env has MONGODB_URI)
- OpenAI package ✅
- Cheerio package ✅

❌ **You need to install**:
- AWS SDK for SMS

---

## 1️⃣ Install Missing Package (AWS SDK for SMS)

Open PowerShell in your project root and run:

```powershell
# Navigate to backend folder
cd backend

# Install AWS SDK for SNS (SMS service)
npm install @aws-sdk/client-sns

# Install the type definitions
npm install --save-dev @types/node
```

**That's it!** You already have all other packages (OpenAI, Cheerio).

---

## 2️⃣ Register the Multi-Channel Routes

You need to add the multi-channel routes to your main router. Let me check if we need to update `backend/src/routes/index.ts`:

**Add this line** to `backend/src/routes/index.ts`:

```typescript
import multiChannelRouter from './multiChannel.routes';

// ... existing code ...

// Add multi-channel routes
router.use('/multi-channel', multiChannelRouter);
```

---

## 3️⃣ Run the Backend Locally

### Option A: Development Mode (Recommended)
```powershell
# Make sure you're in the backend folder
cd backend

# Run in development mode with hot reload
npm run dev
```

This will:
- Start the server on `http://localhost:3000`
- Watch for file changes and auto-reload
- Show detailed logs

### Option B: Build and Run Production Mode
```powershell
# Build TypeScript to JavaScript
npm run build

# Start production server
npm start
```

---

## 4️⃣ Run the Frontend (Angular)

Open a **NEW PowerShell window** (keep backend running):

```powershell
# Navigate to frontend folder
cd frontend

# Install dependencies (if not done yet)
npm install

# Start Angular dev server
ng serve
```

Or use:
```powershell
npm start
```

The frontend will run on `http://localhost:4200`

---

## 5️⃣ Verify Everything is Running

### Check Backend:
```powershell
# Test if backend is alive
curl http://localhost:3000/api/

# Check multi-channel routes are registered
curl http://localhost:3000/api/multi-channel/channel-status
```

### Check Frontend:
Open browser: `http://localhost:4200`

---

## 6️⃣ Test Multi-Channel Features (After Getting AWS Keys)

Once you get AWS SNS keys (follow `HOW_TO_GET_API_KEYS.md`), test SMS:

```powershell
# Set your AWS credentials (replace with real keys)
$env:AWS_REGION="us-east-1"
$env:AWS_ACCESS_KEY_ID="your_key_here"
$env:AWS_SECRET_ACCESS_KEY="your_secret_here"

# Test channel status
curl -X GET http://localhost:3000/api/multi-channel/channel-status
```

---

## 🐛 Troubleshooting

### "Cannot find module '@aws-sdk/client-sns'"
**Fix**: Run `npm install @aws-sdk/client-sns` in backend folder

### "Port 3000 is already in use"
**Fix**: Kill the process using port 3000:
```powershell
# Find process on port 3000
netstat -ano | findstr :3000

# Kill it (replace PID with the number from above)
taskkill /PID <PID> /F
```

### "MongoDB connection failed"
**Fix**: Make sure MongoDB is running or your MONGODB_URI in .env is correct

### Frontend won't start - "Port 4200 in use"
**Fix**: Kill process on port 4200:
```powershell
netstat -ano | findstr :4200
taskkill /PID <PID> /F
```

### TypeScript errors about missing types
**Fix**: 
```powershell
cd backend
npm install --save-dev @types/node @types/express
```

---

## 📁 Project Structure After Setup

```
Emailify_MVP-main/
├── backend/
│   ├── node_modules/          ← Dependencies installed
│   ├── src/
│   │   ├── models/
│   │   │   └── MultiChannelCampaign.ts  ← New model
│   │   ├── services/
│   │   │   ├── contentAdaptationService.ts  ← AI service
│   │   │   ├── smsService.ts                ← SMS service
│   │   │   ├── whatsappService.ts           ← WhatsApp service
│   │   │   ├── instagramService.ts          ← Instagram service
│   │   │   └── messagingService.ts          ← Unified service
│   │   └── routes/
│   │       ├── index.ts                     ← Register routes HERE
│   │       └── multiChannel.routes.ts       ← New routes
│   ├── package.json
│   └── .env                   ← Add API keys here
├── frontend/
│   ├── node_modules/
│   └── src/
└── HOW_TO_GET_API_KEYS.md    ← Follow this to get AWS keys
```

---

## ✅ Quick Start Checklist

- [ ] **Step 1**: Install AWS SDK: `npm install @aws-sdk/client-sns`
- [ ] **Step 2**: Register routes in `backend/src/routes/index.ts`
- [ ] **Step 3**: Start backend: `npm run dev` (in backend folder)
- [ ] **Step 4**: Start frontend: `ng serve` (in frontend folder, new terminal)
- [ ] **Step 5**: Get AWS SNS keys (follow `HOW_TO_GET_API_KEYS.md`)
- [ ] **Step 6**: Add keys to `.env` file
- [ ] **Step 7**: Test SMS endpoint: `curl http://localhost:3000/api/multi-channel/channel-status`

---

## 🎯 What to Do NOW

1. **Install the package** (2 minutes):
   ```powershell
   cd backend
   npm install @aws-sdk/client-sns
   ```

2. **Start the servers** (1 minute):
   ```powershell
   # Terminal 1 - Backend
   cd backend
   npm run dev

   # Terminal 2 - Frontend
   cd frontend
   ng serve
   ```

3. **Get AWS keys** (20 minutes):
   - Follow `HOW_TO_GET_API_KEYS.md` → Section 1 (AWS SNS)
   - Add keys to `.env`
   - Test sending SMS!

---

Need help with any step? Just ask! 🚀
