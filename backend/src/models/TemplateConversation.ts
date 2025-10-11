import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITemplateConversation extends Document {
  userId: Types.ObjectId;
  conversationId: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    images?: Array<{
      data: string;
      mediaType: string;
      fileName: string;
    }>;
  }>;
  currentMjml: string;
  currentHtml: string;
  templateName?: string;
  status: 'active' | 'saved' | 'discarded';
  savedTemplateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateConversationSchema = new Schema<ITemplateConversation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    messages: [
      {
        role: {
          type: String,
          enum: ['user', 'assistant'],
          required: true,
        },
        content: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        images: [
          {
            data: String,
            mediaType: String,
            fileName: String,
          },
        ],
      },
    ],
    currentMjml: {
      type: String,
      default: '',
    },
    currentHtml: {
      type: String,
      default: '',
    },
    templateName: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'saved', 'discarded'],
      default: 'active',
    },
    savedTemplateId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

TemplateConversationSchema.index({ userId: 1, createdAt: -1 });
TemplateConversationSchema.index({ conversationId: 1 });
TemplateConversationSchema.index({ savedTemplateId: 1 });

export default mongoose.model<ITemplateConversation>(
  'TemplateConversation',
  TemplateConversationSchema
);