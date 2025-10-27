import jwt from 'jsonwebtoken';
import { IUser } from '@src/models/User';

export function generateToken(user: IUser): string {
  const payload = {
    userId: user._id,
    email: user.email,
    organizationId: user.organizationId,
    orgRole: user.orgRole
  };

  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: '7d'
  });
}