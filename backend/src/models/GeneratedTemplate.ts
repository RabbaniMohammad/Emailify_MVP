import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGeneratedTemplate extends Document {
  templateId: string;
  name: string;
  html: string;
  userId: Types.ObjectId;
  conversationId?: string;
  type: 'generated';
  createdAt: Date;
  updatedAt: Date;
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