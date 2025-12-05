import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * AllowedUser - Lookup table for pre-authorized users per organization
 * Only users in this table can request access to an organization
 */
export interface IAllowedUser extends Document {
  email: string;
  organizationId: Types.ObjectId;
  defaultRole: 'admin' | 'member';
  autoApprove: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AllowedUserSchema = new Schema<IAllowedUser>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    defaultRole: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    autoApprove: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Unique: same email can't be added twice to same org
AllowedUserSchema.index({ email: 1, organizationId: 1 }, { unique: true });

// Fast lookup by org
AllowedUserSchema.index({ organizationId: 1, isActive: 1 });

export default mongoose.model<IAllowedUser>('AllowedUser', AllowedUserSchema);
