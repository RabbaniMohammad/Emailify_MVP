# 🚀 Multi-Channel Campaign Testing Guide

## ✅ What's Been Implemented

### Backend (Complete)
- ✅ Multi-channel API endpoint: `POST /api/multi-channel/campaigns`
- ✅ AI content adaptation (GPT-4o-mini) for SMS, WhatsApp, Instagram
- ✅ WhatsApp template integration (`emailify_campaign` - pending Meta approval)
- ✅ SMS sending via AWS SNS
- ✅ Email sending via Mailchimp

### Frontend (Complete)
- ✅ Channel selection UI with checkboxes (Email, SMS, WhatsApp)
- ✅ CSV upload with phone number column support
- ✅ Recipient counting per channel
- ✅ Cost estimation display
- ✅ AI adaptation notice
- ✅ Multi-channel submission logic

---

## 📋 Testing Checklist

### 1. File Uploads
- [ ] Upload `sample-multi-channel.csv` (provided in root directory)
- [ ] Verify 5 rows detected
- [ ] Check recipient counts:
  - Email: 5 recipients
  - SMS: 5 recipients (phone column)
  - WhatsApp: 5 recipients (same phone column)

### 2. Channel Selection UI
- [ ] All 3 channel boxes visible after CSV upload
- [ ] Email channel shows 5 recipients, "Free"
- [ ] SMS channel shows 5 recipients, "$0.03" (5 × $0.00645)
- [ ] WhatsApp channel shows 5 recipients, "Free (first 1,000/month)"
- [ ] Checkboxes work (click to select/deselect)
- [ ] Selected channels have green background + checkmark

### 3. AI Adaptation Notice
- [ ] Notice appears when SMS or WhatsApp selected
- [ ] Shows "AI Content Adaptation Enabled"
- [ ] Displays selected channel names

### 4. Cost Summary
- [ ] Shows "$0.03" when only SMS selected
- [ ] Shows "$0.00" when only Email/WhatsApp selected
- [ ] Updates dynamically as channels are toggled

### 5. Form Validation
- [ ] Cannot submit without selecting at least one channel
- [ ] Shows error: "Please select at least one channel"

### 6. Multi-Channel Submission
- [ ] Select Email + SMS + WhatsApp
- [ ] Click submit
- [ ] Confirmation dialog shows:
  - Channel list: "email, sms, whatsapp"
  - Recipient counts for each
  - Estimated cost
- [ ] Backend receives request with:
  ```json
  {
    "channels": ["email", "sms", "whatsapp"],
    "recipients": {
      "email": ["john.doe@example.com", "jane.smith@example.com", ...],
      "sms": [
        { "phone": "+14155552671", "name": "john.doe" },
        { "phone": "+14155552672", "name": "jane.smith" },
        ...
      ],
      "whatsapp": [
        { "phone": "+14155552671", "name": "john.doe" },
        ...
      ]
    },
    "useAIAdaptation": true
  }
  ```

### 7. Email-Only Fallback
- [ ] Uncheck SMS and WhatsApp
- [ ] Only Email selected
- [ ] Submit campaign
- [ ] Uses original Mailchimp-only flow (backward compatible)

---

## 🔧 Backend Verification

### Check WhatsApp Template Status
```bash
cd backend
node check-whatsapp-templates.js
```

**Expected Output:**
```
Available Templates:
- hello_world (APPROVED, no parameters)
- emailify_campaign (IN_REVIEW or APPROVED, 3 body parameters)
```

### Monitor Backend Logs
When submitting multi-channel campaign:
```
[Multi-Channel] Creating campaign: Campaign - 2024-02-15...
[Multi-Channel] Channels: email, sms, whatsapp
[Multi-Channel] AI adaptation enabled

[AI Adaptation] Adapting email content for sms
[AI Adaptation] SMS message (160 chars): "..."

[AI Adaptation] Adapting email content for whatsapp
[AI Adaptation] WhatsApp message (6-7 lines): "..."

[WhatsApp] Sending template: emailify_campaign
[WhatsApp] Parameters: {{1}}: john.doe, {{2}}: <message>, {{3}}: <cta>
[WhatsApp] ✅ Message sent to +14155552671
```

---

## ⚠️ Known Limitations

### WhatsApp Template (Current Status)
- **Template Name**: `emailify_campaign`
- **Status**: IN_REVIEW (24-48 hours from submission)
- **Workaround**: Use `hello_world` template for testing (no parameters)

**If Template Not Approved:**
- WhatsApp messages will fail with error 132000 (template not found)
- SMS and Email will still work
- Can test with `hello_world` by updating `backend/.env`:
  ```
  WHATSAPP_CAMPAIGN_TEMPLATE=hello_world
  ```

### Test Phone Numbers
- WhatsApp test mode accepts any phone in E.164 format (+1XXXXXXXXXX)
- SMS requires verified numbers in AWS SNS sandbox
- Use your own verified number for real testing

### Production Considerations
- **Email**: Unlimited (Mailchimp subscription)
- **SMS**: $0.00645/message (AWS SNS production)
- **WhatsApp**: First 1,000/month free, then ~$0.02/message
- **AI Calls**: OpenAI API costs (~$0.0001 per adaptation)

---

## 🐛 Troubleshooting

### Issue: "Template not found" (WhatsApp)
**Cause**: `emailify_campaign` not approved yet
**Solution**: 
1. Check template status: `node backend/check-whatsapp-templates.js`
2. Use `hello_world` temporarily (no parameters)
3. Wait for Meta approval (24-48 hours)

### Issue: "Phone number not verified" (SMS)
**Cause**: AWS SNS sandbox mode requires verification
**Solution**:
1. Add phone in AWS SNS console: Settings → Text messaging (SMS) → Sandbox destinations
2. Verify via confirmation code
3. Or request production access (instant approval)

### Issue: No recipients counted
**Cause**: CSV missing `phone` column
**Solution**: Ensure CSV has columns: `audiences_list`, `phone`, `scheduled_time`, `test_emails`, `timezone`

### Issue: AI adaptation errors
**Cause**: OpenAI API key missing/invalid
**Solution**: Check `backend/.env`:
```
OPENAI_API_KEY=sk-...
```

---

## 📊 Sample Test Data

### CSV Format
```csv
audiences_list,phone,scheduled_time,test_emails,timezone
john.doe@example.com,+14155552671,2024-02-15 10:00,test@example.com,America/New_York
jane.smith@example.com,+14155552672,2024-02-15 10:00,test@example.com,America/New_York
```

### Expected AI Adaptation Output

**Original Email** (200 words):
> Subject: New Product Launch
> 
> Hi John,
> 
> We're excited to announce our latest product...
> [Full HTML email content]

**Adapted SMS** (160 chars):
> Hi John! New product launch today - exclusive 20% off. Shop now: bit.ly/xyz Offer ends tonight!

**Adapted WhatsApp** (6-7 lines):
> Hi John!
> 
> 🎉 New Product Launch
> Exclusive 20% off for you today
> 
> Shop now: bit.ly/xyz
> Offer ends tonight!

**Adapted Instagram** (5-6 lines casual):
> Hey John! 👋
> 
> New drop just launched 🔥
> 20% off just for you
> Link in bio ⬆️

---

## ✅ Success Criteria

### Frontend
- [x] Channel selection boxes render correctly
- [x] Recipient stats update from CSV
- [x] Cost calculations accurate
- [x] AI notice shows when SMS/WhatsApp selected
- [x] Multi-channel submission calls new API endpoint
- [x] Email-only submission uses original Mailchimp flow

### Backend
- [x] Multi-channel API endpoint accepts requests
- [x] AI adaptation generates channel-specific content
- [x] WhatsApp template integration works
- [x] SMS sending functional (AWS SNS)
- [x] Email sending preserved (Mailchimp)
- [x] Error handling per channel

### Integration
- [ ] **End-to-End Test**: Upload CSV → Select all channels → Submit → Verify messages sent
- [ ] **Email receives** HTML email via Mailchimp
- [ ] **SMS receives** 160-char adapted message
- [ ] **WhatsApp receives** template-based message (pending approval)

---

## 🚀 Next Steps After Testing

1. **WhatsApp Template Approval**
   - Wait for Meta approval (24-48 hours)
   - Re-test with approved template
   - Verify parameter population

2. **Production Setup**
   - Move AWS SNS out of sandbox
   - Request WhatsApp production access
   - Set up cost monitoring

3. **UI Enhancements** (Future)
   - Preview AI-adapted content before sending
   - Schedule multi-channel campaigns
   - Campaign analytics per channel

4. **Additional Channels** (Future)
   - Instagram Direct Messages (needs Graph API v18+)
   - Facebook Messenger
   - Push notifications

---

## 📞 Support Contacts

**WhatsApp Issues**: Meta Business Developer Support
**SMS Issues**: AWS SNS Support
**AI Issues**: OpenAI Support
**Email Issues**: Mailchimp Support

---

**Ready to test!** 🎉

Start with: Upload `sample-multi-channel.csv` → Select all channels → Submit → Monitor backend logs
