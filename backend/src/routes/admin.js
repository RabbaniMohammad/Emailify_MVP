"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("@src/middleware/auth");
const roles_1 = require("@src/middleware/roles");
const User_1 = __importDefault(require("@src/models/User"));
const Organization_1 = __importDefault(require("@src/models/Organization"));
const GeneratedTemplate_1 = __importDefault(require("@src/models/GeneratedTemplate"));
const TemplateConversation_1 = __importDefault(require("@src/models/TemplateConversation"));
const jet_logger_1 = __importDefault(require("jet-logger"));
const router = (0, express_1.Router)();
// Get all users (admin only)
router.get('/users', auth_1.authenticate, roles_1.requireAdmin, async (req, res) => {
    try {
        const currentUser = req.currentUser;
        // Only show users from the admin's organization
        const users = await User_1.default.find({ organizationId: currentUser.organizationId })
            .select('-__v')
            .sort({ createdAt: -1 })
            .populate('approvedBy', 'name email');
        jet_logger_1.default.info(`🔍 [ADMIN] Fetching users for org: ${currentUser.organizationId}, found: ${users.length}`);
        res.json({ users });
    }
    catch (error) {
        jet_logger_1.default.err('Get users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});
// Get pending users (admin only)
router.get('/users/pending', auth_1.authenticate, roles_1.requireAdmin, async (req, res) => {
    try {
        const currentUser = req.currentUser;
        // Only show pending users from the admin's organization
        const users = await User_1.default.find({
            organizationId: currentUser.organizationId,
            isApproved: false,
            isActive: true
        })
            .select('-__v')
            .sort({ createdAt: -1 });
        jet_logger_1.default.info(`🔍 [ADMIN] Fetching pending users for org: ${currentUser.organizationId}, found: ${users.length}`);
        res.json({ users });
    }
    catch (error) {
        jet_logger_1.default.err('Get pending users error:', error);
        res.status(500).json({ error: 'Failed to fetch pending users' });
    }
});
// Approve user (admin only)
router.post('/users/:userId/approve', auth_1.authenticate, roles_1.requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
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
        jet_logger_1.default.info(`✅ User approved: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'User approved', user });
    }
    catch (error) {
        jet_logger_1.default.err('Approve user error:', error);
        res.status(500).json({ error: 'Failed to approve user' });
    }
});
// Deactivate user (admin only)
router.post('/users/:userId/deactivate', auth_1.authenticate, roles_1.requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
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
        jet_logger_1.default.info(`🚫 User deactivated: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'User deactivated', user });
    }
    catch (error) {
        jet_logger_1.default.err('Deactivate user error:', error);
        res.status(500).json({ error: 'Failed to deactivate user' });
    }
});
// Promote to admin (super admin only)
router.post('/users/:userId/promote', auth_1.authenticate, roles_1.requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
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
        jet_logger_1.default.info(`⬆️ User promoted to admin: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'User promoted to admin', user });
    }
    catch (error) {
        jet_logger_1.default.err('Promote user error:', error);
        res.status(500).json({ error: 'Failed to promote user' });
    }
});
// Delete user permanently (super admin only)
router.delete('/users/:userId', auth_1.authenticate, roles_1.requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.orgRole === 'super_admin') {
            return res.status(403).json({ error: 'Cannot delete super admin' });
        }
        await User_1.default.findByIdAndDelete(userId);
        jet_logger_1.default.info(`🗑️ User deleted: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'User deleted successfully' });
    }
    catch (error) {
        jet_logger_1.default.err('Delete user error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});
// Reactivate users (admin only)
router.post('/users/:userId/reactivate', auth_1.authenticate, roles_1.requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.isActive = true;
        await user.save();
        jet_logger_1.default.info(`✅ User reactivated: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'User reactivated', user });
    }
    catch (error) {
        jet_logger_1.default.err('Reactivate user error:', error);
        res.status(500).json({ error: 'Failed to reactivate user' });
    }
});
// Demote admin (super admin only)
router.post('/users/:userId/demote', auth_1.authenticate, roles_1.requireSuperAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUser = req.currentUser;
        const user = await User_1.default.findById(userId);
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
        jet_logger_1.default.info(`⬇️ Admin demoted to user: ${user.email} by ${currentUser.email}`);
        res.json({ message: 'Admin demoted to user', user });
    }
    catch (error) {
        jet_logger_1.default.err('Demote user error:', error);
        res.status(500).json({ error: 'Failed to demote user' });
    }
});
// ==================== ORGANIZATION MANAGEMENT (Super Admin Only) ====================
// Get all organizations (super admin only)
router.get('/organizations', auth_1.authenticate, roles_1.requireSuperAdmin, async (req, res) => {
    try {
        const organizations = await Organization_1.default.find()
            .select('-__v')
            .sort({ createdAt: -1 })
            .populate('owner', 'name email');
        // Get user count for each organization
        const orgsWithCounts = await Promise.all(organizations.map(async (org) => {
            const usersCount = await User_1.default.countDocuments({ organizationId: org._id });
            return {
                ...org.toObject(),
                usersCount
            };
        }));
        jet_logger_1.default.info(`🔍 [SUPER ADMIN] Fetching all organizations, found: ${organizations.length}`);
        res.json({ organizations: orgsWithCounts });
    }
    catch (error) {
        jet_logger_1.default.err('Get organizations error:', error);
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});
// Delete organization (super admin only)
router.delete('/organizations/:slug', auth_1.authenticate, roles_1.requireSuperAdmin, async (req, res) => {
    try {
        const { slug } = req.params;
        const { deleteData } = req.body; // boolean flag to also delete users
        const currentUser = req.currentUser;
        // Prevent deleting the default organization
        if (slug.toLowerCase() === 'default') {
            return res.status(403).json({
                error: 'Cannot delete default organization',
                message: 'The default organization cannot be deleted for system integrity.'
            });
        }
        const organization = await Organization_1.default.findOne({ slug: slug.toLowerCase() });
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        // Only super admins from the default org can delete other organizations
        const userOrg = await Organization_1.default.findById(currentUser.organizationId);
        if (!userOrg || userOrg.slug !== 'default') {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: 'Only super admins from the default organization can delete organizations.'
            });
        }
        // Always delete templates and conversations
        const deletedTemplates = await GeneratedTemplate_1.default.deleteMany({ organizationId: organization._id });
        const deletedConversations = await TemplateConversation_1.default.deleteMany({ organizationId: organization._id });
        let deletedUsers = 0;
        if (deleteData) {
            // Delete all users in the organization
            const result = await User_1.default.deleteMany({ organizationId: organization._id });
            deletedUsers = result.deletedCount || 0;
        }
        else {
            // Just remove organization reference from users
            await User_1.default.updateMany({ organizationId: organization._id }, {
                $unset: { organizationId: '' },
                orgRole: 'user',
                isApproved: false
            });
        }
        // Delete the organization
        await Organization_1.default.findByIdAndDelete(organization._id);
        jet_logger_1.default.info(`🗑️ [SUPER ADMIN] Organization deleted: ${organization.slug} by ${currentUser.email}`);
        jet_logger_1.default.info(`   - Users ${deleteData ? 'deleted' : 'unlinked'}: ${deleteData ? deletedUsers : 'N/A'}`);
        jet_logger_1.default.info(`   - Templates deleted: ${deletedTemplates.deletedCount}`);
        jet_logger_1.default.info(`   - Conversations deleted: ${deletedConversations.deletedCount}`);
        res.json({
            message: `Organization "${organization.name}" deleted successfully`,
            deletedOrganization: organization.slug,
            deletedUsers: deleteData ? deletedUsers : undefined,
            deletedTemplates: deletedTemplates.deletedCount,
            deletedConversations: deletedConversations.deletedCount
        });
    }
    catch (error) {
        jet_logger_1.default.err('Delete organization error:', error);
        res.status(500).json({ error: 'Failed to delete organization' });
    }
});
exports.default = router;
