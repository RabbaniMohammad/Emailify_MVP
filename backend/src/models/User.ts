import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  
  // Organization fields
  organizationId?: Types.ObjectId; // Reference to Organization
  orgRole: 'super_admin' | 'admin' | 'member'; // Role within organization (super_admin = first user/creator)
  
  isActive: boolean;
  isApproved: boolean;
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  lastLogin: Date;
  updateLastLogin(): Promise<IUser>;
}

const UserSchema = new Schema<IUser>({
  googleId: {
    type: String,
    required: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  picture: {
    type: String,
    default: '',
  },
  
  // Organization fields
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    index: true,
  },
  orgRole: {
    type: String,
    enum: ['super_admin', 'admin', 'member'],
    default: 'member',
  },
  
  isActive: {
    type: Boolean,
    default: true,
  },
  isApproved: {
    type: Boolean,
    default: false,
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
  approvedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
});

// Composite unique index: Same email can exist in different organizations
UserSchema.index({ email: 1, organizationId: 1 }, { unique: true });

UserSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

export default mongoose.model<IUser>('User', UserSchema);
