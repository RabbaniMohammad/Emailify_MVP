import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import { authenticate } from '@src/middleware/auth';
import User from '@src/models/User';

// ---------- Minimal types ----------
type McTemplate = { 
  id: number | string; 
  name?: string; 
  type?: string;
  category?: string;
  thumbnail?: string;
  date_created?: string;
  date_edited?: string;
  created_by?: string;
  active?: boolean;
  drag_and_drop?: boolean;
  responsive?: boolean;
  folder_id?: string;
  screenshot_url?: string;
};
type McTemplatesList = { templates?: McTemplate[]; total_items?: number };

// ---------- Typing shims for SDK groups we call ----------
const mc = mailchimp as unknown as {
  templates: {
    list: (p: { count?: number; offset?: number; type?: string }) => Promise<McTemplatesList>;
    get?: (id: string | number) => Promise<any>;
    getTemplate?: (id: string | number) => Promise<any>;
    getDefaultContent?: (id: string | number) => Promise<any>;
    getTemplateDefaultContent?: (id: string | number) => Promise<any>;
    defaultContent?: (id: string | number) => Promise<any>;
  };
};
const MC_ANY: any = mailchimp as any;

const router = Router();

// ---------- helpers ----------
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isGeneratedTemplate(id: string): boolean {
  return id.startsWith('gen_') || id.startsWith('Generated_');
}

async function getGeneratedTemplateFromDB(id: string): Promise<{ name: string; html: string; source: string }> {
  const template = await GeneratedTemplate.findOne({ templateId: id });
  
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
async function renderViaTempCampaign(templateId: string): Promise<string> {
  const listId   = process.env.MC_AUDIENCE_ID;
  const fromEmail = process.env.MC_FROM_EMAIL;
  const fromName  = process.env.MC_FROM_NAME;

  if (!listId || !fromEmail || !fromName) return '';

  const campaigns: any = MC_ANY.campaigns;

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

  const campaignId: string = created?.id;

  try {
    await campaigns.setContent(campaignId, { template: { id: Number(templateId) } });
    const content = await campaigns.getContent(campaignId);
    return String(content?.html ?? '');
  } finally {
    try {
      if (typeof campaigns.remove === 'function') await campaigns.remove(campaignId);
      else if (typeof campaigns.delete === 'function') await campaigns.delete(campaignId);
    } catch { /* best effort cleanup */ }
  }
}

/** Build best-effort HTML for a template */
async function getHtmlForTemplate(id: string): Promise<{ name: string; html: string; source: string }> {
  if (isGeneratedTemplate(id)) {
    return await getGeneratedTemplateFromDB(id);
  }

  const sdk: any = mc;

  let t: any = null;
  if (typeof sdk.templates?.get === 'function') {
    t = await sdk.templates.get(id);
  } else if (typeof sdk.templates?.getTemplate === 'function') {
    t = await sdk.templates.getTemplate(id);
  }

  const name: string = t?.name ?? t?.template_name ?? t?.template?.name ?? `Template ${id}`;

  let html: string = String(
    t?.html ?? t?.source ?? t?.template?.html ?? ''
  ).trim();
  let source = 'template.html';

  if (!html) {
    html = await renderViaTempCampaign(id);
    if (html) source = 'campaign.content.html';
  }

  if (!html) {
    let dc: any = null;
    if (typeof sdk.templates?.getDefaultContent === 'function') {
      dc = await sdk.templates.getDefaultContent(id);
    } else if (typeof sdk.templates?.getTemplateDefaultContent === 'function') {
      dc = await sdk.templates.getTemplateDefaultContent(id);
    } else if (typeof sdk.templates?.defaultContent === 'function') {
      dc = await sdk.templates.defaultContent(id);
    }

    if (dc?.html) {
      html = String(dc.html);
      source = 'defaultContent.html';
    } else if (dc?.sections && typeof dc.sections === 'object') {
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
// In templates.ts - REPLACE the GET / route with this:

/** GET /api/templates?query=&limit=&offset= → { items:[{id,name,...metadata}], total } */
router.get('/', async (req: Request, res: Response) => {
  try {
    const query  = String(req.query.query ?? '').trim().toLowerCase();
    const limit  = Math.min(Number(req.query.limit ?? 50), 250);
    const offset = Number(req.query.offset ?? 0);

    console.log('📋 [LIST_TEMPLATES] Fetching templates list');
    console.log('📋 [LIST_TEMPLATES] Query:', query || '(none)');
    console.log('📋 [LIST_TEMPLATES] Limit:', limit, 'Offset:', offset);

    // ✅ Fetch Mailchimp templates
    console.log('📬 [LIST_TEMPLATES] Fetching Mailchimp templates...');
    const resp: McTemplatesList = await mc.templates.list({ count: limit, offset, type: 'user' });

    const source: McTemplate[] = Array.isArray(resp.templates) ? resp.templates : [];
    const userOnly: McTemplate[] = source.filter((t) => {
      const ty = (t.type ?? '').toString().toLowerCase();
      return ty === 'user' || ty === 'saved' || ty === 'regular';
    });

    const seen = new Set<string>();
    let mailchimpItems = (userOnly.length ? userOnly : source)
      .map((t) => ({
        id: String(t.id),
        name: String(t.name ?? 'Untitled Template'),
        type: t.type ?? null,
        templateType: null, // ✅ Not applicable for Mailchimp templates
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
        source: 'mailchimp', // ✅ NEW FIELD
      }))
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

    console.log('✅ [LIST_TEMPLATES] Mailchimp templates fetched:', mailchimpItems.length);

    // ✅ Fetch Generated templates from MongoDB
    console.log('🤖 [LIST_TEMPLATES] Fetching generated templates from MongoDB...');
    const generatedTemplates = await GeneratedTemplate.find({})
      .sort({ createdAt: -1 })
      .limit(100) // Reasonable limit
      .lean();

    console.log('✅ [LIST_TEMPLATES] Generated templates fetched:', generatedTemplates.length);

    const generatedItems = generatedTemplates.map((t: any) => {
      console.log('📊 [LIST_TEMPLATES] Mapping template:', {
        id: t.templateId,
        name: t.name,
        templateType: t.templateType,
        createdBy: t.createdBy,
        source: t.source
      });

      return {
        id: t.templateId,
        name: t.name,
        type: t.type || 'generated',
        templateType: t.templateType || 'AI Generated', // ✅ NEW FIELD
        category: t.category || 'N/A',
        thumbnail: t.thumbnail || '',
        dateCreated: t.createdAt?.toISOString() ?? null,
        dateEdited: t.updatedAt?.toISOString() ?? null,
        createdBy: t.createdBy || 'Unknown', // ✅ NEW FIELD (from DB)
        active: t.active || 'N/A',
        dragAndDrop: false,
        responsive: t.responsive || 'Yes',
        folderId: t.folderId || 'N/A',
        screenshotUrl: null,
        source: t.source || 'AI Generated', // ✅ NEW FIELD
      };
    });

    console.log('📊 [LIST_TEMPLATES] Generated items mapped:', generatedItems.length);

    // ✅ Merge both lists (generated templates first, then Mailchimp)
    let items = [...generatedItems, ...mailchimpItems];
    console.log('🔀 [LIST_TEMPLATES] Merged lists, total before filter:', items.length);

    // ✅ Apply search filter if provided
    if (query) {
      console.log('🔍 [LIST_TEMPLATES] Applying search filter:', query);
      items = items.filter((t) => t.name.toLowerCase().includes(query));
      console.log('✅ [LIST_TEMPLATES] Filtered results:', items.length);
    }

    const total = items.length;
    
    console.log(`✅ [LIST_TEMPLATES] Final result: ${generatedItems.length} generated + ${mailchimpItems.length} Mailchimp = ${total} total`);

    res.json({ items, total });
  } catch (err: unknown) {
    const e = err as any;
    const status  = e?.status || e?.statusCode || e?.response?.status || 500;
    const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch templates';
    console.error('❌ [LIST_TEMPLATES] Error:', { status, message });
    console.error('❌ [LIST_TEMPLATES] Stack:', e?.stack);
    res.status(status).json({ code: 'FETCH_ERROR', message });
  }
});

/** POST /api/templates - Create a GeneratedTemplate from Visual Editor */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const {
      name,
      content,
      // allow legacy payload keys
      html: contentHtml,
      templateName,
      // metadata fields from frontend
      type: payloadType,
      category,
      createdBy: payloadCreatedBy,
      createdDate,
      lastEdited,
      active,
      dragDrop,
      responsive,
      folderId,
      source,
    } = req.body as any;

    const finalName = (name || templateName || '').toString().trim();
    const finalContent = (content || contentHtml || '').toString();

    if (!finalName || !finalContent) {
      return res.status(400).json({ code: 'INVALID_PAYLOAD', message: 'Template name and content are required' });
    }

    const userId = (req as any).tokenPayload?.userId;

    // Find user for createdBy (frontend requested using Google sign-in name)
    const user = userId ? await User.findById(userId) : null;
    const createdBy = user ? (user.name || user.email || payloadCreatedBy || 'Unknown User') : (payloadCreatedBy || 'Unknown User');

    // Check if the same template already exists (by exact html OR by name + user)
    const existing = await GeneratedTemplate.findOne({ $or: [ { html: finalContent }, { name: finalName, userId } ] });
    if (existing) {
      console.log('ℹ️ [POST /api/templates] Template already exists, returning existing id:', existing.templateId);
      return res.json({ id: existing.templateId });
    }

    const templateId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const doc: any = {
      templateId,
      name: finalName,
      html: finalContent,
      userId: userId,
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
      if (!isNaN(d.getTime())) doc.createdAt = d;
    }
    if (lastEdited) {
      const d2 = new Date(lastEdited);
      if (!isNaN(d2.getTime())) doc.updatedAt = d2;
    }

    const generatedTemplate = await GeneratedTemplate.create(doc);

    console.log('✅ [POST /api/templates] Created GeneratedTemplate:', generatedTemplate.templateId);

    res.json({ id: generatedTemplate.templateId || generatedTemplate._id });
  } catch (err: any) {
    console.error('❌ [POST /api/templates] Error creating template:', err);
    res.status(err?.status || 500).json({ code: 'SAVE_ERROR', message: err?.message || 'Failed to save template' });
  }
});

/** GET /api/templates/:id → JSON: { id, name, html, ...metadata } (no-cache) */
router.get('/:id', async (req: Request, res: Response) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    ETag: `${req.params.id}-${Date.now()}`,
  });

  const id = String(req.params.id);
  
  console.log('📡 [GET_TEMPLATE] Fetching template:', id);
  
  try {
    if (isGeneratedTemplate(id)) {
      console.log('🤖 [GET_TEMPLATE] Detected as generated template');
      
      // ✅ Fetch full template with all metadata
      const template = await GeneratedTemplate.findOne({ templateId: id });
      
      if (!template) {
        console.error('❌ [GET_TEMPLATE] Generated template not found:', id);
        throw new Error(`Generated template not found: ${id}`);
      }
      
      console.log('✅ [GET_TEMPLATE] Generated template found:', template.name);
      console.log('📊 [GET_TEMPLATE] Template metadata:', {
        templateType: template.templateType,
        createdBy: template.createdBy,
        source: template.source,
        responsive: template.responsive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      });
      console.log('📄 [GET_TEMPLATE] HTML length:', template.html?.length);
      
      return res.status(200).json({ 
        id, 
        name: template.name, 
        html: template.html,
        type: template.type || 'generated',
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

    console.log('📬 [GET_TEMPLATE] Fetching Mailchimp template');
    const sdk: any = mc;
    let template: any = null;
    
    if (typeof sdk.templates?.get === 'function') {
      console.log('📡 [GET_TEMPLATE] Using sdk.templates.get()');
      template = await sdk.templates.get(id);
    } else if (typeof sdk.templates?.getTemplate === 'function') {
      console.log('📡 [GET_TEMPLATE] Using sdk.templates.getTemplate()');
      template = await sdk.templates.getTemplate(id);
    }

    console.log('📄 [GET_TEMPLATE] Fetching HTML content...');
    const { name, html, source } = await getHtmlForTemplate(id);
    
    console.log('✅ [GET_TEMPLATE] Mailchimp template fetched');
    console.log(`📊 [GET_TEMPLATE] Template ${id} → html length: ${html.length} (source: ${source})`);
    console.log('📊 [GET_TEMPLATE] Metadata:', {
      type: template?.type,
      category: template?.category,
      createdBy: template?.created_by,
      responsive: template?.responsive
    });
    
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
  } catch (e: any) {
    console.error('❌ [GET_TEMPLATE] Error fetching template:', id);
    console.error('❌ [GET_TEMPLATE] Error details:', e);
    console.error('❌ [GET_TEMPLATE] Error stack:', e.stack);
    
    const status  = e?.status || e?.statusCode || e?.response?.status || 500;
    const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch template';
    console.error('❌ [GET_TEMPLATE] Final error:', { id, status, message });
    return res.status(status).json({ code: 'FETCH_ERROR', message });
  }
});

/** DELETE /api/templates/:id - Delete template */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    
    if (isGeneratedTemplate(id)) {
      console.log('🗑️ Deleting generated template:', id);
      
      const result = await GeneratedTemplate.deleteOne({ templateId: id });
      
      if (result.deletedCount === 0) {
        console.warn('⚠️ Generated template not found:', id);
        return res.json({ 
          success: true, 
          message: 'Template already deleted or not found',
          id 
        });
      }
      
      console.log('✅ Generated template deleted:', id);
      return res.json({ 
        success: true, 
        message: 'Generated template deleted successfully',
        id 
      });
    }

    const templates: any = MC_ANY.templates;
    
    console.log('🗑️ Deleting Mailchimp template:', id);
    
    if (typeof templates.delete === 'function') {
      await templates.delete(id);
    } else if (typeof templates.remove === 'function') {
      await templates.remove(id);
    } else if (typeof templates.deleteTemplate === 'function') {
      await templates.deleteTemplate(id);
    } else {
      throw new Error('Delete method not available on templates API');
    }
    
    console.log('✅ Template deleted successfully:', id);
    res.json({ 
      success: true, 
      message: 'Template deleted successfully',
      id 
    });
  } catch (err: any) {
    console.error('❌ Delete error:', err);
    
    const status = err?.status || err?.statusCode || 500;
    const message = err?.response?.text || err?.message || 'Failed to delete template';
    
    if (status === 404) {
      console.warn('⚠️ Template not found, may have been already deleted');
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
router.get('/:id/raw', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, html, source } = await getHtmlForTemplate(id);

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

    console.log(`Template ${id} → html length: ${fullHtml.length} (source: ${source})`);
  } catch (err: any) {
    console.error(`❌ Error fetching raw template ${req.params.id}:`, err);
    res
      .status(500)
      .send(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:16px;color:#b00020">
           <b>Preview error:</b> ${escapeHtml(err?.message || String(err))}
         </body>`
      );
  }
});

export default router;