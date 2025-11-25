import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import GeneratedTemplate from '@src/models/GeneratedTemplate';
import { authenticate } from '@src/middleware/auth';
import { organizationContext } from '@src/middleware/organizationContext';
import logger from 'jet-logger';

const router = Router();
const MC: any = mailchimp as any;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/*                    ✅ NEW: Enhanced Atomic Types                    */
/* ------------------------------------------------------------------ */

type EditStatus = 'applied' | 'not_found' | 'blocked' | 'skipped' | 'context_mismatch' | 'boundary_issue' | 'already_correct';

type EditDiagnostics = {
  normalizedFind?: string;
  rawOccurrences?: number;
  normalizedOccurrences?: number;
  contextMatched?: boolean;
  crossesBoundary?: boolean;
  locations?: Array<{
    tag: string;
    line?: number;
    actualContext: string;
    confidence: number;
    xpath?: string;
    htmlSnippet?: string;
    spanningElements?: string[];
    visualPreview?: string;
  }>;
  manualFixGuidance?: {
    strategy: 'split-across-boundary' | 'not-found' | 'context-mismatch' | 'normalization-issue';
    recommendation: string;
    searchHints?: string[];
    affectedElements?: Array<{
      tag: string;
      xpath: string;
      textContent: string;
    }>;
  };
  timings?: {
    search: number;
    apply: number;
    verify: number;
  };
};

type EditResult = {
  index: number;
  edit: {
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason?: string;
  };
  status: EditStatus;
  reason?: string;
  change?: {
    before: string;
    after: string;
    parent: string;
    reason?: string;
  };
  diagnostics?: EditDiagnostics;
};

type AtomicEditResponse = {
  html: string;
  results: EditResult[];
  stats: {
    total: number;
    applied: number;
    failed: number;
    blocked: number;
    // ✅ Removed skipped
  };
  timings: {
    total: number;
    parsing: number;
    processing: number;
    verification: number;
  };
};

type TextNodeMap = {
  node: any;
  startInConsolidated: number;
  endInConsolidated: number;
};

/* ------------------------------------------------------------------ */
/*                       Helpers & safe typings                        */
/* ------------------------------------------------------------------ */

function isGeneratedTemplate(id: string): boolean {
  return id.startsWith('gen_') || id.startsWith('Generated_');
}

async function getGeneratedTemplateHtml(id: string): Promise<{ name: string; html: string }> {
  const template = await GeneratedTemplate.findOne({ templateId: id });
  
  if (!template) {
    throw new Error(`Generated template not found: ${id}`);
  }
  
  return {
    name: template.name,
    html: template.html
  };
}

function errMsg(err: unknown): string {
  if (typeof err === 'object' && err && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === 'string' ? m : String(m);
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureFullDocShell(name: string, bodyOrDocHtml: string): string {
  const html = bodyOrDocHtml || "<div style='padding:16px;color:#666'>No content.</div>";
  const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
  if (hasDoc) return html;
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

async function getTemplateHtmlDirect(id: string): Promise<{ name: string; html: string }> {
  const t: any = (MC.templates.getTemplate ? await MC.templates.getTemplate(id) : await MC.templates.get(id));
  const name: string = t?.name || `Template ${id}`;
  const html: string = String(t?.html || '').trim();
  return { name, html };
}

async function getTemplateHtmlFromDefaultContent(id: string): Promise<string> {
  const api: any = MC.templates;
  const dc: any =
    (api.getDefaultContent ? await api.getDefaultContent(id)
      : api.getTemplateDefaultContent ? await api.getTemplateDefaultContent(id)
      : null) || {};
  if (dc.html) return String(dc.html);
  if (dc.sections && typeof dc.sections === 'object') {
    return Object.values(dc.sections as Record<string, string>).join('\n');
  }
  return '';
}

async function getTemplateHtmlViaCampaign(id: string): Promise<string> {
  const listId = process.env.MC_AUDIENCE_ID;
  const fromEmail = process.env.MC_FROM_EMAIL;
  const fromName = process.env.MC_FROM_NAME;
  if (!listId || !fromEmail || !fromName) return '';

  const campaigns: any = MC.campaigns;
  const draft: any = await campaigns.create({
    type: 'regular',
    recipients: { list_id: listId },
    settings: {
      subject_line: 'Preview',
      from_name: fromName,
      reply_to: fromEmail,
      title: `Preview-${id}-${Date.now()}`
    }
  });
  const campaignId: string = draft?.id;

  try {
    await campaigns.setContent(campaignId, { template: { id: Number(id) } });
    const content: any = await campaigns.getContent(campaignId);
    return String(content?.html || '');
  } finally {
    try {
      if (typeof campaigns.remove === 'function') await campaigns.remove(campaignId);
      else if (typeof campaigns.delete === 'function') await campaigns.delete(campaignId);
    } catch (_e: unknown) { /* ignore cleanup */ }
  }
}

export async function getRobustTemplateHtml(id: string): Promise<{ name: string; html: string }> {
  if (isGeneratedTemplate(id)) {
    return await getGeneratedTemplateHtml(id);
  }
  
  const { name, html: direct } = await getTemplateHtmlDirect(id);
  if (direct) return { name, html: ensureFullDocShell(name, direct) };
  let html = await getTemplateHtmlViaCampaign(id);
  if (!html) html = await getTemplateHtmlFromDefaultContent(id);
  return { name, html: ensureFullDocShell(name, html) };
}

/* ------------------------------------------------------------------ */
/*                  Visible text + chunking for GPT                    */
/* ------------------------------------------------------------------ */

function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function chunkText(s: string, max = 3500): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = Math.min(i + max, s.length);
    if (j < s.length) {
      const k = s.lastIndexOf(' ', j);
      if (k > i + 2000) j = k;
    }
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

function grammarSystemPrompt(): string {
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

const NAMED_ENT: Record<string, string> = {
  nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201D', ldquo: '\u201C',
  hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
};

function decodeHtmlEntityAt(raw: string, i: number): { ch: string; end: number } | null {
  if (raw[i] !== '&') return null;
  const semi = raw.indexOf(';', i + 1);
  if (semi < 0 || semi - i > 31) return null;
  const body = raw.slice(i + 1, semi);

  if (body.startsWith('#x') || body.startsWith('#X')) {
    const code = parseInt(body.slice(2), 16);
    if (!Number.isNaN(code)) return { ch: String.fromCodePoint(code), end: semi };
    return null;
  }
  if (body.startsWith('#')) {
    const code = parseInt(body.slice(1), 10);
    if (!Number.isNaN(code)) return { ch: String.fromCodePoint(code), end: semi };
    return null;
  }
  const named = NAMED_ENT[body];
  return named ? { ch: named, end: semi } : null;
}

function normalizeChar(ch: string): string {
  if (ZWS.test(ch)) return '';
  if (ch === '\u00A0' || ch === '\u2007' || ch === '\u202F') return ' ';
  if (ch === '\u201C' || ch === '\u201D') return '"';
  if (ch === '\u2018' || ch === '\u2019') return "'";
  if (ch === '\u2013' || ch === '\u2014') return '-';
  if (ch === '\u2026') return '...';
  return ch;
}

function normalizeAndMap(rawIn: string): { norm: string; mapStart: number[]; mapEnd: number[] } {
  const raw = String(rawIn || '');
  const mapStart: number[] = [];
  const mapEnd: number[] = [];
  let norm = '';
  let lastWasSpace = false;

  for (let i = 0; i < raw.length; i++) {
    let end = i + 1;
    let chOut: string;

    if (raw[i] === '&') {
      const dec = decodeHtmlEntityAt(raw, i);
      if (dec) { chOut = dec.ch; end = dec.end + 1; } else { chOut = raw[i]; }
    } else {
      chOut = raw[i];
    }

    let ch = normalizeChar(chOut);
    if (ch === '') { i = end - 1; continue; }

    if (/\s/.test(ch)) ch = ' ';
    if (ch === ' ') {
      if (lastWasSpace) { i = end - 1; continue; }
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }

    mapStart[norm.length] = i;
    mapEnd[norm.length] = end;
    norm += ch;
    i = end - 1;
  }

  return { norm, mapStart, mapEnd };
}

function normalizeOnly(s: string): string {
  return normalizeAndMap(String(s || '')).norm;
}

function mapNormSpanToRawSpan(
  mapStart: number[],
  mapEnd: number[],
  startN: number,
  lenN: number,
  rawLength: number
) {
  if (startN < 0 || lenN <= 0) return null;
  const rawStart = mapStart[startN];
  const endN = startN + lenN - 1;
  const rawEndExclusive = mapEnd[endN];
  if (typeof rawStart !== 'number' || typeof rawEndExclusive !== 'number') return null;
  return {
    start: Math.max(0, rawStart),
    end: Math.min(rawLength, rawEndExclusive),
  };
}

function findWithContextSpan(haystack: string, needle: string, beforeCtx: string, afterCtx: string) {
  const raw = String(haystack || '');
  const nRaw = String(needle || '');
  const bRaw = String(beforeCtx || '');
  const aRaw = String(afterCtx || '');

  let i = raw.indexOf(nRaw);
  while (i >= 0) {
    const okBefore = bRaw ? raw.slice(Math.max(0, i - bRaw.length), i).endsWith(bRaw) : true;
    const okAfter  = aRaw ? raw.slice(i + nRaw.length, i + nRaw.length + aRaw.length).startsWith(aRaw) : true;
    
    if ((okBefore && okAfter) || (bRaw && okBefore) || (aRaw && okAfter)) {
      return { start: i, end: i + nRaw.length };
    }
    
    i = raw.indexOf(nRaw, i + 1);
  }

  const H = normalizeAndMap(raw);
  const nNeedle = normalizeOnly(nRaw);
  const nBefore = normalizeOnly(bRaw);
  const nAfter  = normalizeOnly(aRaw);

  let ni = H.norm.indexOf(nNeedle);
  while (ni >= 0) {
    const okBefore = nBefore ? H.norm.slice(Math.max(0, ni - nBefore.length), ni).endsWith(nBefore) : true;
    const okAfter  = nAfter  ? H.norm.slice(ni + nNeedle.length, ni + nNeedle.length + nAfter.length).startsWith(nAfter) : true;
    
    if ((okBefore && okAfter) || (nBefore && okBefore) || (nAfter && okAfter)) {
      const span = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, ni, nNeedle.length, raw.length);
      if (span) return span;
    }
    
    ni = H.norm.indexOf(nNeedle, ni + 1);
  }

  if (bRaw || nBefore) {
    const biRaw = bRaw ? raw.indexOf(bRaw) : -1;
    if (biRaw >= 0) {
      const start = biRaw + bRaw.length;
      const j = raw.indexOf(nRaw, start);
      if (j >= 0) return { start: j, end: j + nRaw.length };
    }
    const biN = nBefore ? H.norm.indexOf(nBefore) : -1;
    if (biN >= 0) {
      const startN = biN + nBefore.length;
      const jN = H.norm.indexOf(nNeedle, startN);
      if (jN >= 0) {
        const span2 = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, jN, nNeedle.length, raw.length);
        if (span2) return span2;
      }
    }
  }

  if (aRaw || nAfter) {
    const aiRaw = aRaw ? raw.indexOf(aRaw) : -1;
    if (aiRaw > 0) {
      const end = aiRaw;
      const j = raw.lastIndexOf(nRaw, end);
      if (j >= 0) return { start: j, end: j + nRaw.length };
    }
    const aiN = nAfter ? H.norm.indexOf(nAfter) : -1;
    if (aiN > 0) {
      const endN = aiN;
      const jN = H.norm.lastIndexOf(nNeedle, endN);
      if (jN >= 0) {
        const span3 = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, jN, nNeedle.length, raw.length);
        if (span3) return span3;
      }
    }
  }

  return null;
}

function deniedParents(): Set<string> {
  return new Set(['style', 'script', 'title', 'svg']);
}

function isBlockElement(tag: string): boolean {
  const blockTags = new Set([
    'p', 'div', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'article', 'section', 'header', 'footer', 'aside'
  ]);
  return blockTags.has(tag);
}

function consolidateTextNodesRecursive(
  $: any,
  element: any
): { fullText: string; nodeMap: TextNodeMap[] } {
  let fullText = '';
  const nodeMap: TextNodeMap[] = [];
  
  function traverse(node: any) {
    $(node).contents().each((_: any, child: any) => {
      if (child.type === 'text') {
        const txt = String(child.data || '');
        if (txt) {
          const startInConsolidated = fullText.length;
          fullText += txt;
          const endInConsolidated = fullText.length;
          nodeMap.push({ node: child, startInConsolidated, endInConsolidated });
        }
      } else if (child.type === 'tag') {
        traverse(child);
      }
    });
  }
  
  traverse(element);
  return { fullText, nodeMap };
}

function applyReplacementToNodes(
  nodeMap: TextNodeMap[],
  matchStart: number,
  matchEnd: number,
  replacement: string
): boolean {
  const affectedNodes: { 
    node: any; 
    localStart: number; 
    localEnd: number;
    nodeLength: number;
  }[] = [];
  
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
      
    } else {
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
  } catch (error) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*         ✅ NEW: Helper Functions for Enhanced Diagnostics          */
/* ------------------------------------------------------------------ */

function findAffectedNodes(
  nodeMap: TextNodeMap[],
  matchStart: number,
  matchEnd: number
): Array<{ 
  node: any; 
  localStart: number; 
  localEnd: number;
  nodeLength: number;
}> {
  const affectedNodes: Array<{ 
    node: any; 
    localStart: number; 
    localEnd: number;
    nodeLength: number;
  }> = [];
  
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

function generateXPath($: any, element: any): string {
  const segments: string[] = [];
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ */
/*         ✅ ENHANCED: Atomic Verification with Full Diagnostics      */
/* ------------------------------------------------------------------ */

function applyContextEdits(
  html: string,
  edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string }>
): AtomicEditResponse {
  const startTime = Date.now();
  const parseStart = Date.now();
  const $ = (cheerio as any).load(html, { decodeEntities: false });
  const parseTime = Date.now() - parseStart;
  const deny = deniedParents();
  const results: EditResult[] = [];
  
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

    const diagnostics: EditDiagnostics = {
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
      diagnostics.timings!.search = Date.now() - searchStart;
      
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

    const boundaryInfo: Array<{
      element: any;
      tag: string;
      fullText: string;
      matchPosition: { start: number; end: number };
      spanningElements: string[];
      htmlSnippet: string;
      xpath: string;
    }> = [];

    $('body *').each((_: any, el: any) => {
      if (applied) return false;

      const tag = (el as any).tagName?.toLowerCase?.() || '';
      if (deny.has(tag)) return;
      if (!isBlockElement(tag)) return;

      const { fullText, nodeMap } = consolidateTextNodesRecursive($, el);
      if (!fullText.trim()) return;

      const span = findWithContextSpan(fullText, edit.find, edit.before, edit.after);
      
if (span) {
  diagnostics.contextMatched = true;
  // ✅ NEW: Find affected nodes and save their original state BEFORE applying
  const affectedNodes = findAffectedNodes(nodeMap, span.start, span.end);
  
  // ✅ NEW: Save original state for rollback
  const originalNodeStates: Array<{ node: any; originalData: string }> = [];
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
    const htmlSnippet = $el.html()?.substring(
      Math.max(0, span.start - 100),
      Math.min($el.html()?.length || 0, span.end + 100)
    ) || '';
    
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
  diagnostics.timings!.apply = Date.now() - applyStart;
  
  if (applySuccess) {
    // ✅ Verify the changes
    const verifyStart = Date.now();
    const { fullText: newFullText } = consolidateTextNodesRecursive($, el);
    
    const oldTextGone = !newFullText.includes(edit.find);
    const newTextPresent = newFullText.includes(edit.replace);
    
    const replacementWords = edit.replace.split(/\s+/);
    const allWordsPresent = replacementWords.every(word => 
      word.length < 3 || newFullText.includes(word)
    );
    
    const verificationPassed = oldTextGone && newTextPresent && allWordsPresent;
    
    diagnostics.timings!.verify = Date.now() - verifyStart;
    if (verificationPassed) {
      applied = true;
      appliedTag = tag;
      return false; // Stop iteration
    } else {
      // ✅ NEW: ROLLBACK on verification failure
      originalNodeStates.forEach(({ node, originalData }) => {
        node.data = originalData;
      });
      // ✅ Verify rollback worked
      const { fullText: rolledBackText } = consolidateTextNodesRecursive($, el);
      const rollbackVerified = rolledBackText === fullText;
      diagnostics.crossesBoundary = true;
    }
  } else {
    // ✅ NEW: ROLLBACK on apply failure
    originalNodeStates.forEach(({ node, originalData }) => {
      node.data = originalData;
    });
    diagnostics.crossesBoundary = true;
  }
}else {
        const spanNoContext = findWithContextSpan(fullText, edit.find, '', '');
        if (spanNoContext) {
          const contextBefore = fullText.substring(Math.max(0, spanNoContext.start - 40), spanNoContext.start);
          const contextAfter = fullText.substring(spanNoContext.end, Math.min(fullText.length, spanNoContext.end + 40));
          
          const xpath = generateXPath($, el);
          
          diagnostics.locations!.push({
            tag,
            actualContext: contextBefore + '[' + edit.find + ']' + contextAfter,
            confidence: 0,
            xpath,
            visualPreview: `${contextBefore}${edit.find}${contextAfter}`
          });
        }
      }
    });

    diagnostics.timings!.search = Date.now() - searchStart;
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
    } else {
      let failureReason = 'Unknown failure';
      let status: EditStatus = 'not_found';
      let manualFixGuidance: EditDiagnostics['manualFixGuidance'];
      
      if (diagnostics.contextMatched && diagnostics.crossesBoundary) {
        failureReason = 'Text found but spans across element boundaries (e.g., inside/outside links)';
        status = 'boundary_issue';
        
        if (boundaryInfo.length > 0) {
          const info = boundaryInfo[0];
          
          diagnostics.locations!.push({
            tag: info.tag,
            actualContext: info.fullText.substring(
              Math.max(0, info.matchPosition.start - 50),
              Math.min(info.fullText.length, info.matchPosition.end + 50)
            ),
            confidence: 100,
            xpath: info.xpath,
            htmlSnippet: info.htmlSnippet,
            spanningElements: info.spanningElements,
            visualPreview: info.fullText.substring(
              Math.max(0, info.matchPosition.start - 20),
              Math.min(info.fullText.length, info.matchPosition.end + 20)
            )
          });
          
          const affectedNodesData = findAffectedNodes(
            consolidateTextNodesRecursive($, info.element).nodeMap,
            info.matchPosition.start,
            info.matchPosition.end
          );
          
          manualFixGuidance = {
            strategy: 'split-across-boundary',
            recommendation: `The text "${edit.find}" is split across ${info.spanningElements.length} elements (${info.spanningElements.join(' → ')}). Use the visual editor to manually fix this by editing each part separately.`,
            affectedElements: affectedNodesData.map((n: any) => {
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
        
      } else if (diagnostics.locations && diagnostics.locations.length > 0) {
        failureReason = `Text found ${diagnostics.locations.length} time(s) but context didn't match`;
        status = 'context_mismatch';
        
        manualFixGuidance = {
          strategy: 'context-mismatch',
          recommendation: `Found the text in ${diagnostics.locations.length} location(s), but the surrounding context doesn't match what GPT expected. Review each location in the visual editor.`,
          searchHints: diagnostics.locations.map(loc => 
            `In <${loc.tag}>: "${loc.visualPreview || loc.actualContext}"`
          )
        };
        
      } else if (normalizedOccurrences > 0) {
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
        
      } else {
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

function applyLooseWordFallback(
  html: string,
  edits: Array<{ find: string; replace: string; reason?: string }>
): { html: string; changes: Array<{ before: string; after: string; parent: string; reason?: string }> } {
  const $ = (cheerio as any).load(html, { decodeEntities: false });
  $('script,style,noscript').remove();

  const changes: Array<{ before: string; after: string; parent: string; reason?: string }> = [];

  $('body *').each((_: any, el: any) => {
    const tag = el?.tagName?.toLowerCase?.() || '';

    $(el).contents().each((__: any, node: any) => {
      if (node?.type !== 'text') return;
      let txt: string = node.data || '';

      for (const e of edits) {
        const f = String(e.find || '').replace(/[^\w\s'-]/g, ' ').trim();
        const r = String(e.replace || '').trim();
        if (!f || !r) continue;

        if (r.split(/\s+/).length !== 1) continue;

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

async function getSuggestionsFromHtml(html: string): Promise<{ gibberish: Array<{ text: string; reason: string }>; suggestions: string[] }> {
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
    response_format: { type: 'json_object' as const }
  });

  let gibberish: Array<{ text: string; reason: string }> = [];
  let suggestions: string[] = [];
  try {
    const raw = completion.choices[0]?.message?.content || '{"gibberish":[],"suggestions":[]}';
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const g: unknown = (parsed as any).gibberish;
      const s: unknown = (parsed as any).suggestions;
      if (Array.isArray(g)) {
        gibberish = g.map((x: unknown) => {
          const it = x as { text?: unknown; reason?: unknown };
          return { text: String(it?.text ?? ''), reason: String(it?.reason ?? '') };
        }).filter((it) => !!it.text);
      }
      if (Array.isArray(s)) suggestions = s.map((x: unknown) => String(x ?? ''));
    }
  } catch (_e: unknown) { /* ignore */ }

  return { gibberish, suggestions };
}

/* ------------------------------------------------------------------ */
/*                               Routes                                */
/* ------------------------------------------------------------------ */

router.post('/:id/golden', authenticate, organizationContext, async (req: Request, res: Response) => {
  const requestStart = Date.now();
  try {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    const userId = (req as any).tokenPayload?.userId;
    
    // ✅ SECURITY: Validate template ownership for generated templates
    if (id.startsWith('gen_') || id.startsWith('Generated_')) {
      const template = await GeneratedTemplate.findOne({ 
        templateId: id,
        organizationId: organization._id
      });
      
      if (!template) {
        logger.warn(`🚫 [SECURITY] User ${userId} from org ${organization._id} attempted to access template ${id}`);
        return res.status(404).json({ 
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied' 
        });
      }
      
      logger.info(`✅ [QA] Template ownership validated: ${id} belongs to org ${organization.name}`);
    }
    
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
    
    // ✅ Process all chunks in parallel
    const chunkPromises = chunks.map(async (chunk, i) => {
      
      try {
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          temperature: 0,  // ✅ Changed from 0.2 to 0 for maximum determinism
          seed: 42,        // ✅ Added seed for reproducible results
          messages: [
            { role: 'system', content: grammarSystemPrompt() },
            { role: 'user', content: `Visible email text:\n\n${chunk || 'No text.'}` }
          ],
          response_format: { type: 'json_object' as const }
        });

        const raw = completion.choices[0]?.message?.content || '{"edits":[]}';
        const parsed: unknown = JSON.parse(raw);
        
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).edits)) {
          const edits = (parsed as any).edits.map((e: any) => ({
            find: String(e?.find || ''),
            replace: String(e?.replace || ''),
            before_context: String(e?.before_context || ''),
            after_context: String(e?.after_context || ''),
            reason: e?.reason ? String(e.reason) : undefined,
          })).filter((e: any) => e.find && e.replace);
          
          return edits;
        }
        
        return [];
      } catch (e) {
        return [];
      }
    });
    
    // ✅ Wait for all chunks to complete
    const allChunkResults = await Promise.all(chunkPromises);
    const allEdits = allChunkResults.flat().slice(0, 60); // Limit to 60 edits total
    
    const atomicResult = applyContextEdits(html, allEdits);
    
    const doc = ensureFullDocShell(name, atomicResult.html);

    const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
    const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
    const changes = appliedEdits.map(r => r.change!).filter(Boolean);
    
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
    
  } catch (err: unknown) {
    res.status(500).json({ code: 'QA_GOLDEN_ERROR', message: errMsg(err) });
  }
});

router.post('/:id/subjects', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    const userId = (req as any).tokenPayload?.userId;
    
    // ✅ SECURITY: Validate template ownership for generated templates
    if (id.startsWith('gen_') || id.startsWith('Generated_')) {
      const template = await GeneratedTemplate.findOne({ 
        templateId: id,
        organizationId: organization._id
      });
      
      if (!template) {
        logger.warn(`🚫 [SECURITY] User ${userId} attempted to access template ${id}`);
        return res.status(404).json({ 
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied' 
        });
      }
    }
    
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
      response_format: { type: 'json_object' as const }
    });

    let subjects: string[] = [];
    try {
      const raw = completion.choices[0]?.message?.content || '{"subjects":[]}';
      const parsed: unknown = JSON.parse(raw);
      subjects = Array.isArray((parsed as any)?.subjects)
        ? (parsed as any).subjects.slice(0, 5).map((x: unknown) => String(x ?? ''))
        : [];
    } catch (_e: unknown) {
      subjects = [];
    }

    res.json({ subjects });
  } catch (err: unknown) {
    res.status(500).json({ code: 'QA_SUBJECTS_ERROR', message: errMsg(err) });
  }
});

router.post('/:id/suggestions', authenticate, organizationContext, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const organization = (req as any).organization;
    const userId = (req as any).tokenPayload?.userId;
    
    // ✅ SECURITY: Validate template ownership for generated templates
    if (id.startsWith('gen_') || id.startsWith('Generated_')) {
      const template = await GeneratedTemplate.findOne({ 
        templateId: id,
        organizationId: organization._id
      });
      
      if (!template) {
        logger.warn(`🚫 [SECURITY] User ${userId} attempted to access template ${id}`);
        return res.status(404).json({ 
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Template not found or access denied' 
        });
      }
    }
    
    const { html } = await getRobustTemplateHtml(id);
    const out = await getSuggestionsFromHtml(html);
    res.json(out);
  } catch (err: unknown) {
    res.status(500).json({ code: 'QA_SUGGESTIONS_ERROR', message: errMsg(err) });
  }
});

/* ------------------------------------------------------------------ */
/*                            Variants                                 */
/* ------------------------------------------------------------------ */

type VariantChange = { before: string; after: string; parent: string; reason?: string };
type VariantArtifacts = { usedIdeas: string[] };
type VariantItem = { 
  no: number; 
  html: string; 
  changes: VariantChange[]; 
  why: string[]; 
  artifacts: VariantArtifacts;
  // ✅ NEW: Add failed edits and stats
  failedEdits?: Array<{
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason?: string;
    status: EditStatus;
    diagnostics?: EditDiagnostics;
  }>;
  stats?: {
    total: number;
    applied: number;
    failed: number;
    blocked: number;
    // ✅ Removed skipped
  };
};

type VariantRun = {
  id: string;
  templateId: string;
  target: number;
  goldenHtml: string;
  currentHtml: string;
  usedIdeas: Set<string>;
  variants: VariantItem[];
  createdAt: number;
};

const VARIANT_TARGET_DEFAULT = 5;
const variantRuns = new Map<string, VariantRun>();

async function getVariantEditsAndWhy(sourceHtml: string, usedIdeas: Set<string>): Promise<{ edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string; idea?: string }>; why: string[]; }> {
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
    response_format: { type: 'json_object' as const }
  });

  let edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string; idea?: string }> = [];
  let why: string[] = [];
  try {
    const raw = completion.choices[0]?.message?.content || '{"edits":[],"why":[]}';
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const e = (parsed as any).edits;
      const w = (parsed as any).why;
      if (Array.isArray(e)) {
        edits = e.map((x: any) => ({
          find: String(x?.find || ''),
          replace: String(x?.replace || ''),
          before_context: String(x?.before_context || ''),
          after_context: String(x?.after_context || ''),
          reason: x?.reason ? String(x.reason) : undefined,
          idea: x?.idea ? String(x.idea) : undefined,
        })).filter((x) => x.find && x.replace);
      }
      if (Array.isArray(w)) why = w.map((s: any) => String(s || '')).filter(Boolean);
    }
  } catch (_e: unknown) { /* ignore */ }

  return { edits, why };
}

router.post('/:id/variants/start', async (req: Request, res: Response) => {
  try {
    const templateId = String(req.params.id);
    const goldenHtml: string = String(req.body?.html || '').trim();
    const target = Math.min(Math.max(Number(req.body?.target ?? VARIANT_TARGET_DEFAULT), 1), 5);

    if (!goldenHtml) {
      return res.status(400).json({ code: 'VARIANTS_START_BAD_REQUEST', message: 'goldenHtml is required' });
    }

    const runId = (typeof (randomUUID as any) === 'function') ? randomUUID() : `vr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const run: VariantRun = {
      id: runId,
      templateId,
      target,
      goldenHtml,
      currentHtml: goldenHtml,
      usedIdeas: new Set<string>(),
      variants: [],
      createdAt: Date.now(),
    };
    variantRuns.set(runId, run);
    res.json({ runId, target });
  } catch (err: unknown) {
    res.status(500).json({ code: 'VARIANTS_START_ERROR', message: errMsg(err) });
  }
});

router.post('/variants/:runId/next', async (req: Request, res: Response) => {
  try {
    const runId = String(req.params.runId);
    const run = variantRuns.get(runId);
    if (!run) return res.status(404).json({ code: 'VARIANTS_RUN_NOT_FOUND', message: 'Run not found' });

    if (run.variants.length >= run.target) {
      return res.status(200).json({ done: true, message: 'All variants generated', no: run.variants.length });
    }

    // ✅ FIXED: Always generate variants from the golden template, not from previous variants
    // This prevents drift and ensures each variant is independent
    const sourceHtml = run.goldenHtml;
    const { edits, why } = await getVariantEditsAndWhy(sourceHtml, run.usedIdeas);

    const atomicResult = applyContextEdits(sourceHtml, edits);
    const variantNo = run.variants.length + 1;

    const ideas = Array.from(new Set((edits || []).map((e) => (e as any).idea).filter(Boolean) as string[]));
    ideas.forEach((i) => run.usedIdeas.add(i));

      // ✅ Extract applied changes
      const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
      const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
      const changes = appliedEdits.map(r => r.change!).filter(Boolean);

      const item: VariantItem = {
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
  } catch (err: unknown) {
    res.status(500).json({ code: 'VARIANTS_NEXT_ERROR', message: errMsg(err) });
  }
});

router.get('/variants/:runId/status', async (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  const run = variantRuns.get(runId);
  if (!run) return res.status(404).json({ code: 'VARIANTS_RUN_NOT_FOUND' });
  res.json({
    runId: run.id,
    templateId: run.templateId,
    target: run.target,
    count: run.variants.length,
    items: run.variants,
  });
});

/* ------------------------------------------------------------------ */
/*                         Chat & Other Routes                         */
/* ------------------------------------------------------------------ */

type ChatIntent = 'suggest' | 'edit' | 'both' | 'clarify';

type ChatAssistantJson = {
  intent: ChatIntent;
  ideas?: string[];
  edits?: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string }>;
  targets?: string[];
  notes?: string[];
};

type ChatTurn = { role: 'user' | 'assistant'; content: string; json?: ChatAssistantJson | null };

function visibleTextForChat(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

// Extract semantic sections from HTML for better AI understanding
function extractSemanticSections(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  
  const sections: string[] = [];
  let sectionIndex = 1;
  
  // Extract text from semantic block elements
  const blockSelectors = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'div[class*="section"]', 'div[class*="block"]', 'div[class*="content"]',
    'section', 'article', 'header', 'footer',
    'td', 'th', // Table cells
    'li' // List items
  ];
  
  $(blockSelectors.join(', ')).each((_: any, el: any) => {
    const $el = $(el);
    const text = $el.text().trim();
    
    // Only include meaningful sections (at least 10 chars, not just whitespace)
    if (text.length >= 10 && text.length < 500) {
      const tag = (el as any).tagName?.toLowerCase() || 'div';
      sections.push(`[Section ${sectionIndex++} - ${tag.toUpperCase()}]: ${text}`);
    }
  });
  
  // If no semantic sections found, fall back to plain text
  if (sections.length === 0) {
    return $('body').text().replace(/\s+/g, ' ').trim();
  }
  
  return sections.join('\n\n');
}

function chatSystemPrompt(): string {
  return [
    'You are a friendly and helpful email QA assistant focused on suggestions, strategy, and improvements.',
    '',
    '🎯 YOUR ROLE:',
    'Provide thoughtful suggestions, strategic advice, and quality feedback.',
    '',
    '💡 CONVERSATION MODES:',
    '',
    '1) CASUAL CHAT: When the user greets you or makes small talk:',
    '   - Respond naturally and warmly',
    '   - Set intent to "suggest"',
    '   - Example: "Hello! 👋 How can I help you improve your email today?"',
    '',
    '2) SUGGESTIONS & STRATEGY: For general advice:',
    '   - Provide design ideas, layout suggestions, color recommendations',
    '   - SEO and deliverability tips',
    '   - Content strategy and messaging improvements',
    '   - Tone, clarity, and professional quality feedback',
    '   - Set intent to "suggest"',
    '   - Use "ideas" array for recommendations',
    '',
    '3) CLARIFY: When you need more information:',
    '   - Set intent to "clarify"',
    '   - Ask friendly, helpful questions',
    '',
    '📋 ALWAYS return valid JSON with this structure:',
    '{',
    '  "intent": "suggest" | "clarify",',
    '  "ideas": ["..."],  // Your suggestions, recommendations, and feedback',
    '  "notes": ["friendly messages or questions"]',
    '}',
    '',
    '💡 TONE:',
    '- Be friendly, supportive, and professional',
    '- Use emojis sparingly to add warmth',
    '- Acknowledge the user\'s input and make them feel heard',
    '- Provide actionable, specific suggestions',
  ].join('\n');
}

function chatSystemPromptForAutoRecommendations(): string {
  return [
    'You are a friendly and helpful email QA assistant. The user is asking you to suggest changes to their email, and you should automatically identify which SPECIFIC SECTIONS need improvement.',
    '',
    '🚨 CRITICAL: DO NOT return the entire email. Only return small, specific sections.',
    '',
    '🎯 YOUR TASK:',
    '1. Analyze the email content provided - it is organized by semantic sections (each marked with [Section X - TAG])',
    '2. Each section shown is a COMPLETE semantic unit from the HTML (paragraph, heading, div, etc.)',
    '3. ⚠️ CRITICAL: You MUST ONLY return text that EXACTLY EXISTS in the sections shown above',
    '4. Identify THE SINGLE MOST IMPORTANT COMPLETE section that would benefit from improvement',
    '5. For that ONE section:',
    '   - Copy the EXACT COMPLETE text from the section shown above (the full text in [Section X - TAG]: ...)',
    '   - DO NOT invent, create, or modify the text - COPY IT EXACTLY as it appears',
    '   - DO NOT return partial text - return the COMPLETE section text as shown',
    '   - DO NOT combine text from multiple sections - pick ONE complete section',
    '   - The section should be LESS than 40% of the total email length',
    '   - Create an improved/enhanced version of that COMPLETE section',
    '   - Return it as a SINGLE edit in the "edits" array (red/green format)',
    '',
    '⚠️ IMPORTANT: The email content is provided for CONTEXT ONLY. You are NOT supposed to return it.',
    'You should pick SMALL, SPECIFIC pieces from it and improve those pieces only.',
    '',
    '⚠️ CRITICAL: WHAT COUNTS AS A "SECTION" (MUST BE COMPLETE AND MUST EXIST):',
    '- A COMPLETE semantically complete unit of content FROM THE SECTIONS SHOWN ABOVE (e.g., a FULL paragraph, a COMPLETE disclaimer block, a COMPLETE CTA section)',
    '- A COMPLETE specific line or phrase FROM THE SECTIONS SHOWN ABOVE (e.g., COMPLETE subject line, COMPLETE CTA button text, COMPLETE header)',
    '- A COMPLETE logical content block FROM THE SECTIONS SHOWN ABOVE (e.g., COMPLETE opening paragraph, COMPLETE closing paragraph, COMPLETE terms section)',
    '- Could be short (1 complete sentence) or longer (a COMPLETE full disclaimer paragraph) - but must be a COMPLETE semantic unit',
    '- NEVER return half a sentence, half a paragraph, or partial text - ALWAYS return the COMPLETE semantic unit',
    '- 🚨 NEVER INVENT TEXT - ONLY use text that appears EXACTLY in the sections shown above',
    '',
    '❌ ABSOLUTELY DO NOT:',
    '- Return the entire email body as a single edit (this is WRONG)',
    '- Return most of the email content (more than 50% of the email)',
    '- Return multiple unrelated sections combined into one edit',
    '- Return edits that are longer than a few paragraphs',
    '- Return PARTIAL sections (half a sentence, half a paragraph, incomplete phrases)',
    '- Return text that cuts off mid-thought or mid-sentence',
    '- Return fragments that don\'t form a complete semantic unit',
    '- 🚨 INVENT, CREATE, OR MAKE UP TEXT - ONLY use text that exists in the sections shown above',
    '- 🚨 Return text that doesn\'t appear in any of the [Section X - TAG] entries shown above',
    '- 🚨 Modify or paraphrase the text when copying it - COPY IT EXACTLY as it appears',
    '',
    '⚠️ IF YOU RETURN THE ENTIRE EMAIL, THE SYSTEM WILL REJECT IT',
    '',
    '✅ DO:',
    '- Focus on COMPLETE, semantically complete sections',
    '- Target high-impact COMPLETE sections: COMPLETE subject lines, COMPLETE CTAs, COMPLETE opening/closing paragraphs, COMPLETE disclaimers, COMPLETE sentences with grammar errors',
    '- Each edit should be a COMPLETE, meaningful unit (could be a COMPLETE sentence, COMPLETE paragraph, or COMPLETE section like a disclaimer)',
    '- Make each edit focused on improving one specific aspect, but ALWAYS include the COMPLETE section',
    '- Ensure the "find" text is a COMPLETE semantic unit that makes sense on its own',
    '',
    'FOCUS ON:',
    '- Specific sentences or phrases that need improvement',
    '- Weak CTAs that can be made more compelling',
    '- Grammar or clarity issues in specific sentences',
    '- Opening lines that can be more engaging',
    '- Subject lines that can be improved',
    '',
    '📋 REQUIRED JSON STRUCTURE (YOU MUST FOLLOW THIS EXACTLY):',
    '{',
    '  "intent": "edit",  // ⚠️ MUST be "edit", NOT "suggest"',
    '  "edits": [{',
    '    "find": "EXACT COMPLETE text from a SPECIFIC COMPLETE section (must be a COMPLETE semantic unit - full sentence, full paragraph, or complete section)",',
    '    "replace": "IMPROVED version of that COMPLETE SPECIFIC section only (must also be COMPLETE)",',
    '    "before_context": "10-40 characters before this section (for matching)",',
    '    "after_context": "10-40 characters after this section (for matching)",',
    '    "reason": "brief explanation of why this improvement helps"',
    '  }],  // ⚠️ MUST return EXACTLY 1 edit in this array - DO NOT use "ideas" array',
    '  "ideas": [],  // ⚠️ MUST be empty array - DO NOT put suggestions here',
    '  "notes": ["I\'ve identified specific sections that would benefit from improvement. Click the Find text to apply each change."]',
    '}',
    '',
    '🚨 CRITICAL: If you return "intent": "suggest" with "ideas" instead of "edits", the system will NOT work correctly.',
    'You MUST return "intent": "edit" with "edits" array containing the specific sections to improve.',
    '',
    '⚠️ CRITICAL RULES:',
    '1. Each "find" must be a SPECIFIC, COMPLETE, SEMANTICALLY COMPLETE section FROM THE SECTIONS SHOWN ABOVE (could be a COMPLETE sentence, COMPLETE paragraph, or COMPLETE section like a disclaimer)',
    '2. 🚨 YOU MUST COPY THE TEXT EXACTLY FROM ONE OF THE [Section X - TAG] ENTRIES SHOWN ABOVE - DO NOT INVENT TEXT',
    '3. DO NOT return the entire email or combine multiple unrelated sections',
    '4. DO NOT return partial sections - ALWAYS return COMPLETE semantic units',
    '5. Return EXACTLY 1 edit - the single most impactful improvement',
    '6. DO NOT use "ideas" array - ONLY use "edits" array',
    '7. Set intent to "edit"',
    '8. Prioritize the highest-impact COMPLETE section FROM THE SECTIONS SHOWN ABOVE (COMPLETE subject line, COMPLETE CTA text, COMPLETE opening/closing paragraphs, COMPLETE disclaimers, COMPLETE sentences with grammar fixes)',
    '9. Choose the ONE COMPLETE section that will make the biggest difference',
    '10. Before returning, verify that your "find" text EXACTLY MATCHES text from one of the [Section X - TAG] entries shown above',
    '11. 🚨 IF YOU CANNOT FIND EXACT TEXT IN THE SECTIONS SHOWN, DO NOT INVENT IT - return an empty edits array instead',
    '',
    '📝 EXAMPLES:',
    '',
    '✅ GOOD (COMPLETE specific sections):',
    'Edit 1: "find": "Click Here", "replace": "Get Started Today" (COMPLETE CTA button text)',
    'Edit 2: "find": "We is excited to announce our new product launch.", "replace": "We are excited to announce our new product launch." (COMPLETE opening sentence)',
    'Edit 3: "find": "By using this service you agree to all terms and conditions. Please read our privacy policy.", "replace": "By using this service, you agree to all terms and conditions. Please read our privacy policy." (COMPLETE disclaimer section)',
    '',
    '❌ BAD (partial/incomplete sections):',
    'Edit: "find": "[entire email body from start to end]", "replace": "[entire improved email body]"',
    'Edit: "find": "We is excited to announ", "replace": "We are excited to announce" (INCOMPLETE - cuts off mid-word)',
    'Edit: "find": "By using this service you agree", "replace": "By using this service, you agree" (INCOMPLETE - missing rest of sentence)',
    '',
    '💡 TONE:',
    '- Be friendly and helpful',
    '- Keep notes brief and actionable',
    '- Focus on small, meaningful improvements that will enhance engagement',
  ].join('\n');
}

function chatSystemPromptWithEdits(): string {
  return [
    'You are a friendly and helpful email QA assistant. The user has PASTED A SECTION from their email and wants it corrected.',
    '',
    '🎯 CRITICAL: User pasted text = they want ONE section-level replacement. Return ONE edit in "edits" array.',
    '',
    '📋 REQUIRED JSON STRUCTURE:',
    '{',
    '  "intent": "edit",',
    '  "edits": [{',
    '    "find": "EXACT pasted text from user (preserve exactly as they pasted it, with all errors)",',
    '    "replace": "CORRECTED version of the pasted text (fix all grammar, spelling, punctuation errors)",',
    '    "before_context": "10-40 characters that appear before this section in the email",',
    '    "after_context": "10-40 characters that appear after this section in the email",',
    '    "reason": "brief explanation of corrections made"',
    '  }],',
    '  "ideas": [],  // MUST be empty array',
    '  "notes": ["I\'ve prepared the corrected version below. Click the Find text to replace the entire section."]',
    '}',
    '',
    '⚠️ CRITICAL RULES:',
    '1. User PASTED a section = they want to replace the ENTIRE pasted section',
    '2. "find" = EXACT text the user pasted (preserve spacing, punctuation, line breaks exactly)',
    '3. "replace" = CORRECTED version of that exact text (fix all errors but keep same structure)',
    '4. Return ONLY ONE edit - the entire section replacement',
    '5. DO NOT break it into multiple edits - ONE section = ONE edit',
    '6. DO NOT put this in "ideas" array - ONLY use "edits" array',
    '7. Set intent to "edit"',
    '8. Keep "ideas" array EMPTY',
    '',
    '📝 EXAMPLES:',
    '',
    'User PASTES this text:',
    '"We is so excited to have you joined our community. Your going to love all the amazing feature we has to offer."',
    '',
    'Response (ONE edit - entire section replacement):',
    '{',
    '  "intent": "edit",',
    '  "edits": [{',
    '    "find": "We is so excited to have you joined our community. Your going to love all the amazing feature we has to offer.",',
    '    "replace": "We are so excited to have you join our community. You\'re going to love all the amazing features we have to offer.",',
    '    "before_context": "",',
    '    "after_context": "",',
    '    "reason": "Fix grammar, spelling, and contractions"',
    '  }],',
    '  "ideas": [],',
    '  "notes": ["I\'ve prepared the corrected version below. Click the Find text to replace the entire section."]',
    '}',
    '',
    'User PASTES:',
    '"Thank you for joining! We hope you enjoy our service."',
    '',
    'Response: ONE edit with pasted text as "find" and corrected version as "replace"',
    '',
    '💡 KEY POINT:',
    '- User pastes text = they want to replace that EXACT text',
    '- Return ONE edit with pasted text as "find" and corrected as "replace"',
    '- Works exactly like failed edits: red block = original, green block = corrected',
    '',
    '💡 TONE:',
    '- Be friendly and helpful',
    '- Keep notes brief and actionable',
    '- Focus on providing accurate edits',
  ].join('\n');
}

router.post('/template/grammar-check', async (req: Request, res: Response) => {
  try {
    const html: string = String(req.body?.html || '').trim();
    
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
      response_format: { type: 'json_object' as const }
    });

    let mistakes: Array<{ word: string; suggestion: string; context: string }> = [];
    
    try {
      const raw = completion.choices[0]?.message?.content || '{"mistakes":[]}';
      const parsed: unknown = JSON.parse(raw);
      
      if (parsed && typeof parsed === 'object') {
        const m = (parsed as any).mistakes;
        if (Array.isArray(m)) {
          mistakes = m.map((item: any) => ({
            word: String(item?.word || ''),
            suggestion: String(item?.suggestion || ''),
            context: String(item?.context || '')
          })).filter(item => item.word && item.suggestion);
        }
      }
    } catch (_e: unknown) {}

    const hasErrors = mistakes.length > 0;

    res.json({
      hasErrors,
      mistakes,
      count: mistakes.length,
      message: hasErrors 
        ? `Found ${mistakes.length} spelling mistake${mistakes.length > 1 ? 's' : ''}`
        : 'No spelling mistakes found'
    });

  } catch (err: unknown) {
    res.status(500).json({ 
      code: 'GRAMMAR_CHECK_ERROR', 
      message: errMsg(err) 
    });
  }
});

router.post('/variants/:runId/chat/message', async (req: Request, res: Response) => {
  try {
    const runId: string = String(req.params.runId);
    const no: number = Number(req.body?.no ?? 1);
    const html: string = String(req.body?.html || '').trim();
    const history: ChatTurn[] = Array.isArray(req.body?.history) ? req.body.history : [];
    const userMessage: string = String(req.body?.userMessage || '').trim();

    if (!userMessage) {
      return res.status(400).json({ code: 'CHAT_BAD_REQUEST', message: 'userMessage is required' });
    }
    if (!html) {
      return res.status(400).json({ code: 'CHAT_BAD_REQUEST', message: 'html is required (current variant HTML)' });
    }

    // For auto-recommendation, use semantic sections to help AI understand structure
    // Also keep raw HTML for context extraction
    const $html = cheerio.load(html);
    const htmlBodyText = $html('body').text();

    // Detection logic - use plain text for detection first
    const plainTextContext = visibleTextForChat(html);
    const userMessageLower = userMessage.toLowerCase();
    const hasQuotes = /['"]/.test(userMessage);
    const isLongText = userMessage.length > 30; // Lowered threshold
    const hasMultipleSentences = (userMessage.match(/[.!?]/g) || []).length > 1;
    const hasMultipleWords = userMessage.trim().split(/\s+/).length > 5;

    // Check if user message content matches content in the email (for pasted sections)
    const userWords = new Set<string>(userMessage.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
    const contextWords = new Set<string>(plainTextContext.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
    const matchingWords = [...userWords].filter((word: string) => contextWords.has(word));
    const hasMatchingContent = matchingWords.length >= 3; // At least 3 common words

    // Auto-recommendation request patterns (user wants AI to pick sections to improve)
    // Check these FIRST before replacement keywords to avoid false positives
    const autoRecommendationPatterns = [
      /^suggest\s+(changes?|improvements?|recommendations?)/i,  // Starts with "suggest"
      /suggest\s+(changes?|improvements?|recommendations?)\s+to\s+(a\s+)?section/i,  // "suggest changes to a section"
      /^recommend\s+(changes?|improvements?|suggestions?)/i,  // Starts with "recommend"
      /what\s+(should|can)\s+(i\s+)?(improve|change|fix)/i,
      /(any|some)\s+(suggestions?|recommendations?|improvements?)\s+(for|to)/i,
      /(give|provide|show)\s+(me\s+)?(some\s+)?(suggestions?|recommendations?|improvements?)/i,
      /how\s+(can|should)\s+(i\s+)?(improve|enhance|make\s+better)/i,
    ];
    
    const hasAutoRecommendationPattern = autoRecommendationPatterns.some(pattern => pattern.test(userMessage));
    
    // Also check if message starts with "suggest" or "recommend" - these are almost always auto-recommendation requests
    const startsWithSuggestionKeyword = /^(suggest|recommend)/i.test(userMessage);
    
    // Auto-recommendation: user asks for suggestions but doesn't paste text or specify section
    // Also include messages that start with "suggest" or "recommend" (they're asking for AI to pick sections)
    const isAutoRecommendationRequest: boolean = (hasAutoRecommendationPattern || startsWithSuggestionKeyword) && !isLongText && !hasMatchingContent;

    // Replacement keywords (but exclude if it's an auto-recommendation request)
    // Only check for replacement if message doesn't start with "suggest" or "recommend"
    const startsWithSuggestion = /^(suggest|recommend)/i.test(userMessage);
    const hasReplacementKeywords = !isAutoRecommendationRequest && !startsWithSuggestion && (
      userMessageLower.includes('replace') ||
      userMessageLower.includes('change') ||
      userMessageLower.includes('fix') ||
      userMessageLower.includes('correct') ||
      userMessageLower.includes('update') ||
      userMessageLower.includes('revise') ||
      userMessageLower.includes('should be') ||
      userMessageLower.includes('to be') ||
      userMessageLower.includes('correct this') ||
      userMessageLower.includes('fix this') ||
      userMessageLower.includes('fix:') ||
      userMessageLower.includes('correct:') ||
      userMessage.includes('→') ||
      userMessage.includes('->')
    );
    
    // User pasted a section = long text OR text that matches email content OR has quotes
    const isPastedSection = (isLongText && (hasMultipleSentences || hasQuotes || hasMultipleWords)) || hasMatchingContent;
    
    // User explicitly requests replacement (but not auto-recommendation)
    const isExplicitReplacement = hasReplacementKeywords && !isAutoRecommendationRequest;
    
    const isReplacementRequest = isPastedSection || isExplicitReplacement;

    // Use appropriate prompt based on detection
    let systemPrompt: string;
    let promptMode: string;
    
    if (isAutoRecommendationRequest) {
      // User wants AI to automatically identify sections to improve
      systemPrompt = chatSystemPromptForAutoRecommendations();
      promptMode = 'AUTO-RECOMMENDATION EDITS MODE';
    } else if (isReplacementRequest) {
      // User pasted text or explicitly requested replacement
      systemPrompt = chatSystemPromptWithEdits();
      promptMode = 'EDITS MODE (PASTED TEXT)';
    } else {
      // General suggestions (text-based, not edits)
      systemPrompt = chatSystemPrompt();
      promptMode = 'SUGGESTIONS MODE';
    }

    // Extract context based on request type (after detection is complete)
    const context: string = isAutoRecommendationRequest 
      ? extractSemanticSections(html)
      : plainTextContext;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: isAutoRecommendationRequest
        ? `Email content organized by semantic sections:\n\n${context || 'No visible text.'}\n\nIMPORTANT: Each section above is a COMPLETE semantic unit. When you identify a section to improve, return the COMPLETE text of that entire section in the "find" field.`
        : `Visible text (for context):\n${context || 'No visible text.'}`
      },
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
      response_format: { type: 'json_object' as const },
    });

    let assistantText = '';
    let json: ChatAssistantJson = { intent: 'suggest', ideas: [] };
    try {
      const raw = completion.choices[0]?.message?.content || '{"intent":"suggest"}';
      
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as any;
        
        // ✅ IMPROVED: Better formatting for different intents
        const hasIdeas = Array.isArray(obj.ideas) && obj.ideas.length > 0;
        const hasNotes = Array.isArray(obj.notes) && obj.notes.length > 0;
        const hasEdits = Array.isArray(obj.edits) && obj.edits.length > 0;
        
        // Parse edits from response
        let edits = Array.isArray(obj.edits)
          ? obj.edits.map((e: any) => ({
              find: String(e?.find ?? ''),
              replace: String(e?.replace ?? ''),
              before_context: String(e?.before_context ?? ''),
              after_context: String(e?.after_context ?? ''),
              reason: e?.reason != null ? String(e.reason) : undefined,
            })).filter((e: any) => e.find && e.replace)
          : [];
        
        // 🚨 VALIDATION: For auto-recommendation, validate that sections exist in HTML before displaying
        if (isAutoRecommendationRequest && edits.length > 0) {
          const emailLength = htmlBodyText.length;
          const emailTextLower = htmlBodyText.toLowerCase().trim();
          
          edits = edits.filter((e: any) => {
            const findText = e.find.trim();
            const findTextLower = findText.toLowerCase();
            const findLength = findText.length;
            
            // Check 0: CRITICAL - Verify "find" text exists in the HTML (with smart matching)
            // This prevents showing edits that can't be applied, but allows for reasonable variations
            // Normalize both texts for comparison (collapse whitespace, trim)
            const normalizedFind = findText.replace(/\s+/g, ' ').trim();
            const normalizedHtml = htmlBodyText.replace(/\s+/g, ' ').trim();
            const normalizedHtmlLower = normalizedHtml.toLowerCase();
            const normalizedFindLower = normalizedFind.toLowerCase();
            
            // Try multiple matching strategies (must match in at least one way)
            const exactMatch = htmlBodyText.includes(findText);
            const normalizedExactMatch = normalizedHtml.includes(normalizedFind);
            const caseInsensitiveMatch = emailTextLower.includes(findTextLower);
            const normalizedCaseInsensitiveMatch = normalizedHtmlLower.includes(normalizedFindLower);
            
            // Also check the raw HTML (not just extracted text) in case text extraction missed something
            const $check = cheerio.load(html);
            $check('script, style, noscript').remove();
            const rawHtmlText = $check('body').text().replace(/\s+/g, ' ').trim();
            const rawHtmlTextLower = rawHtmlText.toLowerCase();
            const rawHtmlMatch = rawHtmlText.includes(findText) || rawHtmlTextLower.includes(findTextLower);
            
            // Try exact matches first
            let textExists = exactMatch || normalizedExactMatch || caseInsensitiveMatch || normalizedCaseInsensitiveMatch || rawHtmlMatch;
            let matchedText = findText; // Keep original if exact match found
            
            // If no exact match, try to find the closest match (fuzzy matching for auto-recommendation)
            if (!textExists && findLength > 20) {
              // Find the longest substring that exists in the email
              // This handles cases where AI returns text with slight variations
              let bestMatch = '';
              let bestMatchLength = 0;
              
              // Try finding the text in chunks (sliding window approach)
              const words = normalizedFindLower.split(/\s+/);
              for (let start = 0; start < words.length; start++) {
                for (let end = words.length; end > start; end--) {
                  const chunk = words.slice(start, end).join(' ');
                  if (chunk.length > bestMatchLength && normalizedHtmlLower.includes(chunk)) {
                    // Found a matching chunk, try to extend it
                    const chunkIndex = normalizedHtmlLower.indexOf(chunk);
                    // Try to get more context around the match
                    const contextStart = Math.max(0, chunkIndex - 50);
                    const contextEnd = Math.min(normalizedHtmlLower.length, chunkIndex + chunk.length + 50);
                    const contextText = normalizedHtmlLower.substring(contextStart, contextEnd);
                    
                    // Check if we can match a larger portion
                    if (contextText.includes(chunk) && chunk.length > bestMatchLength) {
                      bestMatch = chunk;
                      bestMatchLength = chunk.length;
                    }
                  }
                }
              }
              
              // If we found a good match (at least 70% of the original text), use it
              if (bestMatchLength > 0 && (bestMatchLength / normalizedFindLower.length) >= 0.7) {
                // Find the actual text from HTML (preserving case and formatting)
                const bestMatchIndex = normalizedHtmlLower.indexOf(bestMatch);
                if (bestMatchIndex !== -1) {
                  // Get the actual text from the original HTML (not normalized)
                  const actualStart = Math.max(0, bestMatchIndex - 100);
                  const actualEnd = Math.min(normalizedHtml.length, bestMatchIndex + bestMatch.length + 100);
                  const actualText = normalizedHtml.substring(actualStart, actualEnd);
                  
                  // Try to find the exact boundaries
                  const matchInActual = actualText.toLowerCase().indexOf(bestMatch);
                  if (matchInActual !== -1) {
                    // Extract the matched portion, trying to get complete words
                    const beforeMatch = actualText.substring(0, matchInActual);
                    const afterMatch = actualText.substring(matchInActual + bestMatch.length);
                    const wordBefore = beforeMatch.match(/\S+\s*$/)?.[0] || '';
                    const wordAfter = afterMatch.match(/^\s*\S+/)?.[0] || '';
                    const extendedMatch = (wordBefore + bestMatch + wordAfter).trim();
                    
                    // Update the find text to match what actually exists
                    e.find = extendedMatch.length > 0 && extendedMatch.length <= findText.length * 1.5 
                      ? extendedMatch 
                      : findText; // Fallback to original if extended is too different
                    
                    textExists = true;
                  }
                }
              }
            }
            
            if (!textExists) {
              console.warn('⚠️ [CHAT] Rejected edit - find text does not exist in email (even with fuzzy matching):', {
                findText: findText.substring(0, 100) + (findText.length > 100 ? '...' : ''),
                findLength,
                exactMatch,
                normalizedExactMatch,
                caseInsensitiveMatch,
                normalizedCaseInsensitiveMatch,
                rawHtmlMatch,
                reason: 'AI suggested text that does not exist in the email - cannot be applied even with fuzzy matching'
              });
              return false;
            }
            
            // Additional verification: Count occurrences to ensure it's actually there
            const finalFindText = e.find || findText;
            const finalFindLower = finalFindText.toLowerCase().replace(/\s+/g, ' ').trim();
            const occurrences = (normalizedHtmlLower.match(new RegExp(escapeRegex(finalFindLower), 'g')) || []).length;
            
            if (occurrences === 0 && !rawHtmlMatch) {
              console.warn('⚠️ [CHAT] Rejected edit - find text not found after all matching attempts:', {
                findText: findText.substring(0, 100) + (findText.length > 100 ? '...' : ''),
                finalFindText: finalFindText.substring(0, 100) + (finalFindText.length > 100 ? '...' : ''),
                reason: 'Text does not exist even after normalization and fuzzy matching'
              });
              return false;
            }
            
            // Check 1: Reject if edit is > 40% of email (too large for a "section")
            const sizeThreshold = emailLength * 0.4; // Max 40% of email
            if (findLength > sizeThreshold) {
              console.warn('⚠️ [CHAT] Rejected edit - too large:', {
                findLength,
                emailLength,
                percentage: ((findLength / emailLength) * 100).toFixed(1) + '%',
                threshold: sizeThreshold,
                findPreview: findText.substring(0, 150) + '...',
                reason: 'Edit is too large - should be a specific section, not most of the email'
              });
              return false;
            }
            
            // Check 2: Reject if "find" text matches most of the email content (likely entire email)
            // Check if find text contains most of the email's unique words
            const emailWords = new Set<string>(emailTextLower.split(/\s+/).filter((w: string) => w.length > 3));
            const findWordsSet = new Set<string>(findTextLower.split(/\s+/).filter((w: string) => w.length > 3));
            const matchingWords = Array.from(findWordsSet).filter((word: string) => emailWords.has(word));
            const wordMatchRatio = emailWords.size > 0 ? matchingWords.length / emailWords.size : 0;
            
            // If find text contains > 60% of email's unique words, it's likely the entire email
            if (wordMatchRatio > 0.6 && findLength > 500) {
              console.warn('⚠️ [CHAT] Rejected edit - matches most of email content:', {
                findLength,
                wordMatchRatio: (wordMatchRatio * 100).toFixed(1) + '%',
                matchingWords: matchingWords.length,
                totalEmailWords: emailWords.size,
                findPreview: findText.substring(0, 150) + '...',
                reason: 'Edit contains most of the email - should be a specific section only'
              });
              return false;
            }
            
            // Check 3: Reject if before_context contains system message text (AI confusion)
            if (e.before_context && (e.before_context.includes('Visible text') || e.before_context.includes('for context'))) {
              console.warn('⚠️ [CHAT] Rejected edit - before_context contains system message:', {
                before_context: e.before_context,
                findPreview: findText.substring(0, 150) + '...',
                reason: 'AI included system message in context - likely confused'
              });
              return false;
            }
            
            return true;
          });
          
          // Limit to only 1 edit (the first valid one)
          if (edits.length > 1) {
            edits = [edits[0]]; // Only keep the first valid edit
          }
          
          if (edits.length === 0) {
            console.warn('⚠️ [CHAT] All edits rejected - attempting to find best match from AI response...');
            
            // If all edits were rejected, try to salvage one by finding the closest match
            // This ensures we always return a suggestion
            if (Array.isArray(obj.edits) && obj.edits.length > 0) {
              const originalEdit = obj.edits[0];
              const originalFind = String(originalEdit?.find || '').trim();
              
              if (originalFind.length > 0) {
                // Try to find the closest matching text in the email
                const originalFindLower = originalFind.toLowerCase().replace(/\s+/g, ' ');
                const emailWords = originalFindLower.split(/\s+/).filter((w: string) => w.length > 2);
                
                // Find sections that contain at least 50% of the words from the AI's suggestion
                const sections = extractSemanticSections(html).split('\n\n');
                let bestMatch = '';
                let bestMatchScore = 0;
                
                for (const section of sections) {
                  const sectionText = section.replace(/^\[Section \d+ - \w+\]:\s*/, '').toLowerCase().replace(/\s+/g, ' ');
                  const sectionWords = sectionText.split(/\s+/).filter((w: string) => w.length > 2);
                  const matchingWords = emailWords.filter((word: string) => sectionWords.includes(word));
                  const matchScore = emailWords.length > 0 ? matchingWords.length / emailWords.length : 0;
                  
                  if (matchScore > bestMatchScore && matchScore >= 0.5) {
                    bestMatch = section.replace(/^\[Section \d+ - \w+\]:\s*/, '').trim();
                    bestMatchScore = matchScore;
                  }
                }
                
                // If we found a good match, create an edit with it
                if (bestMatch && bestMatchScore >= 0.5) {
                  const normalizedBestMatch = bestMatch.replace(/\s+/g, ' ').trim();
                  const normalizedHtml = htmlBodyText.replace(/\s+/g, ' ').trim();
                  
                  if (normalizedHtml.toLowerCase().includes(normalizedBestMatch.toLowerCase())) {
                    // Create an improved version (simple improvement)
                    const improved = normalizedBestMatch
                      .replace(/\s+/g, ' ')
                      .replace(/\s+([,.!?])/g, '$1') // Fix spacing before punctuation
                      .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between words
                      .trim();
                    
                    edits = [{
                      find: normalizedBestMatch,
                      replace: improved !== normalizedBestMatch ? improved : normalizedBestMatch + ' (improved)',
                      before_context: '',
                      after_context: '',
                      reason: 'Suggested improvement for this section'
                    }];
                  }
                }
              }
            }
          }
        }
        
        // 🚨 FALLBACK: If we detected a paste/replacement/auto-recommendation request but AI returned suggestions, convert them to edits
        const needsEdits = isReplacementRequest || isAutoRecommendationRequest;
        if (needsEdits && edits.length === 0 && hasIdeas) {
          let correctedText: string | null = null;
          let pastedText: string | null = null;

          // For auto-recommendation requests, try to extract edits from ideas by finding text in the email
          if (isAutoRecommendationRequest && !isPastedSection) {
            // Try to find quoted text in ideas that matches email content
            for (const idea of obj.ideas) {
              // Look for patterns like "Change 'X' to 'Y'" or "'X' should be 'Y'"
              const changePatterns = [
                /change\s+['"]([^'"]{10,})['"]\s+to\s+['"]([^'"]{10,})['"]/i,
                /['"]([^'"]{10,})['"]\s+should\s+be\s+['"]([^'"]{10,})['"]/i,
                /replace\s+['"]([^'"]{10,})['"]\s+with\s+['"]([^'"]{10,})['"]/i,
                /['"]([^'"]{10,})['"]\s+→\s+['"]([^'"]{10,})['"]/i,
                /['"]([^'"]{10,})['"]\s+->\s+['"]([^'"]{10,})['"]/i,
              ];
              
              for (const pattern of changePatterns) {
                const match = idea.match(pattern);
                if (match && match[1] && match[2]) {
                  const findText = match[1].trim();
                  const replaceText = match[2].trim();
                  
                  // Check if findText exists in the email
                  if (htmlBodyText.includes(findText)) {
                    const contextIndex = htmlBodyText.indexOf(findText);
                    const beforeContext = contextIndex > 0 
                      ? htmlBodyText.substring(Math.max(0, contextIndex - 40), contextIndex).trim()
                      : '';
                    const afterContext = htmlBodyText.substring(
                      contextIndex + findText.length, 
                      Math.min(htmlBodyText.length, contextIndex + findText.length + 40)
                    ).trim();
                    
                    edits.push({
                      find: findText,
                      replace: replaceText,
                      before_context: beforeContext,
                      after_context: afterContext,
                      reason: 'Suggested improvement'
                    });
                  }
                }
              }
              
              // Also try to find quoted strings and see if first one exists in email, second is replacement
              const quotedStrings = idea.match(/['"]([^'"]{10,})['"]/g);
              if (quotedStrings && quotedStrings.length >= 2) {
                const firstQuote = quotedStrings[0].replace(/['"]/g, '').trim();
                const secondQuote = quotedStrings[1].replace(/['"]/g, '').trim();
                
                if (htmlBodyText.includes(firstQuote) && firstQuote !== secondQuote) {
                  const contextIndex = htmlBodyText.indexOf(firstQuote);
                  const beforeContext = contextIndex > 0 
                    ? htmlBodyText.substring(Math.max(0, contextIndex - 40), contextIndex).trim()
                    : '';
                  const afterContext = htmlBodyText.substring(
                    contextIndex + firstQuote.length, 
                    Math.min(htmlBodyText.length, contextIndex + firstQuote.length + 40)
                  ).trim();
                  
                  edits.push({
                    find: firstQuote,
                    replace: secondQuote,
                    before_context: beforeContext,
                    after_context: afterContext,
                    reason: 'Suggested improvement'
                  });
                }
              }
            }
          }

          // Try to extract pasted text from user message (quoted or plain long text)
          const userMessageQuotedMatch = userMessage.match(/['"]([^'"]{20,})['"]/);
          if (userMessageQuotedMatch) {
            pastedText = userMessageQuotedMatch[1];
          } else if (isPastedSection && userMessage.length > 30) { // If it's a pasted section but not quoted
            pastedText = userMessage;
          }

          if (pastedText) {
            // Try to find a corrected version in the ideas text
            if (hasIdeas) {
              // Look for "Change 'X' to 'Y'" pattern
              for (const idea of obj.ideas) {
                const changeMatch = idea.match(/change\s+['"]([^'\"]+?)['\"]\s+to\s+['"]([^'\"]+?)['\"]/i);
                if (changeMatch && changeMatch[1] === pastedText && changeMatch[2]) {
                  correctedText = changeMatch[2];
                  break;
                }
                
                // Look for quoted strings where first matches pasted text
                const quotedStrings = idea.match(/['"]([^'\"]{10,})['\"]/g);
                if (quotedStrings && quotedStrings.length > 1) {
                  const firstQuote = quotedStrings[0].replace(/['\"]/g, '');
                  if (firstQuote === pastedText) {
                    const lastQuote = quotedStrings[quotedStrings.length - 1].replace(/['\"]/g, '');
                    if (lastQuote) {
                      correctedText = lastQuote;
                      break;
                    }
                  }
                }
              }
            }
            
            // If no correction found in ideas, try to find similar corrected text
            if (!correctedText && pastedText && hasIdeas) {
              for (const idea of obj.ideas) {
                const textSegments = idea.match(/['"]([^'\"]{20,})['\"]/g);
                if (textSegments) {
                  for (const segment of textSegments) {
                    const segmentText = segment.replace(/['\"]/g, '');
                    if (segmentText && Math.abs(segmentText.length - pastedText.length) < 10 && segmentText !== pastedText) {
                      correctedText = segmentText;
                      break;
                    }
                  }
                }
              }
            }
            
            // Create edit with pasted text and correction
            if (pastedText) {
              const contextIndex = htmlBodyText.indexOf(pastedText);
              if (contextIndex !== -1) {
                // Extract better context (20-50 chars before/after for better matching)
                const beforeContext = contextIndex > 0 
                  ? htmlBodyText.substring(Math.max(0, contextIndex - 50), contextIndex).trim()
                  : '';
                const afterContext = htmlBodyText.substring(
                  contextIndex + pastedText.length, 
                  Math.min(htmlBodyText.length, contextIndex + pastedText.length + 50)
                ).trim();
                
                // Check if the find text is unique in the HTML body text
                const occurrences = (htmlBodyText.match(new RegExp(escapeRegex(pastedText), 'g')) || []).length;
                const useContext = occurrences > 1; // Only use context if multiple occurrences

                edits = [{
                  find: pastedText,
                  replace: (correctedText ?? pastedText), // Use correction if found, otherwise same (user can edit)
                  before_context: useContext ? beforeContext : '',
                  after_context: useContext ? afterContext : '',
                  reason: correctedText ? 'Corrected based on AI suggestion' : 'User requested replacement'
                }];
              } else {
                console.warn('⚠️ [CHAT] Pasted text not found in HTML body text for context extraction.');
              }
            } else {
              console.warn('⚠️ [CHAT] No valid pasted text extracted for conversion.');
            }
          }
        }

        // Build friendly assistant text
        const parts: string[] = [];
        
        // Check if we have edits (including converted ones)
        const hasValidEdits = edits.length > 0;
        
        // If edits exist, prioritize them and keep message minimal
        if (hasValidEdits) {
          assistantText = json.notes?.[0] || 'I\'ve prepared the corrected version below. Click the Find text to replace the entire section.';
          json.intent = 'edit'; // Force intent to edit if we have valid edits
          json.ideas = []; // Clear ideas if we have edits
        } else if (isAutoRecommendationRequest && edits.length === 0) {
          // Last resort: If still no edits, pick the first semantic section and suggest an improvement
          // This ensures we always return something
          const sections = extractSemanticSections(html).split('\n\n').filter((s: string) => s.trim().length > 0);
          
          if (sections.length > 0) {
            // Get the first meaningful section
            const firstSection = sections[0].replace(/^\[Section \d+ - \w+\]:\s*/, '').trim();
            const normalizedSection = firstSection.replace(/\s+/g, ' ').trim();
            const normalizedHtml = htmlBodyText.replace(/\s+/g, ' ').trim();
            
            if (normalizedHtml.toLowerCase().includes(normalizedSection.toLowerCase())) {
              // Create a simple improvement suggestion
              const improved = normalizedSection
                .replace(/\s+([,.!?])/g, '$1') // Fix spacing before punctuation
                .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between words
                .trim();
              
              edits = [{
                find: normalizedSection,
                replace: improved !== normalizedSection ? improved : normalizedSection,
                before_context: '',
                after_context: '',
                reason: 'Suggested improvement for this section'
              }];
              
              assistantText = 'I\'ve identified a section that could be improved. Click the Find text to apply the change.';
              json.intent = 'edit';
              json.ideas = [];
              json.notes = [];
            }
          }
          
          // If still no edits after fallback, show helpful message
          if (edits.length === 0) {
            assistantText = 'I couldn\'t find any sections to improve. Please try copy-pasting a specific section you\'d like me to improve.';
            json.intent = 'suggest';
            json.ideas = [];
            json.edits = [];
            json.notes = [];
          }
        } else {
          // Original logic for suggestions/notes (for non-auto-recommendation requests)
          if (hasIdeas) {
            // Format ideas nicely
            if (obj.ideas.length === 1) {
              parts.push(obj.ideas[0]);
            } else {
              parts.push(obj.ideas.map((s: any, i: number) => 
                obj.ideas.length > 3 ? `${i + 1}. ${s}` : `• ${s}`
              ).join('\n\n'));
            }
          }
          
          // Only show notes if we have ideas OR if it's not an auto-recommendation request
          // (for auto-recommendation, we already handled it above)
          if (hasNotes && !isAutoRecommendationRequest) {
            // Add notes (questions, friendly messages) - can appear with or without ideas
            parts.push(obj.notes.join('\n\n'));
          }
          
          assistantText = parts.length > 0 
            ? parts.join('\n\n')
            : 'Got it! Let me know if you need anything else.';
        }
        
        // Set intent based on whether we have edits
        const finalIntent = hasValidEdits ? 'edit' : (obj.intent || 'suggest');
        
        json = {
          intent: finalIntent as ChatIntent,
          ideas: hasValidEdits ? [] : (Array.isArray(obj.ideas) ? obj.ideas.map((s: any) => String(s || '')) : []), // Clear ideas if we have edits
          edits: edits, // ✅ Enable edits when user requests text replacements (including converted ones)
          targets: Array.isArray(obj.targets) ? obj.targets.map((s: any) => String(s || '')) : [],
          notes: Array.isArray(obj.notes) ? obj.notes.map((s: any) => String(s || '')) : [],
        };
      }
    } catch (_e: unknown) { /* ignore parse error; return default */ }

    return res.json({ assistantText, json });
  } catch (err: unknown) {
    res.status(500).json({ code: 'CHAT_ERROR', message: errMsg(err) });
  }
});

router.post('/variants/:runId/chat/apply', async (req: Request, res: Response) => {
  try {
    const html: string = String(req.body?.html || '');
    const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
    if (!html) return res.status(400).json({ code: 'CHAT_APPLY_BAD_REQUEST', message: 'html is required' });

    const atomicResult = applyContextEdits(html, edits);

    // ✅ Extract results
    const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
    const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
    const changes = appliedEdits.map(r => r.change!).filter(Boolean);

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
  } catch (err: unknown) {
    res.status(500).json({ code: 'CHAT_APPLY_ERROR', message: errMsg(err) });
  }
});

router.post('/snap', async (req: Request, res: Response) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ url, ok: false, error: 'Invalid URL' });
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (compatible; Variant-Snap/1.0)');

    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 }).catch(() => null);
    await delay(500);

    const buf = (await page.screenshot({ fullPage: true, type: 'jpeg', quality: 80 })) as Buffer;
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;

    res.json({
      url,
      ok: !resp || resp.status() < 400,
      status: resp?.status(),
      finalUrl: page.url(),
      dataUrl,
    });
  } catch (err: unknown) {
    res.status(500).json({ url, ok: false, error: errMsg(err) });
  } finally {
    try { await browser?.close(); } catch {}
  }
});

export default router;
