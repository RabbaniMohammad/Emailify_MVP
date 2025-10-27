import jwt, { SignOptions } from 'jsonwebtoken';
import { IUser } from '@src/models/User';

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '1h') as string;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || '';
const REFRESH_TOKEN_EXPIRES_IN = (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as string;

if (!JWT_SECRET || !REFRESH_TOKEN_SECRET) {
  throw new Error('JWT secrets not configured');
}

export interface TokenPayload {
  userId: string;
  email: string;
  name: string;
  organizationId?: string; // Organization the user belongs to
  orgRole?: string; // Role within organization
}

export const generateAccessToken = (user: IUser): string => {
  const payload: TokenPayload = {
    userId: String(user._id),
    email: user.email,
    name: user.name,
    organizationId: user.organizationId ? String(user.organizationId) : undefined,
    orgRole: user.orgRole,
  };

  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRES_IN 
  } as SignOptions);
};

export const generateRefreshToken = (user: IUser): string => {
  const payload: TokenPayload = {
    userId: String(user._id),
    email: user.email,
    name: user.name,
    organizationId: user.organizationId ? String(user.organizationId) : undefined,
    orgRole: user.orgRole,
  };

  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { 
    expiresIn: REFRESH_TOKEN_EXPIRES_IN 
  } as SignOptions);
};

export const verifyAccessToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    throw new Error('Invalid access token');
  }
};

export const verifyRefreshToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};