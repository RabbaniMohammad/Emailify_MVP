import { Router, Request, Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';
import GeneratedImage from '@src/models/GeneratedImage';
import User from '@src/models/User';
import logger from 'jet-logger';

const router = Router();

/** POST /api/images - Save a generated image (MVP: stores Ideogram URL and metadata) */
router.post('/', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    // Accept both `imageUrl` and legacy `url` from clients, and provide server-side defaults
    const {
      name,
      prompt,
      wrappedPrompt,
      imageUrl: imageUrlFromBody,
      url: urlAlias,
      metadata
    } = req.body as any;

    const imageUrl = String(imageUrlFromBody || urlAlias || '').trim();

    const organization = (req as any).organization;
    const userId = (req as any).tokenPayload?.userId;

  if (!organization) return res.status(403).json({ error: 'Organization context required' });
  if (!userId) return res.status(401).json({ error: 'User not authenticated' });

  // Provide server-side defaults so clients that only provide a name still succeed
  const finalName = name && String(name).trim() ? String(name).trim() : undefined;
  const finalPrompt = prompt && String(prompt).trim() ? String(prompt).trim() : `Generated image`;

  if (!finalName || !imageUrl) return res.status(400).json({ error: 'name and imageUrl are required' });

    const imageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const doc: any = {
      imageId,
      name: finalName,
      prompt: finalPrompt,
      wrappedPrompt: wrappedPrompt || undefined,
      userId,
      organizationId: organization._id,
      source: 'ideogram',
      modelName: metadata?.model || 'v3',
      width: metadata?.width || undefined,
      height: metadata?.height || undefined,
      url: String(imageUrl),
      thumbnail: metadata?.thumbnail || '',
      metadata: metadata || {}
    };

    const created = await GeneratedImage.create(doc);
    res.json({ id: created.imageId, doc });
  } catch (err: any) {
    logger.err('Failed to save generated image', err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to save image' });
  }
});

/** GET /api/images - list images for the organization */
router.get('/', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const organization = (req as any).organization;
    if (!organization) return res.status(403).json({ error: 'Organization context required' });

    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const items = await GeneratedImage.find({ organizationId: organization._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Resolve user names for createdBy display
    const userIds = Array.from(new Set(items.map((it: any) => String(it.userId)).filter(Boolean)));
    const usersById: Record<string, any> = {};
    if (userIds.length > 0) {
      const users = await User.find({ _id: { $in: userIds } }).lean();
      users.forEach(u => { usersById[String(u._id)] = u; });
    }

    const mapped = items.map((it: any) => ({
      id: it.imageId,
      name: it.name,
      url: it.url,
      thumbnail: it.thumbnail || it.url,
      prompt: it.prompt,
      source: it.source,
      createdBy: (usersById[String(it.userId)]?.name) || (usersById[String(it.userId)]?.email) || String(it.userId),
      dateCreated: it.createdAt?.toISOString?.() ?? null
    }));

    res.json({ items: mapped, total: mapped.length });
  } catch (err: any) {
    logger.err('Failed to list images', err?.message || err);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

/** GET /api/images/:id - fetch single image */
router.get('/:id', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    if (!organization) return res.status(403).json({ error: 'Organization context required' });

    const img = await GeneratedImage.findOne({ imageId: id, organizationId: organization._id }).lean();
    if (!img) return res.status(404).json({ error: 'Image not found' });

    // Resolve createdBy display name
    let createdBy: any = null;
    try {
      if (img.userId) {
        const u = await User.findById(img.userId).lean();
        if (u) createdBy = u.name || u.email || String(u._id);
      }
    } catch (e) {}

    const out = { ...img, createdBy: createdBy || img.userId };
    res.json({ item: out });
  } catch (err: any) {
    logger.err('Failed to fetch image', err?.message || err);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

/** DELETE /api/images/:id - delete saved image */
router.delete('/:id', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    const isSuperAdmin = (req as any).isSuperAdmin;
    if (!organization && !isSuperAdmin) return res.status(403).json({ error: 'Organization context required' });

    const q: any = { imageId: id };
    if (!isSuperAdmin && organization) q.organizationId = organization._id;

    const result = await GeneratedImage.deleteOne(q);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err: any) {
    logger.err('Failed to delete image', err?.message || err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

export default router;
