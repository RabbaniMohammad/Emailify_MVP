import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGeneratedImage extends Document {
  imageId: string;
  name: string;
  prompt: string;
  wrappedPrompt?: string;
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  source?: string;
  modelName?: string;
  width?: number;
  height?: number;
  url: string;
  thumbnail?: string;
  metadata?: Record<string, any>;
  conversationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const GeneratedImageSchema = new Schema<IGeneratedImage>(
  {
    imageId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    prompt: { type: String, required: true },
    wrappedPrompt: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    source: { type: String, default: 'ideogram' },
  modelName: { type: String, default: 'v3' },
    width: { type: Number },
    height: { type: Number },
    url: { type: String, required: true },
    thumbnail: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed },
    conversationId: { type: String, index: true }
  },
  { timestamps: true }
);

GeneratedImageSchema.index({ organizationId: 1, createdAt: -1 });
GeneratedImageSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IGeneratedImage>('GeneratedImage', GeneratedImageSchema);
