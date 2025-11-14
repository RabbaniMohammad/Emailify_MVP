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
const advancedGrammarService_1 = require("../services/advancedGrammarService");
const cheerio = __importStar(require("cheerio"));
const openai_1 = __importDefault(require("openai"));
const crypto_1 = require("crypto");
const GeneratedTemplate_1 = __importDefault(require("../models/GeneratedTemplate"));
const auth_1 = require("../middleware/auth");
const organizationContext_1 = require("../middleware/organizationContext");
const jet_logger_1 = __importDefault(require("jet-logger"));
const router = (0, express_1.Router)();
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
/**
 * Helper function to ensure full HTML document
 */
function ensureFullDocShell(name, bodyOrDocHtml) {
    const html = bodyOrDocHtml || "<div style='padding:16px;color:#666'>No content.</div>";
    const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
    if (hasDoc)
        return html;
    return [
        '<!doctype html><html><head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${name}</title>`,
        '</head><body>',
        html,
        '</body></html>',
    ].join('');
}
/**
 * POST /api/qa-advanced/:id/golden
 *
 * EXACT REPLACEMENT for /api/qa/:id/golden but using local grammar checker
 * This matches the EXACT response format so frontend works without changes!
 */
router.post('/:id/golden', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    const requestStart = Date.now();
    try {
        const id = String(req.params.id);
        const organization = req.organization;
        const userId = req.tokenPayload?.userId;
        // ✅ SECURITY: Validate template ownership for generated templates
        if (id.startsWith('gen_') || id.startsWith('Generated_')) {
            const template = await GeneratedTemplate_1.default.findOne({
                templateId: id,
                organizationId: organization._id
            });
            if (!template) {
                jet_logger_1.default.warn(`🚫 [SECURITY] User ${userId} from org ${organization._id} attempted to access template ${id}`);
                return res.status(404).json({
                    code: 'TEMPLATE_NOT_FOUND',
                    message: 'Template not found or access denied'
                });
            }
            jet_logger_1.default.info(`✅ [QA-ADVANCED] Template ownership validated: ${id} belongs to org ${organization.name}`);
        }
        let html = String(req.body?.html || '').trim();
        let name = `Template ${id}`;
        if (!html) {
            return res.status(400).json({
                code: 'QA_GOLDEN_ERROR',
                message: 'HTML is required in request body'
            });
        }
        const parseStart = Date.now();
        // Use advanced grammar checker with timeout
        const grammarResult = await (0, advancedGrammarService_1.checkGrammarAdvanced)(html);
        const parseTime = Date.now() - parseStart;
        // Convert to format expected by frontend (matching /golden response)
        const allEdits = grammarResult.appliedEdits.map(edit => ({
            find: edit.find,
            replace: edit.replace,
            before_context: edit.before_context,
            after_context: edit.after_context,
            reason: edit.reason,
        }));
        // Create atomicResults format
        const atomicResults = [
            ...grammarResult.appliedEdits.map((edit, index) => ({
                index,
                edit: {
                    find: edit.find,
                    replace: edit.replace,
                    before_context: edit.before_context,
                    after_context: edit.after_context,
                    reason: edit.reason,
                },
                status: 'applied',
                change: {
                    before: edit.find,
                    after: edit.replace,
                    parent: 'body',
                    reason: edit.reason,
                    fullSentence: edit.fullSentence,
                    highlightStart: edit.highlightStart,
                    highlightEnd: edit.highlightEnd,
                },
            })),
            ...grammarResult.failedEdits.map((edit, index) => ({
                index: grammarResult.appliedEdits.length + index,
                edit: {
                    find: edit.find,
                    replace: edit.replace,
                    before_context: edit.before_context,
                    after_context: edit.after_context,
                    reason: edit.reason,
                },
                status: 'not_found',
                reason: edit.error,
            }))
        ];
        const changes = grammarResult.appliedEdits.map(edit => ({
            before: edit.find,
            after: edit.replace,
            parent: 'body',
            reason: edit.reason,
            fullSentence: edit.fullSentence,
            highlightStart: edit.highlightStart,
            highlightEnd: edit.highlightEnd,
        }));
        const failedEdits = grammarResult.failedEdits.map(edit => ({
            find: edit.find,
            replace: edit.replace,
            before_context: edit.before_context,
            after_context: edit.after_context,
            reason: edit.reason,
            status: 'failed',
            diagnostics: {
                error: edit.error
            },
        }));
        const doc = ensureFullDocShell(name, grammarResult.html);
        const totalTime = Date.now() - requestStart;
        // 🎯 EXACT SAME RESPONSE FORMAT as /api/qa/:id/golden
        res.json({
            html: doc,
            edits: allEdits,
            changes,
            atomicResults,
            failedEdits,
            stats: {
                total: grammarResult.stats.total,
                applied: grammarResult.stats.applied,
                failed: grammarResult.stats.failed,
                blocked: 0,
            },
            timings: {
                total: totalTime,
                parsing: parseTime,
                processing: totalTime - parseTime,
                verification: 0,
            },
        });
    }
    catch (err) {
        console.error('❌ [ADVANCED GOLDEN] Error:', err);
        res.status(500).json({
            code: 'QA_GOLDEN_ERROR',
            message: String(err)
        });
    }
});
/**
 * POST /api/qa-advanced/grammar-check
 *
 * Check grammar/spelling using local algorithms (no API calls)
 *
 * ⚠️ IMPORTANT: This endpoint matches the EXACT response format of /api/qa/template/grammar-check
 * so you can swap the URL in frontend for testing without any code changes!
 *
 * Body:
 *   - html: string (required) - Full HTML content to check
 *
 * Returns (SAME FORMAT AS ORIGINAL):
 *   - hasErrors: boolean
 *   - mistakes: array of { word, suggestion, context }
 *   - count: number
 *   - message: string
 */
router.post('/grammar-check', auth_1.authenticate, organizationContext_1.organizationContext, async (req, res) => {
    try {
        const html = String(req.body?.html || '').trim();
        if (!html) {
            return res.status(400).json({
                code: 'GRAMMAR_CHECK_BAD_REQUEST',
                message: 'HTML is required'
            });
        }
        // Run the advanced grammar checker
        const result = await (0, advancedGrammarService_1.checkGrammarAdvanced)(html);
        // 🎯 Transform to MATCH the original /api/qa/template/grammar-check format
        const mistakes = result.appliedEdits.map(edit => ({
            word: edit.find,
            suggestion: edit.replace,
            context: edit.reason
        }));
        const hasErrors = mistakes.length > 0;
        // 🎯 EXACT SAME RESPONSE FORMAT as original endpoint
        res.json({
            hasErrors,
            mistakes,
            count: mistakes.length,
            message: hasErrors
                ? `Found ${mistakes.length} spelling mistake${mistakes.length > 1 ? 's' : ''}`
                : 'No spelling mistakes found'
        });
    }
    catch (err) {
        console.error('❌ Advanced Grammar Check Error:', err);
        res.status(500).json({
            code: 'GRAMMAR_CHECK_ERROR',
            message: String(err)
        });
    }
});
/**
 * POST /api/qa-advanced/test
 *
 * Simple test endpoint to verify the service is working
 */
router.post('/test', async (req, res) => {
    try {
        const testHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <p>This is a teh test. I recieve emails from chat gpt.</p>
        <p>The the quick brown fox.</p>
        <div>This are <a href="#">a link</a> test.</div>
      </body>
      </html>
    `;
        const result = await (0, advancedGrammarService_1.checkGrammarAdvanced)(testHtml);
        res.json({
            success: true,
            testHtml,
            result,
            message: 'Test completed successfully'
        });
    }
    catch (err) {
        console.error('❌ Test Error:', err);
        res.status(500).json({
            code: 'TEST_ERROR',
            message: String(err)
        });
    }
});
const VARIANT_TARGET_DEFAULT = 5;
const variantRuns = new Map();
function errMsg(e) {
    return e instanceof Error ? e.message : String(e);
}
// ✅ Get variant edits with SEO focus
async function getVariantEditsAndWhy(sourceHtml, usedIdeas) {
    const $ = cheerio.load(sourceHtml);
    $('script, style, noscript').remove();
    const plain = $('body').text().replace(/\s+/g, ' ').trim();
    const system = [
        'You generate SMALL, high-signal copy tweaks for an email variant focused on SEO optimization and deliverability.',
        'Return ONLY valid JSON:',
        '{ "edits":[{ "find":"<exact substring from input text node>", "replace":"<final corrected text>", "before_context":"<10-40 chars from before the find>", "after_context":"<10-40 chars from after the find>", "reason":"...", "idea":"<short tag>"}], "why":["..."] }',
        'Rules:',
        '- Up to 12 edits. Each edit must be within ONE text node.',
        '- "find" and contexts must be copied EXACTLY from the input text (no HTML).',
        '- Do NOT change URLs, merge tags (*|FNAME|*), tracking codes, or anchor/link text.',
        '- Keep tone/meaning; ≤20% length change per edit.',
        '- Favor deliverability & SEO clarity; avoid spammy all-caps or exclamation!!!!',
        '- Focus on keyword optimization, clarity improvements, and engagement',
        `- Avoid previously used ideas: ${JSON.stringify(Array.from(usedIdeas))}`,
    ].join('\n');
    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.4,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: plain || 'No text.' }
        ],
        response_format: { type: 'json_object' }
    });
    let edits = [];
    let why = [];
    try {
        const raw = completion.choices[0]?.message?.content || '{"edits":[],"why":[]}';
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            const e = parsed.edits;
            const w = parsed.why;
            if (Array.isArray(e)) {
                edits = e.map((x) => ({
                    find: String(x?.find || ''),
                    replace: String(x?.replace || ''),
                    before_context: String(x?.before_context || ''),
                    after_context: String(x?.after_context || ''),
                    reason: x?.reason ? String(x.reason) : undefined,
                    idea: x?.idea ? String(x.idea) : undefined,
                })).filter((x) => x.find && x.replace);
            }
            if (Array.isArray(w))
                why = w.map((s) => String(s || '')).filter(Boolean);
        }
    }
    catch (_e) { /* ignore */ }
    return { edits, why };
}
router.post('/:id/variants/start', async (req, res) => {
    try {
        const templateId = String(req.params.id);
        const goldenHtml = String(req.body?.html || '').trim();
        const target = Math.min(Math.max(Number(req.body?.target ?? VARIANT_TARGET_DEFAULT), 1), 5);
        if (!goldenHtml) {
            return res.status(400).json({ code: 'VARIANTS_START_BAD_REQUEST', message: 'goldenHtml is required' });
        }
        const runId = (typeof crypto_1.randomUUID === 'function') ? (0, crypto_1.randomUUID)() : `vr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const run = {
            id: runId,
            templateId,
            target,
            goldenHtml,
            currentHtml: goldenHtml,
            usedIdeas: new Set(),
            variants: [],
            createdAt: Date.now(),
        };
        variantRuns.set(runId, run);
        res.json({ runId, target });
    }
    catch (err) {
        res.status(500).json({ code: 'VARIANTS_START_ERROR', message: errMsg(err) });
    }
});
router.post('/variants/:runId/next', async (req, res) => {
    try {
        const runId = String(req.params.runId);
        const run = variantRuns.get(runId);
        if (!run)
            return res.status(404).json({ code: 'VARIANTS_RUN_NOT_FOUND', message: 'Run not found' });
        if (run.variants.length >= run.target) {
            return res.status(200).json({ done: true, message: 'All variants generated', no: run.variants.length });
        }
        // ✅ STEP 1: Get SEO-focused edits from GPT
        const sourceHtml = run.goldenHtml;
        const { edits, why } = await getVariantEditsAndWhy(sourceHtml, run.usedIdeas);
        // ✅ STEP 2: Apply edits using ADVANCED tag-based logic (SAME as golden template)
        const result = await (0, advancedGrammarService_1.applyCustomEdits)(sourceHtml, edits);
        const variantNo = run.variants.length + 1;
        // Track used ideas
        const ideas = Array.from(new Set((edits || []).map((e) => e.idea).filter(Boolean)));
        ideas.forEach((i) => run.usedIdeas.add(i));
        // ✅ STEP 3: Format response EXACTLY like golden template
        const allEdits = result.appliedEdits.map(edit => ({
            find: edit.find,
            replace: edit.replace,
            before_context: edit.before_context,
            after_context: edit.after_context,
            reason: edit.reason,
        }));
        const changes = result.appliedEdits.map(edit => ({
            before: edit.find,
            after: edit.replace,
            parent: 'body',
            reason: edit.reason,
            fullSentence: edit.fullSentence,
            highlightStart: edit.highlightStart,
            highlightEnd: edit.highlightEnd,
        }));
        const failedEdits = result.failedEdits.map(edit => ({
            find: edit.find,
            replace: edit.replace,
            before_context: edit.before_context,
            after_context: edit.after_context,
            reason: edit.reason,
            status: 'failed',
            diagnostics: {
                error: edit.error
            },
        }));
        const item = {
            no: variantNo,
            html: ensureFullDocShell(`Variant ${variantNo}`, result.html),
            changes: changes,
            why: (why && why.length) ? why : ['SEO optimization and deliverability improvements.'],
            artifacts: { usedIdeas: ideas },
            failedEdits: failedEdits,
            stats: result.stats,
        };
        run.variants.push(item);
        res.json(item);
    }
    catch (err) {
        console.error('❌ [QA-ADVANCED] Variant generation error:', err);
        res.status(500).json({ code: 'VARIANTS_NEXT_ERROR', message: errMsg(err) });
    }
});
router.get('/variants/:runId/status', async (req, res) => {
    const runId = String(req.params.runId);
    const run = variantRuns.get(runId);
    if (!run)
        return res.status(404).json({ code: 'VARIANTS_RUN_NOT_FOUND' });
    res.json({
        runId: run.id,
        templateId: run.templateId,
        target: run.target,
        count: run.variants.length,
        items: run.variants,
    });
});
exports.default = router;
