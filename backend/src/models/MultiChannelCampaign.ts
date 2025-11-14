import mongoose, { Document, Schema, Types } from 'mongoose';

// Channel types
export type CampaignChannel = 'email' | 'sms' | 'whatsapp' | 'instagram';

// Channel-specific content
export interface ChannelContent {
  email?: {
    html: string;
    subject: string;
  };
  sms?: {
    text: string;
    characterCount: number;
  };
  whatsapp?: {
    text: string;
    templateName?: string; // For approved WhatsApp templates
    mediaUrl?: string;
    lineCount: number;
  };
  instagram?: {
    text: string;
    mediaUrl?: string;
    lineCount: number;
  };
}

// Channel-specific metrics
export interface ChannelMetrics {
  sent: number;
  delivered: number;
  failed: number;
  read?: number; // WhatsApp/Instagram only
  replied?: number; // Two-way channels
  clicked?: number; // For links
  cost?: number; // Track spending per channel
}

// External provider IDs
export interface ExternalIds {
  mailchimp?: string; // Email campaign ID
  awsSns?: string[]; // SMS message IDs
  meta?: string[]; // WhatsApp/Instagram message IDs
  twilio?: string[]; // Alternative SMS/WhatsApp provider
}

export interface IMultiChannelCampaign extends Document {
  // Basic info
  name: string;
  
  // Organization isolation
  organizationId: Types.ObjectId;
  createdBy: Types.ObjectId;
  
  // Multi-channel support
  channels: CampaignChannel[]; // Which channels are active
  primaryChannel: CampaignChannel; // Main channel (usually email)
  
  // Content for each channel
  content: ChannelContent;
  
  // Campaign status
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'canceled';
  
  // Recipients
  recipientsCount: number;
  recipients?: {
    channel: CampaignChannel;
    identifier: string; // email/phone/userId
    status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  }[];
  
  // External provider IDs
  externalIds: ExternalIds;
  
  // Channel-specific metrics
  channelMetrics: {
    email?: ChannelMetrics;
    sms?: ChannelMetrics;
    whatsapp?: ChannelMetrics;
    instagram?: ChannelMetrics;
  };
  
  // Overall metrics (aggregated)
  overallMetrics: {
    totalSent: number;
    totalDelivered: number;
    totalFailed: number;
    totalCost: number;
    deliveryRate: number;
    engagementRate: number;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date;
  scheduledFor?: Date;
  
  // AI generation metadata
  aiGenerated: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
    instagram?: boolean;
    model?: string; // e.g., "gpt-4o-mini"
    generatedAt?: Date;
  };
  
  // Template reference (if generated from email template)
  sourceTemplateId?: Types.ObjectId;
  sourceTemplateHtml?: string; // Store original email HTML
}

const MultiChannelCampaignSchema = new Schema<IMultiChannelCampaign>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    
    // Organization isolation
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    
    // Multi-channel support
    channels: {
      type: [String],
      enum: ['email', 'sms', 'whatsapp', 'instagram'],
      required: true,
      validate: {
        validator: function(channels: string[]) {
          return channels.length > 0;
        },
        message: 'At least one channel must be selected'
      }
    },
    primaryChannel: {
      type: String,
      enum: ['email', 'sms', 'whatsapp', 'instagram'],
      required: true,
    },
    
    // Content storage
    content: {
      email: {
        html: String,
        subject: String,
      },
      sms: {
        text: String,
        characterCount: Number,
      },
      whatsapp: {
        text: String,
        templateName: String,
        mediaUrl: String,
        lineCount: Number,
      },
      instagram: {
        text: String,
        mediaUrl: String,
        lineCount: Number,
      },
    },
    
    // Campaign status
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'canceled'],
      default: 'draft',
      index: true,
    },
    
    // Recipients
    recipientsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    recipients: [{
      channel: {
        type: String,
        enum: ['email', 'sms', 'whatsapp', 'instagram'],
      },
      identifier: String, // email/phone/userId
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed', 'read'],
        default: 'pending',
      },
    }],
    
    // External IDs
    externalIds: {
      mailchimp: String,
      awsSns: [String],
      meta: [String],
      twilio: [String],
    },
    
    // Channel metrics
    channelMetrics: {
      email: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
      },
      sms: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
      },
      whatsapp: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        replied: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
      },
      instagram: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        replied: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
      },
    },
    
    // Overall metrics
    overallMetrics: {
      totalSent: { type: Number, default: 0 },
      totalDelivered: { type: Number, default: 0 },
      totalFailed: { type: Number, default: 0 },
      totalCost: { type: Number, default: 0 },
      deliveryRate: { type: Number, default: 0 },
      engagementRate: { type: Number, default: 0 },
    },
    
    // Timestamps
    sentAt: Date,
    scheduledFor: Date,
    
    // AI generation metadata
    aiGenerated: {
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
      instagram: { type: Boolean, default: false },
      model: String,
      generatedAt: Date,
    },
    
    // Source template
    sourceTemplateId: {
      type: Schema.Types.ObjectId,
      ref: 'GeneratedTemplate',
    },
    sourceTemplateHtml: String,
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
MultiChannelCampaignSchema.index({ organizationId: 1, createdAt: -1 });
MultiChannelCampaignSchema.index({ organizationId: 1, status: 1 });
MultiChannelCampaignSchema.index({ organizationId: 1, channels: 1 });
MultiChannelCampaignSchema.index({ status: 1, scheduledFor: 1 });
MultiChannelCampaignSchema.index({ name: 'text' });

// Virtual for total engagement
MultiChannelCampaignSchema.virtual('totalEngagement').get(function() {
  const email = this.channelMetrics.email?.clicked || 0;
  const sms = this.channelMetrics.sms?.clicked || 0;
  const whatsapp = (this.channelMetrics.whatsapp?.replied || 0) + (this.channelMetrics.whatsapp?.clicked || 0);
  const instagram = this.channelMetrics.instagram?.replied || 0;
  
  return email + sms + whatsapp + instagram;
});

export default mongoose.model<IMultiChannelCampaign>('MultiChannelCampaign', MultiChannelCampaignSchema);
