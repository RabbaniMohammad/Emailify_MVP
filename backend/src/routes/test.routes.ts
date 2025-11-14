import { Router, type Request, type Response } from 'express';
import { adaptEmailToAllChannels } from '@src/services/contentAdaptationService';
import { smsService } from '@src/services/smsService';
import { whatsappService } from '@src/services/whatsappService';

const router = Router();

/**
 * POST /api/test/adapt-content
 * Test AI content adaptation without authentication
 */
router.post('/adapt-content', async (req: Request, res: Response) => {
  try {
    const { emailHtml, campaignName, tone } = req.body;
    
    if (!emailHtml) {
      return res.status(400).json({
        error: 'Missing emailHtml'
      });
    }
    
    console.log('🤖 Testing content adaptation...');
    
    const adaptedContent = await adaptEmailToAllChannels(
      emailHtml,
      campaignName || 'Test Campaign'
    );
    
    res.json({
      success: true,
      adaptedContent,
      metadata: {
        campaignName: campaignName || 'Test Campaign',
        tone: tone || 'default'
      }
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/test/send-sms
 * Test SMS sending without authentication
 */
router.post('/send-sms', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber || !message) {
      return res.status(400).json({
        error: 'Missing phoneNumber or message'
      });
    }
    
    console.log(`📱 Testing SMS to ${phoneNumber}...`);
    
    const result = await smsService.sendSMS(phoneNumber, message);
    
    res.json({
      success: true,
      messageId: result.messageId,
      phoneNumber
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/test/send-whatsapp
 * Test WhatsApp template sending without authentication
 */
router.post('/send-whatsapp', async (req: Request, res: Response) => {
  try {
    const { phoneNumber, templateName, templateParams, languageCode } = req.body;
    
    if (!phoneNumber || !templateName) {
      return res.status(400).json({
        error: 'Missing phoneNumber or templateName'
      });
    }
    
    console.log(`💬 Testing WhatsApp to ${phoneNumber} with template: ${templateName}...`);
    
    const result = await whatsappService.sendTemplateMessage(
      phoneNumber,
      templateName,
      templateParams,
      languageCode || 'en_US'
    );
    
    if (result.success) {
      res.json({
        success: true,
        messageId: result.messageId,
        phoneNumber,
        template: templateName
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        phoneNumber
      });
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * GET /api/test/whatsapp-templates
 * List available WhatsApp templates
 */
router.get('/whatsapp-templates', async (req: Request, res: Response) => {
  try {
    const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    
    if (!WABA_ID || !ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'WhatsApp not configured. Missing WHATSAPP_BUSINESS_ACCOUNT_ID or WHATSAPP_ACCESS_TOKEN'
      });
    }
    
    console.log('📋 Fetching WhatsApp templates...');
    
    const axios = require('axios');
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${WABA_ID}/message_templates`,
      {
        headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` },
        params: { 
          fields: 'name,status,category,language,components',
          limit: 100
        }
      }
    );
    
    const templates = response.data.data || [];
    const approved = templates.filter((t: any) => t.status === 'APPROVED');
    const pending = templates.filter((t: any) => t.status === 'PENDING');
    const rejected = templates.filter((t: any) => t.status === 'REJECTED');
    
    res.json({
      success: true,
      templates: {
        all: templates,
        approved,
        pending,
        rejected
      },
      summary: {
        total: templates.length,
        approved: approved.length,
        pending: pending.length,
        rejected: rejected.length
      },
      currentTemplate: process.env.WHATSAPP_CAMPAIGN_TEMPLATE || 'not set'
    });
    
  } catch (error: any) {
    console.error('❌ Error fetching templates:', error.response?.data || error.message);
    res.status(500).json({
      error: error.response?.data?.error?.message || error.message
    });
  }
});

/**
 * GET /api/test/channel-status
 * Check which channels are configured
 */
router.get('/channel-status', async (req: Request, res: Response) => {
  try {
    const status = {
      sms: {
        configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        region: process.env.AWS_REGION || 'not set'
      },
      whatsapp: {
        configured: !!process.env.WHATSAPP_ACCESS_TOKEN
      },
      instagram: {
        configured: !!process.env.INSTAGRAM_ACCESS_TOKEN
      },
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'not set'
      }
    };
    
    res.json({
      success: true,
      channels: status
    });
    
  } catch (error: any) {
    res.status(500).json({
      error: error.message
    });
  }
});

/**
 * POST /api/test/estimate-cost
 * Estimate campaign costs
 */
router.post('/estimate-cost', async (req: Request, res: Response) => {
  try {
    const { channels, recipientCounts } = req.body;
    
    const estimates = {
      sms: recipientCounts.sms ? (recipientCounts.sms * 0.00645).toFixed(2) : '0.00',
      whatsapp: recipientCounts.whatsapp ? 
        (recipientCounts.whatsapp <= 1000 ? '0.00 (free tier)' : ((recipientCounts.whatsapp - 1000) * 0.005).toFixed(2)) 
        : '0.00',
      instagram: '0.00 (always free)',
      total: 0
    };
    
    estimates.total = parseFloat(estimates.sms) + 
      (typeof estimates.whatsapp === 'string' && estimates.whatsapp.includes('free') ? 0 : parseFloat(estimates.whatsapp as string));
    
    res.json({
      success: true,
      estimates,
      currency: 'USD'
    });
    
  } catch (error: any) {
    res.status(500).json({
      error: error.message
    });
  }
});

export default router;
