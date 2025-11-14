import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGeneratedTemplate extends Document {
  templateId: string;
  name: string;
  html: string;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId; // Organization isolation
  conversationId?: string;
  type: string; // e.g. 'Visual editor' or 'generated'
  createdAt: Date;
  updatedAt: Date;
  
  // Metadata fields
  templateType?: string;
  createdBy: string; // User's name from Google sign-in
  source?: string;
  active?: string;
  category?: string;
  responsive?: string;
  folderId?: string;
  thumbnail?: string; // Empty string ""
  dragDrop?: boolean;
}

const GeneratedTemplateSchema = new Schema<IGeneratedTemplate>(
  {
    templateId: {
      type: String,
      required: true,
      unique: true,
      index: true, // Fast lookups by templateId
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    html: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // Fast lookups by userId
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true, // Fast lookups by organizationId (isolation)
    },
    conversationId: {
      type: String,
      index: true, // Optional link to conversation
    },
    type: {
      type: String,
      default: 'generated',
    },
    
    // Metadata fields (relaxed to accept Visual Editor values)
    templateType: {
      type: String,
      default: 'AI Generated',
    },
    createdBy: {
      type: String,
      required: true, // User's name from Google sign-in
      trim: true,
    },
    source: {
      type: String,
      default: 'AI Generated',
    },
    active: {
      type: String,
      default: 'N/A',
    },
    category: {
      type: String,
      default: 'N/A',
    },
    responsive: {
      type: String,
      default: 'Yes',
    },
    folderId: {
      type: String,
      default: 'N/A',
    },
    thumbnail: {
      type: String,
      default: '', // Empty string
    },
    dragDrop: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Automatically creates createdAt and updatedAt
  }
);

// Compound indexes for efficient queries
GeneratedTemplateSchema.index({ userId: 1, createdAt: -1 });
GeneratedTemplateSchema.index({ organizationId: 1, createdAt: -1 }); // Org isolation
GeneratedTemplateSchema.index({ organizationId: 1, userId: 1 }); // User within org

// Index for finding templates by conversation
GeneratedTemplateSchema.index({ conversationId: 1 });

export default mongoose.model<IGeneratedTemplate>(
  'GeneratedTemplate',
  GeneratedTemplateSchema
);
