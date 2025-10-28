import { Router, Request, Response } from 'express';
import Organization from '@src/models/Organization';
import User from '@src/models/User';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import TemplateConversation from '@src/models/TemplateConversation';
import { authenticate } from '@src/middleware/auth';
import { requireRole } from '@src/middleware/roles';
import logger from 'jet-logger';
import mailchimp from '@mailchimp/mailchimp_marketing';

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

    // ✅ Auto-create Mailchimp folder for the organization
    try {
      const MC: any = mailchimp as any;
      const folderName = `${organization.name} Templates`;
      
      const folder = await MC.templateFolders.create({ name: folderName });
      const folderId = String(folder.id || folder.folder_id);
      
      // Save folder ID to organization
      organization.mailchimpTemplateFolderId = folderId;
      await organization.save();
      
      logger.info(`✅ Created Mailchimp folder "${folderName}" (ID: ${folderId}) for org: ${organization.name}`);
    } catch (folderError: any) {
      // Don't fail organization creation if folder creation fails
      logger.warn(`⚠️  Failed to create Mailchimp folder for ${organization.name}:`, folderError?.message);
      logger.warn(`   Organization created successfully, but folder must be created manually.`);
    }

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
        mailchimpFolderId: organization.mailchimpTemplateFolderId || null,
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

/**
 * DELETE /api/organizations/:slug
 * Delete an organization (only accessible by Default Organization super_admin)
 * Query param: deleteData (true/false) - whether to cascade delete all org data
 */
router.delete('/:slug', authenticate, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const deleteData = req.query.deleteData !== 'false'; // Default to true
    const userId = (req as any).tokenPayload?.userId;

    // Get current user
    const currentUser = await User.findById(userId).populate('organizationId');
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is in Default Organization (owner org)
    const userOrg = currentUser.organizationId as any;
    if (!userOrg || userOrg.slug !== 'default') {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'Only Default Organization can delete organizations'
      });
    }

    // Check if user is super_admin
    if (currentUser.orgRole !== 'super_admin') {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'Only super_admin can delete organizations'
      });
    }

    // Find organization to delete
    const orgToDelete = await Organization.findOne({ slug: slug.toLowerCase() });
    if (!orgToDelete) {
      return res.status(404).json({
        error: 'Organization not found',
        message: 'No organization found with this name'
      });
    }

    // Prevent deleting the Default Organization itself
    if (orgToDelete.slug === 'default') {
      return res.status(403).json({
        error: 'Cannot delete Default Organization',
        message: 'The Default Organization cannot be deleted'
      });
    }

    let deletionSummary = {
      organization: orgToDelete.name,
      templatesDeleted: 0,
      conversationsDeleted: 0,
      usersAffected: 0,
    };

    if (deleteData) {
      // CASCADE DELETE: Remove all organization data
      logger.info(`🗑️  Cascade deleting organization: ${orgToDelete.name}`);

      // Delete templates
      const templateResult = await GeneratedTemplate.deleteMany({ 
        organizationId: orgToDelete._id 
      });
      deletionSummary.templatesDeleted = templateResult.deletedCount || 0;

      // Delete conversations
      const conversationResult = await TemplateConversation.deleteMany({ 
        organizationId: orgToDelete._id 
      });
      deletionSummary.conversationsDeleted = conversationResult.deletedCount || 0;

      // Remove organization from users
      const userResult = await User.updateMany(
        { organizationId: orgToDelete._id },
        { 
          $unset: { organizationId: "" }, 
          $set: { orgRole: 'member', isApproved: false } 
        }
      );
      deletionSummary.usersAffected = userResult.modifiedCount || 0;

      logger.info(`  ✅ Deleted ${deletionSummary.templatesDeleted} templates`);
      logger.info(`  ✅ Deleted ${deletionSummary.conversationsDeleted} conversations`);
      logger.info(`  ✅ Removed organization from ${deletionSummary.usersAffected} users`);
    } else {
      // SOFT DELETE: Only delete org, leave data orphaned
      logger.info(`🗑️  Soft deleting organization: ${orgToDelete.name} (data preserved)`);
      
      const userCount = await User.countDocuments({ organizationId: orgToDelete._id });
      deletionSummary.usersAffected = userCount;
    }

    // Delete the organization
    await Organization.deleteOne({ _id: orgToDelete._id });
    logger.info(`  ✅ Organization deleted: ${orgToDelete.name}`);

    res.json({
      success: true,
      message: `Organization "${orgToDelete.name}" deleted successfully`,
      cascadeDelete: deleteData,
      summary: deletionSummary,
    });
  } catch (error: any) {
    logger.err('❌ Delete organization error:', error);
    res.status(500).json({
      error: 'Failed to delete organization',
      message: error.message
    });
  }
});

/**
 * POST /api/organizations/:id/mailchimp-folder
 * Create and assign a Mailchimp template folder to an organization
 */
router.post('/:id/mailchimp-folder', authenticate, requireRole(['owner', 'admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { folderName } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Verify user has permission (owner or admin)
    const user = await User.findById(userId);
    if (!user || user.organizationId?.toString() !== id) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    const MC: any = mailchimp as any;
    
    // Create folder in Mailchimp
    const folderNameToUse = folderName || `${organization.name} Templates`;
    
    try {
      const folder = await MC.templateFolders.create({ name: folderNameToUse });
      const folderId = folder.id || folder.folder_id;

      // Save folder ID to organization
      organization.mailchimpTemplateFolderId = String(folderId);
      await organization.save();

      logger.info(`✅ Created Mailchimp folder "${folderNameToUse}" (ID: ${folderId}) for org: ${organization.name}`);

      res.json({
        success: true,
        message: 'Mailchimp folder created and assigned successfully',
        folderId: String(folderId),
        folderName: folderNameToUse,
      });
    } catch (mcError: any) {
      logger.error(`❌ Mailchimp folder creation error:`, mcError);
      res.status(500).json({
        error: 'Failed to create Mailchimp folder',
        message: mcError?.message || 'Mailchimp API error',
      });
    }
  } catch (error: any) {
    logger.err('❌ Create Mailchimp folder error:', error);
    res.status(500).json({
      error: 'Failed to create Mailchimp folder',
      message: error.message
    });
  }
});

/**
 * PUT /api/organizations/:id/mailchimp-folder
 * Assign an existing Mailchimp folder to an organization
 */
router.put('/:id/mailchimp-folder', authenticate, requireRole(['owner', 'admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { folderId } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!folderId) {
      return res.status(400).json({ error: 'Folder ID is required' });
    }

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Verify user has permission
    const user = await User.findById(userId);
    if (!user || user.organizationId?.toString() !== id) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    // Update organization
    organization.mailchimpTemplateFolderId = String(folderId);
    await organization.save();

    logger.info(`✅ Assigned Mailchimp folder ${folderId} to org: ${organization.name}`);

    res.json({
      success: true,
      message: 'Mailchimp folder assigned successfully',
      folderId: String(folderId),
    });
  } catch (error: any) {
    logger.err('❌ Assign Mailchimp folder error:', error);
    res.status(500).json({
      error: 'Failed to assign Mailchimp folder',
      message: error.message
    });
  }
});

/**
 * GET /api/organizations/:id/mailchimp-folder
 * Get current Mailchimp folder for an organization
 */
router.get('/:id/mailchimp-folder', authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = (req as any).tokenPayload?.userId;

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Verify user has permission
    const user = await User.findById(userId);
    if (!user || user.organizationId?.toString() !== id) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    res.json({
      folderId: organization.mailchimpTemplateFolderId || null,
      hasFolder: !!organization.mailchimpTemplateFolderId,
    });
  } catch (error: any) {
    logger.err('❌ Get Mailchimp folder error:', error);
    res.status(500).json({
      error: 'Failed to get Mailchimp folder',
      message: error.message
    });
  }
});

/**
 * GET /api/organizations/mailchimp-folders/list
 * List all available Mailchimp template folders
 */
router.get('/mailchimp-folders/list', authenticate, requireRole(['owner', 'admin']), async (req: Request, res: Response) => {
  try {
    const MC: any = mailchimp as any;
    
    const folders = await MC.templateFolders.list({ count: 1000 });
    
    const folderList = (folders.folders || []).map((f: any) => ({
      id: String(f.id || f.folder_id),
      name: f.name,
      count: f.count || 0,
    }));

    res.json({
      folders: folderList,
      total: folderList.length,
    });
  } catch (error: any) {
    logger.err('❌ List Mailchimp folders error:', error);
    res.status(500).json({
      error: 'Failed to list Mailchimp folders',
      message: error?.message || 'Mailchimp API error'
    });
  }
});

export default router;
