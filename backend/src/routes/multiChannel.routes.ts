import { Router, type Request, type Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { adaptEmailToAllChannels, regenerateChannelContent, validateChannelContent } from '@src/services/contentAdaptationService';
import { messagingService } from '@src/services/messagingService';
import { smsService } from '@src/services/smsService';
import MultiChannelCampaign from '@src/models/MultiChannelCampaign';
import User from '@src/models/User';
import Organization from '@src/models/Organization';

const router = Router();

/**
 * POST /api/multi-channel/adapt-content
 * Convert email HTML to SMS/WhatsApp/Instagram using AI
 * 🔒 Requires authentication
 */
router.post('/adapt-content', authenticate, async (req: Request, res: Response) => {
  try {
    const { emailHtml, emailSubject } = req.body;
    
    if (!emailHtml || !emailSubject) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'emailHtml and emailSubject are required',
      });
    }
    
    console.log('🤖 Starting content adaptation...');
    
    // Use AI to adapt content
    const adaptedContent = await adaptEmailToAllChannels(emailHtml, emailSubject);
    
    console.log('✅ Content adapted successfully');
    
    res.json({
      success: true,
      content: adaptedContent,
      message: 'Content successfully adapted to all channels',
    });
    
  } catch (error: any) {
    console.error('❌ Content adaptation failed:', error);
    res.status(500).json({
      error: 'Content adaptation failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/multi-channel/regenerate-content
 * Regenerate content for a specific channel with different tone
 * 🔒 Requires authentication
 */
router.post('/regenerate-content', authenticate, async (req: Request, res: Response) => {
  try {
    const { channel, analysis, tone } = req.body;
    
    if (!channel || !analysis) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'channel and analysis are required',
      });
    }
    
    if (!['sms', 'whatsapp', 'instagram'].includes(channel)) {
      return res.status(400).json({
        error: 'Invalid channel',
        message: 'Channel must be sms, whatsapp, or instagram',
      });
    }
    
    console.log(`🔄 Regenerating ${channel} content...`);
    
    const regeneratedContent = await regenerateChannelContent(
      analysis,
      channel as 'sms' | 'whatsapp' | 'instagram',
      tone
    );
    
    res.json({
      success: true,
      channel,
      content: regeneratedContent,
    });
    
  } catch (error: any) {
    console.error('❌ Content regeneration failed:', error);
    res.status(500).json({
      error: 'Content regeneration failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/multi-channel/validate-content
 * Validate content for channel-specific requirements
 * 🔒 Requires authentication
 */
router.post('/validate-content', authenticate, async (req: Request, res: Response) => {
  try {
    const { channel, content } = req.body;
    
    if (!channel || !content) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'channel and content are required',
      });
    }
    
    const validation = validateChannelContent(
      channel as 'sms' | 'whatsapp' | 'instagram',
      content
    );
    
    res.json({
      success: true,
      ...validation,
    });
    
  } catch (error: any) {
    console.error('❌ Content validation failed:', error);
    res.status(500).json({
      error: 'Content validation failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * GET /api/multi-channel/channel-status
 * Check which channels are configured and available
 * 🔒 Requires authentication
 */
router.get('/channel-status', authenticate, async (req: Request, res: Response) => {
  try {
    const status = messagingService.getChannelStatus();
    
    res.json({
      success: true,
      channels: status,
      message: {
        email: status.email ? 'Configured (Mailchimp)' : 'Not configured',
        sms: status.sms ? 'Configured (AWS SNS)' : 'Not configured - Set AWS credentials',
        whatsapp: status.whatsapp ? 'Configured (Meta)' : 'Not configured - Set WHATSAPP_* env vars',
        instagram: status.instagram ? 'Configured (Meta)' : 'Not configured - Set INSTAGRAM_* env vars',
      },
    });
    
  } catch (error: any) {
    console.error('❌ Channel status check failed:', error);
    res.status(500).json({
      error: 'Channel status check failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/multi-channel/estimate-cost
 * Estimate cost for a multi-channel campaign
 * 🔒 Requires authentication
 */
router.post('/estimate-cost', authenticate, async (req: Request, res: Response) => {
  try {
    const { channels, recipientCounts, messageLength } = req.body;
    
    if (!channels || !recipientCounts) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'channels and recipientCounts are required',
      });
    }
    
    const estimates: any = {};
    let totalCost = 0;
    
    // SMS cost estimation
    if (channels.includes('sms') && recipientCounts.sms) {
      const smsEstimate = smsService.estimateCost(
        recipientCounts.sms,
        messageLength?.sms || 160
      );
      estimates.sms = smsEstimate;
      totalCost += smsEstimate.estimatedCost;
    }
    
    // WhatsApp cost estimation (varies by country, using average)
    if (channels.includes('whatsapp') && recipientCounts.whatsapp) {
      const avgCostPerMessage = 0.02; // Average across countries
      const whatsappCost = recipientCounts.whatsapp * avgCostPerMessage;
      estimates.whatsapp = {
        recipientCount: recipientCounts.whatsapp,
        estimatedCost: whatsappCost,
        note: 'First 1,000 conversations/month FREE, then ~$0.02/conversation',
      };
      totalCost += whatsappCost;
    }
    
    // Instagram is always free
    if (channels.includes('instagram') && recipientCounts.instagram) {
      estimates.instagram = {
        recipientCount: recipientCounts.instagram,
        estimatedCost: 0,
        note: 'Instagram DMs are FREE',
      };
    }
    
    // Email cost (if applicable)
    if (channels.includes('email') && recipientCounts.email) {
      estimates.email = {
        recipientCount: recipientCounts.email,
        estimatedCost: 0,
        note: 'Included in Mailchimp plan',
      };
    }
    
    res.json({
      success: true,
      estimates,
      totalCost,
      currency: 'USD',
    });
    
  } catch (error: any) {
    console.error('❌ Cost estimation failed:', error);
    res.status(500).json({
      error: 'Cost estimation failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/multi-channel/campaigns
 * Create and send a multi-channel campaign
 * 🔒 Requires authentication
 */
router.post('/campaigns', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;
    const {
      name,
      channels,
      emailHtml,
      emailSubject,
      recipients,
      useAIAdaptation,
      scheduledFor,
    } = req.body;
    
    // Validate user and organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({
        error: 'No organization assigned',
        message: 'User must belong to an organization',
      });
    }
    
    const organization = await Organization.findById(user.organizationId);
    if (!organization) {
      return res.status(404).json({
        error: 'Organization not found',
      });
    }
    
    // Validate required fields
    if (!name || !channels || !Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'name and channels (array) are required',
      });
    }
    
    // Validate recipients
    if (!recipients || typeof recipients !== 'object') {
      return res.status(400).json({
        error: 'Missing recipients',
        message: 'recipients object is required',
      });
    }
    
    // Ensure at least one recipient list is provided
    const hasRecipients = 
      (recipients.email?.length > 0) ||
      (recipients.sms?.length > 0) ||
      (recipients.whatsapp?.length > 0) ||
      (recipients.instagram?.length > 0);
    
    if (!hasRecipients) {
      return res.status(400).json({
        error: 'No recipients provided',
        message: 'At least one recipient list must be provided',
      });
    }
    
    console.log(`📤 Creating multi-channel campaign: ${name}`);
    console.log(`📢 Channels: ${channels.join(', ')}`);
    
    // Create and send campaign
    const campaign = await messagingService.createAndSendCampaign({
      organizationId: String(user.organizationId),
      createdBy: String(userId),
      name,
      channels,
      emailHtml,
      emailSubject,
      recipients,
      useAIAdaptation: useAIAdaptation ?? true,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    });
    
    res.json({
      success: true,
      campaign: {
        id: campaign._id,
        name: campaign.name,
        channels: campaign.channels,
        status: campaign.status,
        recipientsCount: campaign.recipientsCount,
        metrics: campaign.overallMetrics,
        sentAt: campaign.sentAt,
      },
      message: 'Multi-channel campaign sent successfully!',
    });
    
  } catch (error: any) {
    console.error('❌ Campaign creation failed:', error);
    res.status(500).json({
      error: 'Campaign creation failed',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * GET /api/multi-channel/campaigns
 * Get all multi-channel campaigns for organization
 * 🔒 Requires authentication
 */
router.get('/campaigns', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;
    const { limit = '50', offset = '0', channel } = req.query;
    
    // Get user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({
        error: 'No organization assigned',
      });
    }
    
    // Build query
    const query: any = { organizationId: user.organizationId };
    if (channel) {
      query.channels = channel;
    }
    
    // Get campaigns
    const campaigns = await MultiChannelCampaign.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string))
      .skip(parseInt(offset as string))
      .populate('createdBy', 'name email')
      .lean();
    
    const total = await MultiChannelCampaign.countDocuments(query);
    
    res.json({
      success: true,
      campaigns,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      },
    });
    
  } catch (error: any) {
    console.error('❌ Failed to fetch campaigns:', error);
    res.status(500).json({
      error: 'Failed to fetch campaigns',
      message: error.message || 'Unknown error',
    });
  }
});

/**
 * GET /api/multi-channel/campaigns/:id
 * Get a specific multi-channel campaign
 * 🔒 Requires authentication
 */
router.get('/campaigns/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;
    const { id } = req.params;
    
    // Get user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({
        error: 'No organization assigned',
      });
    }
    
    // Get campaign
    const campaign = await MultiChannelCampaign.findOne({
      _id: id,
      organizationId: user.organizationId,
    })
      .populate('createdBy', 'name email picture')
      .lean();
    
    if (!campaign) {
      return res.status(404).json({
        error: 'Campaign not found',
        message: 'Campaign not found or access denied',
      });
    }
    
    res.json({
      success: true,
      campaign,
    });
    
  } catch (error: any) {
    console.error('❌ Failed to fetch campaign:', error);
    res.status(500).json({
      error: 'Failed to fetch campaign',
      message: error.message || 'Unknown error',
    });
  }
});

export default router;
