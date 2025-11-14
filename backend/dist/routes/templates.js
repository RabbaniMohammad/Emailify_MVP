"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mailchimp_marketing_1 = __importDefault(require("@mailchimp/mailchimp_marketing"));
const GeneratedTemplate_1 = __importDefault(require("../models/GeneratedTemplate"));
const auth_1 = require("../middleware/auth");
const organizationContext_1 = require("../middleware/organizationContext");
const User_1 = __importDefault(require("../models/User"));
const jet_logger_1 = __importDefault(require("jet-logger"));
// ---------- Typing shims for SDK groups we call ----------
const mc = mailchimp_marketing_1.default;
const MC_ANY = mailchimp_marketing_1.default;
const router = (0, express_1.Router)();
// ---------- helpers ----------
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function isGeneratedTemplate(id) {
    return id.startsWith('gen_') || id.startsWith('Generated_');
}
/**
 * Get generated template from database
 * 🔒 SECURITY: organizationId is REQUIRED to prevent cross-org access
 */
async function getGeneratedTemplateFromDB(id, organizationId) {
    if (!organizationId) {
        throw new Error('Organization ID is required for security');
    }
    const query = {
        templateId: id,
        organizationId: organizationId // Always filter by organization
    };
    const template = await GeneratedTemplate_1.default.findOne(query);
    if (!template) {
        throw new Error(`Generated template not found: ${id}`);
    }
    return {
        name: template.name,
        html: template.html,
        source: 'generated'
    };
}
/**
 * Renders a template to HTML using a temporary campaign, then deletes it.
 * Requires: MC_AUDIENCE_ID, MC_FROM_EMAIL, MC_FROM_NAME
 */
async function renderViaTempCampaign(templateId) {
    const listId = process.env.MC_AUDIENCE_ID;
    const fromEmail = process.env.MC_FROM_EMAIL;
    const fromName = process.env.MC_FROM_NAME;
    if (!listId || !fromEmail || !fromName)
        return '';
    const campaigns = MC_ANY.campaigns;
    const created = await campaigns.create({
        type: 'regular',
        recipients: { list_id: listId },
        settings: {
            subject_line: 'Preview',
            from_name: fromName,
            reply_to: fromEmail,
            title: `Preview-${templateId}-${Date.now()}`
        }
    });
    const campaignId = created?.id;
    try {
        await campaigns.setContent(campaignId, { template: { id: Number(templateId) } });
        const content = await campaigns.getContent(campaignId);
        return String(content?.html ?? '');
    }
    finally {
        try {
            if (typeof campaigns.remove === 'function')
                await campaigns.remove(campaignId);
            else if (typeof campaigns.delete === 'function')
                await campaigns.delete(campaignId);
        }
        catch { /* best effort cleanup */ }
    }
}
/**
 * Build best-effort HTML for a template
 * 🔒 SECURITY: organizationId is REQUIRED for generated templates
 */
async function getHtmlForTemplate(id, organizationId) {
    if (isGeneratedTemplate(id)) {
        if (!organizationId) {
            throw new Error('Organization ID is required for generated templates');
        }
        return await getGeneratedTemplateFromDB(id, organizationId);
    }
    const sdk = mc;
    let t = null;
    if (typeof sdk.templates?.get === 'function') {
        t = await sdk.templates.get(id);
    }
    else if (typeof sdk.templates?.getTemplate === 'function') {
        t = await sdk.templates.getTemplate(id);
    }
    const name = t?.name ?? t?.template_name ?? t?.template?.name ?? `Template ${id}`;
    let html = String(t?.html ?? t?.source ?? t?.template?.html ?? '').trim();
    let source = 'template.html';
    if (!html) {
        html = await renderViaTempCampaign(id);
        if (html)
            source = 'campaign.content.html';
    }
    if (!html) {
        let dc = null;
        if (typeof sdk.templates?.getDefaultContent === 'function') {
            dc = await sdk.templates.getDefaultContent(id);
        }
        else if (typeof sdk.templates?.getTemplateDefaultContent === 'function') {
            dc = await sdk.templates.getTemplateDefaultContent(id);
        }
        else if (typeof sdk.templates?.defaultContent === 'function') {
            dc = await sdk.templates.defaultContent(id);
        }
        if (dc?.html) {
            html = String(dc.html);
            source = 'defaultContent.html';
        }
        else if (dc?.sections && typeof dc.sections === 'object') {
            const parts = Object.entries(dc.sections)
                .map(([key, val]) => {
                const body = typeof val === 'string' ? val.trim() : '';
                return body ? `<section data-section="${key}">${body}</section>` : '';
            })
                .filter(Boolean);
            html = parts.join('\n<hr />\n');
            source = 'stitched.sections';
        }
    }
    return { name, html: html || '', source };
}
// ---------- Routes ----------
/** GET /api/templates?query=&limit=&offset= → { items:[{id,name,...metadata}], total } */
router.get('/', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const query = String(req.query.query ?? '').trim().toLowerCase();
        const limit = Math.min(Number(req.query.limit ?? 50), 250);
        const offset = Number(req.query.offset ?? 0);
        const organization = req.organization;
        // All users must have organization context
        if (!organization) {
            return res.status(403).json({ error: 'Organization context required' });
        }
        jet_logger_1.default.info(`🔍 [TEMPLATES] Filtering by org: ${organization.name} (${organization._id})`);
        // ✅ Fetch Mailchimp templates (filtered by org's folder if configured)
        let mailchimpItems = [];
        try {
            const mailchimpParams = { count: limit, offset, type: 'user' };
            // ✅ Filter by organization's Mailchimp folder if configured
            if (organization.mailchimpTemplateFolderId) {
                mailchimpParams.folder_id = organization.mailchimpTemplateFolderId;
                jet_logger_1.default.info(`🔍 [TEMPLATES] Filtering Mailchimp templates by folder: ${organization.mailchimpTemplateFolderId}`);
            }
            else {
                jet_logger_1.default.warn(`⚠️ [TEMPLATES] No Mailchimp folder configured for org: ${organization.name} - Skipping Mailchimp templates`);
            }
            // Only fetch if folder is configured
            if (organization.mailchimpTemplateFolderId) {
                const resp = await mc.templates.list(mailchimpParams);
                const source = Array.isArray(resp.templates) ? resp.templates : [];
                const userOnly = source.filter((t) => {
                    const ty = (t.type ?? '').toString().toLowerCase();
                    return ty === 'user' || ty === 'saved' || ty === 'regular';
                });
                const seen = new Set();
                mailchimpItems = (userOnly.length ? userOnly : source)
                    .map((t) => ({
                    id: String(t.id),
                    name: String(t.name ?? 'Untitled Template'),
                    type: t.type ?? null,
                    templateType: null,
                    category: t.category ?? null,
                    thumbnail: t.thumbnail ?? null,
                    dateCreated: t.date_created ?? null,
                    dateEdited: t.date_edited ?? null,
                    createdBy: t.created_by ?? null,
                    active: t.active ?? true,
                    dragAndDrop: t.drag_and_drop ?? null,
                    responsive: t.responsive ?? null,
                    folderId: t.folder_id ?? null,
                    screenshotUrl: t.screenshot_url ?? null,
                    source: 'mailchimp',
                }))
                    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
                jet_logger_1.default.info(`🔍 [TEMPLATES] Found ${mailchimpItems.length} Mailchimp templates for this org's folder`);
            }
        }
        catch (mailchimpError) {
            jet_logger_1.default.err(`❌ [TEMPLATES] Mailchimp API error:`, mailchimpError?.message || mailchimpError);
            // Continue without Mailchimp templates instead of failing entire request
        }
        // ✅ Fetch Generated templates from MongoDB (filtered by organization)
        const templateQuery = { organizationId: organization._id };
        const generatedTemplates = await GeneratedTemplate_1.default.find(templateQuery)
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        jet_logger_1.default.info(`🔍 [TEMPLATES] Found ${generatedTemplates.length} AI-generated templates for this org`);
        const generatedItems = generatedTemplates.map((t) => {
            return {
                id: t.templateId,
                name: t.name,
                type: t.type || 'generated',
                templateType: t.templateType || 'AI Generated',
                category: t.category || 'N/A',
                thumbnail: t.thumbnail || '',
                dateCreated: t.createdAt?.toISOString() ?? null,
                dateEdited: t.updatedAt?.toISOString() ?? null,
                createdBy: t.createdBy || 'Unknown',
                active: t.active || 'N/A',
                dragAndDrop: false,
                responsive: t.responsive || 'Yes',
                folderId: t.folderId || 'N/A',
                screenshotUrl: null,
                source: t.source || 'AI Generated',
            };
        });
        // ✅ Merge both lists (generated templates first, then Mailchimp)
        let items = [...generatedItems, ...mailchimpItems];
        // ✅ Apply search filter if provided
        if (query) {
            items = items.filter((t) => t.name.toLowerCase().includes(query));
        }
        const total = items.length;
        jet_logger_1.default.info(`✅ [TEMPLATES] Returning ${total} templates total for org: ${organization.name}`);
        res.json({ items, total });
    }
    catch (err) {
        const e = err;
        const status = e?.status || e?.statusCode || e?.response?.status || 500;
        const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch templates';
        console.error('❌ [LIST_TEMPLATES] Error:', { status, message });
        console.error('❌ [LIST_TEMPLATES] Stack:', e?.stack);
        res.status(status).json({ code: 'FETCH_ERROR', message });
    }
});
/** POST /api/templates - Create a GeneratedTemplate from Visual Editor */
router.post('/', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const { name, content, 
        // allow legacy payload keys
        html: contentHtml, templateName, 
        // metadata fields from frontend
        type: payloadType, category, createdBy: payloadCreatedBy, createdDate, lastEdited, active, dragDrop, responsive, folderId, source, } = req.body;
        const finalName = (name || templateName || '').toString().trim();
        const finalContent = (content || contentHtml || '').toString();
        if (!finalName || !finalContent) {
            return res.status(400).json({ code: 'INVALID_PAYLOAD', message: 'Template name and content are required' });
        }
        const userId = req.tokenPayload?.userId;
        const organization = req.organization;
        // Ensure user has an organization
        if (!organization) {
            return res.status(403).json({
                code: 'NO_ORGANIZATION',
                message: 'You must belong to an organization to create templates'
            });
        }
        // Find user for createdBy (frontend requested using Google sign-in name)
        const user = userId ? await User_1.default.findById(userId) : null;
        const createdBy = user ? (user.name || user.email || payloadCreatedBy || 'Unknown User') : (payloadCreatedBy || 'Unknown User');
        // Check if the same template already exists (by exact html OR by name + user + org)
        const existing = await GeneratedTemplate_1.default.findOne({
            $or: [
                { html: finalContent, organizationId: organization._id },
                { name: finalName, userId, organizationId: organization._id }
            ]
        });
        if (existing) {
            return res.json({ id: existing.templateId });
        }
        const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const doc = {
            templateId,
            name: finalName,
            html: finalContent,
            userId: userId,
            organizationId: organization._id, // ✅ ORGANIZATION ISOLATION
            conversationId: undefined,
            type: payloadType || 'Visual editor',
            templateType: 'AI Generated',
            createdBy: createdBy,
            source: source || 'Visual Editor',
            active: active || 'Yes',
            category: category || 'N/A',
            responsive: responsive || 'N/A',
            folderId: folderId || 'N/A',
            thumbnail: '',
            dragDrop: typeof dragDrop === 'boolean' ? dragDrop : true,
        };
        // If frontend provided createdDate/lastEdited, try to set createdAt/updatedAt
        if (createdDate) {
            const d = new Date(createdDate);
            if (!isNaN(d.getTime()))
                doc.createdAt = d;
        }
        if (lastEdited) {
            const d2 = new Date(lastEdited);
            if (!isNaN(d2.getTime()))
                doc.updatedAt = d2;
        }
        const generatedTemplate = await GeneratedTemplate_1.default.create(doc);
        res.json({ id: generatedTemplate.templateId || generatedTemplate._id });
    }
    catch (err) {
        console.error('❌ [POST /api/templates] Error creating template:', err);
        res.status(err?.status || 500).json({ code: 'SAVE_ERROR', message: err?.message || 'Failed to save template' });
    }
});
/** GET /api/templates/:id → JSON: { id, name, html, ...metadata } (no-cache) */
router.get('/:id', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        ETag: `${req.params.id}-${Date.now()}`,
    });
    const id = String(req.params.id);
    const organization = req.organization;
    // All users must have organization context
    if (!organization) {
        return res.status(403).json({ error: 'Organization context required' });
    }
    try {
        if (isGeneratedTemplate(id)) {
            // ✅ Fetch full template with all metadata (FILTERED BY ORGANIZATION)
            const templateQuery = {
                templateId: id,
                organizationId: organization._id // Always filter by organization
            };
            const template = await GeneratedTemplate_1.default.findOne(templateQuery);
            if (!template) {
                console.error('❌ [GET_TEMPLATE] Generated template not found:', id);
                throw new Error(`Generated template not found: ${id}`);
            }
            return res.status(200).json({
                id,
                name: template.name,
                html: template.html,
                type: template.type || 'Generated',
                templateType: template.templateType, // ✅ NEW FIELD
                source: template.source || 'AI Generated',
                active: template.active || 'N/A',
                category: template.category || 'N/A',
                thumbnail: template.thumbnail || '',
                dateCreated: template.createdAt?.toISOString() || null,
                dateEdited: template.updatedAt?.toISOString() || null,
                createdBy: template.createdBy, // ✅ NEW FIELD
                dragAndDrop: false,
                responsive: template.responsive || 'Yes',
                folderId: template.folderId || 'N/A',
                screenshotUrl: null,
            });
        }
        const sdk = mc;
        let template = null;
        if (typeof sdk.templates?.get === 'function') {
            template = await sdk.templates.get(id);
        }
        else if (typeof sdk.templates?.getTemplate === 'function') {
            template = await sdk.templates.getTemplate(id);
        }
        const { name, html, source } = await getHtmlForTemplate(id, organization._id);
        return res.status(200).json({
            id,
            name,
            html,
            type: template?.type ?? null,
            templateType: null, // Not applicable for Mailchimp templates
            category: template?.category ?? null,
            thumbnail: template?.thumbnail ?? null,
            dateCreated: template?.date_created ?? null,
            dateEdited: template?.date_edited ?? null,
            createdBy: template?.created_by ?? null,
            active: template?.active ?? true,
            dragAndDrop: template?.drag_and_drop ?? null,
            responsive: template?.responsive ?? null,
            folderId: template?.folder_id ?? null,
            screenshotUrl: template?.screenshot_url ?? null,
            source,
        });
    }
    catch (e) {
        console.error('❌ [GET_TEMPLATE] Error fetching template:', id);
        console.error('❌ [GET_TEMPLATE] Error details:', e);
        console.error('❌ [GET_TEMPLATE] Error stack:', e.stack);
        const status = e?.status || e?.statusCode || e?.response?.status || 500;
        const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch template';
        console.error('❌ [GET_TEMPLATE] Final error:', { id, status, message });
        return res.status(status).json({ code: 'FETCH_ERROR', message });
    }
});
/** DELETE /api/templates/:id - Delete template */
router.delete('/:id', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const id = String(req.params.id);
        const organization = req.organization;
        const isSuperAdmin = req.isSuperAdmin;
        if (isGeneratedTemplate(id)) {
            // ✅ Delete with organization filtering
            const deleteQuery = { templateId: id };
            // Super admin can delete any, regular users only their org
            if (!isSuperAdmin && organization) {
                deleteQuery.organizationId = organization._id;
            }
            const result = await GeneratedTemplate_1.default.deleteOne(deleteQuery);
            if (result.deletedCount === 0) {
                return res.json({
                    success: true,
                    message: 'Template already deleted or not found',
                    id
                });
            }
            return res.json({
                success: true,
                message: 'Generated template deleted successfully',
                id
            });
        }
        const templates = MC_ANY.templates;
        if (typeof templates.delete === 'function') {
            await templates.delete(id);
        }
        else if (typeof templates.remove === 'function') {
            await templates.remove(id);
        }
        else if (typeof templates.deleteTemplate === 'function') {
            await templates.deleteTemplate(id);
        }
        else {
            throw new Error('Delete method not available on templates API');
        }
        res.json({
            success: true,
            message: 'Template deleted successfully',
            id
        });
    }
    catch (err) {
        console.error('❌ Delete error:', err);
        const status = err?.status || err?.statusCode || 500;
        const message = err?.response?.text || err?.message || 'Failed to delete template';
        if (status === 404) {
            return res.json({
                success: true,
                message: 'Template already deleted or not found',
                id: String(req.params.id)
            });
        }
        res.status(status).json({
            success: false,
            code: 'DELETE_ERROR',
            message
        });
    }
});
/** GET /api/templates/:id/raw → HTML (iframe-friendly), no-cache */
router.get('/:id/raw', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const id = String(req.params.id);
        const organization = req.organization;
        if (!organization) {
            return res.status(403).send('Organization context required');
        }
        const { name, html, source } = await getHtmlForTemplate(id, organization._id);
        const hasDocShell = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
        const fullHtml = hasDocShell
            ? html
            : [
                '<!doctype html>',
                '<html>',
                '<head>',
                '<meta charset="utf-8">',
                '<meta name="viewport" content="width=device-width,initial-scale=1">',
                `<title>${escapeHtml(name)}</title>`,
                '</head>',
                `<body>${html || "<div style='padding:16px;color:#666'>No content.</div>"}</body>`,
                '</html>',
            ].join('');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(fullHtml);
    }
    catch (err) {
        console.error(`❌ Error fetching raw template ${req.params.id}:`, err);
        res
            .status(500)
            .send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:16px;color:#b00020">
           <b>Preview error:</b> ${escapeHtml(err?.message || String(err))}
         </body>`);
    }
});
exports.default = router;
