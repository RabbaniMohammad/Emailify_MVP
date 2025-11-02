import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import * as XLSX from 'xlsx';
import multer from 'multer';
import Papa from 'papaparse';
import Campaign from '@src/models/Campaign';
import User from '@src/models/User';
import Organization from '@src/models/Organization';
import { authenticate } from '@src/middleware/auth';

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
 * Fetch Mailchimp audience list for current user's organization
 */
router.get('/mailchimp/audiences', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).tokenPayload?.userId;
    
    // Get user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ 
        error: 'User not in organization',
        message: 'You must be a member of an organization to access audiences'
      });
    }
    
    const org = await Organization.findById(user.organizationId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    if (!org.mailchimpAudienceId) {
      // Organization has no audience configured yet
      return res.json({ lists: [] });
    }
    
    // Only return THIS organization's audience
    const audienceList = await MC.lists.getList(org.mailchimpAudienceId);
    
    
    res.json({
      lists: [audienceList]  // Only the org's own audience
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
 * 🔒 SECURITY: Protected - requires authentication
 */
router.post('/campaign/upload-master', authenticate, upload.single('file'), async (req: Request, res: Response) => {
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
 * 🔒 SECURITY: Protected - requires authentication and org validation
 */
router.post('/campaign/reconcile', authenticate, async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;
    const userId = (req as any).tokenPayload?.userId;

    if (!audienceId || !Array.isArray(emails)) {
      return res.status(400).json({
        error: 'Missing required fields: audienceId, emails'
      });
    }

    // 🔒 SECURITY: Verify user belongs to organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ error: 'No organization assigned' });
    }

    const org = await Organization.findById(user.organizationId);
    if (!org || org.mailchimpAudienceId !== audienceId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You can only access your organization\'s audience'
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
 * 🔒 SECURITY: Protected - requires authentication
 */
router.post('/campaign/send-test', authenticate, async (req: Request, res: Response) => {
  try {
    const { testEmails, subject, html } = req.body;
    const userId = (req as any).tokenPayload?.userId;

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

    // 🔒 SECURITY: Get user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ error: 'No organization assigned' });
    }

    const organization = await Organization.findById(user.organizationId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Create a temporary campaign for testing
    const listId = organization.mailchimpAudienceId || process.env.MC_AUDIENCE_ID;
    const fromEmail = organization.fromEmail;
    const fromName = organization.fromName || organization.name;

    if (!listId) {
      return res.status(400).json({
        error: 'Audience configuration error',
        message: 'Organization audience not configured'
      });
    }

    if (!fromEmail || !fromName) {
      return res.status(400).json({
        error: 'Sender settings not configured',
        message: 'Please configure sender email and name in organization settings'
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
router.post('/campaign/cleanup-temp', authenticate, async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;
    const userId = (req as any).tokenPayload?.userId;
    
    // Validate ownership
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'User not in organization' 
      });
    }
    
    const org = await Organization.findById(user.organizationId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    if (org.mailchimpAudienceId !== audienceId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Cannot modify another organization\'s audience' 
      });
    }
    
    const validEmails = emails.filter((e: string) => isValidEmail(e));

    await MC.lists.batchListMembers(audienceId, {
      members: validEmails.map((email: string) => ({
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


router.post('/campaign/add-members', authenticate, async (req: Request, res: Response) => {
  try {
    const { audienceId, emails } = req.body;
    const userId = (req as any).tokenPayload?.userId;
    
    if (!audienceId || !Array.isArray(emails)) {
      return res.status(400).json({
        error: 'Missing required fields: audienceId, emails'
      });
    }

    // Validate ownership - ensure audienceId belongs to user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'User not in organization' 
      });
    }
    
    const org = await Organization.findById(user.organizationId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    if (org.mailchimpAudienceId !== audienceId) {
      console.warn(`⚠️  User ${userId} (org: ${org.name}) attempted to add members to unauthorized audience: ${audienceId}`);
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'Cannot add members to another organization\'s audience' 
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
 * NOW WITH DATABASE TRACKING FOR ORG ISOLATION
 */
router.post('/campaign/submit', authenticate, async (req: Request, res: Response) => {
  try {
    const { subject, templateHtml, scheduleGroups, testEmails } = req.body;
    const userId = (req as any).tokenPayload?.userId;


    if (!subject || !templateHtml || !Array.isArray(scheduleGroups)) {
      return res.status(400).json({
        error: 'Missing required fields: subject, templateHtml, scheduleGroups'
      });
    }

    // Get user and organization info for isolation
    const user = await User.findById(userId).populate('organizationId');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.organizationId) {
      return res.status(400).json({ error: 'User not in an organization' });
    }

    const organization = user.organizationId as any;
    const organizationId = organization._id;


    // Use organization's Mailchimp audience list and sender settings
    const listId = organization.mailchimpAudienceId || process.env.MC_AUDIENCE_ID;
    const fromEmail = organization.fromEmail;
    const fromName = organization.fromName || organization.name;

    if (!listId) {
      return res.status(400).json({
        error: 'Organization audience not configured',
        message: 'Please set up your organization audience first'
      });
    }

    if (!fromEmail || !fromName) {
      return res.status(400).json({
        error: 'Sender settings not configured',
        message: 'Please configure sender email and name in organization settings'
      });
    }


    const campaignIds: string[] = [];
    const dbCampaignIds: string[] = [];

    // Create one campaign per schedule group
    for (const group of scheduleGroups) {
      const scheduledTime = new Date(group.scheduledTime);


      // Create campaign in Mailchimp
      const campaign = await MC.campaigns.create({
        type: 'regular',
        recipients: {
          list_id: listId,
          segment_opts: {
            match: 'any', // Any of these conditions = OR logic
            conditions: group.emails.map((email: string) => ({
              condition_type: 'EmailAddress',
              op: 'is',
              field: 'EMAIL',
              value: email // Single email per condition
            }))
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

      // Determine status and send/schedule
      let status: 'draft' | 'scheduled' | 'sent' = 'draft';
      let sentAt: Date | undefined;
      let scheduledFor: Date | undefined;

      // Check if this group is marked for immediate send
      if (group.isImmediate) {
        // Send immediately (works on free plan)
        await MC.campaigns.send(campaignId);
        status = 'sent';
        sentAt = new Date();
      } else {
        // Schedule for later (requires paid plan)
        await MC.campaigns.schedule(campaignId, {
          schedule_time: scheduledTime.toISOString()
        });
        status = 'scheduled';
        scheduledFor = scheduledTime;
      }

      // 💾 Save to database for org isolation
      const dbCampaign = await Campaign.create({
        mailchimpCampaignId: campaignId,
        name: `Campaign - ${scheduledTime.toISOString()}`,
        subject: subject,
        organizationId: organizationId,
        createdBy: userId,
        status: status,
        recipientsCount: group.emails.length,
        audienceId: listId,
        audienceName: organization.name + ' Subscribers',
        sentAt: sentAt,
        scheduledFor: scheduledFor,
        metrics: {
          emailsSent: status === 'sent' ? group.emails.length : 0,
          opens: 0,
          uniqueOpens: 0,
          openRate: 0,
          clicks: 0,
          uniqueClicks: 0,
          clickRate: 0,
          bounces: 0,
          bounceRate: 0,
          unsubscribes: 0,
          unsubscribeRate: 0,
        }
      });


      campaignIds.push(campaignId);
      dbCampaignIds.push(String(dbCampaign._id));
    }


    res.json({
      success: true,
      campaignIds,
      dbCampaignIds,
      count: campaignIds.length
    });

  } catch (error: any) {
    console.error('❌ Failed to submit campaign:', error);
    res.status(500).json({
      error: 'Failed to submit campaign',
      message: error.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/campaign/validate-audience
 * Validate uploaded CSV against Mailchimp audience
 * Returns: new subscribers (orange), existing subscribers (green), excluded subscribers (red)
 */
router.post('/campaign/validate-audience', authenticate, upload.single('csvFile'), async (req: Request, res: Response) => {
  try {
    
    const userId = (req as any).tokenPayload?.userId;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    // Get user's organization
    const user = await User.findById(userId);
    if (!user?.organizationId) {
      return res.status(403).json({ error: 'User not associated with organization' });
    }

    const orgId = typeof user.organizationId === 'string' 
      ? user.organizationId 
      : (user.organizationId as any)._id;

    const organization = await Organization.findById(orgId);
    if (!organization?.mailchimpAudienceId) {
      return res.status(400).json({ 
        error: 'Organization has no Mailchimp audience configured',
        hint: 'Please setup an audience first' 
      });
    }

    const audienceId = organization.mailchimpAudienceId;

    // Parse CSV file
    const csvContent = file.buffer.toString('utf-8');
    const parseResult = Papa.parse<any>(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim().toLowerCase()
    });

    if (parseResult.errors.length > 0) {
      console.error('❌ CSV parse errors:', parseResult.errors);
      return res.status(400).json({ 
        error: 'Failed to parse CSV',
        details: parseResult.errors.slice(0, 5) // First 5 errors
      });
    }

    // Extract emails from CSV
    const masterEmails: string[] = [];
    const emailColumns = ['email', 'audiences_list', 'email_address', 'subscriber_email'];
    
    parseResult.data.forEach((row: any) => {
      // Find email in any of the common column names
      let email = '';
      for (const col of emailColumns) {
        if (row[col] && typeof row[col] === 'string') {
          email = row[col].trim().toLowerCase();
          break;
        }
      }

      if (email && isValidEmail(email)) {
        masterEmails.push(email);
      }
    });

    // Deduplicate master emails
    const uniqueMasterEmails = Array.from(new Set(masterEmails));

    if (uniqueMasterEmails.length === 0) {
      return res.status(400).json({ 
        error: 'No valid emails found in CSV',
        hint: 'CSV should have a column named: email, audiences_list, email_address, or subscriber_email'
      });
    }

    // Fetch all subscribers from Mailchimp audience (paginated)
    const mailchimpEmails: string[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const response = await MC.lists.getListMembersInfo(audienceId, {
        count: batchSize,
        offset: offset,
        fields: ['members.email_address', 'total_items']
      });

      const members = response.members || [];
      members.forEach((member: any) => {
        if (member.email_address) {
          mailchimpEmails.push(member.email_address.toLowerCase());
        }
      });

      offset += batchSize;
      hasMore = members.length === batchSize;
      
    }


    // Create sets for efficient comparison
    const mailchimpSet = new Set(mailchimpEmails);
    const masterSet = new Set(uniqueMasterEmails);

    // Categorize subscribers
    const newSubscribers: string[] = [];      // 🟠 In CSV, NOT in Mailchimp
    const existingSubscribers: string[] = []; // 🟢 In CSV AND in Mailchimp
    const excludedSubscribers: string[] = []; // 🔴 In Mailchimp, NOT in CSV

    // Process master document emails
    uniqueMasterEmails.forEach(email => {
      if (mailchimpSet.has(email)) {
        existingSubscribers.push(email);
      } else {
        newSubscribers.push(email);
      }
    });

    // Find excluded subscribers
    mailchimpEmails.forEach(email => {
      if (!masterSet.has(email)) {
        excludedSubscribers.push(email);
      }
    });

    // Filter out Mailchimp account owner from excluded list
    const ownerEmail = process.env.MAILCHIMP_OWNER_EMAIL?.toLowerCase();
    const filteredExcluded = ownerEmail 
      ? excludedSubscribers.filter(email => email !== ownerEmail)
      : excludedSubscribers;


    res.json({
      success: true,
      masterDocument: {
        total: uniqueMasterEmails.length,
        new: newSubscribers,
        existing: existingSubscribers
      },
      excludedFromCampaign: {
        total: filteredExcluded.length,
        subscribers: filteredExcluded
      },
      summary: {
        newCount: newSubscribers.length,
        existingCount: existingSubscribers.length,
        excludedCount: filteredExcluded.length,
        totalInCsv: uniqueMasterEmails.length,
        totalInMailchimp: mailchimpEmails.length
      }
    });

  } catch (error: any) {
    console.error('❌ Audience validation failed:', error);
    res.status(500).json({
      error: 'Failed to validate audience',
      message: error.message || 'Unknown error'
    });
  }
});

export default router;
