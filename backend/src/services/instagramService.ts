/**
 * Instagram Messaging API Service (Meta Graph API)
 * Cost: 100% FREE!
 * Note: Can only message users who have messaged your Instagram account first
 */

export interface InstagramMessage {
  recipientId: string; // Instagram-scoped user ID (IGSID)
  message: string;
  mediaUrl?: string; // Optional image/video attachment
}

export interface InstagramSendResult {
  success: boolean;
  messageId?: string;
  recipientId: string;
  error?: string;
}

export interface InstagramBatchResult {
  successful: InstagramSendResult[];
  failed: InstagramSendResult[];
  totalSent: number;
  totalFailed: number;
}

/**
 * Instagram Service using Meta Messaging API
 * Requires: Instagram Business/Creator account + Page access token
 */
export class InstagramService {
  private readonly apiUrl: string;
  private readonly accessToken: string;
  private readonly pageId: string;
  
  constructor() {
    // Meta Instagram Messaging API configuration
    this.accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || '';
    this.pageId = process.env.INSTAGRAM_PAGE_ID || ''; // Connected Facebook Page ID
    this.apiUrl = `https://graph.facebook.com/v18.0/me/messages`;
  }
  
  /**
   * Check if Instagram is configured
   */
  isConfigured(): boolean {
    return Boolean(this.accessToken && this.pageId);
  }
  
  /**
   * Send text message to a user
   * Note: Only works if user has messaged you first (24-hour window)
   */
  async sendTextMessage(recipientId: string, message: string): Promise<InstagramSendResult> {
    try {
      if (!this.isConfigured()) {
        throw new Error('Instagram not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_PAGE_ID');
      }
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: {
            id: recipientId,
          },
          message: {
            text: message,
          },
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Instagram API error');
      }
      
      console.log(`✅ Instagram DM sent to ${recipientId} | MessageId: ${data.message_id}`);
      
      return {
        success: true,
        messageId: data.message_id,
        recipientId,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send Instagram DM to ${recipientId}:`, error.message);
      
      return {
        success: false,
        recipientId,
        error: error.message || 'Unknown error',
      };
    }
  }
  
  /**
   * Send media message (image/video)
   */
  async sendMediaMessage(
    recipientId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' = 'image'
  ): Promise<InstagramSendResult> {
    try {
      if (!this.isConfigured()) {
        throw new Error('Instagram not configured');
      }
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: {
            id: recipientId,
          },
          message: {
            attachment: {
              type: mediaType,
              payload: {
                url: mediaUrl,
              },
            },
          },
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || 'Instagram media send failed');
      }
      
      console.log(`✅ Instagram media sent to ${recipientId} | Type: ${mediaType}`);
      
      return {
        success: true,
        messageId: data.message_id,
        recipientId,
      };
      
    } catch (error: any) {
      console.error(`❌ Failed to send Instagram media to ${recipientId}:`, error.message);
      
      return {
        success: false,
        recipientId,
        error: error.message,
      };
    }
  }
  
  /**
   * Send message with text + media
   */
  async sendMessageWithMedia(
    recipientId: string,
    message: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' = 'image'
  ): Promise<InstagramSendResult> {
    try {
      // Instagram API doesn't support text + media in one message
      // So we send them separately
      
      // Send media first
      await this.sendMediaMessage(recipientId, mediaUrl, mediaType);
      
      // Then send text
      return await this.sendTextMessage(recipientId, message);
      
    } catch (error: any) {
      console.error(`❌ Failed to send Instagram message with media:`, error.message);
      
      return {
        success: false,
        recipientId,
        error: error.message,
      };
    }
  }
  
  /**
   * Send to multiple recipients in parallel
   */
  async sendBatch(messages: InstagramMessage[]): Promise<InstagramBatchResult> {
    console.log(`📤 Sending Instagram DM batch to ${messages.length} recipients...`);
    
    const results = await Promise.allSettled(
      messages.map(msg => {
        if (msg.mediaUrl) {
          return this.sendMessageWithMedia(msg.recipientId, msg.message, msg.mediaUrl);
        } else {
          return this.sendTextMessage(msg.recipientId, msg.message);
        }
      })
    );
    
    const successful: InstagramSendResult[] = [];
    const failed: InstagramSendResult[] = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value);
      } else {
        const recipientId = messages[index].recipientId;
        failed.push({
          success: false,
          recipientId,
          error: result.status === 'rejected' ? result.reason : result.value.error,
        });
      }
    });
    
    console.log(`✅ Instagram batch complete: ${successful.length} sent, ${failed.length} failed`);
    
    return {
      successful,
      failed,
      totalSent: successful.length,
      totalFailed: failed.length,
    };
  }
  
  /**
   * Get user profile info (name, profile pic)
   */
  async getUserProfile(userId: string): Promise<{
    name: string;
    profilePic: string;
    username?: string;
  }> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${userId}?fields=name,profile_pic,username&access_token=${this.accessToken}`,
        {
          method: 'GET',
        }
      );
      
      const data = await response.json();
      
      return {
        name: data.name || 'Unknown',
        profilePic: data.profile_pic || '',
        username: data.username,
      };
    } catch (error: any) {
      console.error('Failed to get Instagram user profile:', error);
      throw error;
    }
  }
  
  /**
   * Get conversation history with a user
   */
  async getConversation(userId: string, limit = 25): Promise<any[]> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${this.pageId}/conversations?user_id=${userId}&limit=${limit}&access_token=${this.accessToken}`,
        {
          method: 'GET',
        }
      );
      
      const data = await response.json();
      
      return data.data || [];
    } catch (error: any) {
      console.error('Failed to get Instagram conversation:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const instagramService = new InstagramService();
