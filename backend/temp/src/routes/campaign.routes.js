"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mailchimp_marketing_1 = __importDefault(require("@mailchimp/mailchimp_marketing"));
const XLSX = __importStar(require("xlsx"));
const multer_1 = __importDefault(require("multer"));
const papaparse_1 = __importDefault(require("papaparse"));
const Campaign_1 = __importDefault(require("@src/models/Campaign"));
const User_1 = __importDefault(require("@src/models/User"));
const Organization_1 = __importDefault(require("@src/models/Organization"));
const auth_1 = require("@src/middleware/auth");
const router = (0, express_1.Router)();
const MC = mailchimp_marketing_1.default;
MC.setConfig({
    apiKey: process.env.MAILCHIMP_API_KEY,
    server: process.env.MAILCHIMP_DC || 'us1',
});
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}
const TIMEZONE_MAP = {
    'EST': 'America/New_York', 'ET': 'America/New_York', 'EDT': 'America/New_York',
    'CST': 'America/Chicago', 'CT': 'America/Chicago', 'CDT': 'America/Chicago',
    'MST': 'America/Denver', 'MT': 'America/Denver', 'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles', 'PT': 'America/Los_Angeles', 'PDT': 'America/Los_Angeles',
    'AKST': 'America/Anchorage', 'AKDT': 'America/Anchorage',
    'HST': 'Pacific/Honolulu', 'HAST': 'Pacific/Honolulu',
    'AST': 'America/Halifax', 'ADT': 'America/Halifax',
    'NST': 'America/St_Johns', 'NDT': 'America/St_Johns',
    'BRT': 'America/Sao_Paulo', 'BRST': 'America/Sao_Paulo',
    'ART': 'America/Argentina/Buenos_Aires',
    'CLT': 'America/Santiago', 'CLST': 'America/Santiago',
    'UTC': 'UTC', 'GMT': 'Europe/London', 'BST': 'Europe/London',
    'CET': 'Europe/Paris', 'CEST': 'Europe/Paris',
    'EET': 'Europe/Athens', 'EEST': 'Europe/Athens',
    'WET': 'Europe/Lisbon', 'WEST': 'Europe/Lisbon',
    'MSK': 'Europe/Moscow',
    'GST': 'Asia/Dubai',
    'IST_ISRAEL': 'Asia/Jerusalem', 'IDT': 'Asia/Jerusalem',
    'AST_ARABIA': 'Asia/Riyadh',
    'IST': 'Asia/Kolkata',
    'SGT': 'Asia/Singapore',
    'JST': 'Asia/Tokyo',
    'KST': 'Asia/Seoul',
    'CST_CHINA': 'Asia/Shanghai', 'HKT': 'Asia/Hong_Kong',
    'ICT': 'Asia/Bangkok',
    'WIB': 'Asia/Jakarta',
    'PHT': 'Asia/Manila',
    'PKT': 'Asia/Karachi',
    'AEDT': 'Australia/Sydney', 'AEST': 'Australia/Sydney',
    'ACDT': 'Australia/Adelaide', 'ACST': 'Australia/Adelaide',
    'AWST': 'Australia/Perth',
    'NZDT': 'Pacific/Auckland', 'NZST': 'Pacific/Auckland',
    'SAST': 'Africa/Johannesburg',
    'EAT': 'Africa/Nairobi',
    'WAT': 'Africa/Lagos',
    'CAT': 'Africa/Harare'
};
const TIMEZONE_OFFSETS = {
    'EST': -5, 'ET': -5, 'EDT': -4,
    'CST': -6, 'CT': -6, 'CDT': -5,
    'MST': -7, 'MT': -7, 'MDT': -6,
    'PST': -8, 'PT': -8, 'PDT': -7,
    'AKST': -9, 'AKDT': -8,
    'HST': -10, 'HAST': -10,
    'AST': -4, 'ADT': -3,
    'NST': -3.5, 'NDT': -2.5,
    'BRT': -3, 'BRST': -2,
    'ART': -3,
    'CLT': -4, 'CLST': -3,
    'UTC': 0, 'GMT': 0, 'BST': 1,
    'CET': 1, 'CEST': 2,
    'EET': 2, 'EEST': 3,
    'WET': 0, 'WEST': 1,
    'MSK': 3,
    'GST': 4,
    'IST_ISRAEL': 2, 'IDT': 3,
    'AST_ARABIA': 3,
    'IST': 5.5,
    'SGT': 8,
    'JST': 9,
    'KST': 9,
    'CST_CHINA': 8, 'HKT': 8,
    'ICT': 7,
    'WIB': 7,
    'PHT': 8,
    'PKT': 5,
    'AEDT': 11, 'AEST': 10,
    'ACDT': 10.5, 'ACST': 9.5,
    'AWST': 8,
    'NZDT': 13, 'NZST': 12,
    'SAST': 2,
    'EAT': 3,
    'WAT': 1,
    'CAT': 2,
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
function parseScheduledTime(timeStr, timezone) {
    try {
        if (!timeStr || timeStr.trim() === '') {
            console.warn(`⚠️ Empty time string provided`);
            return null;
        }
        let normalizedTime = timeStr.trim();
        normalizedTime = normalizedTime.replace(/(\d+):(\d+)\s*am/i, '$1:$2 AM');
        normalizedTime = normalizedTime.replace(/(\d+):(\d+)\s*pm/i, '$1:$2 PM');
        normalizedTime = normalizedTime.replace(/(\d+)\s*am/i, '$1:00 AM');
        normalizedTime = normalizedTime.replace(/(\d+)\s*pm/i, '$1:00 PM');
        const date = new Date(normalizedTime);
        if (isNaN(date.getTime())) {
            console.warn(`⚠️ Unable to parse time: "${timeStr}". Expected format: MM/DD/YYYY HH:MM or YYYY-MM-DD HH:MM`);
            return null;
        }
        const now = new Date();
        if (date < now) {
            console.warn(`⚠️ Scheduled time "${timeStr}" is in the past. Current time: ${now.toISOString()}`);
        }
        if (!timezone)
            return date;
        if (timezone.trim() === '') {
            console.warn(`⚠️ Empty timezone provided for time "${timeStr}"`);
            return date;
        }
        const tz = timezone.trim().toUpperCase();
        const offset = TIMEZONE_OFFSETS[tz];
        if (offset === undefined) {
            console.warn(`⚠️ Unknown timezone: "${timezone}". Supported: EST, CST, MST, PST, UTC, GMT, CET, IST, SGT, JST, etc.`);
            return date;
        }
        const utcTime = date.getTime() - (offset * 60 * 60 * 1000);
        return new Date(utcTime);
    }
    catch (error) {
        console.error(`❌ Error parsing time "${timeStr}":`, error);
        return null;
    }
}
function groupByScheduleTime(rows) {
    const groups = new Map();
    const validationErrors = [];
    rows.forEach((row, index) => {
        const rowNum = index + 2;
        const email = row.audiences_list?.trim().toLowerCase();
        const time = row.scheduled_time?.trim();
        const timezone = row.timezone?.trim();
        if (!email) {
            validationErrors.push(`Row ${rowNum}: Missing email in 'audiences_list' column`);
            return;
        }
        if (!isValidEmail(email)) {
            validationErrors.push(`Row ${rowNum}: Invalid email format '${email}'`);
            return;
        }
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
        groups.get(timeKey).push(email);
    });
    if (validationErrors.length > 0) {
        console.warn(`⚠️ CSV Validation Warnings (${validationErrors.length} issues):`);
        validationErrors.forEach(err => console.warn(`  - ${err}`));
    }
    const scheduleGroups = [];
    groups.forEach((emails, timeKey) => {
        scheduleGroups.push({
            scheduledTime: new Date(timeKey),
            emails: Array.from(new Set(emails)),
            count: emails.length
        });
    });
    scheduleGroups.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());
    return scheduleGroups;
}
router.get('/mailchimp/audiences', auth_1.authenticate, async (req, res) => {
    try {
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({
                error: 'User not in organization',
                message: 'You must be a member of an organization to access audiences'
            });
        }
        const org = await Organization_1.default.findById(user.organizationId);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        if (!org.mailchimpAudienceId) {
            return res.json({ lists: [] });
        }
        const audienceList = await MC.lists.getList(org.mailchimpAudienceId);
        res.json({
            lists: [audienceList]
        });
    }
    catch (error) {
        console.error('Failed to fetch Mailchimp audiences:', error);
        res.status(500).json({
            error: 'Failed to fetch audiences',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/upload-master', auth_1.authenticate, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'No file uploaded'
            });
        }
        const filename = req.file.originalname.toLowerCase();
        let data = [];
        if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (rows.length === 0) {
                return res.status(400).json({
                    error: 'Empty file'
                });
            }
            const headers = rows[0].map((h) => String(h || '').trim().toLowerCase());
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
        else if (filename.endsWith('.csv')) {
            const csvText = req.file.buffer.toString('utf-8');
            const parsed = papaparse_1.default.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_')
            });
            if (!parsed.data || parsed.data.length === 0) {
                return res.status(400).json({
                    error: 'Empty CSV file'
                });
            }
            const firstRow = parsed.data[0];
            if (!('audiences_list' in firstRow) && !('audiences list' in firstRow)) {
                return res.status(400).json({
                    error: 'Missing required column: "audiences_list"'
                });
            }
            data = parsed.data.map((row) => ({
                audiences_list: String(row.audiences_list || row['audiences list'] || '').trim(),
                scheduled_time: String(row.scheduled_time || row['scheduled time'] || '').trim(),
                test_emails: String(row.test_emails || row['test emails'] || '').trim()
            }));
        }
        else {
            return res.status(400).json({
                error: 'Unsupported file format. Use CSV or Excel (.xlsx, .xls)'
            });
        }
        data = data.filter(row => row.audiences_list && isValidEmail(row.audiences_list));
        res.json({
            data,
            count: data.length
        });
    }
    catch (error) {
        console.error('Failed to parse master document:', error);
        res.status(500).json({
            error: 'Failed to parse file',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/reconcile', auth_1.authenticate, async (req, res) => {
    try {
        const { audienceId, emails } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!audienceId || !Array.isArray(emails)) {
            return res.status(400).json({
                error: 'Missing required fields: audienceId, emails'
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({ error: 'No organization assigned' });
        }
        const org = await Organization_1.default.findById(user.organizationId);
        if (!org || org.mailchimpAudienceId !== audienceId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'You can only access your organization\'s audience'
            });
        }
        const validEmails = emails.filter(e => isValidEmail(e));
        const emailSet = new Set(validEmails.map(e => e.toLowerCase()));
        const members = await MC.lists.getListMembersInfo(audienceId, {
            count: 1000,
            fields: ['members.email_address']
        });
        const existingEmails = new Set((members.members || []).map((m) => m.email_address.toLowerCase()));
        const existing = [];
        const newEmails = [];
        emailSet.forEach(email => {
            if (existingEmails.has(email)) {
                existing.push(email);
            }
            else {
                newEmails.push(email);
            }
        });
        const ignored = emails.filter(e => !isValidEmail(e) || !emailSet.has(e.toLowerCase()));
        const reconciliation = {
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
    }
    catch (error) {
        console.error('Failed to reconcile audiences:', error);
        res.status(500).json({
            error: 'Failed to reconcile',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/send-test', auth_1.authenticate, async (req, res) => {
    try {
        const { testEmails, subject, html } = req.body;
        const userId = req.tokenPayload?.userId;
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
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({ error: 'No organization assigned' });
        }
        const organization = await Organization_1.default.findById(user.organizationId);
        if (!organization) {
            return res.status(404).json({ error: 'Organization not found' });
        }
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
            await MC.campaigns.setContent(campaignId, { html });
            await MC.campaigns.sendTestEmail(campaignId, {
                test_emails: validEmails,
                send_type: 'html'
            });
            await MC.campaigns.remove(campaignId);
            res.json({
                sent: validEmails.length,
                failed: []
            });
        }
        catch (error) {
            try {
                await MC.campaigns.remove(campaignId);
            }
            catch { }
            throw error;
        }
    }
    catch (error) {
        console.error('Failed to send test emails:', error);
        res.status(500).json({
            error: 'Failed to send test emails',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/cleanup-temp', auth_1.authenticate, async (req, res) => {
    try {
        const { audienceId, emails } = req.body;
        const userId = req.tokenPayload?.userId;
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'User not in organization'
            });
        }
        const org = await Organization_1.default.findById(user.organizationId);
        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }
        if (org.mailchimpAudienceId !== audienceId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'Cannot modify another organization\'s audience'
            });
        }
        const validEmails = emails.filter((e) => isValidEmail(e));
        await MC.lists.batchListMembers(audienceId, {
            members: validEmails.map((email) => ({
                email_address: email,
                status: 'archived'
            })),
            update_existing: true
        });
        res.json({ success: true, archivedCount: validEmails.length });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.post('/campaign/add-members', auth_1.authenticate, async (req, res) => {
    try {
        const { audienceId, emails } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!audienceId || !Array.isArray(emails)) {
            return res.status(400).json({
                error: 'Missing required fields: audienceId, emails'
            });
        }
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'User not in organization'
            });
        }
        const org = await Organization_1.default.findById(user.organizationId);
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
    }
    catch (error) {
        console.error('Failed to add members:', error);
        res.status(500).json({
            error: 'Failed to add members',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/submit', auth_1.authenticate, async (req, res) => {
    try {
        const { subject, templateHtml, scheduleGroups, testEmails } = req.body;
        const userId = req.tokenPayload?.userId;
        if (!subject || !templateHtml || !Array.isArray(scheduleGroups)) {
            return res.status(400).json({
                error: 'Missing required fields: subject, templateHtml, scheduleGroups'
            });
        }
        const user = await User_1.default.findById(userId).populate('organizationId');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (!user.organizationId) {
            return res.status(400).json({ error: 'User not in an organization' });
        }
        const organization = user.organizationId;
        const organizationId = organization._id;
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
        const campaignIds = [];
        const dbCampaignIds = [];
        for (const group of scheduleGroups) {
            const scheduledTime = new Date(group.scheduledTime);
            const campaign = await MC.campaigns.create({
                type: 'regular',
                recipients: {
                    list_id: listId,
                    segment_opts: {
                        match: 'any',
                        conditions: group.emails.map((email) => ({
                            condition_type: 'EmailAddress',
                            op: 'is',
                            field: 'EMAIL',
                            value: email
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
            await MC.campaigns.setContent(campaignId, { html: templateHtml });
            let status = 'draft';
            let sentAt;
            let scheduledFor;
            if (group.isImmediate) {
                await MC.campaigns.send(campaignId);
                status = 'sent';
                sentAt = new Date();
            }
            else {
                await MC.campaigns.schedule(campaignId, {
                    schedule_time: scheduledTime.toISOString()
                });
                status = 'scheduled';
                scheduledFor = scheduledTime;
            }
            const dbCampaign = await Campaign_1.default.create({
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
    }
    catch (error) {
        console.error('❌ Failed to submit campaign:', error);
        let statusCode = 500;
        let errorResponse = {
            error: 'Failed to submit campaign',
            message: error.message || 'Unknown error'
        };
        if (error.response?.body) {
            const mailchimpError = error.response.body;
            statusCode = error.status || 400;
            errorResponse = {
                error: mailchimpError.title || 'Mailchimp API Error',
                detail: mailchimpError.detail || error.message,
                errors: mailchimpError.errors || []
            };
        }
        else if (error.status) {
            statusCode = error.status;
        }
        res.status(statusCode).json(errorResponse);
    }
});
router.post('/campaign/validate-audience', auth_1.authenticate, upload.single('csvFile'), async (req, res) => {
    try {
        const userId = req.tokenPayload?.userId;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No CSV file uploaded' });
        }
        const user = await User_1.default.findById(userId);
        if (!user?.organizationId) {
            return res.status(403).json({ error: 'User not associated with organization' });
        }
        const orgId = typeof user.organizationId === 'string'
            ? user.organizationId
            : user.organizationId._id;
        const organization = await Organization_1.default.findById(orgId);
        if (!organization?.mailchimpAudienceId) {
            return res.status(400).json({
                error: 'Organization has no Mailchimp audience configured',
                hint: 'Please setup an audience first'
            });
        }
        const audienceId = organization.mailchimpAudienceId;
        const csvContent = file.buffer.toString('utf-8');
        const parseResult = papaparse_1.default.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            delimiter: '',
            transformHeader: (header) => header.trim().toLowerCase()
        });
        if (parseResult.errors.length > 0) {
            console.error('❌ CSV parse errors:', parseResult.errors);
            return res.status(400).json({
                error: 'Failed to parse CSV',
                details: parseResult.errors.slice(0, 5)
            });
        }
        const masterEmails = [];
        const emailColumns = ['email', 'audiences_list', 'email_address', 'subscriber_email'];
        parseResult.data.forEach((row) => {
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
        const uniqueMasterEmails = Array.from(new Set(masterEmails));
        if (uniqueMasterEmails.length === 0) {
            return res.status(400).json({
                error: 'No valid emails found in CSV',
                hint: 'CSV should have a column named: email, audiences_list, email_address, or subscriber_email'
            });
        }
        const mailchimpEmails = [];
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
            members.forEach((member) => {
                if (member.email_address) {
                    mailchimpEmails.push(member.email_address.toLowerCase());
                }
            });
            offset += batchSize;
            hasMore = members.length === batchSize;
        }
        const mailchimpSet = new Set(mailchimpEmails);
        const masterSet = new Set(uniqueMasterEmails);
        const newSubscribers = [];
        const existingSubscribers = [];
        const excludedSubscribers = [];
        uniqueMasterEmails.forEach(email => {
            if (mailchimpSet.has(email)) {
                existingSubscribers.push(email);
            }
            else {
                newSubscribers.push(email);
            }
        });
        mailchimpEmails.forEach(email => {
            if (!masterSet.has(email)) {
                excludedSubscribers.push(email);
            }
        });
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
    }
    catch (error) {
        console.error('❌ Audience validation failed:', error);
        res.status(500).json({
            error: 'Failed to validate audience',
            message: error.message || 'Unknown error'
        });
    }
});
exports.default = router;
