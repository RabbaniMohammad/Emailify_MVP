"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Organization_1 = __importDefault(require("@src/models/Organization"));
const User_1 = __importDefault(require("@src/models/User"));
const GeneratedTemplate_1 = __importDefault(require("@src/models/GeneratedTemplate"));
const TemplateConversation_1 = __importDefault(require("@src/models/TemplateConversation"));
const auth_1 = require("@src/middleware/auth");
const roles_1 = require("@src/middleware/roles");
const jet_logger_1 = __importDefault(require("jet-logger"));
const mailchimp_marketing_1 = __importDefault(require("@mailchimp/mailchimp_marketing"));
const router = (0, express_1.Router)();
router.post('/', auth_1.authenticate, async (req, res) => {
    try {
        const { name, slug, domain } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!name || !slug) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Organization name and slug are required'
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.organizationId) {
            return res.status(400).json({
                error: 'Already in organization',
                message: 'You are already a member of an organization. Please leave it first.'
            });
        }
        const existing = await Organization_1.default.findOne({ slug: slug.toLowerCase() });
        if (existing) {
            return res.status(409).json({
                error: 'Slug already taken',
                message: 'This organization name is already taken. Please choose another.'
            });
        }
        const organization = await Organization_1.default.create({
            name,
            slug: slug.toLowerCase(),
            domain: domain || null,
            owner: userId,
            isActive: true,
        });
        try {
            const MC = mailchimp_marketing_1.default;
            const folderName = `${organization.name} Templates`;
            const folder = await MC.templateFolders.create({ name: folderName });
            const folderId = String(folder.id || folder.folder_id);
            organization.mailchimpTemplateFolderId = folderId;
            await organization.save();
            jet_logger_1.default.info(`✅ Created Mailchimp folder "${folderName}" (ID: ${folderId}) for org: ${organization.name}`);
        }
        catch (folderError) {
            jet_logger_1.default.warn(`⚠️  Failed to create Mailchimp folder for ${organization.name}:`, folderError?.message);
            jet_logger_1.default.warn(`   Organization created successfully, but folder must be created manually.`);
        }
        user.organizationId = organization._id;
        user.orgRole = 'super_admin';
        user.isApproved = true;
        await user.save();
        jet_logger_1.default.info(`✅ Organization created: ${organization.slug} by ${user.email}`);
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
    }
    catch (error) {
        jet_logger_1.default.err('❌ Create organization error:', error);
        res.status(500).json({
            error: 'Failed to create organization',
            message: error.message
        });
    }
});
router.get('/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const organization = await Organization_1.default.findOne({ slug: slug.toLowerCase() })
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
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get organization error:', error);
        res.status(500).json({
            error: 'Failed to fetch organization',
            message: error.message
        });
    }
});
router.post('/:slug/join', auth_1.authenticate, async (req, res) => {
    try {
        const { slug } = req.params;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (user.organizationId) {
            return res.status(400).json({
                error: 'Already in organization',
                message: 'You are already a member of an organization'
            });
        }
        const organization = await Organization_1.default.findOne({ slug: slug.toLowerCase() });
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
        const memberCount = await User_1.default.countDocuments({ organizationId: organization._id });
        if (memberCount >= organization.maxUsers) {
            return res.status(403).json({
                error: 'Organization full',
                message: 'This organization has reached its maximum user limit'
            });
        }
        user.organizationId = organization._id;
        user.orgRole = 'member';
        user.isApproved = false;
        await user.save();
        jet_logger_1.default.info(`👤 User ${user.email} joined organization: ${organization.slug} (pending approval)`);
        res.json({
            success: true,
            message: 'Successfully joined organization. Your account is pending admin approval.',
            requiresApproval: true,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Join organization error:', error);
        res.status(500).json({
            error: 'Failed to join organization',
            message: error.message
        });
    }
});
router.get('/my/details', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId).populate('organizationId');
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
        const organization = user.organizationId;
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
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get my organization error:', error);
        res.status(500).json({
            error: 'Failed to fetch organization details',
            message: error.message
        });
    }
});
router.delete('/:slug', auth_1.authenticate, async (req, res) => {
    try {
        const { slug } = req.params;
        const deleteData = req.query.deleteData !== 'false';
        const userId = req.tokenPayload?.userId;
        const currentUser = await User_1.default.findById(userId).populate('organizationId');
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }
        const userOrg = currentUser.organizationId;
        if (!userOrg || userOrg.slug !== 'default') {
            return res.status(403).json({
                error: 'Permission denied',
                message: 'Only Default Organization can delete organizations'
            });
        }
        if (currentUser.orgRole !== 'super_admin') {
            return res.status(403).json({
                error: 'Permission denied',
                message: 'Only super_admin can delete organizations'
            });
        }
        const orgToDelete = await Organization_1.default.findOne({ slug: slug.toLowerCase() });
        if (!orgToDelete) {
            return res.status(404).json({
                error: 'Organization not found',
                message: 'No organization found with this name'
            });
        }
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
            jet_logger_1.default.info(`🗑️  Cascade deleting organization: ${orgToDelete.name}`);
            const templateResult = await GeneratedTemplate_1.default.deleteMany({
                organizationId: orgToDelete._id
            });
            deletionSummary.templatesDeleted = templateResult.deletedCount || 0;
            const conversationResult = await TemplateConversation_1.default.deleteMany({
                organizationId: orgToDelete._id
            });
            deletionSummary.conversationsDeleted = conversationResult.deletedCount || 0;
            const userResult = await User_1.default.updateMany({ organizationId: orgToDelete._id }, {
                $unset: { organizationId: "" },
                $set: { orgRole: 'member', isApproved: false }
            });
            deletionSummary.usersAffected = userResult.modifiedCount || 0;
            jet_logger_1.default.info(`  ✅ Deleted ${deletionSummary.templatesDeleted} templates`);
            jet_logger_1.default.info(`  ✅ Deleted ${deletionSummary.conversationsDeleted} conversations`);
            jet_logger_1.default.info(`  ✅ Removed organization from ${deletionSummary.usersAffected} users`);
        }
        else {
            jet_logger_1.default.info(`🗑️  Soft deleting organization: ${orgToDelete.name} (data preserved)`);
            const userCount = await User_1.default.countDocuments({ organizationId: orgToDelete._id });
            deletionSummary.usersAffected = userCount;
        }
        await Organization_1.default.deleteOne({ _id: orgToDelete._id });
        jet_logger_1.default.info(`  ✅ Organization deleted: ${orgToDelete.name}`);
        res.json({
            success: true,
            message: `Organization "${orgToDelete.name}" deleted successfully`,
            cascadeDelete: deleteData,
            summary: deletionSummary,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Delete organization error:', error);
        res.status(500).json({
            error: 'Failed to delete organization',
            message: error.message
        });
    }
});
router.post('/:id/mailchimp-folder', auth_1.authenticate, (0, roles_1.requireRole)('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { folderName } = req.body;
        const userId = req.tokenPayload?.userId;
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }
        const MC = mailchimp_marketing_1.default;
        const folderNameToUse = folderName || `${organization.name} Templates`;
        try {
            const folder = await MC.templateFolders.create({ name: folderNameToUse });
            const folderId = folder.id || folder.folder_id;
            organization.mailchimpTemplateFolderId = String(folderId);
            await organization.save();
            jet_logger_1.default.info(`✅ Created Mailchimp folder "${folderNameToUse}" (ID: ${folderId}) for org: ${organization.name}`);
            res.json({
                success: true,
                message: 'Mailchimp folder created and assigned successfully',
                folderId: String(folderId),
                folderName: folderNameToUse,
            });
        }
        catch (mcError) {
            jet_logger_1.default.err(`❌ Mailchimp folder creation error:`, mcError);
            res.status(500).json({
                error: 'Failed to create Mailchimp folder',
                message: mcError?.message || 'Mailchimp API error',
            });
        }
    }
    catch (error) {
        jet_logger_1.default.err('❌ Create Mailchimp folder error:', error);
        res.status(500).json({
            error: 'Failed to create Mailchimp folder',
            message: error.message
        });
    }
});
router.put('/:id/mailchimp-folder', auth_1.authenticate, (0, roles_1.requireRole)('owner', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const { folderId } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!folderId) {
            return res.status(400).json({ error: 'Folder ID is required' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }
        organization.mailchimpTemplateFolderId = String(folderId);
        await organization.save();
        jet_logger_1.default.info(`✅ Assigned Mailchimp folder ${folderId} to org: ${organization.name}`);
        res.json({
            success: true,
            message: 'Mailchimp folder assigned successfully',
            folderId: String(folderId),
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Assign Mailchimp folder error:', error);
        res.status(500).json({
            error: 'Failed to assign Mailchimp folder',
            message: error.message
        });
    }
});
router.get('/:id/mailchimp-folder', auth_1.authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }
        res.json({
            folderId: organization.mailchimpTemplateFolderId || null,
            hasFolder: !!organization.mailchimpTemplateFolderId,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get Mailchimp folder error:', error);
        res.status(500).json({
            error: 'Failed to get Mailchimp folder',
            message: error.message
        });
    }
});
router.get('/mailchimp-folders/list', auth_1.authenticate, (0, roles_1.requireRole)('owner', 'admin'), async (req, res) => {
    try {
        const MC = mailchimp_marketing_1.default;
        const folders = await MC.templateFolders.list({ count: 1000 });
        const folderList = (folders.folders || []).map((f) => ({
            id: String(f.id || f.folder_id),
            name: f.name,
            count: f.count || 0,
        }));
        res.json({
            folders: folderList,
            total: folderList.length,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ List Mailchimp folders error:', error);
        res.status(500).json({
            error: 'Failed to list Mailchimp folders',
            message: error?.message || 'Mailchimp API error'
        });
    }
});
exports.default = router;
