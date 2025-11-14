# 🚀 Multi-Channel Campaign Setup Guide

Complete guide to get API keys and configure SMS, WhatsApp, and Instagram messaging for your Emailify platform.

---

## 📋 **Table of Contents**

1. [AWS SNS (SMS) Setup](#1-aws-sns-sms-setup) - **Start Here** ⭐
2. [OpenAI Setup (Content Adaptation)](#2-openai-setup)
3. [WhatsApp Business API Setup](#3-whatsapp-business-api-setup)
4. [Instagram Messaging API Setup](#4-instagram-messaging-api-setup)
5. [Environment Variables](#5-environment-variables)
6. [Testing Your Setup](#6-testing-your-setup)

---

## 1. **AWS SNS (SMS) Setup**

### ⏱️ **Setup Time**: 15 minutes
### 💰 **Cost**: $0.00645 per SMS (cheapest option)
### 🎯 **Recommended**: Start here - easiest and fastest!

### **Step 1: Create AWS Account**
1. Go to: https://aws.amazon.com
2. Click **Create an AWS Account**
3. Enter email, password, and AWS account name
4. Add payment method (won't be charged unless you send SMS)
5. Verify your identity (phone verification)
6. Choose **Free Tier** plan

### **Step 2: Get AWS Credentials**
1. Log into AWS Console: https://console.aws.amazon.com
2. Click your name (top right) → **Security Credentials**
3. Scroll to **Access Keys** section
4. Click **Create access key**
5. Choose **Application running on an AWS compute service** or **Other**
6. Download the credentials CSV (IMPORTANT: Save this file!)
7. You'll get:
   - `Access Key ID` (looks like: AKIAIOSFODNN7EXAMPLE)
   - `Secret Access Key` (looks like: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY)

### **Step 3: Enable SMS in SNS**
1. Go to SNS Console: https://console.aws.amazon.com/sns
2. Select region: **US East (N. Virginia)** or your preferred region
3. In left sidebar, click **Text messaging (SMS)**
4. Click **Manage SMS settings**
5. Set monthly spending limit (e.g., $100)
6. Set default message type: **Promotional** (cheaper) or **Transactional** (higher priority)
7. Click **Save changes**

### **Step 4: Request SMS Spending Increase (Optional)**
- Default limit: $1/month (~ 150 SMS)
- To increase:
  1. Go to: https://console.aws.amazon.com/support/home#/case/create
  2. Choose **Service limit increase**
  3. Select **SNS Text Messaging**
  4. Request new limit (e.g., $1,000/month)
  5. Usually approved within 24 hours

### **📝 Environment Variables**
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
SMS_SENDER_ID=Emailify  # Optional: Your brand name (max 11 chars)
```

### **✅ Test SMS**
```bash
# Using AWS CLI
aws sns publish --phone-number "+12025551234" --message "Test from Emailify!" --region us-east-1
```

---

## 2. **OpenAI Setup (Content Adaptation)**

### ⏱️ **Setup Time**: 5 minutes
### 💰 **Cost**: ~$0.10 per 1,000 adaptations (very cheap)

### **Step 1: Create OpenAI Account**
1. Go to: https://platform.openai.com/signup
2. Sign up with email or Google
3. Verify email

### **Step 2: Add Payment Method**
1. Go to: https://platform.openai.com/account/billing
2. Click **Add payment method**
3. Add credit card
4. Add $10-$20 credit (will last months)

### **Step 3: Get API Key**
1. Go to: https://platform.openai.com/api-keys
2. Click **Create new secret key**
3. Name it: "Emailify Content Adaptation"
4. Copy the key (looks like: `sk-proj-xxxxx...`)
5. **IMPORTANT**: Save immediately - you can't see it again!

### **📝 Environment Variables**
```bash
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### **✅ Test OpenAI**
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Say hello!"}]
  }'
```

---

## 3. **WhatsApp Business API Setup**

### ⏱️ **Setup Time**: 3-7 days (due to verification)
### 💰 **Cost**: First 1,000 conversations/month FREE, then $0.005-0.04/conversation
### ⚠️ **Note**: Requires business verification

### **Step 1: Create Meta Business Account**
1. Go to: https://business.facebook.com
2. Click **Create Account**
3. Enter your business name and details
4. Verify your email

### **Step 2: Set Up WhatsApp Business**
1. Go to: https://business.facebook.com/wa/manage/home
2. Click **Get Started** with WhatsApp Business Platform
3. Choose **Use the Cloud API** (recommended)
4. Click **Continue**

### **Step 3: Create WhatsApp Business App**
1. Go to: https://developers.facebook.com/apps
2. Click **Create App**
3. Choose **Business** as app type
4. Enter app name: "Emailify Campaigns"
5. Add **WhatsApp** product to your app

### **Step 4: Business Verification** ⚠️ (Takes 2-3 days)
1. In Meta Business Suite, go to **Business Settings**
2. Click **Security Center** → **Start verification**
3. Upload documents:
   - Business registration certificate
   - Proof of address (utility bill/bank statement)
   - Government-issued ID
4. Wait for approval (usually 2-3 days)

### **Step 5: Phone Number Setup**
1. In WhatsApp Manager: https://business.facebook.com/wa/manage/phone-numbers
2. Click **Add phone number**
3. Choose one:
   - **Test number** (Meta provides - 50 messages/day limit)
   - **Your own number** (requires verification)
4. Verify phone number with OTP

### **Step 6: Get Access Token**
1. Go to your WhatsApp app in Meta Developers
2. Navigate to **WhatsApp** → **API Setup**
3. Copy the **Temporary Access Token** (valid 24 hours)
4. For permanent token:
   - Go to **Settings** → **Basic**
   - Generate **System User Token**
   - Grant permissions: `whatsapp_business_messaging`, `whatsapp_business_management`

### **Step 7: Get Phone Number ID**
1. In WhatsApp API Setup page
2. Find **Phone Number ID** (looks like: 102380xxxxxxxxxx)
3. Copy it

### **Step 8: Create Message Templates** (Required!)
WhatsApp requires pre-approved templates for marketing messages:

1. Go to: https://business.facebook.com/wa/manage/message-templates
2. Click **Create Template**
3. Example template:
   ```
   Name: campaign_promotion
   Category: Marketing
   Language: English
   
   Body:
   Hey {{1}}! 👋
   
   {{2}}
   
   Check it out: {{3}}
   
   Reply STOP to unsubscribe
   ```
4. Submit for approval (takes 2-24 hours)

### **📝 Environment Variables**
```bash
WHATSAPP_PHONE_NUMBER_ID=102380xxxxxxxxxx
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345  # Optional
```

### **✅ Test WhatsApp**
```bash
curl -X POST "https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "12025551234",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": { "code": "en_US" }
    }
  }'
```

---

## 4. **Instagram Messaging API Setup**

### ⏱️ **Setup Time**: 1-2 days
### 💰 **Cost**: 100% FREE! ✨
### ⚠️ **Note**: Only works with users who messaged you first

### **Step 1: Create Instagram Business Account**
1. Download Instagram app on your phone
2. Go to **Settings** → **Account** → **Switch to Professional Account**
3. Choose **Business**
4. Connect to a Facebook Page (required)

### **Step 2: Connect Facebook Page**
1. If you don't have a Facebook Page:
   - Go to: https://www.facebook.com/pages/create
   - Create a page for your business
2. Link Instagram to this page:
   - In Instagram: Settings → **Account** → **Linked Accounts**
   - Link your Facebook Page

### **Step 3: Create Meta App**
1. Go to: https://developers.facebook.com/apps
2. Click **Create App**
3. Choose **Business** type
4. Enter app name: "Emailify Instagram"
5. Add **Instagram** product

### **Step 4: Get Page Access Token**
1. Go to: https://developers.facebook.com/tools/explorer
2. Select your app
3. Click **Generate Access Token**
4. Grant permissions:
   - `pages_show_list`
   - `pages_messaging`
   - `instagram_basic`
   - `instagram_manage_messages`
5. Copy the access token

### **Step 5: Get Instagram Account ID**
1. In Graph API Explorer: https://developers.facebook.com/tools/explorer
2. Enter query: `me/accounts?fields=instagram_business_account`
3. Copy the `instagram_business_account` ID

### **Step 6: Get Long-Lived Token** (Optional but recommended)
```bash
curl -X GET "https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=YOUR_APP_ID&client_secret=YOUR_APP_SECRET&fb_exchange_token=YOUR_SHORT_TOKEN"
```

### **📝 Environment Variables**
```bash
INSTAGRAM_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
INSTAGRAM_PAGE_ID=123456789012345
INSTAGRAM_ACCOUNT_ID=17841xxxxxxxxxx  # Optional
```

### **✅ Test Instagram**
```bash
curl -X POST "https://graph.facebook.com/v18.0/me/messages" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": {"id": "USER_INSTAGRAM_ID"},
    "message": {"text": "Hello from Emailify!"}
  }'
```

---

## 5. **Environment Variables**

### **Complete .env File**

```bash
# ============================================
# EXISTING VARIABLES (Email/Mailchimp)
# ============================================
MAILCHIMP_API_KEY=your_mailchimp_api_key
MAILCHIMP_DC=us1
MC_AUDIENCE_ID=your_audience_id

# ============================================
# OPENAI (Content Adaptation)
# ============================================
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ============================================
# AWS SNS (SMS)
# ============================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
SMS_SENDER_ID=Emailify  # Optional: Brand name (max 11 chars)

# ============================================
# WHATSAPP (Meta Business API)
# ============================================
WHATSAPP_PHONE_NUMBER_ID=102380xxxxxxxxxx
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345  # Optional

# ============================================
# INSTAGRAM (Meta Messaging API)
# ============================================
INSTAGRAM_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
INSTAGRAM_PAGE_ID=123456789012345
INSTAGRAM_ACCOUNT_ID=17841xxxxxxxxxx  # Optional

# ============================================
# DATABASE (Existing)
# ============================================
MONGODB_URI=mongodb://localhost:27017/emailify
```

---

## 6. **Testing Your Setup**

### **Backend Test Endpoints**

#### **Test 1: Check Channel Status**
```bash
curl -X GET http://localhost:3000/api/multi-channel/channel-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "channels": {
    "email": true,
    "sms": true,
    "whatsapp": true,
    "instagram": true
  }
}
```

#### **Test 2: AI Content Adaptation**
```bash
curl -X POST http://localhost:3000/api/multi-channel/adapt-content \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emailHtml": "<h1>Black Friday Sale!</h1><p>Get 50% off everything today only!</p>",
    "emailSubject": "🎉 Black Friday: 50% OFF Everything!"
  }'
```

Expected response:
```json
{
  "success": true,
  "content": {
    "sms": {
      "text": "🎉 BLACK FRIDAY! 50% OFF everything. Shop now: bit.ly/bf-sale Ends tonight! ⏰",
      "characterCount": 82
    },
    "whatsapp": {
      "text": "Hey there! 👋\n\nBlack Friday is HERE! 🎉\n\n✨ 50% off everything\n🚚 Free shipping\n⏰ Today only!\n\nShop now: [link]\n\nReply STOP to unsubscribe"
    },
    "instagram": {
      "text": "Heyyy! 💜\n\nBlack Friday deals are LIVE! 🔥\n\n50% OFF everything! 😱\n\nDon't miss out! 🏃‍♀️\n\nTap the link 🔗\n\n[Image attached]"
    }
  }
}
```

#### **Test 3: Send Test SMS**
```bash
curl -X POST http://localhost:3000/api/multi-channel/campaigns \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test SMS Campaign",
    "channels": ["sms"],
    "recipients": {
      "sms": ["+12025551234"]
    },
    "emailHtml": "<h1>Test</h1>",
    "emailSubject": "Test Campaign",
    "useAIAdaptation": true
  }'
```

---

## 7. **Package Installation**

Install required npm packages:

```bash
cd backend

# AWS SDK for SMS
npm install @aws-sdk/client-sns

# OpenAI for AI content adaptation
npm install openai

# Cheerio for HTML parsing
npm install cheerio
npm install --save-dev @types/cheerio

# Fetch API (if not available)
npm install node-fetch@2
npm install --save-dev @types/node-fetch@2
```

---

## 8. **Common Issues & Solutions**

### **Issue: AWS SNS "InvalidParameter" error**
**Solution**: Ensure phone numbers are in E.164 format (+12025551234)

### **Issue: WhatsApp "Template not approved"**
**Solution**: Wait for template approval (2-24 hours) or use test template "hello_world"

### **Issue: Instagram "User not found"**
**Solution**: User must message your Instagram account first before you can DM them

### **Issue: OpenAI "Rate limit exceeded"**
**Solution**: Add payment method at https://platform.openai.com/account/billing

### **Issue: "Process is not defined" in TypeScript**
**Solution**: Add to tsconfig.json:
```json
{
  "compilerOptions": {
    "types": ["node"]
  }
}
```

---

## 9. **Cost Summary**

| Channel | Setup Cost | Per Message Cost | Free Tier | Best For |
|---------|------------|------------------|-----------|----------|
| **SMS (AWS SNS)** | $0 | $0.00645 | None | Urgent messages, OTPs |
| **WhatsApp** | $0 | $0.005-0.04 | 1,000/month | Customer engagement |
| **Instagram** | $0 | $0 (FREE) | Unlimited | Brand engagement |
| **OpenAI** | $0 | ~$0.0001/adapt | $5 credit | Content adaptation |

### **Example Campaign Costs**:
- **10,000 SMS**: $64.50
- **10,000 WhatsApp**: ~$50-400 (varies by country)
- **10,000 Instagram**: $0 (FREE!)
- **1,000 AI adaptations**: ~$0.10

---

## 🎉 **You're All Set!**

Your multi-channel campaign platform is ready! Start with SMS (easiest), then add WhatsApp and Instagram as needed.

**Questions?** Check the API documentation or test endpoints above.

**Need Help?** Common issues section above covers 90% of problems.

Happy campaigning! 🚀
