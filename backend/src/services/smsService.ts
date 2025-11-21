// Twilio-based SMS Service (preferred)
// To enable: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in your env and run `npm install twilio`

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
 * Twilio SMS Service
 * Configure via env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * Optional env: TWILIO_SMS_COST (USD per message estimate)
 */
export class SMSService {
  private twilioClient: any | null = null;
  private readonly SMS_COST_PER_MESSAGE: number;
  private readonly fromNumber: string;

  constructor() {
    this.SMS_COST_PER_MESSAGE = parseFloat(process.env.TWILIO_SMS_COST || process.env.SMS_COST_PER_MESSAGE || '0.00645');
    this.fromNumber = process.env.TWILIO_FROM || process.env.SMS_SENDER_ID || '';

    const sid = process.env.TWILIO_ACCOUNT_SID || '';
    const token = process.env.TWILIO_AUTH_TOKEN || '';

    if (sid && token) {
      try {
        // Require dynamically so unit tests or environments without twilio installed don't crash at import time
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Twilio = require('twilio');
        this.twilioClient = new Twilio(sid, token);
      } catch (err) {
        console.warn('Twilio client not installed. Run `npm install twilio` to enable SMS via Twilio.');
        this.twilioClient = null;
      }
    }
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
        console.warn(`⚠️ SMS message exceeds 160 chars (${message.length}). May be sent as multiple segments.`);
      }

      if (!this.twilioClient) {
        throw new Error('Twilio client not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and install the twilio package.');
      }

      // Use Twilio to send SMS
      const from = this.fromNumber || undefined;
      const resp = await this.twilioClient.messages.create({
        body: message,
        to: phoneNumber,
        from,
      });

      const messageCount = Math.ceil(message.length / 160);
      const cost = messageCount * this.SMS_COST_PER_MESSAGE;

      console.log(`✅ SMS sent via Twilio to ${phoneNumber} | SID: ${resp.sid} | Cost est: $${cost.toFixed(4)}`);

      return {
        success: true,
        messageId: resp.sid,
        phoneNumber,
        cost,
      };
    } catch (error: any) {
      console.error(`❌ Failed to send SMS to ${phoneNumber}:`, error?.message || error);
      return {
        success: false,
        phoneNumber,
        error: error?.message || 'Unknown error',
      };
    }
  }
  
  /**
   * Send SMS to multiple recipients in parallel
   * Note: AWS SNS doesn't have true batch API for SMS, so we send in parallel
   */
  async sendBatchSMS(recipients: SMSMessage[]): Promise<SMSBatchResult> {
    console.log(`📤 Sending SMS batch to ${recipients.length} recipients...`);

    if (!this.twilioClient) {
      // Fall back: attempt to send each (will error) so the caller receives failures
      const fallbackResults = await Promise.allSettled(
        recipients.map(r => this.sendSMS(r.phoneNumber, r.message))
      );
      const successful: SMSSendResult[] = [];
      const failed: SMSSendResult[] = [];
      let totalCost = 0;
      fallbackResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          successful.push(result.value);
          totalCost += result.value.cost || 0;
        } else {
          failed.push({ success: false, phoneNumber: recipients[index].phoneNumber, error: result.status === 'rejected' ? result.reason : result.value.error });
        }
      });
      return { successful, failed, totalSent: successful.length, totalFailed: failed.length, totalCost };
    }

    // Twilio supports high-volume sends via Messaging Services; here we parallelize for simplicity
    const results = await Promise.allSettled(
      recipients.map(recipient => this.sendSMS(recipient.phoneNumber, recipient.message))
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
        failed.push({ success: false, phoneNumber, error: result.status === 'rejected' ? result.reason : result.value.error });
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
    // Twilio does not expose an equivalent GetSMSAttributes API. Return configured values or placeholders.
    return {
      monthlySpendLimit: process.env.SMS_MONTHLY_LIMIT || 'Not set',
      maxPrice: process.env.SMS_MAX_PRICE || String(this.SMS_COST_PER_MESSAGE),
      defaultSMSType: 'Promotional',
    };
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
