import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOrganization extends Document {
  name: string; // Organization name (e.g., "Acme Corp")
  slug: string; // URL-friendly unique identifier (e.g., "acme-corp")
  domain?: string; // Optional: email domain restriction (e.g., "@acme.com")
  
  // Mailchimp API credentials (org-specific)
  mailchimpApiKey?: string;
  mailchimpServerPrefix?: string;
  mailchimpAudienceId?: string;
  mailchimpTemplateFolderId?: string; // Mailchimp template folder ID for organization isolation
  
  // Email sender settings
  fromEmail?: string; // Sender email address for campaigns (e.g., "marketing@acmecorp.com")
  fromName?: string; // Sender name for campaigns (e.g., "Acme Corp Marketing")
  
  // Settings
  maxUsers: number; // Maximum users allowed
  maxTemplates: number; // Maximum templates allowed
  isActive: boolean;
  
  // Metadata
  owner: Types.ObjectId; // Reference to User who created the org
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: function(v: string) {
          // Only lowercase letters, numbers, and hyphens
          return /^[a-z0-9-]+$/.test(v);
        },
        message: 'Slug can only contain lowercase letters, numbers, and hyphens'
      }
    },
    domain: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true, // Allow multiple null values
      validate: {
        validator: function(v: string) {
          if (!v) return true;
          // Email domain validation (e.g., "@acme.com" or "acme.com")
          return /^@?[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
        },
        message: 'Invalid email domain format'
      }
    },
    
    // Mailchimp credentials (optional per org)
    mailchimpApiKey: {
      type: String,
      default: '',
    },
    mailchimpServerPrefix: {
      type: String,
      default: '',
    },
    mailchimpAudienceId: {
      type: String,
      default: '',
    },
    mailchimpTemplateFolderId: {
      type: String,
      default: '',
      sparse: true, // Allow multiple null/empty values
    },
    
    // Email sender settings
    fromEmail: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
      validate: {
        validator: function(v: string) {
          if (!v) return true;
          // Standard email validation
          return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
        },
        message: 'Invalid email address format'
      }
    },
    fromName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 100,
    },
    
    // Limits
    maxUsers: {
      type: Number,
      default: 50,
      min: 1,
    },
    maxTemplates: {
      type: Number,
      default: 1000,
      min: 1,
    },
    
    isActive: {
      type: Boolean,
      default: true,
    },
    
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for faster lookups
OrganizationSchema.index({ slug: 1, isActive: 1 });
OrganizationSchema.index({ owner: 1 });

// Pre-save hook to generate slug if not provided
OrganizationSchema.pre('save', function(next) {
  if (this.isNew && !this.slug) {
    // Auto-generate slug from name
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
  next();
});

export default mongoose.model<IOrganization>('Organization', OrganizationSchema);
