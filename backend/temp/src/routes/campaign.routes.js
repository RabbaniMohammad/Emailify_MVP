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
function parseScheduledTime(timeStr) {
    try {
        const date = new Date(timeStr);
        return isNaN(date.getTime()) ? null : date;
    }
    catch {
        return null;
    }
}
function groupByScheduleTime(rows) {
    const groups = new Map();
    rows.forEach(row => {
        const email = row.audiences_list?.trim().toLowerCase();
        const time = row.scheduled_time?.trim();
        if (!email || !isValidEmail(email) || !time)
            return;
        const scheduledDate = parseScheduledTime(time);
        if (!scheduledDate)
            return;
        const timeKey = scheduledDate.toISOString();
        if (!groups.has(timeKey)) {
            groups.set(timeKey, []);
        }
        groups.get(timeKey).push(email);
    });
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
router.get('/mailchimp/audiences', async (req, res) => {
    try {
        const response = await MC.lists.getAllLists({ count: 1000 });
        res.json({
            lists: response.lists || []
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
router.post('/campaign/upload-master', upload.single('file'), async (req, res) => {
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
router.post('/campaign/reconcile', async (req, res) => {
    try {
        const { audienceId, emails } = req.body;
        if (!audienceId || !Array.isArray(emails)) {
            return res.status(400).json({
                error: 'Missing required fields: audienceId, emails'
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
router.post('/campaign/send-test', async (req, res) => {
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
router.post('/campaign/cleanup-temp', async (req, res) => {
    try {
        const { audienceId, emails } = req.body;
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
router.post('/campaign/add-members', async (req, res) => {
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
    }
    catch (error) {
        console.error('Failed to add members:', error);
        res.status(500).json({
            error: 'Failed to add members',
            message: error.message || 'Unknown error'
        });
    }
});
router.post('/campaign/submit', async (req, res) => {
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
        const campaignIds = [];
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
            if (group.isImmediate) {
                await MC.campaigns.send(campaignId);
            }
            else {
                await MC.campaigns.schedule(campaignId, {
                    schedule_time: scheduledTime.toISOString()
                });
            }
            campaignIds.push(campaignId);
        }
        res.json({
            success: true,
            campaignIds,
            count: campaignIds.length
        });
    }
    catch (error) {
        console.error('Failed to submit campaign:', error);
        res.status(500).json({
            error: 'Failed to submit campaign',
            message: error.message || 'Unknown error'
        });
    }
});
exports.default = router;
