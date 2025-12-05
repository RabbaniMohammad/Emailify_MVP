import { Router, Request, Response } from 'express';
import AllowedUser from '@src/models/AllowedUser';
import User from '@src/models/User';
import Organization from '@src/models/Organization';
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';
import logger from 'jet-logger';

const router = Router();

/**
 * GET /api/org/allowed-users
 * Get all allowed users for the current organization (Admin only)
 */
router.get('/', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    const allowedUsers = await AllowedUser.find({ 
      organizationId: organization._id 
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      allowedUsers
    });
  } catch (error: any) {
    logger.err('Failed to fetch allowed users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch allowed users',
      message: error.message 
    });
  }
});

/**
 * GET /api/org/allowed-users/with-status
 * Get authorized users who haven't signed up yet (Admin only)
 * Only shows users awaiting signup - signed up users appear in All Users tab
 */
router.get('/with-status', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    // Get all allowed users for this org
    const allowedUsers = await AllowedUser.find({ 
      organizationId: organization._id,
      isActive: true
    }).sort({ createdAt: -1 });
    
    // Get all actual users' emails in this org
    const actualUsers = await User.find({ 
      organizationId: organization._id 
    }).select('email');
    
    // Create a Set of emails that have signed up
    const signedUpEmails = new Set(actualUsers.map(u => u.email.toLowerCase()));
    
    // Filter to only show users who HAVEN'T signed up yet
    const awaitingSignup = allowedUsers
      .filter(au => !signedUpEmails.has(au.email.toLowerCase()))
      .map(au => ({
        _id: au._id,
        email: au.email,
        defaultRole: au.defaultRole,
        authorizedAt: au.createdAt,
        hasSignedUp: false,
        name: null,
        picture: null,
        actualRole: au.defaultRole,
        isActive: true,
        signedUpAt: null
      }));
    
    res.json({
      success: true,
      authorizedUsers: awaitingSignup,
      stats: {
        total: allowedUsers.length,
        signedUp: allowedUsers.length - awaitingSignup.length,
        awaitingSignup: awaitingSignup.length
      }
    });
  } catch (error: any) {
    logger.err('Failed to fetch allowed users with status:', error);
    res.status(500).json({ 
      error: 'Failed to fetch allowed users',
      message: error.message 
    });
  }
});

/**
 * POST /api/org/allowed-users
 * Add a new allowed user to the organization (Admin only)
 */
router.post('/', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    const { email, phoneNumber, defaultRole, autoApprove } = req.body;
    
    if (!email || email.trim() === '') {
      return res.status(400).json({ 
        error: 'Email is required' 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format' 
      });
    }
    
    // Check if email already exists for this org
    const existing = await AllowedUser.findOne({ 
      email: email.toLowerCase(), 
      organizationId: organization._id 
    });
    
    if (existing) {
      return res.status(409).json({ 
        error: 'User with this email is already authorized for this organization' 
      });
    }
    
    // Log what we're about to create
    console.log('Creating AllowedUser with:', {
      email: email.toLowerCase().trim(),
      organizationId: organization._id,
      defaultRole: defaultRole || 'member',
      autoApprove: autoApprove || false,
    });

    // Create new allowed user
    const allowedUser = await AllowedUser.create({
      email: email.toLowerCase().trim(),
      organizationId: organization._id,
      defaultRole: defaultRole || 'member',
      autoApprove: autoApprove ?? true,
      isActive: true
    });
    
    logger.info(`✅ Allowed user created: ${email} for org: ${organization.slug}`);
    
    res.status(201).json({
      success: true,
      allowedUser
    });
  } catch (error: any) {
    console.error('ERROR DETAILS:', error);
    console.error('ERROR NAME:', error.name);
    console.error('ERROR MESSAGE:', error.message);
    console.error('ERROR STACK:', error.stack);
    logger.err('Failed to create allowed user: ' + (error.message || String(error)));
    res.status(500).json({ 
      error: 'Failed to create allowed user',
      message: error.message || 'Unknown error',
      name: error.name
    });
  }
});

/**
 * POST /api/org/allowed-users/bulk
 * Bulk import allowed users (Admin only)
 */
router.post('/bulk', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    const { users } = req.body;
    
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ 
        error: 'Users array is required' 
      });
    }
    
    const results = {
      success: [] as string[],
      failed: [] as { email: string; reason: string }[],
      skipped: [] as { email: string; reason: string }[]
    };
    
    for (const user of users) {
      const email = user.email?.toLowerCase().trim();
      
      if (!email) {
        results.failed.push({ email: 'unknown', reason: 'Email is required' });
        continue;
      }
      
      // Check if already exists
      const existing = await AllowedUser.findOne({ 
        email, 
        organizationId: organization._id 
      });
      
      if (existing) {
        results.skipped.push({ email, reason: 'Already exists' });
        continue;
      }
      
      try {
        await AllowedUser.create({
          email,
          phoneNumber: user.phoneNumber?.trim() || undefined,
          organizationId: organization._id,
          defaultRole: user.defaultRole || 'member',
          autoApprove: user.autoApprove || false,
          isActive: true
        });
        results.success.push(email);
      } catch (err: any) {
        results.failed.push({ email, reason: err.message });
      }
    }
    
    logger.info(`✅ Bulk import: ${results.success.length} added, ${results.skipped.length} skipped, ${results.failed.length} failed`);
    
    res.json({
      success: true,
      results
    });
  } catch (error: any) {
    logger.err('Failed to bulk import allowed users:', error);
    res.status(500).json({ 
      error: 'Failed to bulk import allowed users',
      message: error.message 
    });
  }
});

/**
 * PUT /api/org/allowed-users/:id
 * Update an allowed user (Admin only)
 */
router.put('/:id', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    const { id } = req.params;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    const allowedUser = await AllowedUser.findOne({ 
      _id: id, 
      organizationId: organization._id 
    });
    
    if (!allowedUser) {
      return res.status(404).json({ 
        error: 'Allowed user not found' 
      });
    }
    
    const { phoneNumber, defaultRole, autoApprove, isActive } = req.body;
    
    // Update fields if provided
    if (phoneNumber !== undefined) {
      allowedUser.phoneNumber = phoneNumber?.trim() || undefined;
    }
    if (defaultRole !== undefined) {
      allowedUser.defaultRole = defaultRole;
    }
    if (autoApprove !== undefined) {
      allowedUser.autoApprove = autoApprove;
    }
    if (isActive !== undefined) {
      allowedUser.isActive = isActive;
    }
    
    await allowedUser.save();
    
    logger.info(`✅ Allowed user updated: ${allowedUser.email}`);
    
    res.json({
      success: true,
      allowedUser
    });
  } catch (error: any) {
    logger.err('Failed to update allowed user:', error);
    res.status(500).json({ 
      error: 'Failed to update allowed user',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/org/allowed-users/:id
 * Delete an allowed user (Admin only)
 */
router.delete('/:id', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    const tokenPayload = (req as any).tokenPayload;
    const { id } = req.params;
    
    // Check if user is admin or super_admin
    if (!['admin', 'super_admin'].includes(tokenPayload.orgRole)) {
      return res.status(403).json({ 
        error: 'Admin access required' 
      });
    }
    
    const allowedUser = await AllowedUser.findOneAndDelete({ 
      _id: id, 
      organizationId: organization._id 
    });
    
    if (!allowedUser) {
      return res.status(404).json({ 
        error: 'Allowed user not found' 
      });
    }
    
    logger.info(`🗑️ Allowed user deleted: ${allowedUser.email}`);
    
    res.json({
      success: true,
      message: 'Allowed user deleted'
    });
  } catch (error: any) {
    logger.err('Failed to delete allowed user:', error);
    res.status(500).json({ 
      error: 'Failed to delete allowed user',
      message: error.message 
    });
  }
});

export default router;

