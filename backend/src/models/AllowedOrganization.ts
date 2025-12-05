import mongoose, { Document, Schema } from 'mongoose';

/**
 * AllowedOrganization - Reference table for tracking organizations
 * Note: With Option A, anyone can create orgs - this is just for admin reference
 */
export interface IAllowedOrganization extends Document {
  name: string;
  slug: string;
  allowedDomains: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AllowedOrganizationSchema = new Schema<IAllowedOrganization>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: function (v: string) {
          return /^[a-z0-9-]+$/.test(v);
        },
        message: 'Slug can only contain lowercase letters, numbers, and hyphens',
      },
    },
    allowedDomains: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for fast lookups
AllowedOrganizationSchema.index({ slug: 1, isActive: 1 });

export default mongoose.model<IAllowedOrganization>('AllowedOrganization', AllowedOrganizationSchema);
