import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { requireAdmin, requireSuperAdmin } from '@src/middleware/roles';
import User from '@src/models/User';
import logger from 'jet-logger';

const router = Router();

// Get all users (admin only)
router.get('/users', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await User.find()
      .select('-__v')
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'name email');

    res.json({ users });
  } catch (error) {
    logger.err('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get pending users (admin only)
router.get('/users/pending', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await User.find({ isApproved: false, isActive: true })
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

    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot deactivate super admin' });
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

    if (user.role === 'super_admin') {
      return res.status(400).json({ error: 'User is already super admin' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'User is already an admin' });
    }

    user.role = 'admin';
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

    if (user.role === 'super_admin') {
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

// Reactivate user (admin only)
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

    if (user.role === 'super_admin') {
      return res.status(403).json({ error: 'Cannot demote super admin' });
    }

    if (user.role === 'user') {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    user.role = 'user';
    await user.save();

    logger.info(`⬇️ Admin demoted to user: ${user.email} by ${currentUser.email}`);
    res.json({ message: 'Admin demoted to user', user });
  } catch (error) {
    logger.err('Demote user error:', error);
    res.status(500).json({ error: 'Failed to demote user' });
  }
});

export default router;