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
const Campaign_1 = __importDefault(require("@src/models/Campaign"));
const auth_1 = require("@src/middleware/auth");
const roles_1 = require("@src/middleware/roles");
const strictOrganizationAccess_1 = require("@src/middleware/strictOrganizationAccess");
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
            console.error(`❌ Template folder creation failed:`, folderError?.message);
            jet_logger_1.default.warn(`⚠️  Failed to create Mailchimp folder for ${organization.name}:`, folderError?.message);
            jet_logger_1.default.warn(`   Organization created successfully, but folder must be created manually.`);
        }
        try {
            const MC = mailchimp_marketing_1.default;
            const listName = `${organization.name} Subscribers`;
            const fromEmail = organization.fromEmail;
            const fromName = organization.fromName || organization.name;
            if (!fromEmail) {
                throw new Error('Organization must have fromEmail configured before creating audience');
            }
            const audienceList = await MC.lists.createList({
                name: listName,
                permission_reminder: `You are receiving this email because you signed up for ${organization.name}.`,
                email_type_option: false,
                contact: {
                    company: organization.name,
                    address1: '',
                    city: '',
                    state: '',
                    zip: '',
                    country: 'US',
                },
                campaign_defaults: {
                    from_name: fromName,
                    from_email: fromEmail,
                    subject: '',
                    language: 'en',
                },
            });
            const listId = String(audienceList.id);
            organization.mailchimpAudienceId = listId;
            await organization.save();
            jet_logger_1.default.info(`✅ Created Mailchimp audience list "${listName}" (ID: ${listId}) for org: ${organization.name}`);
        }
        catch (audienceError) {
            console.error(`❌ Audience list creation failed:`, audienceError?.message);
            jet_logger_1.default.warn(`⚠️  Failed to create Mailchimp audience list for ${organization.name}:`, audienceError?.message);
            jet_logger_1.default.warn(`   Organization created successfully, but audience list must be created manually.`);
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
                mailchimpAudienceId: organization.mailchimpAudienceId || null,
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
router.get('/:slug', auth_1.authenticate, async (req, res) => {
    try {
        const { slug } = req.params;
        const userId = req.tokenPayload?.userId;
        const organization = await Organization_1.default.findOne({ slug: slug.toLowerCase() })
            .select('name slug domain isActive maxUsers maxTemplates createdAt');
        if (!organization) {
            return res.status(404).json({
                error: 'Organization not found',
                message: 'No organization found with this name'
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== organization._id.toString()) {
            jet_logger_1.default.warn(`🚫 [SECURITY] User ${userId} attempted to access org ${organization.slug}`);
            return res.status(403).json({
                error: 'Access denied',
                message: 'You can only view your own organization'
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
            mailchimpAudienceDeleted: false,
            mailchimpFolderDeleted: false,
        };
        if (deleteData) {
            jet_logger_1.default.info(`🗑️  Cascade deleting organization: ${orgToDelete.name}`);
            const MC = mailchimp_marketing_1.default;
            if (orgToDelete.mailchimpAudienceId) {
                try {
                    jet_logger_1.default.info(`  🗑️  Fetching campaigns for audience: ${orgToDelete.mailchimpAudienceId}`);
                    const campaigns = await MC.campaigns.list({
                        list_id: orgToDelete.mailchimpAudienceId,
                        count: 1000
                    });
                    if (campaigns.campaigns && campaigns.campaigns.length > 0) {
                        jet_logger_1.default.info(`  🗑️  Deleting ${campaigns.campaigns.length} Mailchimp campaigns...`);
                        for (const campaign of campaigns.campaigns) {
                            try {
                                await MC.campaigns.remove(campaign.id);
                                jet_logger_1.default.info(`    ✅ Deleted campaign: ${campaign.id}`);
                            }
                            catch (campError) {
                                jet_logger_1.default.err(`    ⚠️  Failed to delete campaign ${campaign.id}: ${campError.message}`);
                            }
                        }
                    }
                }
                catch (campError) {
                    jet_logger_1.default.err(`  ⚠️  Failed to fetch/delete campaigns: ${campError.message}`);
                }
            }
            if (orgToDelete.mailchimpAudienceId) {
                try {
                    jet_logger_1.default.info(`  🗑️  Deleting Mailchimp audience: ${orgToDelete.mailchimpAudienceId}`);
                    await MC.lists.deleteList(orgToDelete.mailchimpAudienceId);
                    deletionSummary.mailchimpAudienceDeleted = true;
                    jet_logger_1.default.info(`  ✅ Mailchimp audience deleted`);
                }
                catch (mcError) {
                    jet_logger_1.default.err(`  ⚠️  Failed to delete Mailchimp audience: ${mcError.message}`);
                    jet_logger_1.default.err(`  ⚠️  Error details: ${JSON.stringify(mcError.response?.body || mcError)}`);
                }
            }
            if (orgToDelete.mailchimpTemplateFolderId) {
                try {
                    jet_logger_1.default.info(`  🗑️  Deleting Mailchimp template folder: ${orgToDelete.mailchimpTemplateFolderId}`);
                    await MC.templateFolders.delete(orgToDelete.mailchimpTemplateFolderId);
                    deletionSummary.mailchimpFolderDeleted = true;
                    jet_logger_1.default.info(`  ✅ Mailchimp template folder deleted`);
                }
                catch (mcError) {
                    jet_logger_1.default.err(`  ⚠️  Failed to delete Mailchimp template folder: ${mcError.message}`);
                }
            }
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
router.post('/:id/mailchimp-folder', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, (0, roles_1.requireRole)('owner', 'admin'), async (req, res) => {
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
router.put('/:id/mailchimp-folder', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, (0, roles_1.requireRole)('owner', 'admin'), async (req, res) => {
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
router.get('/:id/mailchimp-folder', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
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
router.put('/:id/sender-settings', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, roles_1.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { fromEmail, fromName } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!fromEmail || !fromName) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'Both fromEmail and fromName are required'
            });
        }
        const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
        if (!emailRegex.test(fromEmail)) {
            return res.status(400).json({
                error: 'Invalid email format',
                message: 'Please provide a valid email address'
            });
        }
        const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
        const domain = fromEmail.split('@')[1]?.toLowerCase();
        if (genericDomains.includes(domain)) {
            return res.status(400).json({
                error: 'Invalid email domain',
                message: 'Cannot use generic email providers (Gmail, Yahoo, etc). Please use your organization\'s domain.'
            });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Not a member of this organization' });
        }
        organization.fromEmail = fromEmail.toLowerCase().trim();
        organization.fromName = fromName.trim();
        await organization.save();
        if (organization.mailchimpAudienceId) {
            try {
                const MC = mailchimp_marketing_1.default;
                await MC.lists.updateList(organization.mailchimpAudienceId, {
                    campaign_defaults: {
                        from_name: fromName,
                        from_email: fromEmail,
                        subject: '',
                        language: 'en',
                    }
                });
                jet_logger_1.default.info(`✅ Updated email service campaign defaults for org: ${organization.name}`);
            }
            catch (mcError) {
                jet_logger_1.default.warn(`⚠️  Failed to update email service defaults:`, mcError?.message);
                return res.status(200).json({
                    success: true,
                    message: 'Sender settings saved, but email service update failed. Email domain may need verification.',
                    warning: mcError?.message || 'Email service update error',
                    fromEmail: organization.fromEmail,
                    fromName: organization.fromName,
                    requiresVerification: true
                });
            }
        }
        jet_logger_1.default.info(`✅ Updated sender settings for org: ${organization.name} - ${fromEmail}`);
        res.json({
            success: true,
            message: 'Sender settings updated successfully',
            fromEmail: organization.fromEmail,
            fromName: organization.fromName,
            requiresVerification: true,
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Update sender settings error:', error);
        res.status(500).json({
            error: 'Failed to update sender settings',
            message: error.message
        });
    }
});
router.get('/:id/sender-settings', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
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
            fromEmail: organization.fromEmail || '',
            fromName: organization.fromName || organization.name,
            isConfigured: !!(organization.fromEmail && organization.fromName)
        });
    }
    catch (error) {
        jet_logger_1.default.err('❌ Get sender settings error:', error);
        res.status(500).json({
            error: 'Failed to get sender settings',
            message: error.message
        });
    }
});
router.get('/:id/campaigns', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const { status, limit = 50, offset = 0 } = req.query;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Not a member of this organization'
            });
        }
        const query = { organizationId: id };
        if (status) {
            query.status = status;
        }
        const campaigns = await Campaign_1.default.find(query)
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(Number(offset))
            .populate('createdBy', 'name email')
            .populate('templateUsed', 'name templateId')
            .lean();
        const totalCount = await Campaign_1.default.countDocuments(query);
        const statusCounts = await Campaign_1.default.aggregate([
            { $match: { organizationId: user.organizationId } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);
        const stats = {
            total: totalCount,
            draft: 0,
            scheduled: 0,
            sent: 0,
            sending: 0,
            paused: 0,
            canceled: 0,
        };
        statusCounts.forEach((item) => {
            if (item._id in stats) {
                stats[item._id] = item.count;
            }
        });
        res.json({
            success: true,
            campaigns,
            pagination: {
                total: totalCount,
                limit: Number(limit),
                offset: Number(offset),
                hasMore: totalCount > Number(offset) + campaigns.length,
            },
            stats,
        });
    }
    catch (error) {
        console.error('❌ Get campaigns error:', error);
        jet_logger_1.default.err('❌ Get campaigns error:', error);
        res.status(500).json({
            error: 'Failed to fetch campaigns',
            message: error.message
        });
    }
});
router.get('/:id/campaigns/:campaignId', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id, campaignId } = req.params;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Not a member of this organization'
            });
        }
        const campaign = await Campaign_1.default.findOne({
            _id: campaignId,
            organizationId: id
        })
            .populate('createdBy', 'name email picture')
            .populate('templateUsed', 'name templateId html')
            .lean();
        if (!campaign) {
            return res.status(404).json({
                error: 'Campaign not found',
                message: 'Campaign not found or does not belong to this organization'
            });
        }
        res.json({
            success: true,
            campaign,
        });
    }
    catch (error) {
        console.error('❌ Get campaign error:', error);
        jet_logger_1.default.err('❌ Get campaign error:', error);
        res.status(500).json({
            error: 'Failed to fetch campaign',
            message: error.message
        });
    }
});
router.get('/:id/dashboard', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Not a member of this organization'
            });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const [totalCampaigns, totalTemplates, totalMembers, recentCampaigns, campaignStats] = await Promise.all([
            Campaign_1.default.countDocuments({ organizationId: id }),
            GeneratedTemplate_1.default.countDocuments({ organizationId: id }),
            User_1.default.countDocuments({ organizationId: id }),
            Campaign_1.default.find({ organizationId: id })
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('createdBy', 'name email')
                .lean(),
            Campaign_1.default.aggregate([
                { $match: { organizationId: user.organizationId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ])
        ]);
        const stats = {
            campaigns: {
                total: totalCampaigns,
                draft: 0,
                scheduled: 0,
                sent: 0,
            },
            templates: totalTemplates,
            members: totalMembers,
        };
        campaignStats.forEach((item) => {
            if (item._id in stats.campaigns) {
                stats.campaigns[item._id] = item.count;
            }
        });
        res.json({
            success: true,
            organization: {
                id: organization._id,
                name: organization.name,
                slug: organization.slug,
                createdAt: organization.createdAt,
            },
            stats,
            recentCampaigns,
        });
    }
    catch (error) {
        console.error('❌ Get dashboard error:', error);
        jet_logger_1.default.err('❌ Get dashboard error:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data',
            message: error.message
        });
    }
});
router.post('/:id/setup-audience', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Not a member of this organization'
            });
        }
        if (user.orgRole !== 'super_admin' && user.orgRole !== 'admin') {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: 'Only organization admins can setup audience lists'
            });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const MC = mailchimp_marketing_1.default;
        if (organization.mailchimpAudienceId) {
            try {
                const existingList = await MC.lists.getList(organization.mailchimpAudienceId);
                return res.json({
                    success: true,
                    message: 'Audience already configured',
                    audienceId: organization.mailchimpAudienceId,
                    audienceName: existingList.name,
                    memberCount: existingList.stats.member_count
                });
            }
            catch (err) {
            }
        }
        const listName = `${organization.name} Subscribers`;
        const fromEmail = organization.fromEmail;
        const fromName = organization.fromName || organization.name;
        if (!fromEmail) {
            return res.status(400).json({
                error: 'Sender email not configured',
                message: 'Please configure organization sender email in settings before creating audience'
            });
        }
        try {
            const newList = await MC.lists.createList({
                name: listName,
                permission_reminder: `You are receiving this email because you signed up for ${organization.name}.`,
                email_type_option: false,
                contact: {
                    company: organization.name,
                    address1: '123 Main St',
                    city: 'New York',
                    state: 'NY',
                    zip: '10001',
                    country: 'US',
                },
                campaign_defaults: {
                    from_name: fromName,
                    from_email: fromEmail,
                    subject: '',
                    language: 'en',
                },
            });
            const listId = String(newList.id);
            organization.mailchimpAudienceId = listId;
            await organization.save();
            res.json({
                success: true,
                message: 'New dedicated audience created successfully',
                audienceId: listId,
                audienceName: newList.name,
                memberCount: 0
            });
        }
        catch (createError) {
            console.error('❌ Mailchimp createList failed:', createError);
            console.error('❌ Error details:', {
                status: createError.status,
                title: createError.title,
                detail: createError.detail,
                message: createError.message
            });
            throw createError;
        }
    }
    catch (error) {
        console.error('❌ Setup audience error:', error);
        jet_logger_1.default.err('❌ Setup audience error:', error);
        let errorMessage = error.message || 'Unknown error';
        let statusCode = 500;
        if (error.status === 403 || errorMessage.includes('Forbidden')) {
            errorMessage = 'Your Mailchimp account does not have permission to create new audiences. Free accounts are limited to 1 audience. Please upgrade your Mailchimp plan or contact support.';
            statusCode = 403;
        }
        else if (error.status === 400) {
            errorMessage = `Mailchimp API error: ${error.message}`;
            statusCode = 400;
        }
        res.status(statusCode).json({
            error: 'Failed to setup audience',
            message: errorMessage,
            details: error.response?.text || error.message
        });
    }
});
router.get('/:id/audience', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 25));
        const status = req.query.status || 'all';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Not a member of this organization'
            });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        if (!organization.mailchimpAudienceId) {
            return res.status(400).json({
                error: 'No audience list',
                message: 'This organization does not have a Mailchimp audience list configured'
            });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const mailchimpParams = {
            count: limit,
            offset: offset,
            sort_field: 'timestamp_opt',
            sort_dir: 'DESC',
        };
        if (status !== 'all') {
            mailchimpParams.status = status;
        }
        const [listInfo, members] = await Promise.all([
            MC.lists.getList(listId),
            MC.lists.getListMembersInfo(listId, mailchimpParams)
        ]);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const stats = {
            totalSubscribers: listInfo.stats.member_count || 0,
            subscribed: listInfo.stats.member_count || 0,
            unsubscribed: listInfo.stats.unsubscribe_count || 0,
            cleaned: listInfo.stats.cleaned_count || 0,
            newLast30Days: 0,
            openRate: listInfo.stats.open_rate || 0,
            clickRate: listInfo.stats.click_rate || 0,
        };
        let memberList = members.members.map((m) => ({
            email: m.email_address,
            status: m.status,
            joinedAt: m.timestamp_opt,
            firstName: m.merge_fields?.FNAME || '',
            lastName: m.merge_fields?.LNAME || '',
            emailClient: m.email_client || 'Unknown',
            location: m.location?.country_code || '',
        }))
            .filter((m) => {
            const mailchimpOwnerEmail = process.env.MAILCHIMP_OWNER_EMAIL;
            if (mailchimpOwnerEmail && m.email.toLowerCase() === mailchimpOwnerEmail.toLowerCase()) {
                return false;
            }
            return true;
        });
        if (search) {
            const searchLower = search.toLowerCase();
            memberList = memberList.filter((m) => m.email.toLowerCase().includes(searchLower) ||
                m.firstName.toLowerCase().includes(searchLower) ||
                m.lastName.toLowerCase().includes(searchLower));
        }
        const totalMembers = members.total_items || 0;
        const totalPages = Math.ceil(totalMembers / limit);
        res.json({
            success: true,
            audienceId: listId,
            stats,
            members: memberList,
            pagination: {
                page,
                limit,
                totalItems: totalMembers,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
                startItem: totalMembers === 0 ? 0 : offset + 1,
                endItem: Math.min(offset + limit, totalMembers),
            },
            filters: {
                status,
                search,
            },
            listInfo: {
                name: listInfo.name,
                dateCreated: listInfo.date_created,
                webId: listInfo.web_id,
            }
        });
    }
    catch (error) {
        console.error('❌ Get audience error:', error);
        jet_logger_1.default.err('❌ Get audience error:', error);
        if (error.status === 404) {
            return res.status(404).json({
                error: 'Audience not found',
                message: 'The Mailchimp audience list for this organization was not found'
            });
        }
        res.status(500).json({
            error: 'Failed to fetch audience data',
            message: error.message
        });
    }
});
router.post('/:id/subscribers/add', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const { email, firstName, lastName, tags, status = 'subscribed' } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({ error: 'Organization has no audience list configured' });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const member = await MC.lists.addListMember(listId, {
            email_address: email,
            status: status,
            merge_fields: {
                FNAME: firstName || '',
                LNAME: lastName || ''
            },
            tags: tags || []
        });
        res.json({
            success: true,
            member: {
                email: member.email_address,
                status: member.status,
                firstName: member.merge_fields?.FNAME,
                lastName: member.merge_fields?.LNAME
            }
        });
    }
    catch (error) {
        console.error('❌ Add subscriber error:', error);
        res.status(500).json({
            error: 'Failed to add subscriber',
            message: error.message
        });
    }
});
router.post('/:id/subscribers/bulk-import', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const { subscribers } = req.body;
        if (!Array.isArray(subscribers) || subscribers.length === 0) {
            return res.status(400).json({ error: 'Subscribers array is required' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({ error: 'Organization has no audience list configured' });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const operations = subscribers.map((sub) => ({
            email_address: sub.email,
            status: 'subscribed',
            merge_fields: {
                FNAME: sub.firstName || '',
                LNAME: sub.lastName || ''
            }
        }));
        const result = await MC.lists.batchListMembers(listId, {
            members: operations,
            update_existing: false
        });
        res.json({
            success: true,
            addedCount: result.new_members?.length || 0,
            updatedCount: result.updated_members?.length || 0,
            errorCount: result.errors?.length || 0,
            errors: result.errors || []
        });
    }
    catch (error) {
        console.error('❌ Bulk import error:', error);
        res.status(500).json({
            error: 'Failed to import subscribers',
            message: error.message
        });
    }
});
router.put('/:id/subscribers/:email', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id, email } = req.params;
        const userId = req.tokenPayload?.userId;
        const { firstName, lastName, status, tags } = req.body;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({ error: 'Organization has no audience list configured' });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const crypto = require('crypto');
        const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
        const updateData = {};
        if (firstName !== undefined || lastName !== undefined) {
            updateData.merge_fields = {};
            if (firstName !== undefined)
                updateData.merge_fields.FNAME = firstName;
            if (lastName !== undefined)
                updateData.merge_fields.LNAME = lastName;
        }
        if (status)
            updateData.status = status;
        const member = await MC.lists.updateListMember(listId, subscriberHash, updateData);
        if (tags && Array.isArray(tags)) {
            await MC.lists.updateListMemberTags(listId, subscriberHash, {
                tags: tags.map((tag) => ({ name: tag, status: 'active' }))
            });
        }
        res.json({
            success: true,
            member: {
                email: member.email_address,
                status: member.status,
                firstName: member.merge_fields?.FNAME,
                lastName: member.merge_fields?.LNAME
            }
        });
    }
    catch (error) {
        console.error('❌ Update subscriber error:', error);
        res.status(500).json({
            error: 'Failed to update subscriber',
            message: error.message
        });
    }
});
router.delete('/:id/subscribers/:email', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id, email } = req.params;
        const userId = req.tokenPayload?.userId;
        const { permanent = false } = req.query;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({ error: 'Organization has no audience list configured' });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const crypto = require('crypto');
        const subscriberHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
        if (permanent === 'true') {
            await MC.lists.deleteListMemberPermanent(listId, subscriberHash);
        }
        else {
            await MC.lists.updateListMember(listId, subscriberHash, { status: 'unsubscribed' });
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('❌ Delete subscriber error:', error);
        res.status(500).json({
            error: 'Failed to remove subscriber',
            message: error.message
        });
    }
});
router.get('/:id/subscribers/tags', auth_1.authenticate, strictOrganizationAccess_1.strictOrganizationAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user || user.organizationId?.toString() !== id) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const organization = await Organization_1.default.findById(id);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({ error: 'Organization has no audience list configured' });
        }
        const MC = mailchimp_marketing_1.default;
        const listId = organization.mailchimpAudienceId;
        const segments = await MC.lists.listSegments(listId);
        res.json({
            success: true,
            segments: segments.segments || []
        });
    }
    catch (error) {
        console.error('❌ Get tags error:', error);
        res.status(500).json({
            error: 'Failed to fetch tags',
            message: error.message
        });
    }
});
router.post('/:id/campaigns/:campaignId/sync', auth_1.authenticate, async (req, res) => {
    try {
        const { id: orgId, campaignId } = req.params;
        const userId = req.tokenPayload?.userId;
        const org = await Organization_1.default.findById(orgId);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || String(user.organizationId) !== orgId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not belong to this organization'
            });
        }
        const campaign = await Campaign_1.default.findOne({
            _id: campaignId,
            organizationId: orgId
        });
        if (!campaign) {
            return res.status(404).json({
                error: 'Campaign not found',
                message: 'Campaign not found in this organization'
            });
        }
        const MC = mailchimp_marketing_1.default;
        const report = await MC.reports.getCampaignReport(campaign.mailchimpCampaignId);
        campaign.metrics = {
            emailsSent: report.emails_sent || 0,
            opens: report.opens?.opens_total || 0,
            uniqueOpens: report.opens?.unique_opens || 0,
            openRate: report.opens?.open_rate ? report.opens.open_rate * 100 : 0,
            clicks: report.clicks?.clicks_total || 0,
            uniqueClicks: report.clicks?.unique_clicks || 0,
            clickRate: report.clicks?.click_rate ? report.clicks.click_rate * 100 : 0,
            bounces: report.bounces?.hard_bounces || 0,
            bounceRate: report.bounces?.bounce_rate ? report.bounces.bounce_rate * 100 : 0,
            unsubscribes: report.unsubscribed?.unsubscribe_count || 0,
            unsubscribeRate: report.unsubscribed?.unsubscribe_rate ? report.unsubscribed.unsubscribe_rate * 100 : 0,
            lastSyncedAt: new Date(),
        };
        if (report.status === 'sent' && campaign.status !== 'sent') {
            campaign.status = 'sent';
            if (report.send_time) {
                campaign.sentAt = new Date(report.send_time);
            }
        }
        await campaign.save();
        jet_logger_1.default.info(`✅ Synced metrics for campaign ${campaignId}`);
        res.json({
            success: true,
            message: 'Campaign metrics synced successfully',
            campaign: {
                id: campaign._id,
                name: campaign.name,
                status: campaign.status,
                metrics: campaign.metrics,
                lastSyncedAt: campaign.metrics.lastSyncedAt
            }
        });
    }
    catch (error) {
        console.error('❌ Sync metrics error:', error);
        jet_logger_1.default.err('❌ Sync metrics error:', error);
        if (error.status === 404) {
            return res.status(404).json({
                error: 'Campaign not found in Mailchimp',
                message: 'The campaign was not found in Mailchimp'
            });
        }
        res.status(500).json({
            error: 'Failed to sync campaign metrics',
            message: error.message
        });
    }
});
router.get('/:id/campaigns/:campaignId/report', auth_1.authenticate, async (req, res) => {
    try {
        const { id: orgId, campaignId } = req.params;
        const userId = req.tokenPayload?.userId;
        const org = await Organization_1.default.findById(orgId);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || String(user.organizationId) !== orgId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not belong to this organization'
            });
        }
        const campaign = await Campaign_1.default.findOne({
            _id: campaignId,
            organizationId: orgId
        }).populate('createdBy', 'name email');
        if (!campaign) {
            return res.status(404).json({
                error: 'Campaign not found',
                message: 'Campaign not found in this organization'
            });
        }
        const MC = mailchimp_marketing_1.default;
        const report = await MC.reports.getCampaignReport(campaign.mailchimpCampaignId);
        let locationData = [];
        try {
            const locationsResponse = await MC.reports.getLocationsForCampaign(campaign.mailchimpCampaignId, {
                count: 10
            });
            locationData = locationsResponse.locations || [];
        }
        catch (locError) {
        }
        const reportData = {
            success: true,
            campaign: {
                id: campaign._id,
                name: campaign.name,
                subject: campaign.subject,
                status: campaign.status,
                createdAt: campaign.createdAt,
                sentAt: campaign.sentAt,
                createdBy: campaign.createdBy,
                recipientsCount: campaign.recipientsCount,
            },
            performance: {
                emailsSent: report.emails_sent || 0,
                delivered: (report.emails_sent || 0) - (report.bounces?.hard_bounces || 0) - (report.bounces?.soft_bounces || 0),
                opens: {
                    total: report.opens?.opens_total || 0,
                    unique: report.opens?.unique_opens || 0,
                    rate: report.opens?.open_rate ? (report.opens.open_rate * 100) : 0,
                    lastOpen: report.opens?.last_open || null,
                },
                clicks: {
                    total: report.clicks?.clicks_total || 0,
                    unique: report.clicks?.unique_clicks || 0,
                    rate: report.clicks?.click_rate ? (report.clicks.click_rate * 100) : 0,
                    lastClick: report.clicks?.last_click || null,
                    subscriberClicks: report.clicks?.unique_subscriber_clicks || 0,
                },
                bounces: {
                    total: (report.bounces?.hard_bounces || 0) + (report.bounces?.soft_bounces || 0),
                    hard: report.bounces?.hard_bounces || 0,
                    soft: report.bounces?.soft_bounces || 0,
                    rate: report.bounces?.bounce_rate ? (report.bounces.bounce_rate * 100) : 0,
                },
                unsubscribes: {
                    total: report.unsubscribed?.unsubscribe_count || 0,
                    rate: report.unsubscribed?.unsubscribe_rate ? (report.unsubscribed.unsubscribe_rate * 100) : 0,
                },
            },
            clickedLinks: (report.clicks?.click_detail || []).slice(0, 10).map((link) => ({
                url: link.url,
                totalClicks: link.total_clicks || 0,
                uniqueClicks: link.unique_clicks || 0,
                clickPercentage: link.percent || 0,
            })),
            topLocations: locationData.slice(0, 10).map((loc) => ({
                country: loc.country_code || 'Unknown',
                countryName: loc.country_name || loc.country_code || 'Unknown',
                region: loc.region || '',
                regionName: loc.region_name || loc.region || '',
                opens: loc.opens || 0,
            })),
            timeseries: report.timeseries || [],
            sendTime: {
                sentAt: report.send_time || campaign.sentAt,
                timezone: report.timezone || 'UTC',
            },
            list: {
                id: report.list_id,
                name: report.list_name,
            },
        };
        res.json(reportData);
    }
    catch (error) {
        console.error('❌ Get campaign report error:', error);
        jet_logger_1.default.err('❌ Get campaign report error:', error);
        if (error.status === 404) {
            return res.status(404).json({
                error: 'Campaign report not found',
                message: 'The campaign report was not found in Mailchimp'
            });
        }
        res.status(500).json({
            error: 'Failed to fetch campaign report',
            message: error.message
        });
    }
});
router.get('/:id/campaigns/:campaignId/activity', auth_1.authenticate, async (req, res) => {
    try {
        const { id: orgId, campaignId } = req.params;
        const { limit = '50', offset = '0' } = req.query;
        const userId = req.tokenPayload?.userId;
        const org = await Organization_1.default.findById(orgId);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        const user = await User_1.default.findById(userId);
        if (!user || String(user.organizationId) !== orgId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not belong to this organization'
            });
        }
        const campaign = await Campaign_1.default.findOne({
            _id: campaignId,
            organizationId: orgId
        });
        if (!campaign) {
            return res.status(404).json({
                error: 'Campaign not found',
                message: 'Campaign not found in this organization'
            });
        }
        const MC = mailchimp_marketing_1.default;
        const [openedMembers, clickedMembers] = await Promise.all([
            MC.reports.getEmailActivityForCampaign(campaign.mailchimpCampaignId, {
                count: parseInt(limit),
                offset: parseInt(offset),
            }).catch(() => ({ emails: [], total_items: 0 })),
            MC.reports.getCampaignClickDetails(campaign.mailchimpCampaignId, {
                count: parseInt(limit),
            }).catch(() => ({ members_clicked: [], total_items: 0 }))
        ]);
        const activityMap = new Map();
        (openedMembers.emails || []).forEach((email) => {
            const key = email.email_address;
            if (!activityMap.has(key)) {
                activityMap.set(key, {
                    email: email.email_address,
                    opened: false,
                    clicked: false,
                    openCount: 0,
                    clickCount: 0,
                    lastOpened: null,
                    lastClicked: null,
                });
            }
            const activity = activityMap.get(key);
            if (email.activity && email.activity.length > 0) {
                const opens = email.activity.filter((a) => a.action === 'open');
                if (opens.length > 0) {
                    activity.opened = true;
                    activity.openCount = opens.length;
                    activity.lastOpened = opens[opens.length - 1].timestamp;
                }
                const clicks = email.activity.filter((a) => a.action === 'click');
                if (clicks.length > 0) {
                    activity.clicked = true;
                    activity.clickCount = clicks.length;
                    activity.lastClicked = clicks[clicks.length - 1].timestamp;
                }
            }
        });
        const activityList = Array.from(activityMap.values());
        res.json({
            success: true,
            activity: activityList,
            pagination: {
                total: openedMembers.total_items || activityList.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
            }
        });
    }
    catch (error) {
        console.error('❌ Get subscriber activity error:', error);
        jet_logger_1.default.err('❌ Get subscriber activity error:', error);
        res.status(500).json({
            error: 'Failed to fetch subscriber activity',
            message: error.message
        });
    }
});
exports.default = router;
