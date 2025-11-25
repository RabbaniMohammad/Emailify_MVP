import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '@src/middleware/auth';
import { UploadConsent } from '@src/models/UploadConsent';
import { UploadMaster } from '@src/models/UploadMaster';

const router = Router();

// Ensure uploads folder exists
const consentDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'consent');
fs.mkdirSync(consentDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, consentDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${file.originalname}`),
});

const upload = multer({ storage });

/**
 * POST /api/uploads/consent
 * Save consent record (authenticated client)
 */
router.post('/consent', authenticate, upload.single('proof_file'), async (req: Request, res: Response) => {
  try {
    const tokenPayload = (req as any).tokenPayload || {};
    const clientId = tokenPayload.organizationId || tokenPayload.clientId || req.body.clientId;
    if (!clientId) return res.status(400).json({ error: 'Missing client id' });

    // Try to attach user and organization info for audit
    const userId = tokenPayload.userId;
    let userName = '';
    let organizationName = '';
    try {
      if (userId) {
        const User = (await import('@src/models/User')).default;
        const Organization = (await import('@src/models/Organization')).default;
        const user = await User.findById(userId).lean();
        if (user) {
          userName = user.name || user.email || '';
          const orgId = user.organizationId;
          if (orgId) {
            const org = await Organization.findById(orgId).lean();
            if (org) organizationName = org.name || '';
          }
        }
      }
    } catch (err) {
      // Non-fatal — continue without user/org info
      console.warn('Could not fetch user/org for consent audit:', err?.message || err);
    }

  const uploadId = req.body.uploadId || `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    const sms_optin = req.body.sms_optin === 'true' || req.body.sms_optin === true;
    const whatsapp_optin = req.body.whatsapp_optin === 'true' || req.body.whatsapp_optin === true;
    const instagram_optin = req.body.instagram_optin === 'true' || req.body.instagram_optin === true;
    const email_optin = req.body.email_optin === 'true' || req.body.email_optin === true;

    const proof_file_url = req.file ? `/uploads/consent/${path.basename(req.file.path)}` : req.body.proof_file_url;
    const proof_page_url = req.body.proof_page_url || '';
    const description = req.body.description || '';
    const ip_address = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';

    const record = await UploadConsent.create({
      clientId,
      uploadId,
      userId: userId || undefined,
      userName: userName || undefined,
      organizationName: organizationName || undefined,
      sms_optin,
      whatsapp_optin,
      instagram_optin,
      email_optin,
      proof_file_url,
      proof_page_url,
      description,
      ip_address,
      timestamp: new Date(),
    });

    // Link consent record to UploadMaster if uploadId exists
    try {
      const existing = await UploadMaster.findOne({ uploadId });
      if (existing) {
        existing.consentId = record._id;
        // Also populate audit fields on the master if missing
        if (!existing.userId && userId) existing.userId = userId;
        if (!existing.userName && userName) existing.userName = userName;
        if (!existing.organizationName && organizationName) existing.organizationName = organizationName;
        await existing.save();
      }
    } catch (err: any) {
      console.warn('Failed to link UploadConsent to UploadMaster:', err?.message || err);
    }

    res.json({ success: true, record });
  } catch (error: any) {
    console.error('Failed to save upload consent:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Failed to save consent' });
  }
});

/** GET /api/uploads/:uploadId/consent */
router.get('/:uploadId/consent', authenticate, async (req: Request, res: Response) => {
  try {
    const uploadId = req.params.uploadId;
    const record = await UploadConsent.findOne({ uploadId }).lean();
    if (!record) return res.status(404).json({ error: 'Consent not found' });
    res.json({ record });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to fetch consent' });
  }
});

export default router;
