import { Router, Request, Response, NextFunction } from 'express';
import passport from '@src/config/passport';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '@src/services/authService';
import { authenticate } from '@src/middleware/auth';
import User from '@src/models/User';
import logger from 'jet-logger';

const router = Router();

// Google OAuth initiation
router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'],
  session: false 
}));

// Google OAuth callback
router.get(
  '/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate('google', { session: false }, async (err: any, user: any, info: any) => {
      try {
        // Handle passport errors
        if (err) {
          logger.err('Passport error:', err);
          if (err.message.includes('pending admin approval') || err.message.includes('pending approval')) {
            return res.redirect(`${process.env.FRONTEND_URL}/auth/pending`);
          }
          if (err.message.includes('created')) {
            return res.redirect(`${process.env.FRONTEND_URL}/auth/pending`);
          }
          return res.redirect(`${process.env.FRONTEND_URL}/auth?error=authentication_failed`);
        }

        if (!user) {
          return res.redirect(`${process.env.FRONTEND_URL}/auth?error=no_user`);
        }

        // Check approval status
        if (!user.isApproved) {
          logger.warn(`⏳ Unapproved user login attempt: ${user.email}`);
          return res.redirect(`${process.env.FRONTEND_URL}/auth/pending`);
        }

        if (!user.isActive) {
          logger.warn(`🚫 Inactive user login attempt: ${user.email}`);
          return res.redirect(`${process.env.FRONTEND_URL}/auth?error=account_deactivated`);
        }

        logger.info(`✅ User authenticated: ${user.email}`);

        // Generate tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        // Set cookies
        res.cookie('accessToken', accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 1000,
        });

        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.redirect(`${process.env.FRONTEND_URL}/auth/callback?success=true`);
      } catch (error) {
        logger.err('OAuth callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL}/auth?error=callback_failed`);
      }
    })(req, res, next);
  }
);

// Get current user
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const tokenPayload = (req as any).tokenPayload as TokenPayload | undefined;
    
    if (!tokenPayload) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const user = await User.findById(tokenPayload.userId).select('-__v');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    logger.err('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Refresh access token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);

    // Get user
    const user = await User.findById(payload.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user);

    // Set new access token cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000,
    });

    res.json({ message: 'Token refreshed' });
  } catch (error) {
    logger.err('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out successfully' });
});

export default router;