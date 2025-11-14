import { SNSClient, PublishCommand, PublishBatchCommand, GetSMSAttributesCommand } from '@aws-sdk/client-sns';

export interface SMSMessage {
  phoneNumber: string; // Format: +1234567890
  message: string; // Max 160 chars for single SMS
  messageId?: string; // Tracking ID
}

export interface SMSSendResult {
  success: boolean;
  messageId?: string;
  phoneNumber: string;
  error?: string;
  cost?: number; // Estimated cost in USD
}

export interface SMSBatchResult {
  successful: SMSSendResult[];
  failed: SMSSendResult[];
  totalSent: number;
  totalFailed: number;
  totalCost: number;
}

/**
 * AWS SNS SMS Service
 * Cost: ~$0.00645 per SMS (US numbers)
 */
export class SMSService {
  private snsClient: SNSClient;
  private readonly SMS_COST_PER_MESSAGE = 0.00645; // USD
  
  constructor() {
    // Initialize AWS SNS client
    this.snsClient = new SNSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }
  
  /**
   * Validate phone number format (E.164 format required)
   * Example: +12025551234
   */
  validatePhoneNumber(phoneNumber: string): { valid: boolean; error?: string } {
    // Remove spaces and hyphens
    const cleaned = phoneNumber.replace(/[\s-]/g, '');
    
    // Must start with + and contain 10-15 digits
    const e164Regex = /^\+[1-9]\d{9,14}$/;
    
    if (!e164Regex.test(cleaned)) {
      return {
        valid: false,
        error: 'Phone number must be in E.164 format (e.g., +12025551234)',
      };
    }
    
    return { valid: true };
  }
  
  /**
   * Send a single SMS message
   */
  async sendSMS(phoneNumber: string, message: string): Promise<SMSSendResult> {
    try {
      // Validate phone number
      const validation = this.validatePhoneNumber(phoneNumber);
      if (!validation.valid) {
        return {
          success: false,
          phoneNumber,
          error: validation.error,
        };
      }
      
      // Validate message length
      if (message.length > 160) {
        console.warn(`⚠️ SMS message exceeds 160 chars (${message.length}). Will be sent as multiple SMS.`);
      }
      
      // Send SMS via AWS SNS
      const command = new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Promotional', // or 'Transactional'
          },
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: process.env.SMS_SENDER_ID || 'Emailify', // Max 11 chars
          },
        },
      });
      
      const response = await this.snsClient.send(command);
      
      // Calculate cost (multiple messages if > 160 chars)
      const messageCount = Math.ceil(message.length / 160);
      const cost = messageCount * this.SMS_COST_PER_MESSAGE;
      
      console.log(`✅ SMS sent to ${phoneNumber} | MessageId: ${response.MessageId} | Cost: $${cost.toFixed(4)}`);
      
      return {
        success: true,
        messageId: response.MessageId,
        phoneNumber,
        cost,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error.message);
      
      return {
        success: false,
        phoneNumber,
        error: error.message || 'Unknown error',
      };
    }
  }
  
  /**
   * Send SMS to multiple recipients in parallel
   * Note: AWS SNS doesn't have true batch API for SMS, so we send in parallel
   */
  async sendBatchSMS(recipients: SMSMessage[]): Promise<SMSBatchResult> {
    console.log(`📤 Sending SMS batch to ${recipients.length} recipients...`);
    
    // Send all in parallel (AWS SNS handles rate limiting)
    const results = await Promise.allSettled(
      recipients.map(recipient =>
        this.sendSMS(recipient.phoneNumber, recipient.message)
      )
    );
    
    // Categorize results
    const successful: SMSSendResult[] = [];
    const failed: SMSSendResult[] = [];
    let totalCost = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value);
        totalCost += result.value.cost || 0;
      } else {
        const phoneNumber = recipients[index].phoneNumber;
        failed.push({
          success: false,
          phoneNumber,
          error: result.status === 'rejected' ? result.reason : result.value.error,
        });
      }
    });
    
    console.log(`✅ Batch complete: ${successful.length} sent, ${failed.length} failed | Total cost: $${totalCost.toFixed(2)}`);
    
    return {
      successful,
      failed,
      totalSent: successful.length,
      totalFailed: failed.length,
      totalCost,
    };
  }
  
  /**
   * Get SMS sending limits and usage
   */
  async getSMSAttributes(): Promise<{
    monthlySpendLimit: string;
    maxPrice: string;
    defaultSMSType: string;
  }> {
    try {
      const command = new GetSMSAttributesCommand({});
      const response = await this.snsClient.send(command);
      
      return {
        monthlySpendLimit: response.attributes?.MonthlySpendLimit || 'Not set',
        maxPrice: response.attributes?.DefaultSMSType || 'Not set',
        defaultSMSType: response.attributes?.DefaultSMSType || 'Promotional',
      };
    } catch (error: any) {
      console.error('Failed to get SMS attributes:', error);
      throw error;
    }
  }
  
  /**
   * Format phone number to E.164 format
   * Handles common US formats: (202) 555-1234, 202-555-1234, 2025551234
   */
  formatPhoneNumber(phoneNumber: string, defaultCountryCode = '+1'): string {
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If already has country code (11 digits for US)
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return '+' + cleaned;
    }
    
    // If 10 digits, add default country code
    if (cleaned.length === 10) {
      return defaultCountryCode + cleaned;
    }
    
    // If already starts with +, return as is
    if (phoneNumber.startsWith('+')) {
      return phoneNumber.replace(/\D/g, '').replace(/^/, '+');
    }
    
    // Return original if can't format
    return phoneNumber;
  }
  
  /**
   * Estimate cost for a campaign
   */
  estimateCost(recipientCount: number, averageMessageLength: number): {
    messageCount: number;
    estimatedCost: number;
    costPerRecipient: number;
  } {
    const messagesPerRecipient = Math.ceil(averageMessageLength / 160);
    const totalMessages = recipientCount * messagesPerRecipient;
    const estimatedCost = totalMessages * this.SMS_COST_PER_MESSAGE;
    
    return {
      messageCount: totalMessages,
      estimatedCost,
      costPerRecipient: messagesPerRecipient * this.SMS_COST_PER_MESSAGE,
    };
  }
}

// Export singleton instance
export const smsService = new SMSService();
