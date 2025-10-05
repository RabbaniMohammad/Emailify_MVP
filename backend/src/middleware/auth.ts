import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '@src/services/authService';
import User from '@src/models/User';
import logger from 'jet-logger';

// Don't redeclare - use Passport's existing Express.User

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

    // Verify user still exists and is active
    const user = await User.findById(payload.userId);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    // Attach payload to request using a custom property
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
      if (user && user.isActive) {
        (req as any).tokenPayload = payload;
      }
    }
    next();
  } catch (error) {
    // Silently continue without auth
    next();
  }
};