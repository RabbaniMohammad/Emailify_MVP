import { Router, Request, Response, NextFunction } from 'express';
import passport from '@src/config/passport';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '@src/services/authService';
import { authenticate } from '@src/middleware/auth';
import User from '@src/models/User';
import logger from 'jet-logger';
import { IUser } from '@src/models/User';

const router = Router();

// Google OAuth initiation
router.get('/google', passport.authenticate('google', { 
  scope: ['profile', 'email'],
  session: false 
}));

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL}/auth?error=auth_failed`,
    session: false 
  }),
  async (req: Request, res: Response) => {
    try {
      const user = req.user as IUser;

      if (!user) {
        logger.warn('⚠️ No user found in callback');
        return res.redirect(`${process.env.FRONTEND_URL}/auth?error=no_user`);
      }

      // Check if user is deactivated first
      if (!user.isActive) {
        logger.warn(`🚫 Deactivated user login attempt: ${user.email}`);
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Account Deactivated</title>
            <style>
              body {
                margin: 0;
                padding: 1.5rem;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                box-sizing: border-box;
              }
              .container {
                background: white;
                border-radius: 16px;
                padding: 3rem 2rem;
                max-width: 500px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              }
              .icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 1.5rem;
                background: #fee2e2;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 40px;
              }
              h1 {
                font-size: 1.75rem;
                font-weight: 700;
                color: #1e293b;
                margin: 0 0 1rem 0;
              }
              p {
                font-size: 1rem;
                color: #64748b;
                line-height: 1.6;
                margin: 0 0 2rem 0;
              }
              button {
                background: #667eea;
                color: white;
                border: none;
                padding: 0.875rem 2rem;
                border-radius: 8px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
              }
              button:hover {
                background: #5568d3;
                transform: translateY(-2px);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="icon">🚫</div>
              <h1>Account Deactivated</h1>
              <p>Your account has been deactivated. Please contact your administrator.</p>
              <button onclick="window.close()">Close</button>
            </div>
          </body>
          </html>
        `);
      }

      // Check approval status - DON'T generate tokens for unapproved users
      if (!user.isApproved) {
        logger.warn(`⏳ Unapproved user login attempt: ${user.email}`);
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Pending Approval</title>
            <style>
              body {
                margin: 0;
                padding: 1.5rem;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                box-sizing: border-box;
              }
              .container {
                background: white;
                border-radius: 16px;
                padding: 3rem 2rem;
                max-width: 500px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              }
              .icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 1.5rem;
                background: #fef3c7;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 40px;
              }
              h1 {
                font-size: 1.75rem;
                font-weight: 700;
                color: #1e293b;
                margin: 0 0 1rem 0;
              }
              p {
                font-size: 1rem;
                color: #64748b;
                line-height: 1.6;
                margin: 0 0 2rem 0;
              }
              button {
                background: #667eea;
                color: white;
                border: none;
                padding: 0.875rem 2rem;
                border-radius: 8px;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s ease;
              }
              button:hover {
                background: #5568d3;
                transform: translateY(-2px);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="icon">⏳</div>
              <h1>Account Pending Approval</h1>
              <p>Your account has been created successfully and is currently awaiting approval from an administrator. You'll receive access once an admin reviews your request.</p>
              <button onclick="window.close()">Close</button>
            </div>
          </body>
          </html>
        `);
      }

      // User is approved and active - generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      // Set cookies
      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000, // 1 hour
      });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      logger.info(`✅ User logged in: ${user.email}`);

      // Close popup and notify parent
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Login Success</title></head>
        <body>
          <script>
            window.opener.postMessage({ 
              type: 'AUTH_SUCCESS',
              user: ${JSON.stringify({
                _id: user._id,
                email: user.email,
                name: user.name,
                picture: user.picture,
                role: user.role
              })}
            }, '${process.env.FRONTEND_URL}');
            setTimeout(() => window.close(), 500);
          </script>
        </body>
        </html>
      `);
    } catch (error) {
      logger.err('OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/auth?error=callback_failed`);
    }
  }
);

// Get current user - allow unapproved users to check their status
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

    // Return user info even if not approved - let frontend handle the pending state
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
    if (!user || !user.isActive || !user.isApproved) {
      return res.status(401).json({ error: 'User not found, inactive, or not approved' });
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