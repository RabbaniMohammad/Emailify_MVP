import { Router, Request, Response } from 'express';
import Organization from '@src/models/Organization';
import User from '@src/models/User';
import { authenticate } from '@src/middleware/auth';
import { requireRole } from '@src/middleware/roles';
import logger from 'jet-logger';

const router = Router();

/**
 * POST /api/organizations
 * Create a new organization (first user becomes owner)
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, slug, domain } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!name || !slug) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Organization name and slug are required' 
      });
    }

    // Check if user already belongs to an organization
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.organizationId) {
      return res.status(400).json({ 
        error: 'Already in organization',
        message: 'You are already a member of an organization. Please leave it first.' 
      });
    }

    // Check if slug is already taken
    const existing = await Organization.findOne({ slug: slug.toLowerCase() });
    if (existing) {
      return res.status(409).json({ 
        error: 'Slug already taken',
        message: 'This organization name is already taken. Please choose another.' 
      });
    }

    // Create organization
    const organization = await Organization.create({
      name,
      slug: slug.toLowerCase(),
      domain: domain || null,
      owner: userId,
      isActive: true,
    });

    // Update user to be the super_admin
    user.organizationId = organization._id as any;
    user.orgRole = 'super_admin';
    user.isApproved = true; // Auto-approve super_admin
    await user.save();

    logger.info(`✅ Organization created: ${organization.slug} by ${user.email}`);

    res.status(201).json({
      success: true,
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        domain: organization.domain,
      },
      message: 'Organization created successfully. You are now the owner.'
    });
  } catch (error: any) {
    logger.err('❌ Create organization error:', error);
    res.status(500).json({ 
      error: 'Failed to create organization',
      message: error.message 
    });
  }
});

/**
 * GET /api/organizations/:slug
 * Get organization details by slug
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const organization = await Organization.findOne({ slug: slug.toLowerCase() })
      .select('name slug domain isActive maxUsers maxTemplates createdAt');

    if (!organization) {
      return res.status(404).json({ 
        error: 'Organization not found',
        message: 'No organization found with this name' 
      });
    }

    if (!organization.isActive) {
      return res.status(403).json({ 
        error: 'Organization inactive',
        message: 'This organization is currently inactive' 
      });
    }

    res.json({
      success: true,
      organization: {
        name: organization.name,
        slug: organization.slug,
        domain: organization.domain,
        isActive: organization.isActive,
      }
    });
  } catch (error: any) {
    logger.err('❌ Get organization error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch organization',
      message: error.message 
    });
  }
});

/**
 * POST /api/organizations/:slug/join
 * Request to join an existing organization
 */
router.post('/:slug/join', authenticate, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = (req as any).tokenPayload?.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.organizationId) {
      return res.status(400).json({ 
        error: 'Already in organization',
        message: 'You are already a member of an organization' 
      });
    }

    const organization = await Organization.findOne({ slug: slug.toLowerCase() });
    if (!organization) {
      return res.status(404).json({ 
        error: 'Organization not found',
        message: 'No organization found with this name' 
      });
    }

    if (!organization.isActive) {
      return res.status(403).json({ 
        error: 'Organization inactive',
        message: 'This organization is currently inactive' 
      });
    }

    // Check domain restriction if set
    if (organization.domain) {
      const domain = organization.domain.startsWith('@') 
        ? organization.domain 
        : `@${organization.domain}`;
      
      if (!user.email.endsWith(domain)) {
        return res.status(403).json({ 
          error: 'Email domain mismatch',
          message: `Only users with ${domain} email addresses can join this organization` 
        });
      }
    }

    // Check user limit
    const memberCount = await User.countDocuments({ organizationId: organization._id });
    if (memberCount >= organization.maxUsers) {
      return res.status(403).json({ 
        error: 'Organization full',
        message: 'This organization has reached its maximum user limit' 
      });
    }

    // Add user to organization (pending approval)
    user.organizationId = organization._id as any;
    user.orgRole = 'member';
    user.isApproved = false; // Requires admin approval
    await user.save();

    logger.info(`👤 User ${user.email} joined organization: ${organization.slug} (pending approval)`);

    res.json({
      success: true,
      message: 'Successfully joined organization. Your account is pending admin approval.',
      requiresApproval: true,
    });
  } catch (error: any) {
    logger.err('❌ Join organization error:', error);
    res.status(500).json({ 
      error: 'Failed to join organization',
      message: error.message 
    });
  }
});

/**
 * GET /api/organizations/my/details
 * Get current user's organization details
 */
router.get('/my/details', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;

    const user = await User.findById(userId).populate('organizationId');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.organizationId) {
      return res.json({
        success: true,
        hasOrganization: false,
        message: 'Not a member of any organization'
      });
    }

    const organization = user.organizationId as any;

    res.json({
      success: true,
      hasOrganization: true,
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        domain: organization.domain,
        isActive: organization.isActive,
      },
      userRole: user.orgRole,
    });
  } catch (error: any) {
    logger.err('❌ Get my organization error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch organization details',
      message: error.message 
    });
  }
});

export default router;
