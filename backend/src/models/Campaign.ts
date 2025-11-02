import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICampaign extends Document {
  mailchimpCampaignId: string; // Mailchimp campaign ID
  name: string; // Campaign name
  subject?: string; // Email subject line
  previewText?: string; // Preview text
  
  // Organization isolation
  organizationId: Types.ObjectId; // Reference to Organization
  createdBy: Types.ObjectId; // Reference to User who created it
  
  // Campaign status
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'canceled';
  
  // Template and content
  templateUsed?: Types.ObjectId; // Reference to GeneratedTemplate
  templateName?: string; // Template name for reference
  
  // Audience info
  recipientsCount: number; // Total recipients
  audienceId?: string; // Mailchimp audience list ID
  audienceName?: string; // Audience list name for reference
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  sentAt?: Date; // When campaign was sent
  scheduledFor?: Date; // When campaign is scheduled to send
  
  // Campaign metrics (synced from Mailchimp)
  metrics: {
    // Email counts
    emailsSent: number;
    
    // Open metrics
    opens: number; // Total opens
    uniqueOpens: number; // Unique opens
    openRate: number; // Percentage (0-100)
    
    // Click metrics
    clicks: number; // Total clicks
    uniqueClicks: number; // Unique clicks
    clickRate: number; // Percentage (0-100)
    
    // Negative metrics
    bounces: number;
    bounceRate: number; // Percentage (0-100)
    unsubscribes: number;
    unsubscribeRate: number; // Percentage (0-100)
    
    // Last sync
    lastSyncedAt?: Date;
  };
}

const CampaignSchema = new Schema<ICampaign>(
  {
    mailchimpCampaignId: {
      type: String,
      required: true,
      unique: true,
      index: true, // Fast lookups by Mailchimp ID
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    previewText: {
      type: String,
      trim: true,
    },
    
    // Organization isolation - CRITICAL for multi-tenant
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true, // Fast lookups by organization
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // Fast lookups by user
    },
    
    // Campaign status
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'canceled'],
      default: 'draft',
      index: true, // Fast filtering by status
    },
    
    // Template reference
    templateUsed: {
      type: Schema.Types.ObjectId,
      ref: 'GeneratedTemplate',
    },
    templateName: {
      type: String,
      trim: true,
    },
    
    // Audience info
    recipientsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    audienceId: {
      type: String,
    },
    audienceName: {
      type: String,
      trim: true,
    },
    
    // Timestamps
    sentAt: {
      type: Date,
    },
    scheduledFor: {
      type: Date,
    },
    
    // Campaign metrics
    metrics: {
      emailsSent: {
        type: Number,
        default: 0,
        min: 0,
      },
      
      // Opens
      opens: {
        type: Number,
        default: 0,
        min: 0,
      },
      uniqueOpens: {
        type: Number,
        default: 0,
        min: 0,
      },
      openRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      
      // Clicks
      clicks: {
        type: Number,
        default: 0,
        min: 0,
      },
      uniqueClicks: {
        type: Number,
        default: 0,
        min: 0,
      },
      clickRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      
      // Negative metrics
      bounces: {
        type: Number,
        default: 0,
        min: 0,
      },
      bounceRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      unsubscribes: {
        type: Number,
        default: 0,
        min: 0,
      },
      unsubscribeRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
      },
      
      lastSyncedAt: {
        type: Date,
      },
    },
  },
  {
    timestamps: true, // Automatically creates createdAt and updatedAt
  }
);

// Compound indexes for efficient queries
CampaignSchema.index({ organizationId: 1, createdAt: -1 }); // Org isolation, newest first
CampaignSchema.index({ organizationId: 1, status: 1 }); // Filter by org and status
CampaignSchema.index({ organizationId: 1, sentAt: -1 }); // Recent sent campaigns
CampaignSchema.index({ createdBy: 1, createdAt: -1 }); // User's campaigns
CampaignSchema.index({ status: 1, scheduledFor: 1 }); // Find scheduled campaigns

// Text index for searching campaigns by name or subject
CampaignSchema.index({ name: 'text', subject: 'text' });

console.log('📧 Campaign model loaded');

export default mongoose.model<ICampaign>('Campaign', CampaignSchema);
