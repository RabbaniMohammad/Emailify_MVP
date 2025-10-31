import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { requireAdmin, requireSuperAdmin } from '@src/middleware/roles';
import User from '@src/models/User';
import Organization from '@src/models/Organization';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import TemplateConversation from '@src/models/TemplateConversation';
import logger from 'jet-logger';

const router = Router();

// Get all users (admin only)
router.get('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    
    // Only show users from the admin's organization
    const users = await User.find({ organizationId: currentUser.organizationId })
      .select('-__v')
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'name email');

    logger.info(`🔍 [ADMIN] Fetching users for org: ${currentUser.organizationId}, found: ${users.length}`);
    res.json({ users });
  } catch (error) {
    logger.err('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get pending users (admin only)
router.get('/users/pending', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).currentUser;
    
    // Only show pending users from the admin's organization
    const users = await User.find({ 
      organizationId: currentUser.organizationId,
      isApproved: false, 
      isActive: true 
    })
      .select('-__v')
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    logger.err('Get pending users error:', error);
    res.status(500).json({ error: 'Failed to fetch pending users' });
  }
});

// Approve user (admin only)
router.post('/users/:userId/approve', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Security: Ensure user is in the same organization
    if (user.organizationId?.toString() !== currentUser.organizationId?.toString()) {
      return res.status(403).json({ error: 'Cannot approve user from different organization' });
    }

    user.isApproved = true;
    user.approvedBy = currentUser._id;
    user.approvedAt = new Date();
    await user.save();

    logger.info(`✅ User approved: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'User approved', user });
  } catch (error) {
    logger.err('Approve user error:', error);
    res.status(500).json({ error: 'Failed to approve user' });
  }
});

// Deactivate user (admin only)
router.post('/users/:userId/deactivate', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Security: Ensure user is in the same organization
    if (user.organizationId?.toString() !== currentUser.organizationId?.toString()) {
      return res.status(403).json({ error: 'Cannot deactivate user from different organization' });
    }

    // Prevent deactivating org super_admins
    if (user.orgRole === 'super_admin') {
      return res.status(403).json({ error: 'Cannot deactivate organization super admin' });
    }

    user.isActive = false;
    await user.save();

    logger.info(`🚫 User deactivated: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'User deactivated', user });
  } catch (error) {
    logger.err('Deactivate user error:', error);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// Promote to admin (super admin only)
router.post('/users/:userId/promote', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.orgRole === 'super_admin') {
      return res.status(400).json({ error: 'User is already super admin' });
    }

    if (user.orgRole === 'admin') {
      return res.status(400).json({ error: 'User is already an admin' });
    }

    user.orgRole = 'admin';
    await user.save();

    logger.info(`⬆️ User promoted to admin: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'User promoted to admin', user });
  } catch (error) {
    logger.err('Promote user error:', error);
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

// Delete user permanently (super admin only)
router.delete('/users/:userId', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.orgRole === 'super_admin') {
      return res.status(403).json({ error: 'Cannot delete super admin' });
    }

    await User.findByIdAndDelete(userId);

    logger.info(`🗑️ User deleted: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.err('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Reactivate users (admin only)
router.post('/users/:userId/reactivate', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isActive = true;
    await user.save();

    logger.info(`✅ User reactivated: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'User reactivated', user });
  } catch (error) {
    logger.err('Reactivate user error:', error);
    res.status(500).json({ error: 'Failed to reactivate user' });
  }
});

// Demote admin (super admin only)
router.post('/users/:userId/demote', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUser = (req as any).currentUser;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.orgRole === 'super_admin') {
      return res.status(403).json({ error: 'Cannot demote super admin' });
    }

    if (user.orgRole === 'member') {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    user.orgRole = 'member';
    await user.save();

    logger.info(`⬇️ Admin demoted to user: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'Admin demoted to user', user });
  } catch (error) {
    logger.err('Demote user error:', error);
    res.status(500).json({ error: 'Failed to demote user' });
  }
});

// ==================== ORGANIZATION MANAGEMENT (Super Admin Only) ====================

// Get all organizations (super admin only)
router.get('/organizations', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const organizations = await Organization.find()
      .select('-__v')
      .sort({ createdAt: -1 })
      .populate('owner', 'name email');

    // Get user count for each organization
    const orgsWithCounts = await Promise.all(
      organizations.map(async (org) => {
        const usersCount = await User.countDocuments({ organizationId: org._id });
        return {
          ...org.toObject(),
          usersCount
        };
      })
    );

    logger.info(`🔍 [SUPER ADMIN] Fetching all organizations, found: ${organizations.length}`);
    res.json({ organizations: orgsWithCounts });
  } catch (error) {
    logger.err('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Delete organization (super admin only)
router.delete('/organizations/:slug', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { deleteData } = req.body; // boolean flag to also delete users
    const currentUser = (req as any).currentUser;

    // Prevent deleting the default organization
    if (slug.toLowerCase() === 'default') {
      return res.status(403).json({ 
        error: 'Cannot delete default organization',
        message: 'The default organization cannot be deleted for system integrity.'
      });
    }

    const organization = await Organization.findOne({ slug: slug.toLowerCase() });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Only super admins from the default org can delete other organizations
    const userOrg = await Organization.findById(currentUser.organizationId);
    if (!userOrg || userOrg.slug !== 'default') {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: 'Only super admins from the default organization can delete organizations.'
      });
    }

    // Always delete templates and conversations
    const deletedTemplates = await GeneratedTemplate.deleteMany({ organizationId: organization._id });
    const deletedConversations = await TemplateConversation.deleteMany({ organizationId: organization._id });

    let deletedUsers = 0;
    if (deleteData) {
      // Delete all users in the organization
      const result = await User.deleteMany({ organizationId: organization._id });
      deletedUsers = result.deletedCount || 0;
    } else {
      // Just remove organization reference from users
      await User.updateMany(
        { organizationId: organization._id },
        { 
          $unset: { organizationId: '' },
          orgRole: 'user',
          isApproved: false
        }
      );
    }

    // Delete the organization
    await Organization.findByIdAndDelete(organization._id);

    logger.info(`🗑️ [SUPER ADMIN] Organization deleted: ${organization.slug} by ${currentUser.email}`);
    logger.info(`   - Users ${deleteData ? 'deleted' : 'unlinked'}: ${deleteData ? deletedUsers : 'N/A'}`);
    logger.info(`   - Templates deleted: ${deletedTemplates.deletedCount}`);
    logger.info(`   - Conversations deleted: ${deletedConversations.deletedCount}`);

    res.json({ 
      message: `Organization "${organization.name}" deleted successfully`,
      deletedOrganization: organization.slug,
      deletedUsers: deleteData ? deletedUsers : undefined,
      deletedTemplates: deletedTemplates.deletedCount,
      deletedConversations: deletedConversations.deletedCount
    });
  } catch (error) {
    logger.err('Delete organization error:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

export default router;