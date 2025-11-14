# 🔑 API Keys Quick Reference

## Where to Get Each API Key

### 1. **AWS SNS (SMS)** - ⏱️ 15 minutes
📍 **URL**: https://console.aws.amazon.com
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```
**Steps**:
1. Create AWS account → https://aws.amazon.com
2. Go to IAM → Users → Create access key
3. Download CSV with credentials
4. Enable SNS SMS → https://console.aws.amazon.com/sns

---

### 2. **OpenAI (AI Content)** - ⏱️ 5 minutes
📍 **URL**: https://platform.openai.com/api-keys
```bash
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
**Steps**:
1. Sign up → https://platform.openai.com/signup
2. Add payment method → https://platform.openai.com/account/billing
3. Create API key → https://platform.openai.com/api-keys
4. Copy key (starts with `sk-proj-`)

---

### 3. **WhatsApp (Meta)** - ⏱️ 3-7 days
📍 **URL**: https://developers.facebook.com/apps
```bash
WHATSAPP_PHONE_NUMBER_ID=102380xxxxxxxxxx
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
**Steps**:
1. Create Meta Business account → https://business.facebook.com
2. Create app → https://developers.facebook.com/apps
3. Add WhatsApp product
4. Verify business (2-3 days)
5. Get Phone Number ID from WhatsApp → API Setup
6. Generate access token

---

### 4. **Instagram (Meta)** - ⏱️ 1-2 days
📍 **URL**: https://developers.facebook.com/apps
```bash
INSTAGRAM_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
INSTAGRAM_PAGE_ID=123456789012345
```
**Steps**:
1. Convert Instagram to Business account (in app)
2. Link to Facebook Page
3. Create Meta app → https://developers.facebook.com/apps
4. Add Instagram product
5. Generate Page access token → https://developers.facebook.com/tools/explorer
6. Get Instagram Account ID from Graph API

---

## Complete .env Template

Copy this to your `backend/.env` file:

```bash
# ============================================
# OPENAI - Required for AI content adaptation
# ============================================
OPENAI_API_KEY=sk-proj-your_key_here

# ============================================
# AWS SNS - Required for SMS
# ============================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
SMS_SENDER_ID=Emailify

# ============================================
# WHATSAPP - Optional (for WhatsApp)
# ============================================
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_access_token_here

# ============================================
# INSTAGRAM - Optional (for Instagram DMs)
# ============================================
INSTAGRAM_ACCESS_TOKEN=your_access_token_here
INSTAGRAM_PAGE_ID=your_page_id_here
```

---

## Priority Setup Order

### **Day 1: Core Setup** (20 minutes)
1. ✅ OpenAI API key (5 min) - Required for AI
2. ✅ AWS SNS credentials (15 min) - Required for SMS
3. ✅ Test SMS sending

### **Week 1: Add WhatsApp** (if needed)
1. Start business verification (Day 1)
2. Wait for approval (2-3 days)
3. Get credentials (Day 4-5)
4. Test WhatsApp (Day 5-7)

### **Week 2: Add Instagram** (if needed)
1. Convert Instagram to Business
2. Create Meta app
3. Get credentials
4. Test Instagram DMs

---

## Testing Your Keys

### Test OpenAI
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hi"}]}'
```

### Test AWS SNS
```bash
aws sns publish \
  --phone-number "+12025551234" \
  --message "Test from Emailify" \
  --region us-east-1
```

### Test WhatsApp
```bash
curl -X POST "https://graph.facebook.com/v18.0/$WHATSAPP_PHONE_NUMBER_ID/messages" \
  -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"12025551234","type":"template","template":{"name":"hello_world","language":{"code":"en_US"}}}'
```

### Test Instagram
```bash
curl -X POST "https://graph.facebook.com/v18.0/me/messages" \
  -H "Authorization: Bearer $INSTAGRAM_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":{"id":"USER_ID"},"message":{"text":"Test"}}'
```

---

## Quick Troubleshooting

| Error | Solution |
|-------|----------|
| `OPENAI_API_KEY not found` | Add to .env file |
| `AWS credentials not found` | Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY |
| `WhatsApp template not approved` | Wait 2-24 hours or use "hello_world" |
| `Instagram user not found` | User must message you first |
| `Process is not defined` | Install @types/node |

---

## Cost Summary

| Service | Free Tier | Pay-As-You-Go |
|---------|-----------|---------------|
| OpenAI | $5 credit | ~$0.0001/adaptation |
| AWS SNS | None | $0.00645/SMS |
| WhatsApp | 1,000/month | $0.005-0.04/message |
| Instagram | Unlimited | FREE |

**Example**: 10,000 multi-channel messages
- SMS: $64.50
- WhatsApp: $0 (if under 1K) or ~$50-400
- Instagram: $0
- AI adaptation: $1
- **Total: ~$65-465**

---

## Need More Help?

📖 **Detailed Guides**:
- `MULTI_CHANNEL_SETUP_GUIDE.md` - Complete step-by-step setup
- `QUICK_START_MULTI_CHANNEL.md` - Quick start & API examples
- `IMPLEMENTATION_SUMMARY.md` - What's implemented

🔗 **Useful Links**:
- AWS Console: https://console.aws.amazon.com
- OpenAI Dashboard: https://platform.openai.com
- Meta Developers: https://developers.facebook.com
- WhatsApp Manager: https://business.facebook.com/wa/manage

💬 **Support**:
- AWS SNS Docs: https://docs.aws.amazon.com/sns
- OpenAI Docs: https://platform.openai.com/docs
- WhatsApp API: https://developers.facebook.com/docs/whatsapp
- Instagram API: https://developers.facebook.com/docs/instagram-api

---

**🚀 Ready to start?** Follow the priority setup order above!
