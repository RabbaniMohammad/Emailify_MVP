import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUser extends Document {
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  
  // Organization fields
  organizationId?: Types.ObjectId; // Reference to Organization
  orgRole: 'super_admin' | 'admin' | 'member'; // Role within organization (super_admin = first user/creator)
  
  // Global role (for super_admin only)
  role: 'super_admin' | 'admin' | 'user';
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
    unique: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
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
  
  // Global role (for super_admin only)
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'user'],
    default: 'user',
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

UserSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

export default mongoose.model<IUser>('User', UserSchema);