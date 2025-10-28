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
exports.getRobustTemplateHtml = getRobustTemplateHtml;
const express_1 = require("express");
const mailchimp_marketing_1 = __importDefault(require("@mailchimp/mailchimp_marketing"));
const openai_1 = __importDefault(require("openai"));
const cheerio = __importStar(require("cheerio"));
const crypto_1 = require("crypto");
const puppeteer_1 = __importDefault(require("puppeteer"));
const GeneratedTemplate_1 = __importDefault(require("@src/models/GeneratedTemplate"));
const router = (0, express_1.Router)();
const MC = mailchimp_marketing_1.default;
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
/* ------------------------------------------------------------------ */
/*                       Helpers & safe typings                        */
/* ------------------------------------------------------------------ */
function isGeneratedTemplate(id) {
    return id.startsWith('gen_') || id.startsWith('Generated_');
}
async function getGeneratedTemplateHtml(id) {
    const template = await GeneratedTemplate_1.default.findOne({ templateId: id });
    if (!template) {
        throw new Error(`Generated template not found: ${id}`);
    }
    return {
        name: template.name,
        html: template.html
    };
}
function errMsg(err) {
    if (typeof err === 'object' && err && 'message' in err) {
        const m = err.message;
        return typeof m === 'string' ? m : String(m);
    }
    try {
        return JSON.stringify(err);
    }
    catch {
        return String(err);
    }
}
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function ensureFullDocShell(name, bodyOrDocHtml) {
    const html = bodyOrDocHtml || "<div style='padding:16px;color:#666'>No content.</div>";
    const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
    if (hasDoc)
        return html;
    return [
        '<!doctype html><html><head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        `<title>${escapeHtml(name)}</title>`,
        '</head><body>',
        html,
        '</body></html>',
    ].join('');
}
/* ------------------------------------------------------------------ */
/*                      Mailchimp HTML retrieval                       */
/* ------------------------------------------------------------------ */
async function getTemplateHtmlDirect(id) {
    const t = (MC.templates.getTemplate ? await MC.templates.getTemplate(id) : await MC.templates.get(id));
    const name = t?.name || `Template ${id}`;
    const html = String(t?.html || '').trim();
    return { name, html };
}
async function getTemplateHtmlFromDefaultContent(id) {
    const api = MC.templates;
    const dc = (api.getDefaultContent ? await api.getDefaultContent(id)
        : api.getTemplateDefaultContent ? await api.getTemplateDefaultContent(id)
            : null) || {};
    if (dc.html)
        return String(dc.html);
    if (dc.sections && typeof dc.sections === 'object') {
        return Object.values(dc.sections).join('\n');
    }
    return '';
}
async function getTemplateHtmlViaCampaign(id) {
    const listId = process.env.MC_AUDIENCE_ID;
    const fromEmail = process.env.MC_FROM_EMAIL;
    const fromName = process.env.MC_FROM_NAME;
    if (!listId || !fromEmail || !fromName)
        return '';
    const campaigns = MC.campaigns;
    const draft = await campaigns.create({
        type: 'regular',
        recipients: { list_id: listId },
        settings: {
            subject_line: 'Preview',
            from_name: fromName,
            reply_to: fromEmail,
            title: `Preview-${id}-${Date.now()}`
        }
    });
    const campaignId = draft?.id;
    try {
        await campaigns.setContent(campaignId, { template: { id: Number(id) } });
        const content = await campaigns.getContent(campaignId);
        return String(content?.html || '');
    }
    finally {
        try {
            if (typeof campaigns.remove === 'function')
                await campaigns.remove(campaignId);
            else if (typeof campaigns.delete === 'function')
                await campaigns.delete(campaignId);
        }
        catch (_e) { /* ignore cleanup */ }
    }
}
async function getRobustTemplateHtml(id) {
    if (isGeneratedTemplate(id)) {
        return await getGeneratedTemplateHtml(id);
    }
    const { name, html: direct } = await getTemplateHtmlDirect(id);
    if (direct)
        return { name, html: ensureFullDocShell(name, direct) };
    let html = await getTemplateHtmlViaCampaign(id);
    if (!html)
        html = await getTemplateHtmlFromDefaultContent(id);
    return { name, html: ensureFullDocShell(name, html) };
}
/* ------------------------------------------------------------------ */
/*                  Visible text + chunking for GPT                    */
/* ------------------------------------------------------------------ */
function extractVisibleText(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
}
function chunkText(s, max = 3500) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        let j = Math.min(i + max, s.length);
        if (j < s.length) {
            const k = s.lastIndexOf(' ', j);
            if (k > i + 2000)
                j = k;
        }
        out.push(s.slice(i, j));
        i = j;
    }
    return out;
}
function grammarSystemPrompt() {
    return [
        "You are a professional copy editor. Fix ONLY clear grammar, spelling, punctuation, and capitalization errors.",
        "",
        "STRICT RULES:",
        "1. DO NOT change numbers, prices, brand names, URLs, or merge tags (e.g., *|FNAME|*)",
        "2. DO NOT change product names, company names, or proper nouns",
        "3. Keep each edit focused on ONE specific, objective error",
        "4. Copy text EXACTLY from input - no paraphrasing or rewording",
        "5. Only suggest edits for clear, unambiguous errors",
        "6. When in doubt, skip it - be conservative",
        "",
        "Return ONLY valid JSON:",
        '{"edits":[{',
        '  "find":"<exact substring with error>",',
        '  "replace":"<corrected text>",',
        '  "before_context":"<10-40 chars before>",',
        '  "after_context":"<10-40 chars after>",',
        '  "reason":"<brief explanation>"',
        '}]}',
        "",
        "IMPORTANT:",
        "- 'find' and contexts must be EXACTLY from input text (no HTML tags)",
        "- Provide good before/after context for accurate matching",
        "- Maximum 30 edits per request",
        "- Each edit should fix ONE error only",
        "",
        "Examples of GOOD edits:",
        "- 'teh' → 'the' (obvious typo)",
        "- 'dont' → 'don't' (missing apostrophe)",
        "- 'washington' → 'Washington' (proper noun capitalization)",
        "",
        "Examples of BAD edits (DO NOT suggest):",
        "- Changing '$19.99' to 'nineteen dollars'",
        "- Rewriting sentences for style",
        "- Changing brand names or product names",
        "- Editing URLs or email addresses",
    ].join("\n");
}
/* ------------------------------------------------------------------ */
/*             Entity-aware, context-aware text patching               */
/* ------------------------------------------------------------------ */
const ZWS = /[\u200B\u200C\u200D\uFEFF]/;
const NAMED_ENT = {
    nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
    hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
};
function decodeHtmlEntityAt(raw, i) {
    if (raw[i] !== '&')
        return null;
    const semi = raw.indexOf(';', i + 1);
    if (semi < 0 || semi - i > 31)
        return null;
    const body = raw.slice(i + 1, semi);
    if (body.startsWith('#x') || body.startsWith('#X')) {
        const code = parseInt(body.slice(2), 16);
        if (!Number.isNaN(code))
            return { ch: String.fromCodePoint(code), end: semi };
        return null;
    }
    if (body.startsWith('#')) {
        const code = parseInt(body.slice(1), 10);
        if (!Number.isNaN(code))
            return { ch: String.fromCodePoint(code), end: semi };
        return null;
    }
    const named = NAMED_ENT[body];
    return named ? { ch: named, end: semi } : null;
}
function normalizeChar(ch) {
    if (ZWS.test(ch))
        return '';
    if (ch === '\u00A0' || ch === '\u2007' || ch === '\u202F')
        return ' ';
    if (ch === '\u201C' || ch === '\u201D')
        return '"';
    if (ch === '\u2018' || ch === '\u2019')
        return "'";
    if (ch === '\u2013' || ch === '\u2014')
        return '-';
    if (ch === '\u2026')
        return '...';
    return ch;
}
function normalizeAndMap(rawIn) {
    const raw = String(rawIn || '');
    const mapStart = [];
    const mapEnd = [];
    let norm = '';
    let lastWasSpace = false;
    for (let i = 0; i < raw.length; i++) {
        let end = i + 1;
        let chOut;
        if (raw[i] === '&') {
            const dec = decodeHtmlEntityAt(raw, i);
            if (dec) {
                chOut = dec.ch;
                end = dec.end + 1;
            }
            else {
                chOut = raw[i];
            }
        }
        else {
            chOut = raw[i];
        }
        let ch = normalizeChar(chOut);
        if (ch === '') {
            i = end - 1;
            continue;
        }
        if (/\s/.test(ch))
            ch = ' ';
        if (ch === ' ') {
            if (lastWasSpace) {
                i = end - 1;
                continue;
            }
            lastWasSpace = true;
        }
        else {
            lastWasSpace = false;
        }
        mapStart[norm.length] = i;
        mapEnd[norm.length] = end;
        norm += ch;
        i = end - 1;
    }
    return { norm, mapStart, mapEnd };
}
function normalizeOnly(s) {
    return normalizeAndMap(String(s || '')).norm;
}
function mapNormSpanToRawSpan(mapStart, mapEnd, startN, lenN, rawLength) {
    if (startN < 0 || lenN <= 0)
        return null;
    const rawStart = mapStart[startN];
    const endN = startN + lenN - 1;
    const rawEndExclusive = mapEnd[endN];
    if (typeof rawStart !== 'number' || typeof rawEndExclusive !== 'number')
        return null;
    return {
        start: Math.max(0, rawStart),
        end: Math.min(rawLength, rawEndExclusive),
    };
}
function findWithContextSpan(haystack, needle, beforeCtx, afterCtx) {
    const raw = String(haystack || '');
    const nRaw = String(needle || '');
    const bRaw = String(beforeCtx || '');
    const aRaw = String(afterCtx || '');
    let i = raw.indexOf(nRaw);
    while (i >= 0) {
        const okBefore = bRaw ? raw.slice(Math.max(0, i - bRaw.length), i).endsWith(bRaw) : true;
        const okAfter = aRaw ? raw.slice(i + nRaw.length, i + nRaw.length + aRaw.length).startsWith(aRaw) : true;
        if ((okBefore && okAfter) || (bRaw && okBefore) || (aRaw && okAfter)) {
            return { start: i, end: i + nRaw.length };
        }
        i = raw.indexOf(nRaw, i + 1);
    }
    const H = normalizeAndMap(raw);
    const nNeedle = normalizeOnly(nRaw);
    const nBefore = normalizeOnly(bRaw);
    const nAfter = normalizeOnly(aRaw);
    let ni = H.norm.indexOf(nNeedle);
    while (ni >= 0) {
        const okBefore = nBefore ? H.norm.slice(Math.max(0, ni - nBefore.length), ni).endsWith(nBefore) : true;
        const okAfter = nAfter ? H.norm.slice(ni + nNeedle.length, ni + nNeedle.length + nAfter.length).startsWith(nAfter) : true;
        if ((okBefore && okAfter) || (nBefore && okBefore) || (nAfter && okAfter)) {
            const span = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, ni, nNeedle.length, raw.length);
            if (span)
                return span;
        }
        ni = H.norm.indexOf(nNeedle, ni + 1);
    }
    if (bRaw || nBefore) {
        const biRaw = bRaw ? raw.indexOf(bRaw) : -1;
        if (biRaw >= 0) {
            const start = biRaw + bRaw.length;
            const j = raw.indexOf(nRaw, start);
            if (j >= 0)
                return { start: j, end: j + nRaw.length };
        }
        const biN = nBefore ? H.norm.indexOf(nBefore) : -1;
        if (biN >= 0) {
            const startN = biN + nBefore.length;
            const jN = H.norm.indexOf(nNeedle, startN);
            if (jN >= 0) {
                const span2 = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, jN, nNeedle.length, raw.length);
                if (span2)
                    return span2;
            }
        }
    }
    if (aRaw || nAfter) {
        const aiRaw = aRaw ? raw.indexOf(aRaw) : -1;
        if (aiRaw > 0) {
            const end = aiRaw;
            const j = raw.lastIndexOf(nRaw, end);
            if (j >= 0)
                return { start: j, end: j + nRaw.length };
        }
        const aiN = nAfter ? H.norm.indexOf(nAfter) : -1;
        if (aiN > 0) {
            const endN = aiN;
            const jN = H.norm.lastIndexOf(nNeedle, endN);
            if (jN >= 0) {
                const span3 = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, jN, nNeedle.length, raw.length);
                if (span3)
                    return span3;
            }
        }
    }
    return null;
}
function deniedParents() {
    return new Set(['style', 'script', 'title', 'svg']);
}
function isBlockElement(tag) {
    const blockTags = new Set([
        'p', 'div', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'blockquote', 'pre', 'article', 'section', 'header', 'footer', 'aside'
    ]);
    return blockTags.has(tag);
}
function consolidateTextNodesRecursive($, element) {
    let fullText = '';
    const nodeMap = [];
    function traverse(node) {
        $(node).contents().each((_, child) => {
            if (child.type === 'text') {
                const txt = String(child.data || '');
                if (txt) {
                    const startInConsolidated = fullText.length;
                    fullText += txt;
                    const endInConsolidated = fullText.length;
                    nodeMap.push({ node: child, startInConsolidated, endInConsolidated });
                }
            }
            else if (child.type === 'tag') {
                traverse(child);
            }
        });
    }
    traverse(element);
    return { fullText, nodeMap };
}
function applyReplacementToNodes(nodeMap, matchStart, matchEnd, replacement) {
    const affectedNodes = [];
    for (const mapping of nodeMap) {
        const { node, startInConsolidated, endInConsolidated } = mapping;
        if (matchEnd <= startInConsolidated || matchStart >= endInConsolidated) {
            continue;
        }
        const nodeLength = endInConsolidated - startInConsolidated;
        const localStart = Math.max(0, matchStart - startInConsolidated);
        const localEnd = Math.min(nodeLength, matchEnd - startInConsolidated);
        affectedNodes.push({ node, localStart, localEnd, nodeLength });
    }
    if (affectedNodes.length === 0) {
        return false;
    }
    if (affectedNodes.length > 1) {
        const interactiveTags = ['a', 'button'];
        const interactiveParents = affectedNodes.map((n) => {
            let current = n.node.parent;
            while (current) {
                const tag = current.tagName?.toLowerCase();
                if (tag && interactiveTags.includes(tag)) {
                    return current;
                }
                current = current.parent;
            }
            return null;
        });
        const hasInteractive = interactiveParents.some(p => p !== null);
        const hasNonInteractive = interactiveParents.some(p => p === null);
        if (hasInteractive && hasNonInteractive) {
            return false;
        }
        const uniqueInteractive = new Set(interactiveParents.filter(p => p !== null));
        if (uniqueInteractive.size > 1) {
            return false;
        }
    }
    try {
        if (affectedNodes.length === 1) {
            const { node, localStart, localEnd } = affectedNodes[0];
            const original = String(node.data || '');
            node.data = original.substring(0, localStart) + replacement + original.substring(localEnd);
            return true;
        }
        else {
            const first = affectedNodes[0];
            const firstOriginal = String(first.node.data || '');
            first.node.data = firstOriginal.substring(0, first.localStart) + replacement;
            for (let i = 1; i < affectedNodes.length - 1; i++) {
                const middle = affectedNodes[i];
                const middleOriginal = String(middle.node.data || '');
                middle.node.data = '';
            }
            const last = affectedNodes[affectedNodes.length - 1];
            const lastOriginal = String(last.node.data || '');
            last.node.data = lastOriginal.substring(last.localEnd);
            return true;
        }
    }
    catch (error) {
        console.error('❌ Error in applyReplacementToNodes:', error);
        return false;
    }
}
/* ------------------------------------------------------------------ */
/*         ✅ NEW: Helper Functions for Enhanced Diagnostics          */
/* ------------------------------------------------------------------ */
function findAffectedNodes(nodeMap, matchStart, matchEnd) {
    const affectedNodes = [];
    for (const mapping of nodeMap) {
        const { node, startInConsolidated, endInConsolidated } = mapping;
        if (matchEnd <= startInConsolidated || matchStart >= endInConsolidated) {
            continue;
        }
        const nodeLength = endInConsolidated - startInConsolidated;
        const localStart = Math.max(0, matchStart - startInConsolidated);
        const localEnd = Math.min(nodeLength, matchEnd - startInConsolidated);
        affectedNodes.push({ node, localStart, localEnd, nodeLength });
    }
    return affectedNodes;
}
function generateXPath($, element) {
    const segments = [];
    let current = element;
    while (current && current.tagName) {
        const tag = current.tagName.toLowerCase();
        const siblings = $(current.parent).children(tag);
        const index = siblings.index(current) + 1;
        segments.unshift(`${tag}[${index}]`);
        current = current.parent;
    }
    return '/' + segments.join('/');
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/* ------------------------------------------------------------------ */
/*         ✅ ENHANCED: Atomic Verification with Full Diagnostics      */
/* ------------------------------------------------------------------ */
function applyContextEdits(html, edits) {
    const startTime = Date.now();
    const parseStart = Date.now();
    const $ = cheerio.load(html, { decodeEntities: false });
    const parseTime = Date.now() - parseStart;
    const deny = deniedParents();
    const results = [];
    let appliedCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let skippedCount = 0;
    const processingStart = Date.now();
    edits.forEach((originalEdit, index) => {
        const editStart = Date.now();
        const edit = {
            find: String(originalEdit?.find || ''),
            replace: String(originalEdit?.replace || ''),
            before: String(originalEdit?.before_context || ''),
            after: String(originalEdit?.after_context || ''),
            reason: originalEdit?.reason ? String(originalEdit.reason) : undefined,
        };
        const diagnostics = {
            timings: { search: 0, apply: 0, verify: 0 },
            locations: [],
        };
        if (!edit.find || !edit.replace) {
            results.push({
                index,
                edit: originalEdit,
                status: 'skipped',
                reason: 'Invalid edit: empty find or replace',
                diagnostics,
            });
            skippedCount++;
            return;
        }
        if (edit.find === edit.replace) {
            results.push({
                index,
                edit: originalEdit,
                status: 'skipped',
                reason: 'Invalid edit: find equals replace',
                diagnostics,
            });
            skippedCount++;
            return;
        }
        if (/https?:\/\//i.test(edit.find) || /https?:\/\//i.test(edit.replace)) {
            results.push({
                index,
                edit: originalEdit,
                status: 'blocked',
                reason: 'Contains URL - blocked for safety',
                diagnostics,
            });
            blockedCount++;
            return;
        }
        if (/\*\|[A-Z0-9_]+\|\*/.test(edit.find) || /\*\|[A-Z0-9_]+\|\*/.test(edit.replace)) {
            results.push({
                index,
                edit: originalEdit,
                status: 'blocked',
                reason: 'Contains merge tag - blocked for safety',
                diagnostics,
            });
            blockedCount++;
            return;
        }
        const searchStart = Date.now();
        let applied = false;
        let appliedTag = '';
        const rawHtml = $.html();
        const rawOccurrences = (rawHtml.match(new RegExp(escapeRegex(edit.find), 'g')) || []).length;
        const normalized = normalizeOnly(edit.find);
        const normalizedHtml = normalizeOnly(rawHtml);
        const normalizedOccurrences = (normalizedHtml.match(new RegExp(escapeRegex(normalized), 'g')) || []).length;
        diagnostics.rawOccurrences = rawOccurrences;
        diagnostics.normalizedOccurrences = normalizedOccurrences;
        diagnostics.normalizedFind = normalized;
        if (rawOccurrences === 0 && normalizedOccurrences === 0) {
            diagnostics.timings.search = Date.now() - searchStart;
            diagnostics.manualFixGuidance = {
                strategy: 'not-found',
                recommendation: 'Text spans across HTML element boundaries or has already been corrected. Manual review recommended.',
                searchHints: [
                    edit.find,
                    normalized,
                    edit.find.toLowerCase(),
                    edit.find.split(/\s+/).slice(1).join(' '),
                    edit.find.split(/\s+/).slice(0, -1).join(' ')
                ].filter((hint, idx, arr) => arr.indexOf(hint) === idx && hint.length > 0)
            };
            results.push({
                index,
                edit: originalEdit,
                status: 'not_found',
                reason: 'Text spans across HTML element boundaries - cannot be automatically modified without risking template structure',
                diagnostics,
            });
            failedCount++;
            return;
        }
        const boundaryInfo = [];
        $('body *').each((_, el) => {
            if (applied)
                return false;
            const tag = el.tagName?.toLowerCase?.() || '';
            if (deny.has(tag))
                return;
            if (!isBlockElement(tag))
                return;
            const { fullText, nodeMap } = consolidateTextNodesRecursive($, el);
            if (!fullText.trim())
                return;
            const span = findWithContextSpan(fullText, edit.find, edit.before, edit.after);
            if (span) {
                diagnostics.contextMatched = true;
                // ✅ NEW: Find affected nodes and save their original state BEFORE applying
                const affectedNodes = findAffectedNodes(nodeMap, span.start, span.end);
                // ✅ NEW: Save original state for rollback
                const originalNodeStates = [];
                affectedNodes.forEach(n => {
                    originalNodeStates.push({
                        node: n.node,
                        originalData: String(n.node.data || '')
                    });
                });
                // Detect boundary issues
                if (affectedNodes.length > 1) {
                    const spanningElements = affectedNodes.map(n => {
                        let parent = n.node.parent;
                        while (parent && !parent.tagName) {
                            parent = parent.parent;
                        }
                        return parent?.tagName?.toLowerCase() || 'unknown';
                    }).filter((t, i, arr) => arr.indexOf(t) === i);
                    const $el = $(el);
                    const htmlSnippet = $el.html()?.substring(Math.max(0, span.start - 100), Math.min($el.html()?.length || 0, span.end + 100)) || '';
                    const xpath = generateXPath($, el);
                    boundaryInfo.push({
                        element: el,
                        tag,
                        fullText,
                        matchPosition: span,
                        spanningElements,
                        htmlSnippet,
                        xpath
                    });
                }
                // Try to apply the replacement
                const applyStart = Date.now();
                const applySuccess = applyReplacementToNodes(nodeMap, span.start, span.end, edit.replace);
                diagnostics.timings.apply = Date.now() - applyStart;
                if (applySuccess) {
                    // ✅ Verify the changes
                    const verifyStart = Date.now();
                    const { fullText: newFullText } = consolidateTextNodesRecursive($, el);
                    const oldTextGone = !newFullText.includes(edit.find);
                    const newTextPresent = newFullText.includes(edit.replace);
                    const replacementWords = edit.replace.split(/\s+/);
                    const allWordsPresent = replacementWords.every(word => word.length < 3 || newFullText.includes(word));
                    const verificationPassed = oldTextGone && newTextPresent && allWordsPresent;
                    diagnostics.timings.verify = Date.now() - verifyStart;
                    if (verificationPassed) {
                        applied = true;
                        appliedTag = tag;
                        return false; // Stop iteration
                    }
                    else {
                        // ✅ NEW: ROLLBACK on verification failure
                        originalNodeStates.forEach(({ node, originalData }) => {
                            node.data = originalData;
                        });
                        // ✅ Verify rollback worked
                        const { fullText: rolledBackText } = consolidateTextNodesRecursive($, el);
                        const rollbackVerified = rolledBackText === fullText;
                        diagnostics.crossesBoundary = true;
                    }
                }
                else {
                    // ✅ NEW: ROLLBACK on apply failure
                    originalNodeStates.forEach(({ node, originalData }) => {
                        node.data = originalData;
                    });
                    diagnostics.crossesBoundary = true;
                }
            }
            else {
                const spanNoContext = findWithContextSpan(fullText, edit.find, '', '');
                if (spanNoContext) {
                    const contextBefore = fullText.substring(Math.max(0, spanNoContext.start - 40), spanNoContext.start);
                    const contextAfter = fullText.substring(spanNoContext.end, Math.min(fullText.length, spanNoContext.end + 40));
                    const xpath = generateXPath($, el);
                    diagnostics.locations.push({
                        tag,
                        actualContext: contextBefore + '[' + edit.find + ']' + contextAfter,
                        confidence: 0,
                        xpath,
                        visualPreview: `${contextBefore}${edit.find}${contextAfter}`
                    });
                }
            }
        });
        diagnostics.timings.search = Date.now() - searchStart;
        const editTime = Date.now() - editStart;
        if (applied) {
            results.push({
                index,
                edit: originalEdit,
                status: 'applied',
                change: {
                    before: edit.find,
                    after: edit.replace,
                    parent: appliedTag,
                    reason: edit.reason,
                },
                diagnostics,
            });
            appliedCount++;
        }
        else {
            let failureReason = 'Unknown failure';
            let status = 'not_found';
            let manualFixGuidance;
            if (diagnostics.contextMatched && diagnostics.crossesBoundary) {
                failureReason = 'Text found but spans across element boundaries (e.g., inside/outside links)';
                status = 'boundary_issue';
                if (boundaryInfo.length > 0) {
                    const info = boundaryInfo[0];
                    diagnostics.locations.push({
                        tag: info.tag,
                        actualContext: info.fullText.substring(Math.max(0, info.matchPosition.start - 50), Math.min(info.fullText.length, info.matchPosition.end + 50)),
                        confidence: 100,
                        xpath: info.xpath,
                        htmlSnippet: info.htmlSnippet,
                        spanningElements: info.spanningElements,
                        visualPreview: info.fullText.substring(Math.max(0, info.matchPosition.start - 20), Math.min(info.fullText.length, info.matchPosition.end + 20))
                    });
                    const affectedNodesData = findAffectedNodes(consolidateTextNodesRecursive($, info.element).nodeMap, info.matchPosition.start, info.matchPosition.end);
                    manualFixGuidance = {
                        strategy: 'split-across-boundary',
                        recommendation: `The text "${edit.find}" is split across ${info.spanningElements.length} elements (${info.spanningElements.join(' → ')}). Use the visual editor to manually fix this by editing each part separately.`,
                        affectedElements: affectedNodesData.map((n) => {
                            let parent = n.node.parent;
                            while (parent && !parent.tagName) {
                                parent = parent.parent;
                            }
                            return {
                                tag: parent?.tagName?.toLowerCase() || 'text',
                                xpath: generateXPath($, parent),
                                textContent: String(n.node.data || '').substring(n.localStart, n.localEnd)
                            };
                        }),
                        searchHints: [
                            edit.find,
                            ...info.spanningElements.map(tag => `Text in <${tag}> element`),
                            `Look for: "${info.fullText.substring(Math.max(0, info.matchPosition.start - 10), Math.min(info.fullText.length, info.matchPosition.end + 10))}"`
                        ]
                    };
                }
            }
            else if (diagnostics.locations && diagnostics.locations.length > 0) {
                failureReason = `Text found ${diagnostics.locations.length} time(s) but context didn't match`;
                status = 'context_mismatch';
                manualFixGuidance = {
                    strategy: 'context-mismatch',
                    recommendation: `Found the text in ${diagnostics.locations.length} location(s), but the surrounding context doesn't match what GPT expected. Review each location in the visual editor.`,
                    searchHints: diagnostics.locations.map(loc => `In <${loc.tag}>: "${loc.visualPreview || loc.actualContext}"`)
                };
            }
            else if (normalizedOccurrences > 0) {
                failureReason = 'Text exists after normalization but could not be located';
                status = 'not_found';
                manualFixGuidance = {
                    strategy: 'normalization-issue',
                    recommendation: 'The text exists but may have special characters or formatting. Try searching for it manually in the visual editor.',
                    searchHints: [
                        edit.find,
                        normalized,
                        edit.find.replace(/\s+/g, ' ').trim()
                    ]
                };
            }
            else {
                failureReason = 'Text spans across element boundaries';
                status = 'not_found';
                manualFixGuidance = {
                    strategy: 'not-found',
                    recommendation: 'Text spans across HTML element boundaries or has already been corrected. Manual adjustment recommended to preserve template structure.',
                    searchHints: [edit.find]
                };
            }
            diagnostics.manualFixGuidance = manualFixGuidance;
            results.push({
                index,
                edit: originalEdit,
                status,
                reason: failureReason,
                diagnostics,
            });
            failedCount++;
        }
    });
    const processingTime = Date.now() - processingStart;
    const totalTime = Date.now() - startTime;
    const filteredResults = results.filter(r => r.status !== 'skipped'); // ✅ Remove skipped from results
    return {
        html: $.html(),
        results: filteredResults,
        stats: {
            total: filteredResults.length, // ✅ Only count non-skipped edits
            applied: appliedCount,
            failed: failedCount,
            blocked: blockedCount,
            // ✅ Removed skipped from stats
        },
        timings: {
            total: totalTime,
            parsing: parseTime,
            processing: processingTime,
            verification: totalTime - parseTime - processingTime,
        },
    };
}
/* ------------------------------------------------------------------ */
/*                      Loose word fallback (safe)                     */
/* ------------------------------------------------------------------ */
function applyLooseWordFallback(html, edits) {
    const $ = cheerio.load(html, { decodeEntities: false });
    $('script,style,noscript').remove();
    const changes = [];
    $('body *').each((_, el) => {
        const tag = el?.tagName?.toLowerCase?.() || '';
        $(el).contents().each((__, node) => {
            if (node?.type !== 'text')
                return;
            let txt = node.data || '';
            for (const e of edits) {
                const f = String(e.find || '').replace(/[^\w\s'-]/g, ' ').trim();
                const r = String(e.replace || '').trim();
                if (!f || !r)
                    continue;
                if (r.split(/\s+/).length !== 1)
                    continue;
                const candidates = f.split(/\s+/).filter(w => w && w.length >= 4);
                for (const w of candidates) {
                    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
                    if (re.test(txt)) {
                        txt = txt.replace(re, r);
                        changes.push({ before: w, after: r, parent: tag, reason: e.reason });
                        break;
                    }
                }
            }
            node.data = txt;
        });
    });
    return { html: $.html(), changes };
}
/* ------------------------------------------------------------------ */
/*                           Suggestions                               */
/* ------------------------------------------------------------------ */
async function getSuggestionsFromHtml(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    const plain = $('body').text().replace(/\s+/g, ' ').trim();
    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
            {
                role: 'system',
                content: [
                    'You analyze email copy for gibberish and quick improvement ideas.',
                    'Return ONLY valid JSON:',
                    '{ "gibberish": [{"text":"...","reason":"..."}], "suggestions": ["..."] }',
                    'Rules:',
                    '- Identify nonsense tokens like "ajsn iabfw ibf" or random character runs.',
                    '- Keep suggestions high-signal and short (max 10).',
                    '- Do NOT propose structural/layout changes; copy only.',
                ].join('\n')
            },
            { role: 'user', content: plain || 'No text.' }
        ],
        response_format: { type: 'json_object' }
    });
    let gibberish = [];
    let suggestions = [];
    try {
        const raw = completion.choices[0]?.message?.content || '{"gibberish":[],"suggestions":[]}';
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            const g = parsed.gibberish;
            const s = parsed.suggestions;
            if (Array.isArray(g)) {
                gibberish = g.map((x) => {
                    const it = x;
                    return { text: String(it?.text ?? ''), reason: String(it?.reason ?? '') };
                }).filter((it) => !!it.text);
            }
            if (Array.isArray(s))
                suggestions = s.map((x) => String(x ?? ''));
        }
    }
    catch (_e) { /* ignore */ }
    return { gibberish, suggestions };
}
/* ------------------------------------------------------------------ */
/*                               Routes                                */
/* ------------------------------------------------------------------ */
router.post('/:id/golden', async (req, res) => {
    const requestStart = Date.now();
    try {
        const id = String(req.params.id);
        // ✅ USE REQUEST BODY HTML if provided (cache-first approach)
        let html = String(req.body?.html || '').trim();
        let name = `Template ${id}`;
        // If no HTML provided in body, fetch it (fallback for backward compatibility)
        if (!html) {
            const fetched = await getRobustTemplateHtml(id);
            html = fetched.html;
            name = fetched.name;
        }
        const visible = extractVisibleText(html);
        const chunks = chunkText(visible, 700);
        console.log('🔍 [GOLDEN CHECK] Template ID:', id);
        console.log('📏 [GOLDEN CHECK] Total visible text length:', visible.length, 'characters');
        console.log('✂️ [GOLDEN CHECK] Number of chunks created:', chunks.length);
        console.log('📦 [GOLDEN CHECK] Chunk sizes:', chunks.map((c, i) => `Chunk ${i + 1}: ${c.length} chars`).join(', '));
        console.log('🚀 [GOLDEN CHECK] Processing all chunks in parallel...\n');
        // ✅ Process all chunks in parallel
        const chunkPromises = chunks.map(async (chunk, i) => {
            console.log(`🚀 [GOLDEN CHECK] Starting chunk ${i + 1}/${chunks.length} (${chunk.length} characters)...`);
            try {
                const completion = await openai.chat.completions.create({
                    model: OPENAI_MODEL,
                    temperature: 0, // ✅ Changed from 0.2 to 0 for maximum determinism
                    seed: 42, // ✅ Added seed for reproducible results
                    messages: [
                        { role: 'system', content: grammarSystemPrompt() },
                        { role: 'user', content: `Visible email text:\n\n${chunk || 'No text.'}` }
                    ],
                    response_format: { type: 'json_object' }
                });
                const raw = completion.choices[0]?.message?.content || '{"edits":[]}';
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.edits)) {
                    const edits = parsed.edits.map((e) => ({
                        find: String(e?.find || ''),
                        replace: String(e?.replace || ''),
                        before_context: String(e?.before_context || ''),
                        after_context: String(e?.after_context || ''),
                        reason: e?.reason ? String(e.reason) : undefined,
                    })).filter((e) => e.find && e.replace);
                    console.log(`✅ [GOLDEN CHECK] Chunk ${i + 1} completed with ${edits.length} edits`);
                    return edits;
                }
                return [];
            }
            catch (e) {
                console.error(`❌ [GOLDEN CHECK] Failed to process chunk ${i + 1}:`, e);
                return [];
            }
        });
        // ✅ Wait for all chunks to complete
        const allChunkResults = await Promise.all(chunkPromises);
        const allEdits = allChunkResults.flat().slice(0, 60); // Limit to 60 edits total
        console.log(`\n🎯 [GOLDEN CHECK] Finished processing all chunks`);
        console.log(`📝 [GOLDEN CHECK] Total edits collected: ${allEdits.length}`);
        const atomicResult = applyContextEdits(html, allEdits);
        const doc = ensureFullDocShell(name, atomicResult.html);
        const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
        const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
        const changes = appliedEdits.map(r => r.change).filter(Boolean);
        console.log(`✅ [GOLDEN CHECK] Applied: ${appliedEdits.length}, Failed: ${failedEdits.length}, Changes: ${changes.length}`);
        console.log(`⏱️ [GOLDEN CHECK] Total time: ${Date.now() - requestStart}ms\n`);
        res.json({
            html: doc,
            edits: allEdits,
            changes,
            atomicResults: atomicResult.results,
            failedEdits: failedEdits.map(r => ({
                ...r.edit,
                status: r.status,
                reason: r.reason,
                diagnostics: r.diagnostics,
            })),
            stats: atomicResult.stats,
            timings: atomicResult.timings,
        });
    }
    catch (err) {
        console.error('❌ GOLDEN ERROR:', err);
        res.status(500).json({ code: 'QA_GOLDEN_ERROR', message: errMsg(err) });
    }
});
router.post('/:id/subjects', async (req, res) => {
    try {
        const id = String(req.params.id);
        // ✅ USE REQUEST BODY HTML (fast path)
        let html = String(req.body?.html || '').trim();
        let name = `Template ${id}`;
        // If no HTML provided, fetch it (fallback)
        if (!html) {
            const fetched = await getRobustTemplateHtml(id);
            html = fetched.html;
            name = fetched.name;
        }
        const $plain = cheerio.load(html);
        $plain('script, style, noscript').remove();
        const body = $plain('body').text().replace(/\s+/g, ' ').trim();
        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            temperature: 0.5,
            messages: [
                { role: 'system', content: 'Return ONLY valid JSON: {"subjects": ["..."]}. Generate 5 concise subject lines (<=60 chars). IMPORTANT: At least 2 subjects MUST include relevant emojis that relate to the email template content (e.g., 🎉 for celebrations, 📧 for emails, 🌟 for special offers, 🎁 for gifts, etc.). Choose emojis based on the template topic, NOT random emojis. The other 3 can be without emojis.' },
                { role: 'user', content: `Campaign Name: ${name}\n\nBody:\n${body}` }
            ],
            response_format: { type: 'json_object' }
        });
        let subjects = [];
        try {
            const raw = completion.choices[0]?.message?.content || '{"subjects":[]}';
            const parsed = JSON.parse(raw);
            subjects = Array.isArray(parsed?.subjects)
                ? parsed.subjects.slice(0, 5).map((x) => String(x ?? ''))
                : [];
        }
        catch (_e) {
            subjects = [];
        }
        res.json({ subjects });
    }
    catch (err) {
        res.status(500).json({ code: 'QA_SUBJECTS_ERROR', message: errMsg(err) });
    }
});
router.post('/:id/suggestions', async (req, res) => {
    try {
        const id = String(req.params.id);
        const { html } = await getRobustTemplateHtml(id);
        const out = await getSuggestionsFromHtml(html);
        res.json(out);
    }
    catch (err) {
        res.status(500).json({ code: 'QA_SUGGESTIONS_ERROR', message: errMsg(err) });
    }
});
const VARIANT_TARGET_DEFAULT = 5;
const variantRuns = new Map();
async function getVariantEditsAndWhy(sourceHtml, usedIdeas) {
    const $ = cheerio.load(sourceHtml);
    $('script, style, noscript').remove();
    const plain = $('body').text().replace(/\s+/g, ' ').trim();
    const system = [
        'You generate SMALL, high-signal copy tweaks for an email variant.',
        'Return ONLY valid JSON:',
        '{ "edits":[{ "find":"<exact substring from input text node>", "replace":"<final corrected text>", "before_context":"<10-40 chars from before the find>", "after_context":"<10-40 chars from after the find>", "reason":"...", "idea":"<short tag>"}], "why":["..."] }',
        'Rules:',
        '- Up to 12 edits. Each edit must be within ONE text node.',
        '- "find" and contexts must be copied EXACTLY from the input text (no HTML).',
        '- Do NOT change URLs, merge tags (*|FNAME|*), tracking codes, or anchor/link text.',
        '- Keep tone/meaning; ≤20% length change per edit.',
        '- Favor deliverability & SEO clarity; avoid spammy all-caps or exclamation!!!!',
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
        // ✅ FIXED: Always generate variants from the golden template, not from previous variants
        // This prevents drift and ensures each variant is independent
        const sourceHtml = run.goldenHtml;
        const { edits, why } = await getVariantEditsAndWhy(sourceHtml, run.usedIdeas);
        const atomicResult = applyContextEdits(sourceHtml, edits);
        const variantNo = run.variants.length + 1;
        const ideas = Array.from(new Set((edits || []).map((e) => e.idea).filter(Boolean)));
        ideas.forEach((i) => run.usedIdeas.add(i));
        // ✅ Extract applied changes
        const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
        const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
        const changes = appliedEdits.map(r => r.change).filter(Boolean);
        const item = {
            no: variantNo,
            html: ensureFullDocShell(`Variant ${variantNo}`, atomicResult.html),
            changes: changes,
            why: (why && why.length) ? why : ['Small clarity and deliverability improvements.'],
            artifacts: { usedIdeas: ideas },
            // ✅ NEW: Add failed edits and stats
            failedEdits: failedEdits.map(r => ({
                ...r.edit,
                status: r.status,
                reason: r.reason,
                diagnostics: r.diagnostics,
            })),
            stats: atomicResult.stats,
        };
        // ✅ FIXED: Do NOT update currentHtml to chain variants
        // Each variant is independent from the golden template
        run.variants.push(item);
        res.json(item);
    }
    catch (err) {
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
function visibleTextForChat(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
}
function chatSystemPrompt() {
    return [
        'You are a friendly and helpful email QA assistant focused on suggestions, strategy, and improvements.',
        '',
        '🎯 YOUR ROLE:',
        'Provide thoughtful suggestions, strategic advice, and quality feedback. DO NOT perform text replacements.',
        'Users should make edits themselves using the visual editor.',
        '',
        '💡 CONVERSATION MODES:',
        '',
        '1) CASUAL CHAT: When the user greets you or makes small talk:',
        '   - Respond naturally and warmly',
        '   - Set intent to "suggest"',
        '   - Example: "Hello! 👋 How can I help you improve your email today?"',
        '',
        '2) SUGGESTIONS & STRATEGY: Your primary function:',
        '   - Provide design ideas, layout suggestions, color recommendations',
        '   - SEO and deliverability tips',
        '   - Content strategy and messaging improvements',
        '   - Tone, clarity, and professional quality feedback',
        '   - Set intent to "suggest"',
        '   - Be specific and actionable in your recommendations',
        '',
        '3) CLARIFY: When you need more information:',
        '   - Set intent to "clarify"',
        '   - Ask friendly, helpful questions',
        '',
        '📋 ALWAYS return valid JSON with this structure:',
        '{',
        '  "intent": "suggest" | "clarify",',
        '  "ideas": ["..."],  // Your suggestions, recommendations, and feedback',
        '  "notes": ["friendly messages or questions for the user"]',
        '}',
        '',
        '⚠️ IMPORTANT RULES:',
        '- DO NOT include "edits" array - text replacement is disabled',
        '- DO NOT offer to make specific text changes',
        '- Instead, describe what should be changed and why',
        '- Guide users to make edits themselves using the visual editor',
        '- Focus on high-level strategy and specific recommendations',
        '',
        '💡 TONE:',
        '- Be friendly, supportive, and professional',
        '- Use emojis sparingly to add warmth',
        '- Acknowledge the user\'s input and make them feel heard',
        '- Provide actionable, specific suggestions',
        '- If asked to make replacements, politely explain they should use the editor',
    ].join('\n');
}
router.post('/template/grammar-check', async (req, res) => {
    try {
        const html = String(req.body?.html || '').trim();
        if (!html) {
            return res.status(400).json({
                code: 'GRAMMAR_CHECK_BAD_REQUEST',
                message: 'HTML is required'
            });
        }
        const $ = cheerio.load(html);
        $('script, style, noscript').remove();
        const visibleText = $('body').text().replace(/\s+/g, ' ').trim();
        if (!visibleText) {
            return res.json({
                hasErrors: false,
                mistakes: [],
                message: 'No text content found to check'
            });
        }
        const systemPrompt = [
            'You are a spelling checker. Check ONLY for spelling mistakes and gibberish.',
            'DO NOT check grammar, punctuation, or style.',
            'DO NOT change numbers, prices, brand names, URLs, or merge tags (*|FNAME|*).',
            '',
            'Return ONLY valid JSON with this exact structure:',
            '{',
            '  "mistakes": [',
            '    {',
            '      "word": "<misspelled word or gibberish>",',
            '      "suggestion": "<correct spelling or removal>",',
            '      "context": "<sentence where it appears>"',
            '    }',
            '  ]',
            '}',
            '',
            'Rules:',
            '- Only flag clear spelling errors and gibberish text',
            '- Flag gibberish: Random letter sequences that are not valid words in ANY language',
            '  Examples of gibberish to flag: "sfbfbwifbwdicbwidvbwc", "xyzqwrt", "asdfjkl", "qwertyuiop"',
            '- DO NOT flag valid words in other languages (Spanish, French, German, etc.)',
            '  Examples to IGNORE: "hola" (Spanish), "bonjour" (French), "danke" (German)',
            '- Ignore proper nouns, brand names, and technical terms',
            '- Ignore intentional stylistic choices like "looove" or "yaaay"',
            '- Max 20 mistakes',
        ].join('\n');
        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            temperature: 0,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Check spelling in this text:\n\n${visibleText}` }
            ],
            response_format: { type: 'json_object' }
        });
        let mistakes = [];
        try {
            const raw = completion.choices[0]?.message?.content || '{"mistakes":[]}';
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                const m = parsed.mistakes;
                if (Array.isArray(m)) {
                    mistakes = m.map((item) => ({
                        word: String(item?.word || ''),
                        suggestion: String(item?.suggestion || ''),
                        context: String(item?.context || '')
                    })).filter(item => item.word && item.suggestion);
                }
            }
        }
        catch (_e) { }
        const hasErrors = mistakes.length > 0;
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
        res.status(500).json({
            code: 'GRAMMAR_CHECK_ERROR',
            message: errMsg(err)
        });
    }
});
router.post('/variants/:runId/chat/message', async (req, res) => {
    try {
        const runId = String(req.params.runId);
        const no = Number(req.body?.no ?? 1);
        const html = String(req.body?.html || '').trim();
        const history = Array.isArray(req.body?.history) ? req.body.history : [];
        const userMessage = String(req.body?.userMessage || '').trim();
        if (!userMessage) {
            return res.status(400).json({ code: 'CHAT_BAD_REQUEST', message: 'userMessage is required' });
        }
        if (!html) {
            return res.status(400).json({ code: 'CHAT_BAD_REQUEST', message: 'html is required (current variant HTML)' });
        }
        const context = visibleTextForChat(html);
        const messages = [
            { role: 'system', content: chatSystemPrompt() },
            { role: 'user', content: `Visible text (for context):\n${context || 'No visible text.'}` },
        ];
        for (const t of history.slice(-6)) {
            const r = (t?.role === 'assistant') ? 'assistant' : 'user';
            messages.push({ role: r, content: (t?.content || '').toString() });
        }
        messages.push({ role: 'user', content: userMessage });
        const completion = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            temperature: 0.4,
            messages,
            response_format: { type: 'json_object' },
        });
        let assistantText = '';
        let json = { intent: 'suggest', ideas: [] };
        try {
            const raw = completion.choices[0]?.message?.content || '{"intent":"suggest"}';
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                const obj = parsed;
                // ✅ IMPROVED: Better formatting for different intents
                const hasIdeas = Array.isArray(obj.ideas) && obj.ideas.length > 0;
                const hasNotes = Array.isArray(obj.notes) && obj.notes.length > 0;
                const hasEdits = Array.isArray(obj.edits) && obj.edits.length > 0;
                // Build friendly assistant text - COMBINE notes and ideas when both exist
                const parts = [];
                if (hasIdeas) {
                    // Format ideas nicely
                    if (obj.ideas.length === 1) {
                        parts.push(obj.ideas[0]);
                    }
                    else {
                        parts.push(obj.ideas.map((s, i) => obj.ideas.length > 3 ? `${i + 1}. ${s}` : `• ${s}`).join('\n\n'));
                    }
                }
                if (hasNotes) {
                    // Add notes (questions, friendly messages) - can appear with or without ideas
                    parts.push(obj.notes.join('\n\n'));
                }
                // ❌ REMOVED: Edit functionality disabled
                // Edits array is ignored - chatbot now provides suggestions only
                assistantText = parts.length > 0
                    ? parts.join('\n\n')
                    : 'Got it! Let me know if you need anything else.';
                json = {
                    intent: (obj.intent || 'suggest'),
                    ideas: Array.isArray(obj.ideas) ? obj.ideas.map((s) => String(s || '')) : [],
                    edits: [], // ❌ Always empty - replacement functionality removed
                    targets: Array.isArray(obj.targets) ? obj.targets.map((s) => String(s || '')) : [],
                    notes: Array.isArray(obj.notes) ? obj.notes.map((s) => String(s || '')) : [],
                };
            }
        }
        catch (_e) { /* ignore parse error; return default */ }
        return res.json({ assistantText, json });
    }
    catch (err) {
        res.status(500).json({ code: 'CHAT_ERROR', message: errMsg(err) });
    }
});
router.post('/variants/:runId/chat/apply', async (req, res) => {
    try {
        const html = String(req.body?.html || '');
        const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
        if (!html)
            return res.status(400).json({ code: 'CHAT_APPLY_BAD_REQUEST', message: 'html is required' });
        const atomicResult = applyContextEdits(html, edits);
        // ✅ Extract results
        const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
        const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
        const changes = appliedEdits.map(r => r.change).filter(Boolean);
        const doc = ensureFullDocShell('Edited Variant', atomicResult.html);
        return res.json({
            html: doc,
            changes: changes,
            // ✅ NEW: Return failed edits and stats
            failedEdits: failedEdits.map(r => ({
                ...r.edit,
                status: r.status,
                reason: r.reason,
                diagnostics: r.diagnostics,
            })),
            atomicResults: atomicResult.results,
            stats: atomicResult.stats,
        });
    }
    catch (err) {
        res.status(500).json({ code: 'CHAT_APPLY_ERROR', message: errMsg(err) });
    }
});
router.post('/snap', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ url, ok: false, error: 'Invalid URL' });
    }
    let browser = null;
    try {
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
        await page.setUserAgent('Mozilla/5.0 (compatible; Variant-Snap/1.0)');
        const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => null);
        await delay(500);
        const buf = (await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 }));
        const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
        res.json({
            url,
            ok: !resp || resp.status() < 400,
            status: resp?.status(),
            finalUrl: page.url(),
            dataUrl,
        });
    }
    catch (err) {
        res.status(500).json({ url, ok: false, error: errMsg(err) });
    }
    finally {
        try {
            await browser?.close();
        }
        catch { }
    }
});
exports.default = router;
