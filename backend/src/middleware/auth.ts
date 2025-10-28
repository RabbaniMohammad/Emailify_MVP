import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '@src/services/authService';
import User from '@src/models/User';
import logger from 'jet-logger';

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get token from cookie or Authorization header
    const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // Verify token
    const payload = verifyAccessToken(token);

    // Verify user exists
    const user = await User.findById(payload.userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Allow /auth/me to return user status even if not approved/active
    const isAuthMeRoute = req.path === '/me' && req.baseUrl === '/api/auth';
    
    if (!isAuthMeRoute) {
      // 🔒 SECURITY: User must belong to an organization
      if (!user.organizationId) {
        logger.warn(`🚫 SECURITY: User ${user.email} has no organization - access denied`);
        res.status(403).json({ 
          error: 'No organization assigned',
          message: 'You must belong to an organization to access this resource.'
        });
        return;
      }
      
      // For all other routes, check approval and active status
      if (!user.isApproved) {
        res.status(403).json({ error: 'Account pending approval' });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ error: 'Account deactivated' });
        return;
      }
    }

    // Attach payload to request
    (req as any).tokenPayload = payload;
    next();
  } catch (error) {
    logger.err('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.userId);
      if (user && user.isActive && user.isApproved) {
        (req as any).tokenPayload = payload;
      }
    }
    next();
  } catch (error) {
    // Silently continue without auth
    next();
  }
};