"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const passport_1 = __importDefault(require("@src/config/passport"));
const authService_1 = require("@src/services/authService");
const auth_1 = require("@src/middleware/auth");
const User_1 = __importDefault(require("@src/models/User"));
const Organization_1 = __importDefault(require("@src/models/Organization"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const router = (0, express_1.Router)();
router.get('/google', (req, res, next) => {
    const orgSlug = req.query.org;
    if (orgSlug) {
        req.session = req.session || {};
        req.session.orgSlug = orgSlug;
    }
    passport_1.default.authenticate('google', {
        scope: ['profile', 'email'],
        session: false,
        state: orgSlug || '',
    })(req, res, next);
});
router.get('/google/callback', passport_1.default.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/auth?error=auth_failed`,
    session: false
}), async (req, res) => {
    try {
        let user = req.user;
        const orgSlug = req.query.state || '';
        if (!user) {
            jet_logger_1.default.warn('⚠️ No user found in callback');
            return res.redirect(`${process.env.FRONTEND_URL}/auth?error=no_user`);
        }
        if (orgSlug) {
            let organization = await Organization_1.default.findOne({ slug: orgSlug.toLowerCase() });
            if (!organization) {
                organization = new Organization_1.default({
                    name: orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1),
                    slug: orgSlug.toLowerCase(),
                    owner: user._id,
                    isActive: true,
                    maxUsers: 50,
                    maxTemplates: 1000,
                });
                await organization.save();
                user.organizationId = organization._id;
                user.orgRole = 'super_admin';
                user.isApproved = true;
                await user.save();
                jet_logger_1.default.info(`🏢 New organization created: ${orgSlug} (super_admin: ${user.email})`);
            }
            else if (organization.isActive) {
                const isCurrentOrg = user.organizationId?.toString() === String(organization._id);
                if (isCurrentOrg) {
                    if (user.orgRole === 'super_admin' && !user.isApproved) {
                        user.isApproved = true;
                        await user.save();
                        jet_logger_1.default.info(`✅ Auto-approved super_admin: ${user.email} in org: ${orgSlug}`);
                    }
                    else {
                        jet_logger_1.default.info(`✅ User ${user.email} already in org: ${orgSlug}`);
                    }
                }
                else {
                    if (!user.organizationId) {
                        const existingUserCount = await User_1.default.countDocuments({ organizationId: organization._id });
                        if (existingUserCount === 0) {
                            user.organizationId = organization._id;
                            user.orgRole = 'super_admin';
                            user.isApproved = true;
                            organization.owner = user._id;
                            await organization.save();
                            await user.save();
                            jet_logger_1.default.info(`🏢 First user joins org ${orgSlug} as super_admin: ${user.email}`);
                        }
                        else {
                            let canJoin = true;
                            if (organization.domain) {
                                const domain = organization.domain.startsWith('@')
                                    ? organization.domain
                                    : `@${organization.domain}`;
                                canJoin = user.email.endsWith(domain);
                                if (!canJoin) {
                                    jet_logger_1.default.warn(`⚠️ Email domain mismatch for ${user.email} in org ${orgSlug}`);
                                }
                            }
                            if (canJoin) {
                                const memberCount = await User_1.default.countDocuments({ organizationId: organization._id });
                                if (memberCount >= organization.maxUsers) {
                                    jet_logger_1.default.warn(`⚠️ Organization ${orgSlug} is full (${memberCount}/${organization.maxUsers})`);
                                    canJoin = false;
                                }
                            }
                            if (canJoin) {
                                user.organizationId = organization._id;
                                user.orgRole = 'member';
                                user.isApproved = false;
                                await user.save();
                                jet_logger_1.default.info(`🔄 User ${user.email} joined ${orgSlug} as member (pending approval)`);
                            }
                        }
                    }
                    else {
                        jet_logger_1.default.warn(`⚠️ User ${user.email} is in different org, but trying to access ${orgSlug}`);
                    }
                }
            }
            const freshUser = await User_1.default.findById(user._id);
            if (freshUser) {
                user = freshUser;
            }
        }
        if (!user.isActive) {
            jet_logger_1.default.warn(`🚫 Deactivated user login attempt: ${user.email}`);
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
        if (!user.isApproved) {
            jet_logger_1.default.warn(`⏳ Unapproved user login attempt: ${user.email}`);
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
        const accessToken = (0, authService_1.generateAccessToken)(user);
        const refreshToken = (0, authService_1.generateRefreshToken)(user);
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
        jet_logger_1.default.info(`✅ User logged in: ${user.email}`);
        let organizationData = null;
        if (user.organizationId) {
            const org = await Organization_1.default.findById(user.organizationId);
            if (org) {
                organizationData = {
                    id: org._id,
                    name: org.name,
                    slug: org.slug,
                };
            }
        }
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
    }
    catch (error) {
        jet_logger_1.default.err('OAuth callback error:', error);
        const err = error;
        if (err.message)
            jet_logger_1.default.err('Error details: ' + err.message);
        if (err.stack)
            jet_logger_1.default.err('Error stack: ' + err.stack);
        res.redirect(`${process.env.FRONTEND_URL}/auth?error=callback_failed`);
    }
});
router.get('/me', auth_1.authenticate, async (req, res) => {
    try {
        const tokenPayload = req.tokenPayload;
        if (!tokenPayload) {
            return res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
        }
        const user = await User_1.default.findById(tokenPayload.userId)
            .select('-__v')
            .populate('organizationId', 'name slug domain isActive isOwner');
        if (!user) {
            return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
        }
        const userResponse = user.toObject();
        if (user.organizationId && typeof user.organizationId === 'object') {
            userResponse.organizationIsOwner = user.organizationId.isOwner || false;
        }
        res.json({ user: userResponse });
    }
    catch (error) {
        jet_logger_1.default.err('Get user error:', error);
        res.status(500).json({ error: 'Failed to get user', code: 'SERVER_ERROR' });
    }
});
router.post('/refresh', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refreshToken;
        if (!refreshToken) {
            jet_logger_1.default.warn('🚫 Refresh attempt with no token');
            return res.status(401).json({
                error: 'No refresh token',
                code: 'NO_REFRESH_TOKEN'
            });
        }
        let payload;
        try {
            payload = (0, authService_1.verifyRefreshToken)(refreshToken);
        }
        catch (verifyError) {
            jet_logger_1.default.warn('🚫 Invalid refresh token signature');
            return res.status(401).json({
                error: 'Invalid refresh token',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }
        const user = await User_1.default.findById(payload.userId);
        if (!user) {
            jet_logger_1.default.warn(`🚫 User not found during refresh: ${payload.userId}`);
            return res.status(401).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }
        if (!user.isActive) {
            jet_logger_1.default.warn(`🚫 Inactive user refresh attempt: ${user.email}`);
            return res.status(401).json({
                error: 'User account is inactive',
                code: 'USER_INACTIVE'
            });
        }
        if (!user.isApproved) {
            jet_logger_1.default.warn(`🚫 Unapproved user refresh attempt: ${user.email}`);
            return res.status(401).json({
                error: 'User account is not approved',
                code: 'USER_NOT_APPROVED'
            });
        }
        const newAccessToken = (0, authService_1.generateAccessToken)(user);
        const newRefreshToken = (0, authService_1.generateRefreshToken)(user);
        res.cookie('accessToken', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 1000,
        });
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        jet_logger_1.default.info(`✅ Token refreshed successfully for: ${user.email}`);
        res.json({ message: 'Token refreshed successfully' });
    }
    catch (error) {
        jet_logger_1.default.err('Refresh token error:', error);
        res.status(401).json({
            error: 'Token refresh failed',
            code: 'REFRESH_FAILED'
        });
    }
});
router.post('/logout', (req, res) => {
    try {
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        jet_logger_1.default.info('✅ User logged out successfully');
        res.json({ message: 'Logged out successfully' });
    }
    catch (error) {
        jet_logger_1.default.err('Logout error:', error);
        res.status(500).json({ error: 'Logout failed', code: 'LOGOUT_FAILED' });
    }
});
exports.default = router;
