# 🚀 Quick Start: Multi-Channel Campaigns

## Step 1: Install Dependencies

```bash
cd backend
npm install @aws-sdk/client-sns openai cheerio node-fetch@2
npm install --save-dev @types/cheerio @types/node-fetch@2
```

## Step 2: Add Environment Variables

Add to your `.env` file:

```bash
# OpenAI (Required for AI content adaptation)
OPENAI_API_KEY=sk-proj-your_key_here

# AWS SNS (Required for SMS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
SMS_SENDER_ID=Emailify

# WhatsApp (Optional - for WhatsApp messaging)
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token

# Instagram (Optional - for Instagram DMs)
INSTAGRAM_ACCESS_TOKEN=your_access_token
INSTAGRAM_PAGE_ID=your_page_id
```

## Step 3: Register Multi-Channel Routes

In `backend/src/routes/index.ts`, add:

```typescript
import multiChannelRouter from './multiChannel.routes';

// Add this line with your other routes
apiRouter.use('/multi-channel', multiChannelRouter);
```

## Step 4: Test Your Setup

```bash
# Start backend
cd backend
npm run dev

# Test channel status
curl http://localhost:3000/api/multi-channel/channel-status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Step 5: Use the API

### Example: AI Content Adaptation
```bash
POST /api/multi-channel/adapt-content
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "emailHtml": "<h1>Sale Alert!</h1><p>50% off everything!</p>",
  "emailSubject": "Flash Sale: 50% OFF!"
}
```

Response:
```json
{
  "success": true,
  "content": {
    "sms": {
      "text": "🎉 FLASH SALE! 50% OFF everything. Shop: bit.ly/sale Ends soon! ⏰",
      "characterCount": 68
    },
    "whatsapp": {
      "text": "Hey! 👋\n\n50% OFF FLASH SALE!\n\n✨ Everything discounted...",
      "lineCount": 7
    },
    "instagram": {
      "text": "Heyyy! 💜\n\nFlash sale is LIVE...",
      "lineCount": 6
    }
  }
}
```

### Example: Send Multi-Channel Campaign
```bash
POST /api/multi-channel/campaigns
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "Black Friday Campaign",
  "channels": ["sms", "whatsapp", "instagram"],
  "emailHtml": "<h1>Black Friday!</h1><p>50% off!</p>",
  "emailSubject": "Black Friday: 50% OFF!",
  "recipients": {
    "sms": ["+12025551234", "+13035555678"],
    "whatsapp": ["+14155551234"],
    "instagram": ["instagram_user_id_123"]
  },
  "useAIAdaptation": true
}
```

Response:
```json
{
  "success": true,
  "campaign": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Black Friday Campaign",
    "channels": ["sms", "whatsapp", "instagram"],
    "status": "sent",
    "recipientsCount": 4,
    "metrics": {
      "totalSent": 4,
      "totalCost": 0.02
    }
  }
}
```

## 📚 Full Documentation

See [MULTI_CHANNEL_SETUP_GUIDE.md](./MULTI_CHANNEL_SETUP_GUIDE.md) for:
- ✅ Complete API key setup instructions
- ✅ AWS SNS SMS configuration
- ✅ WhatsApp Business API setup
- ✅ Instagram Messaging API setup
- ✅ Troubleshooting guide

## 🎯 What's Implemented

- ✅ **SMS via AWS SNS** - $0.00645/message
- ✅ **WhatsApp via Meta API** - Free for first 1K/month
- ✅ **Instagram DMs via Meta API** - 100% FREE
- ✅ **AI Content Adaptation** - Converts email to SMS/WhatsApp/Instagram
- ✅ **Multi-Channel Campaign Management**
- ✅ **Cost Estimation**
- ✅ **Analytics & Tracking**

## 🔗 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/multi-channel/adapt-content` | POST | Convert email to all channels using AI |
| `/api/multi-channel/regenerate-content` | POST | Regenerate with different tone |
| `/api/multi-channel/validate-content` | POST | Validate channel-specific requirements |
| `/api/multi-channel/channel-status` | GET | Check which channels are configured |
| `/api/multi-channel/estimate-cost` | POST | Estimate campaign cost |
| `/api/multi-channel/campaigns` | POST | Create and send campaign |
| `/api/multi-channel/campaigns` | GET | List all campaigns |
| `/api/multi-channel/campaigns/:id` | GET | Get campaign details |

## 💡 Quick Tips

1. **Start with SMS (AWS SNS)** - Easiest to set up (15 minutes)
2. **Add WhatsApp later** - Requires business verification (3-7 days)
3. **Instagram is optional** - Only for B2C brands with Instagram presence
4. **Test with small batches** - Use test endpoints before full campaigns

## 🆘 Need Help?

- Check `MULTI_CHANNEL_SETUP_GUIDE.md` for detailed setup instructions
- Test endpoints are in the guide above
- Common issues section covers 90% of problems

Happy campaigning! 🎉
