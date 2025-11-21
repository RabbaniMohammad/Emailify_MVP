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

// Extend Express Request type to include file from multer
interface MulterRequest extends Request {
  file?: any;
}


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
  phone?: string;
  instagram_handle?: string;
  scheduled_time: string;
  test_emails: string;
  timezone?: string;
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

// Timezone abbreviation to IANA timezone mapping
const TIMEZONE_MAP: Record<string, string> = {
  // North America
  'EST': 'America/New_York', 'ET': 'America/New_York', 'EDT': 'America/New_York',
  'CST': 'America/Chicago', 'CT': 'America/Chicago', 'CDT': 'America/Chicago',
  'MST': 'America/Denver', 'MT': 'America/Denver', 'MDT': 'America/Denver',
  'PST': 'America/Los_Angeles', 'PT': 'America/Los_Angeles', 'PDT': 'America/Los_Angeles',
  'AKST': 'America/Anchorage', 'AKDT': 'America/Anchorage',
  'HST': 'Pacific/Honolulu', 'HAST': 'Pacific/Honolulu',
  'AST': 'America/Halifax', 'ADT': 'America/Halifax',
  'NST': 'America/St_Johns', 'NDT': 'America/St_Johns',
  // Latin America
  'BRT': 'America/Sao_Paulo', 'BRST': 'America/Sao_Paulo',
  'ART': 'America/Argentina/Buenos_Aires',
  'CLT': 'America/Santiago', 'CLST': 'America/Santiago',
  // Europe
  'UTC': 'UTC', 'GMT': 'Europe/London', 'BST': 'Europe/London',
  'CET': 'Europe/Paris', 'CEST': 'Europe/Paris',
  'EET': 'Europe/Athens', 'EEST': 'Europe/Athens',
  'WET': 'Europe/Lisbon', 'WEST': 'Europe/Lisbon',
  'MSK': 'Europe/Moscow',
  // Middle East
  'GST': 'Asia/Dubai',
  'IST_ISRAEL': 'Asia/Jerusalem', 'IDT': 'Asia/Jerusalem',
  'AST_ARABIA': 'Asia/Riyadh',
  // Asia
  'IST': 'Asia/Kolkata',
  'SGT': 'Asia/Singapore',
  'JST': 'Asia/Tokyo',
  'KST': 'Asia/Seoul',
  'CST_CHINA': 'Asia/Shanghai', 'HKT': 'Asia/Hong_Kong',
  'ICT': 'Asia/Bangkok',
  'WIB': 'Asia/Jakarta',
  'PHT': 'Asia/Manila',
  'PKT': 'Asia/Karachi',
  // Australia & Oceania
  'AEDT': 'Australia/Sydney', 'AEST': 'Australia/Sydney',
  'ACDT': 'Australia/Adelaide', 'ACST': 'Australia/Adelaide',
  'AWST': 'Australia/Perth',
  'NZDT': 'Pacific/Auckland', 'NZST': 'Pacific/Auckland',
  // Africa
  'SAST': 'Africa/Johannesburg',
  'EAT': 'Africa/Nairobi',
  'WAT': 'Africa/Lagos',
  'CAT': 'Africa/Harare'
};

// Timezone offset mapping (in hours from UTC)
// Note: These are standard time offsets (not daylight saving)
const TIMEZONE_OFFSETS: Record<string, number> = {
  // North America - Abbreviations
  'EST': -5, 'ET': -5, 'EDT': -4,
  'CST': -6, 'CT': -6, 'CDT': -5,
  'MST': -7, 'MT': -7, 'MDT': -6,
  'PST': -8, 'PT': -8, 'PDT': -7,
  'AKST': -9, 'AKDT': -8,
  'HST': -10, 'HAST': -10,
  'AST': -4, 'ADT': -3,
  'NST': -3.5, 'NDT': -2.5,
  // Latin America
  'BRT': -3, 'BRST': -2,
  'ART': -3,
  'CLT': -4, 'CLST': -3,
  // Europe - Abbreviations
  'UTC': 0, 'GMT': 0, 'BST': 1,
  'CET': 1, 'CEST': 2,
  'EET': 2, 'EEST': 3,
  'WET': 0, 'WEST': 1,
  'MSK': 3,
  // Middle East
  'GST': 4,
  'IST_ISRAEL': 2, 'IDT': 3,
  'AST_ARABIA': 3,
  // Asia
  'IST': 5.5,
  'SGT': 8,
  'JST': 9,
  'KST': 9,
  'CST_CHINA': 8, 'HKT': 8,
  'ICT': 7,
  'WIB': 7,
  'PHT': 8,
  'PKT': 5,
  // Australia & Oceania
  'AEDT': 11, 'AEST': 10,
  'ACDT': 10.5, 'ACST': 9.5,
  'AWST': 8,
  'NZDT': 13, 'NZST': 12,
  // Africa
  'SAST': 2,
  'EAT': 3,
  'WAT': 1,
  'CAT': 2,
  // IANA timezone names (from frontend UI)
  'AMERICA/NEW_YORK': -5,
  'AMERICA/CHICAGO': -6,
  'AMERICA/DENVER': -7,
  'AMERICA/LOS_ANGELES': -8,
  'AMERICA/ANCHORAGE': -9,
  'PACIFIC/HONOLULU': -10,
  'AMERICA/HALIFAX': -4,
  'AMERICA/ST_JOHNS': -3.5,
  'AMERICA/SAO_PAULO': -3,
  'AMERICA/ARGENTINA/BUENOS_AIRES': -3,
  'AMERICA/SANTIAGO': -4,
  'AMERICA/MEXICO_CITY': -6,
  'EUROPE/LONDON': 0,
  'EUROPE/PARIS': 1,
  'EUROPE/BERLIN': 1,
  'EUROPE/MADRID': 1,
  'EUROPE/ROME': 1,
  'EUROPE/AMSTERDAM': 1,
  'EUROPE/ATHENS': 2,
  'EUROPE/LISBON': 0,
  'EUROPE/MOSCOW': 3,
  'EUROPE/ISTANBUL': 3,
  'ASIA/DUBAI': 4,
  'ASIA/JERUSALEM': 2,
  'ASIA/RIYADH': 3,
  'ASIA/KOLKATA': 5.5,
  'ASIA/SINGAPORE': 8,
  'ASIA/TOKYO': 9,
  'ASIA/SEOUL': 9,
  'ASIA/SHANGHAI': 8,
  'ASIA/HONG_KONG': 8,
  'ASIA/BANGKOK': 7,
  'ASIA/JAKARTA': 7,
  'ASIA/MANILA': 8,
  'ASIA/KARACHI': 5,
  'AUSTRALIA/SYDNEY': 11,
  'AUSTRALIA/MELBOURNE': 11,
  'AUSTRALIA/BRISBANE': 10,
  'AUSTRALIA/ADELAIDE': 10.5,
  'AUSTRALIA/PERTH': 8,
  'PACIFIC/AUCKLAND': 13,
  'AFRICA/JOHANNESBURG': 2,
  'AFRICA/NAIROBI': 3,
  'AFRICA/LAGOS': 1,
  'AFRICA/CAIRO': 2,
  'AFRICA/HARARE': 2
};

function parseScheduledTime(timeStr: string, timezone?: string): Date | null {
  try {
    // Edge case: Empty or null time
    if (!timeStr || timeStr.trim() === '') {
      console.warn(`⚠️ Empty time string provided`);
      return null;
    }
    
    // Normalize common time format variations
    let normalizedTime = timeStr.trim();
    
    // Handle lowercase am/pm -> uppercase AM/PM
    normalizedTime = normalizedTime.replace(/(\d+):(\d+)\s*am/i, '$1:$2 AM');
    normalizedTime = normalizedTime.replace(/(\d+):(\d+)\s*pm/i, '$1:$2 PM');
    
    // Handle formats like "9am" -> "9:00 AM"
    normalizedTime = normalizedTime.replace(/(\d+)\s*am/i, '$1:00 AM');
    normalizedTime = normalizedTime.replace(/(\d+)\s*pm/i, '$1:00 PM');
    
    // Parse the date string
    const date = new Date(normalizedTime);
    
    // Edge case: Invalid date format
    if (isNaN(date.getTime())) {
      console.warn(`⚠️ Unable to parse time: "${timeStr}". Expected format: MM/DD/YYYY HH:MM or YYYY-MM-DD HH:MM`);
      return null;
    }
    
    // Edge case: Date in the past
    const now = new Date();
    if (date < now) {
      console.warn(`⚠️ Scheduled time "${timeStr}" is in the past. Current time: ${now.toISOString()}`);
      // Allow it but warn - customer might want to schedule in past for testing
    }
    
    // If no timezone specified, return as-is (will be interpreted as local time)
    if (!timezone) return date;
    
    // Edge case: Empty timezone string
    if (timezone.trim() === '') {
      console.warn(`⚠️ Empty timezone provided for time "${timeStr}"`);
      return date;
    }
    
    // Get the timezone (uppercase for lookup)
    const tz = timezone.trim().toUpperCase();
    
    // Get offset for this timezone
    const offset = TIMEZONE_OFFSETS[tz];
    
    // Edge case: Unknown timezone
    if (offset === undefined) {
      console.warn(`⚠️ Unknown timezone: "${timezone}". Supported: EST, CST, MST, PST, UTC, GMT, CET, IST, SGT, JST, etc.`);
      return date; // Use local time as fallback
    }
    
    // IMPORTANT: new Date(timeStr) parses as local server time
    // We need to interpret it as the specified timezone, then convert to UTC
    // 
    // Example: "11/5/2025 9:00" in EST (UTC-5):
    // - User means 9:00 AM Eastern Time
    // - That's 14:00 UTC (9 + 5 = 14)
    // - So we SUBTRACT the offset from the local timestamp
    //
    // Formula: UTC = LocalTime - TimezoneOffset
    // For EST (offset = -5): UTC = 9:00 - (-5) = 9:00 + 5 = 14:00 ✓
    
    const utcTime = date.getTime() - (offset * 60 * 60 * 1000);
    return new Date(utcTime);
  } catch (error) {
    console.error(`❌ Error parsing time "${timeStr}":`, error);
    return null;
  }
}

function groupByScheduleTime(rows: MasterDocRow[]): ScheduleGroup[] {
  const groups = new Map<string, string[]>();
  const validationErrors: string[] = [];

  rows.forEach((row, index) => {
    const rowNum = index + 2; // +2 because CSV has header row and arrays are 0-indexed
    const email = row.audiences_list?.trim().toLowerCase();
    const time = row.scheduled_time?.trim();
    const timezone = row.timezone?.trim();

    // Validate email
    if (!email) {
      validationErrors.push(`Row ${rowNum}: Missing email in 'audiences_list' column`);
      return;
    }
    if (!isValidEmail(email)) {
      validationErrors.push(`Row ${rowNum}: Invalid email format '${email}'`);
      return;
    }

    // Validate time
    if (!time) {
      validationErrors.push(`Row ${rowNum}: Missing scheduled time for email '${email}'`);
      return;
    }

    const scheduledDate = parseScheduledTime(time, timezone);
    if (!scheduledDate) {
      const suggestion = timezone 
        ? `Please use format like '11/5/2025 9:00 AM' with timezone '${timezone}'`
        : `Please use format like '11/5/2025 9:00 AM'`;
      validationErrors.push(`Row ${rowNum}: Invalid time format '${time}'. ${suggestion}`);
      return;
    }

    const timeKey = scheduledDate.toISOString();

    if (!groups.has(timeKey)) {
      groups.set(timeKey, []);
    }
    groups.get(timeKey)!.push(email);
  });

  // If there are validation errors, log them
  if (validationErrors.length > 0) {
    console.warn(`⚠️ CSV Validation Warnings (${validationErrors.length} issues):`);
    validationErrors.forEach(err => console.warn(`  - ${err}`));
  }

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
router.post('/campaign/upload-master', authenticate, upload.single('file'), async (req: MulterRequest, res: Response) => {
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
      const phoneIdx = headers.findIndex(h => h === 'phone');
  const instagramIdx = headers.findIndex(h => h === 'instagram_handle' || h === 'instagram handle' || h === 'instagram');
      const timeIdx = headers.findIndex(h => h === 'scheduled_time' || h === 'scheduled time');
      const testIdx = headers.findIndex(h => h === 'test_emails' || h === 'test emails');
      const timezoneIdx = headers.findIndex(h => h === 'timezone');

      if (audienceIdx === -1) {
        return res.status(400).json({
          error: 'Missing required column: "audiences_list"'
        });
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        data.push({
          audiences_list: String(row[audienceIdx] || '').trim(),
          phone: phoneIdx >= 0 ? String(row[phoneIdx] || '').trim() : '',
          instagram_handle: instagramIdx >= 0 ? String(row[instagramIdx] || '').trim() : '',
          scheduled_time: timeIdx >= 0 ? String(row[timeIdx] || '').trim() : '',
          test_emails: testIdx >= 0 ? String(row[testIdx] || '').trim() : '',
          timezone: timezoneIdx >= 0 ? String(row[timezoneIdx] || '').trim() : ''
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
        phone: String(row.phone || '').trim(),
        instagram_handle: String(row.instagram_handle || row['instagram handle'] || row.instagram || '').trim(),
        scheduled_time: String(row.scheduled_time || row['scheduled time'] || '').trim(),
        test_emails: String(row.test_emails || row['test emails'] || '').trim(),
        timezone: String(row.timezone || '').trim()
      }));
    } else {
      return res.status(400).json({
        error: 'Unsupported file format. Use CSV or Excel (.xlsx, .xls)'
      });
    }

    // Filter out empty rows - keep rows that have a valid email OR a phone OR an instagram handle
    data = data.filter(row => {
      const hasEmail = row.audiences_list && isValidEmail(String(row.audiences_list));
      const hasPhone = row.phone && String(row.phone).trim() !== '';
      const hasInstagram = row.instagram_handle && String(row.instagram_handle).trim() !== '';
      // Normalize instagram handle (strip leading @)
      if (hasInstagram) {
        row.instagram_handle = String(row.instagram_handle).trim();
        if (row.instagram_handle.startsWith('@')) {
          row.instagram_handle = row.instagram_handle.slice(1);
        }
      }
      return hasEmail || hasPhone || hasInstagram;
    });

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
    
    // Extract Mailchimp error details if available
    let statusCode = 500;
    let errorResponse: any = {
      error: 'Failed to submit campaign',
      message: error.message || 'Unknown error'
    };
    
    // Check if this is a Mailchimp API error
    if (error.response?.body) {
      const mailchimpError = error.response.body;
      statusCode = error.status || 400;
      
      errorResponse = {
        error: mailchimpError.title || 'Mailchimp API Error',
        detail: mailchimpError.detail || error.message,
        errors: mailchimpError.errors || []
      };
    } else if (error.status) {
      statusCode = error.status;
    }
    
    res.status(statusCode).json(errorResponse);
  }
});

/**
 * POST /api/campaign/validate-audience
 * Validate uploaded CSV against Mailchimp audience
 * Returns: new subscribers (orange), existing subscribers (green), excluded subscribers (red)
 */
router.post('/campaign/validate-audience', authenticate, upload.single('csvFile'), async (req: MulterRequest, res: Response) => {
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

    // Parse CSV file (auto-detect delimiter for CSV/TSV)
    const csvContent = file.buffer.toString('utf-8');
    const parseResult = Papa.parse<any>(csvContent, {
      header: true,
      skipEmptyLines: true,
      delimiter: '', // Auto-detect delimiter (comma, tab, etc.)
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
  // Also extract Instagram handles if present
  const masterInstagramHandles: string[] = [];
    const emailColumns = ['email', 'audiences_list', 'email_address', 'subscriber_email'];
  const instagramColumns = ['instagram_handle', 'instagram handle', 'instagram'];
    
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

      // Find instagram handle in any of the common column names
      for (const col of instagramColumns) {
        if (row[col] && typeof row[col] === 'string') {
          const handle = String(row[col]).trim();
          if (handle) {
            // normalize (strip leading @)
            masterInstagramHandles.push(handle.startsWith('@') ? handle.slice(1) : handle);
          }
          break;
        }
      }
    });

    // Deduplicate master emails
    const uniqueMasterEmails = Array.from(new Set(masterEmails));

    // If there are no emails AND no instagram handles, return an error
    const uniqueInstagramHandles = Array.from(new Set(masterInstagramHandles.map(h => h.toLowerCase())));
    if (uniqueMasterEmails.length === 0 && uniqueInstagramHandles.length === 0) {
      return res.status(400).json({ 
        error: 'No valid recipients found in CSV',
        hint: 'CSV should have email columns (email, audiences_list, email_address) or an instagram_handle column'
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
      instagramHandles: uniqueInstagramHandles,
      instagramSummary: {
        total: uniqueInstagramHandles.length
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
