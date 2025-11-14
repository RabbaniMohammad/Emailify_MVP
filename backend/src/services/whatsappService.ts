/**
 * WhatsApp Business API Service (Meta Cloud API)
 * Cost: First 1,000 conversations/month FREE, then $0.005-0.04 per conversation
 * A "conversation" = 24-hour messaging window
 */

export interface WhatsAppMessage {
  phoneNumber: string; // Format: +1234567890 (no spaces)
  message: string;
  templateName?: string; // For pre-approved templates
  templateParams?: string[]; // Template variable values
  mediaUrl?: string; // Optional image/video/document URL
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  phoneNumber: string;
  error?: string;
  conversationId?: string;
}

export interface WhatsAppBatchResult {
  successful: WhatsAppSendResult[];
  failed: WhatsAppSendResult[];
  totalSent: number;
  totalFailed: number;
}

/**
 * WhatsApp Service using Meta Business API
 * Requires: Business verification + Phone number verification
 */
export class WhatsAppService {
  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  
  constructor() {
    // Meta WhatsApp Cloud API configuration
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.apiUrl = `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`;
  }
  
  /**
   * Validate WhatsApp is configured
   */
  isConfigured(): boolean {
    return Boolean(this.phoneNumberId && this.accessToken);
  }
  
  /**
   * Send text message (free-form, requires 24-hour window)
   */
  async sendTextMessage(phoneNumber: string, message: string): Promise<WhatsAppSendResult> {
    try {
      if (!this.isConfigured()) {
        throw new Error('WhatsApp not configured. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN');
      }
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneNumber.replace(/[^+\d]/g, ''), // Clean phone number
          type: 'text',
          text: {
            preview_url: true, // Auto-detect and preview URLs
            body: message,
          },
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'WhatsApp API error');
      }
      
      console.log(`✅ WhatsApp sent to ${phoneNumber} | MessageId: ${data.messages[0].id}`);
      
      return {
        success: true,
        messageId: data.messages[0].id,
        phoneNumber,
        conversationId: data.messages[0].conversation_id,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send WhatsApp to ${phoneNumber}:`, error.message);
      
      return {
        success: false,
        phoneNumber,
        error: error.message || 'Unknown error',
      };
    }
  }
  
  /**
   * Send template message (pre-approved, can be sent anytime)
   * Templates must be approved in Meta Business Manager first
   * 
   * @param phoneNumber - Recipient phone (E.164 format: +1234567890)
   * @param templateName - Name of approved template (e.g., 'hello_world', 'emailify_campaign_v1')
   * @param templateParams - Array of parameter values for template variables
   * @param languageCode - Template language (default: 'en_US')
   * 
   * @example
   * // Simple template with no parameters
   * await sendTemplateMessage('+15133065946', 'hello_world');
   * 
   * // Campaign template with parameters
   * await sendTemplateMessage(
   *   '+15133065946',
   *   'emailify_campaign_v1',
   *   ['John', '50% OFF Flash Sale!', 'Shop Now', 'https://example.com/sale']
   * );
   */
  async sendTemplateMessage(
    phoneNumber: string,
    templateName: string,
    templateParams?: string[],
    languageCode: string = 'en_US'
  ): Promise<WhatsAppSendResult> {
    try {
      if (!this.isConfigured()) {
        throw new Error('WhatsApp not configured');
      }
      
      // Build components array if parameters provided
      const components = templateParams && templateParams.length > 0 ? [{
        type: 'body',
        parameters: templateParams.map(param => ({
          type: 'text',
          text: param,
        })),
      }] : undefined;
      
      const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber.replace(/[^+\d]/g, ''), // Clean phone number
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode,
          },
          ...(components && { components }), // Only add if present
        },
      };
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // Enhanced error handling
        const errorMsg = data.error?.message || 'WhatsApp template send failed';
        const errorCode = data.error?.code;
        
        if (errorCode === 132000) {
          throw new Error(`Template '${templateName}' not found or not approved. Check Meta Business Manager.`);
        } else if (errorCode === 132001) {
          throw new Error(`Template parameter count mismatch for '${templateName}'. Expected different number of parameters.`);
        } else if (errorCode === 131026) {
          throw new Error(`Recipient ${phoneNumber} not verified in test mode. Add to whitelist in Meta Dashboard.`);
        }
        
        throw new Error(`${errorMsg} (Code: ${errorCode || 'unknown'})`);
      }
      
      console.log(`✅ WhatsApp template sent to ${phoneNumber} | Template: ${templateName} | MessageId: ${data.messages[0].id}`);
      
      return {
        success: true,
        messageId: data.messages[0].id,
        phoneNumber,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send WhatsApp template to ${phoneNumber}:`, error.message);
      
      return {
        success: false,
        phoneNumber,
        error: error.message,
      };
    }
  }
  
  /**
   * Send media message (image, video, document)
   */
  async sendMediaMessage(
    phoneNumber: string,
    mediaUrl: string,
    caption?: string,
    mediaType: 'image' | 'video' | 'document' = 'image'
  ): Promise<WhatsAppSendResult> {
    try {
      if (!this.isConfigured()) {
        throw new Error('WhatsApp not configured');
      }
      
      const payload: any = {
        messaging_product: 'whatsapp',
        to: phoneNumber.replace(/[^+\d]/g, ''),
        type: mediaType,
      };
      
      payload[mediaType] = {
        link: mediaUrl,
      };
      
      if (caption && (mediaType === 'image' || mediaType === 'video')) {
        payload[mediaType].caption = caption;
      }
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'WhatsApp media send failed');
      }
      
      console.log(`✅ WhatsApp media sent to ${phoneNumber} | Type: ${mediaType}`);
      
      return {
        success: true,
        messageId: data.messages[0].id,
        phoneNumber,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send WhatsApp media to ${phoneNumber}:`, error.message);
      
      return {
        success: false,
        phoneNumber,
        error: error.message,
      };
    }
  }
  
  /**
   * Send to multiple recipients in parallel
   */
  async sendBatch(messages: WhatsAppMessage[]): Promise<WhatsAppBatchResult> {
    console.log(`📤 Sending WhatsApp batch to ${messages.length} recipients...`);
    
    const results = await Promise.allSettled(
      messages.map(msg => {
        if (msg.templateName) {
          return this.sendTemplateMessage(msg.phoneNumber, msg.templateName, msg.templateParams);
        } else if (msg.mediaUrl) {
          return this.sendMediaMessage(msg.phoneNumber, msg.mediaUrl, msg.message);
        } else {
          return this.sendTextMessage(msg.phoneNumber, msg.message);
        }
      })
    );
    
    const successful: WhatsAppSendResult[] = [];
    const failed: WhatsAppSendResult[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value);
      } else {
        const phoneNumber = messages[index].phoneNumber;
        failed.push({
          success: false,
          phoneNumber,
          error: result.status === 'rejected' ? result.reason : result.value.error,
        });
      }
    });
    
    console.log(`✅ WhatsApp batch complete: ${successful.length} sent, ${failed.length} failed`);
    
    return {
      successful,
      failed,
      totalSent: successful.length,
      totalFailed: failed.length,
    };
  }
  
  /**
   * Get message status (delivered, read, etc.)
   */
  async getMessageStatus(messageId: string): Promise<{
    status: string;
    timestamp?: string;
  }> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${messageId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );
      
      const data = await response.json();
      
      return {
        status: data.status || 'unknown',
        timestamp: data.timestamp,
      };
    } catch (error: any) {
      console.error('Failed to get WhatsApp message status:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const whatsappService = new WhatsAppService();
