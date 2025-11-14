# 📱 How to Get API Keys for SMS, WhatsApp & Instagram

## 🎯 Quick Overview
You already have: ✅ OpenAI API Key  
You need to get: ❌ AWS SNS (SMS), ❌ WhatsApp, ❌ Instagram

**Start with SMS (AWS SNS) - Easiest and Fastest (20 minutes)**

---

## 1️⃣ AWS SNS for SMS (Easiest - Start Here!)

### Step 1: Create AWS Account
1. Go to: https://aws.amazon.com/
2. Click **"Create an AWS Account"** (top right)
3. Fill in:
   - Email address
   - Password
   - AWS account name (e.g., "Emailify SMS")
4. Choose **Personal** account type
5. Enter your contact information
6. **Payment**: Add credit/debit card (won't be charged unless you exceed free tier)
7. Verify phone number (OTP verification)
8. Choose **Basic Support Plan** (Free)

### Step 2: Log into AWS Console
1. Go to: https://console.aws.amazon.com/
2. Sign in with your new account
3. **Important**: Note your AWS region (top right) - e.g., `us-east-1`

### Step 3: Create IAM User (Security Best Practice)
1. In AWS Console, search for **"IAM"** in the search bar
2. Click **"Users"** in left sidebar
3. Click **"Create user"** button
4. Enter username: `emailify-sms-user`
5. Click **Next**
6. Select **"Attach policies directly"**
7. Search for and check: **`AmazonSNSFullAccess`**
8. Click **Next** → **Create user**

### Step 4: Generate Access Keys
1. Click on the user you just created (`emailify-sms-user`)
2. Go to **"Security credentials"** tab
3. Scroll to **"Access keys"** section
4. Click **"Create access key"**
5. Select use case: **"Application running outside AWS"**
6. Click **Next** → Add description: "Emailify SMS"
7. Click **"Create access key"**
8. **⚠️ IMPORTANT**: Copy these NOW (you can't see them again):
   - **Access Key ID**: (looks like: `AKIAIOSFODNN7EXAMPLE`)
   - **Secret Access Key**: (looks like: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`)

### Step 5: Enable SMS in SNS
1. Search for **"SNS"** in AWS Console
2. Make sure you're in a supported region (check top right):
   - ✅ Recommended: **us-east-1** (N. Virginia)
   - ✅ Also good: **us-west-2** (Oregon), **eu-west-1** (Ireland)
3. Click **"Text messaging (SMS)"** in left sidebar
4. Click **"Publish text message"** to test
5. Enter a phone number with country code: `+1234567890`
6. Type test message: "Hello from Emailify"
7. Click **"Publish message"**
8. Check your phone! 📱

### Step 6: Request Production Access (Optional - Do Later)
- By default: 1 USD spending limit/month (sandbox mode)
- To send more SMS:
  1. In SNS console → **"Text messaging (SMS)"** → **"Account information"**
  2. Click **"Request production access"** (top right)
  3. Fill form (takes 24 hours approval)
  4. For testing: Sandbox is fine!

### ✅ What You Need for .env:
```env
# AWS SNS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

---

## 2️⃣ Meta WhatsApp Business API (Medium Difficulty)

### Step 1: Create Meta Business Account
1. Go to: https://business.facebook.com/
2. Click **"Create Account"**
3. Enter:
   - Business name: "Emailify"
   - Your name
   - Work email (use your real email)
4. Click **"Next"** and complete setup

### Step 2: Create Meta Developer Account
1. Go to: https://developers.facebook.com/
2. Log in with your Facebook account
3. Click **"My Apps"** (top right) → **"Create App"**
4. Choose **"Business"** type
5. App name: `Emailify WhatsApp`
6. Select your business account from Step 1
7. Click **"Create App"**

### Step 3: Add WhatsApp Product
1. In your app dashboard, find **"WhatsApp"** product
2. Click **"Set Up"**
3. You'll see a setup wizard
4. Step 1: Select or create **Meta Business Portfolio**
5. Step 2: Create or select **WhatsApp Business Account**

### Step 4: Get Test Credentials (For Development)
1. In WhatsApp setup, go to **"API Setup"** tab
2. You'll see:
   - **Test Phone Number ID**: (starts with 12345...)
   - **WhatsApp Business Account ID**: (starts with 10203...)
3. Scroll down to **"Temporary access token"**:
   - Click **"Generate Token"**
   - Copy it (valid for 24 hours - good for testing!)
   - Format: `EAAKEx4Z...` (very long)

### Step 5: Add Test Recipient Number
1. In **"API Setup"** tab, find **"To"** field
2. Click **"Manage phone number list"**
3. Add YOUR phone number (with country code): `+1234567890`
4. You'll receive a verification code via WhatsApp
5. Enter the code to verify

### Step 6: Send Test Message
1. In **"API Setup"** tab, scroll to **"Send and receive messages"**
2. Select your verified number
3. Click **"Send message"**
4. Check your WhatsApp! 📱

### Step 7: Get Permanent Token (Production)
1. In app dashboard, go to **"Settings"** → **"Basic"**
2. Copy **"App ID"** and **"App Secret"**
3. Generate permanent token:
   - Go to: https://developers.facebook.com/tools/explorer/
   - Select your app
   - Under **"User or Page"**, select **"whatsapp_business_management"**
   - Add permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
   - Click **"Generate Access Token"**
   - **⚠️ SAVE THIS TOKEN** - This is your permanent token

### Step 8: Business Verification (Required for Production)
- **For Testing**: You can skip this now
- **For Production**: Meta requires business verification (3-7 days)
  1. Go to: https://business.facebook.com/settings/info
  2. Click **"Start Verification"**
  3. Upload: Business documents (registration, tax ID, utility bill)
  4. Wait for approval

### ✅ What You Need for .env:
```env
# Meta WhatsApp Configuration
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=102030405060708
WHATSAPP_ACCESS_TOKEN=EAAKEx4ZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789
```

---

## 3️⃣ Meta Instagram Messaging API (Medium Difficulty)

### Prerequisites:
- ✅ Meta Developer Account (from WhatsApp setup)
- ✅ Instagram Business/Creator Account (not personal!)
- ✅ Facebook Page connected to Instagram

### Step 1: Convert to Instagram Business Account
1. Open Instagram app on your phone
2. Go to **Settings** → **Account** → **Switch to Professional Account**
3. Choose **Business** or **Creator**
4. Complete setup

### Step 2: Connect Instagram to Facebook Page
1. Go to: https://www.facebook.com/pages
2. Create a new page OR use existing page
3. In Facebook Page, go to **Settings** → **Instagram**
4. Click **"Connect Account"**
5. Log in to your Instagram Business account
6. Confirm connection

### Step 3: Add Instagram Product to Your App
1. Go to: https://developers.facebook.com/apps/
2. Select your app (same one from WhatsApp OR create new)
3. Click **"Add Product"**
4. Find **"Instagram"** → Click **"Set Up"**
5. In setup wizard, select **"Instagram Graph API"**

### Step 4: Generate Access Token
1. Go to: https://developers.facebook.com/tools/explorer/
2. Select your app from dropdown
3. Under **"User or Page"**, select your connected Instagram account
4. Add permissions:
   - `instagram_basic`
   - `instagram_manage_messages`
   - `pages_manage_metadata`
   - `pages_read_engagement`
5. Click **"Generate Access Token"**
6. Log in and authorize
7. **⚠️ COPY AND SAVE THE TOKEN**

### Step 5: Get Instagram Account ID (IGID)
1. Open a terminal or use online tool
2. Make this request (replace `YOUR_TOKEN`):
```bash
curl -X GET "https://graph.facebook.com/v18.0/me/accounts?access_token=YOUR_TOKEN"
```
3. Find your page ID in the response
4. Then get Instagram ID:
```bash
curl -X GET "https://graph.facebook.com/v18.0/PAGE_ID?fields=instagram_business_account&access_token=YOUR_TOKEN"
```
5. Copy the `instagram_business_account.id` value

### Step 6: Enable Instagram Messaging
1. In your Instagram app, go to **Settings** → **Privacy** → **Messages**
2. Make sure **"Allow message requests"** is ON
3. Set **"Message controls"** to allow messages from everyone (for testing)

### Step 7: Test Messaging (Important Limitation!)
⚠️ **Instagram API Limitation**: You can ONLY reply to messages users send YOU first!
- Users must message your Instagram account first
- Then your API can reply within 24 hours
- You CANNOT initiate conversations via API

**Testing Steps**:
1. Have a friend message your Instagram Business account
2. Use the API to reply to that message

### ✅ What You Need for .env:
```env
# Meta Instagram Configuration
INSTAGRAM_API_URL=https://graph.facebook.com/v18.0
INSTAGRAM_ACCOUNT_ID=17841405309211844
INSTAGRAM_ACCESS_TOKEN=EAAKEx4ZABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789
```

---

## 🎯 RECOMMENDED SETUP ORDER

### Day 1 (Today) - 30 minutes:
1. ✅ **AWS SNS** (SMS) - 20 min - **DO THIS FIRST!**
2. ✅ Test SMS sending with curl command

### Day 2 - 1 hour:
3. ✅ **Meta Developer Account** + **WhatsApp Test Setup** - 45 min
4. ✅ Test WhatsApp with temporary token

### Day 3-7 (Optional):
5. ⏰ **WhatsApp Business Verification** (if needed for production)
6. ⏰ **Instagram Setup** (if you want Instagram messaging)

---

## 🧪 Testing Your API Keys

### Test SMS (AWS SNS):
```bash
# In PowerShell
$env:AWS_REGION="us-east-1"
$env:AWS_ACCESS_KEY_ID="your_access_key"
$env:AWS_SECRET_ACCESS_KEY="your_secret_key"

# Then test in your app with this endpoint
curl -X POST http://localhost:3000/api/multi-channel/channel-status
```

### Test WhatsApp:
```bash
# Test if token works
curl -X GET "https://graph.facebook.com/v18.0/me?access_token=YOUR_WHATSAPP_TOKEN"
```

### Test Instagram:
```bash
# Test if token works
curl -X GET "https://graph.facebook.com/v18.0/INSTAGRAM_ACCOUNT_ID?fields=name,username&access_token=YOUR_INSTAGRAM_TOKEN"
```

---

## 💰 Cost Summary

| Service | Free Tier | Cost After Free Tier |
|---------|-----------|---------------------|
| **AWS SNS (SMS)** | First 100 SMS free (first month) | $0.00645 per SMS (USA) |
| **OpenAI** | You already have key | ~$0.0001 per adaptation |
| **WhatsApp** | 1,000 conversations/month FREE forever | $0.005-$0.09 per conversation after |
| **Instagram** | **Completely FREE** | No charges |

**Estimate for 1,000 campaigns**:
- SMS: $6.45
- WhatsApp: $0 (within free tier)
- Instagram: $0 (always free)
- OpenAI adaptations: $0.10
- **Total: ~$6.55 for 1,000 multi-channel campaigns**

---

## ❓ Common Issues

### AWS SNS Issues:
- **"Phone number is not verified"**: You're in sandbox mode, verify your test number first
- **"Rate exceeded"**: Default limit is 1 SMS/sec, request increase in SNS console
- **"Invalid parameter: PhoneNumber"**: Must use E.164 format: `+1234567890`

### WhatsApp Issues:
- **"Access token expired"**: Temporary tokens expire in 24 hours, generate permanent token
- **"Phone number not registered"**: Add test number in API Setup → Manage phone numbers
- **"This message is sent outside the 24-hour window"**: User must message you first, or use templates

### Instagram Issues:
- **"Invalid user ID"**: Make sure you're using Instagram Business Account ID, not personal
- **"Cannot send message"**: Instagram API can ONLY reply to incoming messages, not initiate
- **"Access token invalid"**: Regenerate token with correct permissions

---

## 🆘 Need Help?

1. **AWS SNS**: https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html
2. **WhatsApp API**: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
3. **Instagram API**: https://developers.facebook.com/docs/instagram-api/guides/messaging

---

## ✅ Next Steps After Getting Keys:

1. Add keys to `.env` file (I'll help you update it)
2. Install dependencies: `npm install @aws-sdk/client-sns`
3. Register routes in `backend/src/routes/index.ts`
4. Test each channel using curl commands
5. Build frontend UI for multi-channel campaigns

**Let me know when you get any of these keys and I'll help you test them!** 🚀
