import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';

// ---------- Minimal types ----------
type McTemplate = { id: number | string; name?: string; type?: string };
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
const MC_ANY: any = mailchimp as any; // for campaigns.* calls

const router = Router();

// ---------- helpers ----------
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/** Build best-effort HTML for a template:
 *  1) direct template.html (custom-coded),
 *  2) temp campaign → compiled HTML (classic DnD),
 *  3) default content (sections/html) stitched.
 */
async function getHtmlForTemplate(id: string): Promise<{ name: string; html: string; source: string }> {
  const sdk: any = mc;

  // Try to fetch template metadata/HTML (method name varies by SDK version)
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

  // Fallback 2: render via temporary campaign (works for classic DnD)
  if (!html) {
    html = await renderViaTempCampaign(id);
    if (html) source = 'campaign.content.html';
  }

  // Fallback 3: default content (sections/html), stitch if needed
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

/** GET /api/templates?query=&limit=&offset= → { items:[{id,name}], total } */
router.get('/', async (req: Request, res: Response) => {
  try {
    const query  = String(req.query.query ?? '').trim().toLowerCase();
    const limit  = Math.min(Number(req.query.limit ?? 50), 250);
    const offset = Number(req.query.offset ?? 0);

    // Only Saved/User templates (classic/custom)
    const resp: McTemplatesList = await mc.templates.list({ count: limit, offset, type: 'user' });

    const source: McTemplate[] = Array.isArray(resp.templates) ? resp.templates : [];
    const userOnly: McTemplate[] = source.filter((t) => {
      const ty = (t.type ?? '').toString().toLowerCase();
      return ty === 'user' || ty === 'saved' || ty === 'regular';
    });

    const seen = new Set<string>();
    let items = (userOnly.length ? userOnly : source)
      .map((t) => ({ id: String(t.id), name: String(t.name ?? '') }))
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

    if (query) items = items.filter((t) => t.name.toLowerCase().includes(query));

    const total = typeof resp.total_items === 'number' ? resp.total_items : items.length;
    res.json({ items, total });
  } catch (err: unknown) {
    const e = err as any;
    const status  = e?.status || e?.statusCode || e?.response?.status || 500;
    const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch templates';
    // eslint-disable-next-line no-console
    console.error('Mailchimp templates error:', { status, message });
    res.status(status).json({ code: 'MAILCHIMP_ERROR', message });
  }
});

/** GET /api/templates/:id → JSON: { id, name, html } (no-cache) */
router.get('/:id', async (req: Request, res: Response) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    ETag: `${req.params.id}-${Date.now()}`,
  });

  const id = String(req.params.id);
  try {
    const { name, html, source } = await getHtmlForTemplate(id);
    // eslint-disable-next-line no-console
    console.log(`Template ${id} → html length: ${html.length} (source: ${source})`);
    return res.status(200).json({ id, name, html });
  } catch (e: any) {
    const status  = e?.status || e?.statusCode || e?.response?.status || 500;
    const message = e?.response?.text || e?.detail || e?.message || 'Failed to fetch template';
    console.error('Template detail error:', { status, message });
    return res.status(status).json({ code: 'MAILCHIMP_ERROR', message });
  }
});

/** GET /api/templates/:id/raw → HTML (iframe-friendly), no-cache */
router.get('/:id/raw', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, html, source } = await getHtmlForTemplate(id);

    // Ensure full document shell
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
