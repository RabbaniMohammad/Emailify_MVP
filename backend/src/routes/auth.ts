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
            logger.warn(`🚫 Deactivated user login attempt: ${user.email}`);
            // Send to a dedicated deactivated page instead
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                <title>Account Deactivated</title>
                <style>
                    body { font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
                    .container { text-align: center; padding: 2rem; }
                    .icon { font-size: 64px; margin-bottom: 1rem; }
                    h1 { color: #dc2626; margin: 0 0 1rem 0; }
                    p { color: #64748b; margin: 0 0 1.5rem 0; }
                    button { background: #667eea; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; cursor: pointer; font-weight: 600; }
                    button:hover { background: #5568d3; }
                </style>
                </head>
                <body>
                <div class="container">
                    <div class="icon">🚫</div>
                    <h1>Account Deactivated</h1>
                    <p>Your account has been deactivated. Please contact an administrator.</p>
                    <button onclick="window.close()">Close</button>
                </div>
                </body>
                </html>
            `);
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