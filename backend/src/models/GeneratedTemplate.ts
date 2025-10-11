import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGeneratedTemplate extends Document {
  templateId: string;
  name: string;
  html: string;
  userId: Types.ObjectId;
  conversationId?: string;
  type: 'Generated';
  createdAt: Date;
  updatedAt: Date;
  
  // ✅ New metadata fields
  templateType: 'AI Generated';
  createdBy: string; // User's name from Google sign-in
  source: 'AI Generated';
  active: 'N/A';
  category: 'N/A';
  responsive: 'Yes';
  folderId: 'N/A';
  thumbnail: string; // Empty string ""
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
    conversationId: {
      type: String,
      index: true, // Optional link to conversation
    },
    type: {
      type: String,
      default: 'generated',
      enum: ['generated'],
    },
    
    // ✅ NEW METADATA FIELDS
    templateType: {
      type: String,
      default: 'AI Generated',
      enum: ['AI Generated'],
    },
    createdBy: {
      type: String,
      required: true, // User's name from Google sign-in
      trim: true,
    },
    source: {
      type: String,
      default: 'AI Generated',
      enum: ['AI Generated'],
    },
    active: {
      type: String,
      default: 'N/A',
      enum: ['N/A'],
    },
    category: {
      type: String,
      default: 'N/A',
      enum: ['N/A'],
    },
    responsive: {
      type: String,
      default: 'Yes',
      enum: ['Yes'],
    },
    folderId: {
      type: String,
      default: 'N/A',
      enum: ['N/A'],
    },
    thumbnail: {
      type: String,
      default: '', // Empty string
    },
  },
  {
    timestamps: true, // Automatically creates createdAt and updatedAt
  }
);

// Compound index for user-specific queries
GeneratedTemplateSchema.index({ userId: 1, createdAt: -1 });

// Index for finding templates by conversation
GeneratedTemplateSchema.index({ conversationId: 1 });

export default mongoose.model<IGeneratedTemplate>(
  'GeneratedTemplate',
  GeneratedTemplateSchema
);