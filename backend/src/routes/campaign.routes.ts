import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import * as XLSX from 'xlsx';
import multer from 'multer';
import Papa from 'papaparse';

const router = Router();
const MC: any = mailchimp as any;

// Configure Mailchimp
MC.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_DC || 'us1',
});

// Configure multer for file uploads (in-memory)
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// TYPES
// ============================================

type MasterDocRow = {
  audiences_list: string;
  scheduled_time: string;
  test_emails: string;
};

type AudienceReconciliation = {
  existing: string[];
  new: string[];
  ignored: string[];
  summary: {
    existingCount: number;
    newCount: number;
    ignoredCount: number;
  };
};

type ScheduleGroup = {
  scheduledTime: Date;
  emails: string[];
  count: number;
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function parseScheduledTime(timeStr: string): Date | null {
  try {
    const date = new Date(timeStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function groupByScheduleTime(rows: MasterDocRow[]): ScheduleGroup[] {
  const groups = new Map<string, string[]>();

  rows.forEach(row => {
    const email = row.audiences_list?.trim().toLowerCase();
    const time = row.scheduled_time?.trim();

    if (!email || !isValidEmail(email) || !time) return;

    const scheduledDate = parseScheduledTime(time);
    if (!scheduledDate) return;

    const timeKey = scheduledDate.toISOString();

    if (!groups.has(timeKey)) {
      groups.set(timeKey, []);
    }
    groups.get(timeKey)!.push(email);
  });

  const scheduleGroups: ScheduleGroup[] = [];
  groups.forEach((emails, timeKey) => {
    scheduleGroups.push({
      scheduledTime: new Date(timeKey),
      emails: Array.from(new Set(emails)), // dedupe
      count: emails.length
    });
  });

  // Sort by time
  scheduleGroups.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());

  return scheduleGroups;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/mailchimp/audiences
 * Fetch all Mailchimp audience lists
 */
router.get('/mailchimp/audiences', async (req: Request, res: Response) => {
  try {
    const response = await MC.lists.getAllLists({ count: 1000 });
    
    res.json({
      lists: response.lists || []
    });
  } catch (error: any) {
    console.error('Failed to fetch Mailchimp audiences:', error);
    res.status(500).json({
      error: 'Failed to fetch audiences',
      message: error.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/campaign/upload-master
 * Parse uploaded CSV/Excel master document
 */
router.post('/campaign/upload-master', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    const filename = req.file.originalname.toLowerCase();
    let data: MasterDocRow[] = [];

    // Parse Excel
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length === 0) {
        return res.status(400).json({
          error: 'Empty file'
        });
      }

      const headers = rows[0].map((h: any) => String(h || '').trim().toLowerCase());
      const audienceIdx = headers.findIndex(h => h === 'audiences_list' || h === 'audiences list');
      const timeIdx = headers.findIndex(h => h === 'scheduled_time' || h === 'scheduled time');
      const testIdx = headers.findIndex(h => h === 'test_emails' || h === 'test emails');

      if (audienceIdx === -1) {
        return res.status(400).json({
          error: 'Missing required column: "audiences_list"'
        });
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        data.push({
          audiences_list: String(row[audienceIdx] || '').trim(),
          scheduled_time: timeIdx >= 0 ? String(row[timeIdx] || '').trim() : '',
          test_emails: testIdx >= 0 ? String(row[testIdx] || '').trim() : ''
        });
      }
    }
    // Parse CSV
    else if (filename.endsWith('.csv')) {
      const csvText = req.file.buffer.toString('utf-8');
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_')
      });

      if (!parsed.data || parsed.data.length === 0) {
        return res.status(400).json({
          error: 'Empty CSV file'
        });
      }

      const firstRow: any = parsed.data[0];
      if (!('audiences_list' in firstRow) && !('audiences list' in firstRow)) {
        return res.status(400).json({
          error: 'Missing required column: "audiences_list"'
        });
      }

      data = (parsed.data as any[]).map((row: any) => ({
        audiences_list: String(row.audiences_list || row['audiences list'] || '').trim(),
        scheduled_time: String(row.scheduled_time || row['scheduled time'] || '').trim(),
        test_emails: String(row.test_emails || row['test emails'] || '').trim()
      }));
    } else {
      return res.status(400).json({
        error: 'Unsupported file format. Use CSV or Excel (.xlsx, .xls)'
      });
    }

    // Filter out empty rows
    data = data.filter(row => row.audiences_list && isValidEmail(row.audiences_list));

    res.json({
      data,
      count: data.length
    });

  } catch (error: any) {
    console.error('Failed to parse master document:', error);
    res.status(500).json({
      error: 'Failed to parse file',
      message: error.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/campaign/reconcile
 * Compare uploaded emails with Mailchimp audience
 */
router.post('/campaign/reconcile', async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;

    if (!audienceId || !Array.isArray(emails)) {
      return res.status(400).json({
        error: 'Missing required fields: audienceId, emails'
      });
    }

    const validEmails = emails.filter(e => isValidEmail(e));
    const emailSet = new Set(validEmails.map(e => e.toLowerCase()));

    // Fetch existing members from Mailchimp
    const members = await MC.lists.getListMembersInfo(audienceId, {
      count: 1000,
      fields: ['members.email_address']
    });

    const existingEmails = new Set(
      (members.members || []).map((m: any) => m.email_address.toLowerCase())
    );

    const existing: string[] = [];
    const newEmails: string[] = [];

    emailSet.forEach(email => {
      if (existingEmails.has(email)) {
        existing.push(email);
      } else {
        newEmails.push(email);
      }
    });

    const ignored = emails.filter(e => !isValidEmail(e) || !emailSet.has(e.toLowerCase()));

    const reconciliation: AudienceReconciliation = {
      existing,
      new: newEmails,
      ignored,
      summary: {
        existingCount: existing.length,
        newCount: newEmails.length,
        ignoredCount: ignored.length
      }
    };

    res.json(reconciliation);

  } catch (error: any) {
    console.error('Failed to reconcile audiences:', error);
    res.status(500).json({
      error: 'Failed to reconcile',
      message: error.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/campaign/send-test
 * Send test emails
 */
router.post('/campaign/send-test', async (req: Request, res: Response) => {
  try {
    const { testEmails, subject, html } = req.body;

    if (!Array.isArray(testEmails) || !subject || !html) {
      return res.status(400).json({
        error: 'Missing required fields: testEmails, subject, html'
      });
    }

    const validEmails = testEmails.filter(e => isValidEmail(e));

    if (validEmails.length === 0) {
      return res.status(400).json({
        error: 'No valid test emails provided'
      });
    }

    // Create a temporary campaign for testing
    const listId = process.env.MC_AUDIENCE_ID;
    const fromEmail = process.env.MC_FROM_EMAIL;
    const fromName = process.env.MC_FROM_NAME;

    if (!listId || !fromEmail || !fromName) {
      return res.status(500).json({
        error: 'Server configuration error: Missing Mailchimp credentials'
      });
    }

    const campaign = await MC.campaigns.create({
      type: 'regular',
      recipients: { list_id: listId },
      settings: {
        subject_line: subject,
        from_name: fromName,
        reply_to: fromEmail,
        title: `Test - ${Date.now()}`
      }
    });

    const campaignId = campaign.id;

    try {
      // Set campaign content
      await MC.campaigns.setContent(campaignId, { html });

      // Send test
      await MC.campaigns.sendTestEmail(campaignId, {
        test_emails: validEmails,
        send_type: 'html'
      });

      // Delete temporary campaign
      await MC.campaigns.remove(campaignId);

      res.json({
        sent: validEmails.length,
        failed: []
      });

    } catch (error: any) {
      // Try to clean up campaign even if test failed
      try {
        await MC.campaigns.remove(campaignId);
      } catch {}

      throw error;
    }

  } catch (error: any) {
    console.error('Failed to send test emails:', error);
    res.status(500).json({
      error: 'Failed to send test emails',
      message: error.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/campaign/add-members
 * Add new members to Mailchimp audience
 */

// Route 2: Cleanup/archive (needed when checkbox UNCHECKED)
router.post('/campaign/cleanup-temp', async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;
    const validEmails = emails.filter(e => isValidEmail(e));

    await MC.lists.batchListMembers(audienceId, {
      members: validEmails.map(email => ({
        email_address: email,
        status: 'archived'
      })),
      update_existing: true
    });

    res.json({ success: true, archivedCount: validEmails.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


router.post('/campaign/add-members', async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;
    
    if (!audienceId || !Array.isArray(emails)) {
      return res.status(400).json({
        error: 'Missing required fields: audienceId, emails'
      });
    }

    const validEmails = emails.filter(e => isValidEmail(e));

    if (validEmails.length === 0) {
      return res.status(400).json({
        error: 'No valid emails provided'
      });
    }

    const response = await MC.lists.batchListMembers(audienceId, {
      members: validEmails.map(email => ({
        email_address: email,
        status: 'subscribed'
      })),
      update_existing: false
    });

    res.json({
      success: true,
      addedCount: response.new_members?.length || 0,
      errorCount: response.errors?.length || 0
    });

  } catch (error: any) {
    console.error('Failed to add members:', error);
    res.status(500).json({
      error: 'Failed to add members',
      message: error.message || 'Unknown error'
    });
  }
});


/**
 * POST /api/campaign/submit
 * Create and schedule campaigns
 */
router.post('/campaign/submit', async (req: Request, res: Response) => {
  try {
    const { subject, templateHtml, scheduleGroups, testEmails } = req.body;

    if (!subject || !templateHtml || !Array.isArray(scheduleGroups)) {
      return res.status(400).json({
        error: 'Missing required fields: subject, templateHtml, scheduleGroups'
      });
    }

    const listId = process.env.MC_AUDIENCE_ID;
    const fromEmail = process.env.MC_FROM_EMAIL;
    const fromName = process.env.MC_FROM_NAME;

    if (!listId || !fromEmail || !fromName) {
      return res.status(500).json({
        error: 'Server configuration error: Missing Mailchimp credentials'
      });
    }

    const campaignIds: string[] = [];

    // Create one campaign per schedule group
    for (const group of scheduleGroups) {
      const scheduledTime = new Date(group.scheduledTime);

      // Create campaign
      const campaign = await MC.campaigns.create({
        type: 'regular',
        recipients: {
          list_id: listId,
          segment_opts: {
            match: 'any',
            conditions: [{
              condition_type: 'EmailAddress',
              op: 'is',
              field: 'EMAIL',
              value: group.emails
            }]
          }
        },
        settings: {
          subject_line: subject,
          from_name: fromName,
          reply_to: fromEmail,
          title: `Campaign - ${scheduledTime.toISOString()}`
        }
      });

      const campaignId = campaign.id;

      // Set content
      await MC.campaigns.setContent(campaignId, { html: templateHtml });

      // Schedule campaign
      await MC.campaigns.schedule(campaignId, {
        schedule_time: scheduledTime.toISOString()
      });

      campaignIds.push(campaignId);
    }

    res.json({
      success: true,
      campaignIds,
      count: campaignIds.length
    });

  } catch (error: any) {
    console.error('Failed to submit campaign:', error);
    res.status(500).json({
      error: 'Failed to submit campaign',
      message: error.message || 'Unknown error'
    });
  }
});

export default router;