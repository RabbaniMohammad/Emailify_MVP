import { Router, Request, Response, NextFunction } from 'express';
import passport from '@src/config/passport';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '@src/services/authService';
import { authenticate } from '@src/middleware/auth';
import User from '@src/models/User';
import Organization from '@src/models/Organization';
import logger from 'jet-logger';
import { IUser } from '@src/models/User';

const router = Router();

// ==================== Google OAuth Initiation ====================
// Accept organization slug as query parameter
router.get('/google', (req: Request, res: Response, next: NextFunction) => {
  const orgSlug = req.query.org as string;
  
  // Store org slug in session for callback
  if (orgSlug) {
    (req as any).session = (req as any).session || {};
    (req as any).session.orgSlug = orgSlug;
  }
  
  passport.authenticate('google', { 
    scope: ['profile', 'email'],
    session: false,
    state: orgSlug || '', // Pass org slug via state
  })(req, res, next);
});

// ==================== Google OAuth Callback ====================
router.get(
  '/google/callback',
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL}/auth?error=auth_failed`,
    session: false 
  }),
  async (req: Request, res: Response) => {
    try {
      let user = req.user as IUser;
      const orgSlug = (req.query.state as string) || '';

      if (!user) {
        logger.warn('⚠️ No user found in callback');
        return res.redirect(`${process.env.FRONTEND_URL}/auth?error=no_user`);
      }

      // ==================== Handle Organization Assignment ====================
      // Always process org slug if provided (allows switching organizations)
      if (orgSlug) {
        let organization = await Organization.findOne({ slug: orgSlug.toLowerCase() });
        
        // If organization doesn't exist, create it and make user the owner
        if (!organization) {
          organization = new Organization({
            name: orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1), // Capitalize first letter
            slug: orgSlug.toLowerCase(),
            owner: user._id, // Set the creator as owner (for org model requirement)
            isActive: true,
            maxUsers: 50,
            maxTemplates: 1000,
          });
          await organization.save();
          
          // Make first user the super_admin of this org
          user.organizationId = organization._id as any;
          user.orgRole = 'super_admin'; // First user is super_admin
          user.isApproved = true; // Super admin is auto-approved
          await user.save();
          
          logger.info(`🏢 New organization created: ${orgSlug} (super_admin: ${user.email})`);
        } else if (organization.isActive) {
          // Organization exists - check if user is already in this org
          const isCurrentOrg = user.organizationId?.toString() === String(organization._id);
          
          if (isCurrentOrg) {
            // Already in this org - ensure super_admin is always approved
            if (user.orgRole === 'super_admin' && !user.isApproved) {
              user.isApproved = true;
              await user.save();
              logger.info(`✅ Auto-approved super_admin: ${user.email} in org: ${orgSlug}`);
            } else {
              logger.info(`✅ User ${user.email} already in org: ${orgSlug}`);
            }
          } else {
            // User record exists but for wrong org (shouldn't happen with new passport logic)
            // This means passport created user without org - update it now
            if (!user.organizationId) {
              // Check if this is the first user in this organization
              const existingUserCount = await User.countDocuments({ organizationId: organization._id });
              
              if (existingUserCount === 0) {
                // First user in this org - make them super_admin
                user.organizationId = organization._id as any;
                user.orgRole = 'super_admin';
                user.isApproved = true;
                organization.owner = user._id as any; // Update org owner
                await organization.save();
                await user.save();
                logger.info(`🏢 First user joins org ${orgSlug} as super_admin: ${user.email}`);
              } else {
                // Not first user - check domain restriction and join as member
                let canJoin = true;
                
                if (organization.domain) {
                  const domain = organization.domain.startsWith('@') 
                    ? organization.domain 
                    : `@${organization.domain}`;
                  canJoin = user.email.endsWith(domain);
                  
                  if (!canJoin) {
                    logger.warn(`⚠️ Email domain mismatch for ${user.email} in org ${orgSlug}`);
                  }
                }
                
                if (canJoin) {
                  // Check user limit
                  const memberCount = await User.countDocuments({ organizationId: organization._id });
                  
                  if (memberCount >= organization.maxUsers) {
                    logger.warn(`⚠️ Organization ${orgSlug} is full (${memberCount}/${organization.maxUsers})`);
                    canJoin = false;
                  }
                }
                
                if (canJoin) {
                  // Update user's organization as member
                  user.organizationId = organization._id as any;
                  user.orgRole = 'member';
                  user.isApproved = false; // Requires admin approval when joining new org
                  await user.save();
                  
                  logger.info(`🔄 User ${user.email} joined ${orgSlug} as member (pending approval)`);
                }
              }
            } else {
              logger.warn(`⚠️ User ${user.email} is in different org, but trying to access ${orgSlug}`);
            }
          }
        }
        
        // ⭐ CRITICAL: Reload user from DB to get fresh organizationId for JWT
        const freshUser = await User.findById(user._id);
        if (freshUser) {
          user = freshUser;
        }
      }

      // ==================== Check if user is deactivated ====================
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

      // ==================== Check approval status ====================
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

      // ==================== User is approved and active - generate tokens ====================
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

      // Fetch organization details if user has one
      let organizationData = null;
      if (user.organizationId) {
        const org = await Organization.findById(user.organizationId);
        if (org) {
          organizationData = {
            id: org._id,
            name: org.name,
            slug: org.slug,
          };
        }
      }

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
                orgRole: user.orgRole,
                organization: organizationData
              })}
            }, '${process.env.FRONTEND_URL}');
            setTimeout(() => window.close(), 500);
          </script>
        </body>
        </html>
      `);
    } catch (error) {
      logger.err('OAuth callback error:', error);
      const err = error as Error;
      if (err.message) logger.err('Error details: ' + err.message);
      if (err.stack) logger.err('Error stack: ' + err.stack);
      res.redirect(`${process.env.FRONTEND_URL}/auth?error=callback_failed`);
    }
  }
);

// ==================== Get Current User ====================
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const tokenPayload = (req as any).tokenPayload as TokenPayload | undefined;
    
    if (!tokenPayload) {
      return res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
    }
    
    const user = await User.findById(tokenPayload.userId)
      .select('-__v')
      .populate('organizationId', 'name slug domain isActive isOwner');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Add organizationIsOwner flag for easy frontend access
    const userResponse: any = user.toObject();
    if (user.organizationId && typeof user.organizationId === 'object') {
      userResponse.organizationIsOwner = (user.organizationId as any).isOwner || false;
    }

    // Return user info even if not approved - let frontend handle the pending state
    res.json({ user: userResponse });
  } catch (error) {
    logger.err('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user', code: 'SERVER_ERROR' });
  }
});

// ==================== Refresh Access Token ====================
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    // ✅ Check if refresh token exists
    if (!refreshToken) {
      logger.warn('🚫 Refresh attempt with no token');
      return res.status(401).json({ 
        error: 'No refresh token',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    // ✅ Verify refresh token signature
    let payload: TokenPayload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (verifyError) {
      logger.warn('🚫 Invalid refresh token signature');
      return res.status(401).json({ 
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN'
      });
    }

    // ✅ Get user from database
    const user = await User.findById(payload.userId);
    
    if (!user) {
      logger.warn(`🚫 User not found during refresh: ${payload.userId}`);
      return res.status(401).json({ 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // ✅ Check if user is active
    if (!user.isActive) {
      logger.warn(`🚫 Inactive user refresh attempt: ${user.email}`);
      return res.status(401).json({ 
        error: 'User account is inactive',
        code: 'USER_INACTIVE'
      });
    }

    // ✅ Check if user is approved
    if (!user.isApproved) {
      logger.warn(`🚫 Unapproved user refresh attempt: ${user.email}`);
      return res.status(401).json({ 
        error: 'User account is not approved',
        code: 'USER_NOT_APPROVED'
      });
    }

    // ✅ Generate new access token
    const newAccessToken = generateAccessToken(user);

    // ✅ Generate new refresh token (token rotation for better security)
    const newRefreshToken = generateRefreshToken(user);

    // ✅ Set new access token cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    // ✅ Set new refresh token cookie (token rotation)
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    logger.info(`✅ Token refreshed successfully for: ${user.email}`);
    res.json({ message: 'Token refreshed successfully' });
  } catch (error) {
    logger.err('Refresh token error:', error);
    res.status(401).json({ 
      error: 'Token refresh failed',
      code: 'REFRESH_FAILED'
    });
  }
});

// ==================== Logout ====================
router.post('/logout', (req: Request, res: Response) => {
  try {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    logger.info('✅ User logged out successfully');
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.err('Logout error:', error);
    res.status(500).json({ error: 'Logout failed', code: 'LOGOUT_FAILED' });
  }
});

export default router;