import { Router, Request, Response } from 'express';
import AllowedOrganization from '@src/models/AllowedOrganization';
import { authenticate } from '@src/middleware/auth';
import { toSlug } from '@src/utils/slugify';
import logger from 'jet-logger';

const router = Router();

/**
 * GET /api/admin/allowed-orgs
 * Get all allowed organizations (Platform Super Admin only)
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const tokenPayload = (req as any).tokenPayload;
    
    // TODO: Add platform super admin check when implemented
    // For now, allow any authenticated admin
    
    const allowedOrgs = await AllowedOrganization.find()
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      allowedOrganizations: allowedOrgs
    });
  } catch (error: any) {
    logger.err('Failed to fetch allowed organizations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch allowed organizations',
      message: error.message 
    });
  }
});

/**
 * POST /api/admin/allowed-orgs
 * Add a new allowed organization (Platform Super Admin only)
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { name, allowedDomains } = req.body;
    
    if (!name || name.trim() === '') {
      return res.status(400).json({ 
        error: 'Organization name is required' 
      });
    }
    
    // Generate slug from name
    const slug = toSlug(name);
    
    if (!slug) {
      return res.status(400).json({ 
        error: 'Invalid organization name format' 
      });
    }
    
    // Check if slug already exists
    const existing = await AllowedOrganization.findOne({ slug });
    if (existing) {
      return res.status(409).json({ 
        error: 'Organization with this name already exists' 
      });
    }
    
    // Create new allowed organization
    const allowedOrg = await AllowedOrganization.create({
      name: name.trim(),
      slug,
      allowedDomains: allowedDomains || [],
      isActive: true
    });
    
    logger.info(`✅ Allowed organization created: ${slug}`);
    
    res.status(201).json({
      success: true,
      allowedOrganization: allowedOrg
    });
  } catch (error: any) {
    logger.err('Failed to create allowed organization:', error);
    res.status(500).json({ 
      error: 'Failed to create allowed organization',
      message: error.message 
    });
  }
});

/**
 * PUT /api/admin/allowed-orgs/:id
 * Update an allowed organization (Platform Super Admin only)
 */
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, allowedDomains, isActive } = req.body;
    
    const allowedOrg = await AllowedOrganization.findById(id);
    
    if (!allowedOrg) {
      return res.status(404).json({ 
        error: 'Allowed organization not found' 
      });
    }
    
    // Update fields if provided
    if (name !== undefined) {
      allowedOrg.name = name.trim();
      // Note: slug is not updated to avoid breaking existing references
    }
    if (allowedDomains !== undefined) {
      allowedOrg.allowedDomains = allowedDomains;
    }
    if (isActive !== undefined) {
      allowedOrg.isActive = isActive;
    }
    
    await allowedOrg.save();
    
    logger.info(`✅ Allowed organization updated: ${allowedOrg.slug}`);
    
    res.json({
      success: true,
      allowedOrganization: allowedOrg
    });
  } catch (error: any) {
    logger.err('Failed to update allowed organization:', error);
    res.status(500).json({ 
      error: 'Failed to update allowed organization',
      message: error.message 
    });
  }
});

/**
 * DELETE /api/admin/allowed-orgs/:id
 * Delete an allowed organization (Platform Super Admin only)
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const allowedOrg = await AllowedOrganization.findByIdAndDelete(id);
    
    if (!allowedOrg) {
      return res.status(404).json({ 
        error: 'Allowed organization not found' 
      });
    }
    
    logger.info(`🗑️ Allowed organization deleted: ${allowedOrg.slug}`);
    
    res.json({
      success: true,
      message: 'Allowed organization deleted'
    });
  } catch (error: any) {
    logger.err('Failed to delete allowed organization:', error);
    res.status(500).json({ 
      error: 'Failed to delete allowed organization',
      message: error.message 
    });
  }
});

/**
 * GET /api/admin/allowed-orgs/validate/:slug
 * Check if an organization slug is allowed (Public endpoint for login page)
 */
router.get('/validate/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const normalizedSlug = toSlug(slug);
    
    if (!normalizedSlug) {
      return res.json({ valid: false, message: 'Invalid format' });
    }
    
    const allowedOrg = await AllowedOrganization.findOne({ 
      slug: normalizedSlug, 
      isActive: true 
    });
    
    if (allowedOrg) {
      res.json({ 
        valid: true, 
        name: allowedOrg.name,
        slug: allowedOrg.slug
      });
    } else {
      res.json({ 
        valid: false, 
        message: 'Organization not authorized' 
      });
    }
  } catch (error: any) {
    logger.err('Failed to validate organization:', error);
    res.status(500).json({ 
      valid: false, 
      message: 'Validation failed' 
    });
  }
});

export default router;

