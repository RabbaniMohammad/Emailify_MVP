import { Router, type Request, type Response } from 'express';
import { authenticate } from '@src/middleware/auth';
import { adaptEmailToAllChannels } from '@src/services/contentAdaptationService';

const router = Router();

/**
 * POST /api/content-adaptation/preview
 * Generate AI-adapted content preview for all channels
 * 🔒 SECURITY: Protected - requires authentication
 */
router.post('/preview', authenticate, async (req: Request, res: Response) => {
  try {
    const { emailHtml, emailSubject } = req.body;

    if (!emailHtml || !emailSubject) {
      return res.status(400).json({
        error: 'Missing required fields: emailHtml, emailSubject'
      });
    }

    console.log('🤖 Generating AI content preview...');
    
    const adaptedContent = await adaptEmailToAllChannels(emailHtml, emailSubject);

    res.json({
      email: adaptedContent.email,
      sms: adaptedContent.sms,
      whatsapp: adaptedContent.whatsapp,
      instagram: adaptedContent.instagram
    });

  } catch (error: any) {
    console.error('❌ Failed to generate preview:', error);
    res.status(500).json({
      error: 'Failed to generate preview',
      message: error.message || 'Unknown error'
    });
  }
});

export default router;
