import { smsService, SMSMessage, SMSSendResult, SMSBatchResult } from './smsService';
import { whatsappService, WhatsAppMessage, WhatsAppSendResult, WhatsAppBatchResult } from './whatsappService';
import { instagramService, InstagramMessage, InstagramSendResult, InstagramBatchResult } from './instagramService';
import MultiChannelCampaign, { IMultiChannelCampaign, CampaignChannel } from '@src/models/MultiChannelCampaign';
import { adaptEmailToAllChannels } from './contentAdaptationService';

/**
 * Unified interface for sending messages across all channels
 */
export interface UnifiedMessage {
  channel: CampaignChannel;
  recipient: string; // email, phone, or user ID
  content: {
    text?: string;
    html?: string;
    subject?: string;
    mediaUrl?: string;
    templateName?: string;
    templateParams?: string[];
  };
}

export interface UnifiedSendResult {
  channel: CampaignChannel;
  success: boolean;
  recipient: string;
  messageId?: string;
  error?: string;
  cost?: number;
}

export interface CampaignSubmission {
  organizationId: string;
  createdBy: string;
  name: string;
  channels: CampaignChannel[];
  emailHtml?: string;
  emailSubject?: string;
  recipients: {
    email?: string[];
    sms?: string[]; // phone numbers
    whatsapp?: string[]; // phone numbers
    instagram?: string[]; // user IDs
  };
  scheduledFor?: Date;
  useAIAdaptation?: boolean; // Auto-generate SMS/WhatsApp/Instagram from email
}

/**
 * Unified Messaging Service
 * Factory pattern to manage all messaging channels
 */
export class MessagingService {
  
  /**
   * Send a single message to any channel
   */
  async sendMessage(message: UnifiedMessage): Promise<UnifiedSendResult> {
    try {
      switch (message.channel) {
        case 'email':
          // Use existing Mailchimp service (not implemented here)
          throw new Error('Email sending should use existing campaign service');
          
        case 'sms':
          const smsResult = await smsService.sendSMS(
            message.recipient,
            message.content.text || ''
          );
          return {
            channel: 'sms',
            success: smsResult.success,
            recipient: message.recipient,
            messageId: smsResult.messageId,
            error: smsResult.error,
            cost: smsResult.cost,
          };
          
        case 'whatsapp':
          const whatsappResult = message.content.templateName
            ? await whatsappService.sendTemplateMessage(
                message.recipient,
                message.content.templateName,
                message.content.templateParams
              )
            : await whatsappService.sendTextMessage(
                message.recipient,
                message.content.text || ''
              );
          return {
            channel: 'whatsapp',
            success: whatsappResult.success,
            recipient: message.recipient,
            messageId: whatsappResult.messageId,
            error: whatsappResult.error,
          };
          
        case 'instagram':
          const instagramResult = await instagramService.sendTextMessage(
            message.recipient,
            message.content.text || ''
          );
          return {
            channel: 'instagram',
            success: instagramResult.success,
            recipient: message.recipient,
            messageId: instagramResult.messageId,
            error: instagramResult.error,
          };
          
        default:
          throw new Error(`Unsupported channel: ${message.channel}`);
      }
    } catch (error: any) {
      return {
        channel: message.channel,
        success: false,
        recipient: message.recipient,
        error: error.message || 'Unknown error',
      };
    }
  }
  
  /**
   * Send batch messages to multiple recipients on a single channel
   */
  async sendBatchToChannel(
    channel: CampaignChannel,
    recipients: string[],
    content: { text: string; mediaUrl?: string }
  ): Promise<UnifiedSendResult[]> {
    
    switch (channel) {
      case 'sms':
        const smsMessages: SMSMessage[] = recipients.map(phone => ({
          phoneNumber: phone,
          message: content.text,
        }));
        const smsResult = await smsService.sendBatchSMS(smsMessages);
        return [
          ...smsResult.successful.map(r => ({
            channel: 'sms' as CampaignChannel,
            success: true,
            recipient: r.phoneNumber,
            messageId: r.messageId,
            cost: r.cost,
          })),
          ...smsResult.failed.map(r => ({
            channel: 'sms' as CampaignChannel,
            success: false,
            recipient: r.phoneNumber,
            error: r.error,
          })),
        ];
        
      case 'whatsapp':
        const whatsappMessages: WhatsAppMessage[] = recipients.map(phone => ({
          phoneNumber: phone,
          message: content.text,
          mediaUrl: content.mediaUrl,
        }));
        const whatsappResult = await whatsappService.sendBatch(whatsappMessages);
        return [
          ...whatsappResult.successful.map(r => ({
            channel: 'whatsapp' as CampaignChannel,
            success: true,
            recipient: r.phoneNumber,
            messageId: r.messageId,
          })),
          ...whatsappResult.failed.map(r => ({
            channel: 'whatsapp' as CampaignChannel,
            success: false,
            recipient: r.phoneNumber,
            error: r.error,
          })),
        ];
        
      case 'instagram':
        const instagramMessages: InstagramMessage[] = recipients.map(userId => ({
          recipientId: userId,
          message: content.text,
          mediaUrl: content.mediaUrl,
        }));
        const instagramResult = await instagramService.sendBatch(instagramMessages);
        return [
          ...instagramResult.successful.map(r => ({
            channel: 'instagram' as CampaignChannel,
            success: true,
            recipient: r.recipientId,
            messageId: r.messageId,
          })),
          ...instagramResult.failed.map(r => ({
            channel: 'instagram' as CampaignChannel,
            success: false,
            recipient: r.recipientId,
            error: r.error,
          })),
        ];
        
      default:
        throw new Error(`Batch sending not supported for channel: ${channel}`);
    }
  }
  
  /**
   * Create and send a multi-channel campaign
   * This is the main entry point for campaign submission
   */
  async createAndSendCampaign(
    submission: CampaignSubmission
  ): Promise<IMultiChannelCampaign> {
    
    console.log(`🚀 Creating multi-channel campaign: ${submission.name}`);
    console.log(`📢 Channels: ${submission.channels.join(', ')}`);
    
    // Step 1: AI content adaptation (if email provided and AI adaptation enabled)
    let adaptedContent = null;
    if (submission.useAIAdaptation && submission.emailHtml && submission.emailSubject) {
      console.log('🤖 Using AI to adapt email content to other channels...');
      adaptedContent = await adaptEmailToAllChannels(
        submission.emailHtml,
        submission.emailSubject
      );
    }
    
    // Step 2: Create campaign in database
    const campaign = await MultiChannelCampaign.create({
      name: submission.name,
      organizationId: submission.organizationId,
      createdBy: submission.createdBy,
      channels: submission.channels,
      primaryChannel: submission.channels[0],
      content: {
        email: adaptedContent?.email || {
          html: submission.emailHtml || '',
          subject: submission.emailSubject || '',
        },
        sms: adaptedContent?.sms || undefined,
        whatsapp: adaptedContent?.whatsapp || undefined,
        instagram: adaptedContent?.instagram || undefined,
      },
      status: submission.scheduledFor ? 'scheduled' : 'draft',
      scheduledFor: submission.scheduledFor,
      recipientsCount: 
        (submission.recipients.email?.length || 0) +
        (submission.recipients.sms?.length || 0) +
        (submission.recipients.whatsapp?.length || 0) +
        (submission.recipients.instagram?.length || 0),
      aiGenerated: {
        sms: Boolean(adaptedContent?.sms),
        whatsapp: Boolean(adaptedContent?.whatsapp),
        instagram: Boolean(adaptedContent?.instagram),
        model: adaptedContent ? 'gpt-4o-mini' : undefined,
        generatedAt: adaptedContent ? new Date() : undefined,
      },
    });
    
    console.log(`✅ Campaign created in DB: ${campaign._id}`);
    
    // Step 3: Send to each channel
    const results: UnifiedSendResult[] = [];
    
    // SMS
    if (submission.channels.includes('sms') && submission.recipients.sms?.length) {
      console.log(`📱 Sending SMS to ${submission.recipients.sms.length} recipients...`);
      const smsContent = adaptedContent?.sms?.text || submission.emailSubject || '';
      const smsResults = await this.sendBatchToChannel(
        'sms',
        submission.recipients.sms,
        { text: smsContent }
      );
      results.push(...smsResults);
      
      // Update campaign metrics
      const smsSent = smsResults.filter(r => r.success).length;
      const smsFailed = smsResults.filter(r => !r.success).length;
      const smsCost = smsResults.reduce((sum, r) => sum + (r.cost || 0), 0);
      
      campaign.channelMetrics.sms = {
        sent: smsSent,
        delivered: smsSent, // Will be updated via webhooks
        failed: smsFailed,
        clicked: 0,
        cost: smsCost,
      };
      
      // Store external IDs
      campaign.externalIds.awsSns = smsResults
        .filter(r => r.messageId)
        .map(r => r.messageId!);
    }
    
    // WhatsApp - Using Template
    if (submission.channels.includes('whatsapp') && submission.recipients.whatsapp?.length) {
      console.log(`💬 Sending WhatsApp to ${submission.recipients.whatsapp.length} recipients...`);
      
      // Get WhatsApp template name from environment or use default
      const templateName = process.env.WHATSAPP_CAMPAIGN_TEMPLATE || 'emailify_campaign';
      
      // Prepare template parameters from AI-generated content
      const whatsappMessage = adaptedContent?.whatsapp?.text || submission.emailSubject || 'Campaign update';
      
      // Split message into lines for better template formatting
      const messageLines = whatsappMessage.split('\n').filter(line => line.trim());
      const mainMessage = messageLines[0] || whatsappMessage;
      const additionalInfo = messageLines.slice(1).join(' ') || 'Learn more';
      
      console.log(`📋 Using template: ${templateName}`);
      console.log(`📝 Message: ${mainMessage}`);
      
      const whatsappResults: UnifiedSendResult[] = [];
      
      // Send to each recipient
      for (const phoneNumber of submission.recipients.whatsapp) {
        try {
          const result = await whatsappService.sendTemplateMessage(
            phoneNumber,
            templateName,
            [
              'Customer',           // {{1}} - Recipient name (you can personalize this)
              mainMessage,          // {{2}} - Main AI-generated message
              additionalInfo        // {{3}} - Additional info or CTA
            ],
            'en_US'
          );
          
          whatsappResults.push({
            channel: 'whatsapp',
            success: result.success,
            recipient: phoneNumber,
            messageId: result.messageId,
            error: result.error,
          });
        } catch (error: any) {
          whatsappResults.push({
            channel: 'whatsapp',
            success: false,
            recipient: phoneNumber,
            error: error.message,
          });
        }
      }
      
      results.push(...whatsappResults);
      
      // Update campaign metrics
      const whatsappSent = whatsappResults.filter(r => r.success).length;
      const whatsappFailed = whatsappResults.filter(r => !r.success).length;
      
      campaign.channelMetrics.whatsapp = {
        sent: whatsappSent,
        delivered: whatsappSent,
        failed: whatsappFailed,
        read: 0,
        replied: 0,
        clicked: 0,
        cost: 0, // Will be calculated from Meta billing
      };
      
      // Store external IDs
      campaign.externalIds.meta = whatsappResults
        .filter(r => r.messageId)
        .map(r => r.messageId!);
    }
    
    // Instagram
    if (submission.channels.includes('instagram') && submission.recipients.instagram?.length) {
      console.log(`📸 Sending Instagram DMs to ${submission.recipients.instagram.length} recipients...`);
      const instagramContent = adaptedContent?.instagram?.text || submission.emailSubject || '';
      const instagramResults = await this.sendBatchToChannel(
        'instagram',
        submission.recipients.instagram,
        { text: instagramContent }
      );
      results.push(...instagramResults);
      
      // Update campaign metrics
      const instagramSent = instagramResults.filter(r => r.success).length;
      const instagramFailed = instagramResults.filter(r => !r.success).length;
      
      campaign.channelMetrics.instagram = {
        sent: instagramSent,
        delivered: instagramSent,
        failed: instagramFailed,
        read: 0,
        replied: 0,
        cost: 0, // Instagram is free
      };
    }
    
    // Step 4: Update overall metrics
    const totalSent = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success).length;
    const totalCost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
    
    campaign.overallMetrics = {
      totalSent,
      totalDelivered: totalSent, // Initial value
      totalFailed,
      totalCost,
      deliveryRate: totalSent / (totalSent + totalFailed) * 100,
      engagementRate: 0, // Will be updated later
    };
    
    // Update status
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    
    await campaign.save();
    
    console.log(`✅ Campaign sent successfully!`);
    console.log(`   Total sent: ${totalSent}`);
    console.log(`   Total failed: ${totalFailed}`);
    console.log(`   Total cost: $${totalCost.toFixed(2)}`);
    
    return campaign;
  }
  
  /**
   * Get channel availability status
   */
  getChannelStatus(): {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
    instagram: boolean;
  } {
    return {
      email: true, // Always available (using Mailchimp)
      sms: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
      whatsapp: whatsappService.isConfigured(),
      instagram: instagramService.isConfigured(),
    };
  }
}

// Export singleton instance
export const messagingService = new MessagingService();
