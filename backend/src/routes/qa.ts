import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import GeneratedTemplate from '@src/models/GeneratedTemplate';

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
    skipped: number;
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
    "You are a copy editor. Only fix grammar, spelling, punctuation, capitalization, and duplicated words.",
    "DO NOT change numbers, prices, product/brand names, URLs, merge tags (e.g., *|FNAME|*), or tracking codes.",
    'Return ONLY valid JSON matching this schema:',
    "",
    '{"edits":[{"find":"<exact substring from input text node>",',
    '           "replace":"<final corrected text>",',
    '           "before_context":"<10-40 chars from before the find>",',
    '           "after_context":"<10-40 chars from after the find>",',
    '           "reason":"<short>"}]}',
    "",
    "Rules:",
    "- 'find' and contexts must be copied EXACTLY from the input text (no HTML).",
    "- Keep edits minimal; don't rewrite tone or meaning.",
    "- ✅ CRITICAL: Make separate edits for text that appears to cross link boundaries.",
    "- ✅ Example: If 'ew single, Bagel wah over us' has errors, make TWO edits SEPERATELY:",
    "  1) 'ew single' → 'new single' (inside link)",
    "  2) 'wah over us' → 'wash over us' (outside link)",
    "  3) *ALWAYS AIM FOR ONE EDIT ONLY SENTENCE 1 HAS $ MISTAKES should AIM for 4 different edits*",
    "4) understand the difference between the headings and normal text you are mixing the edits. edits should be seperately for each tag.",
    "- Max 30 edits per request.",
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
    console.log('⚠️ No affected nodes found');
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
      console.log('🚫 Rejected: crosses interactive boundary');
      return false;
    }
    
    const uniqueInteractive = new Set(interactiveParents.filter(p => p !== null));
    if (uniqueInteractive.size > 1) {
      console.log('🚫 Rejected: multiple interactive elements');
      return false;
    }
  }
  
  try {
    if (affectedNodes.length === 1) {
      const { node, localStart, localEnd } = affectedNodes[0];
      const original = String(node.data || '');
      
      console.log(`  Single node: "${original.substring(localStart, localEnd)}" → "${replacement}"`);
      
      node.data = original.substring(0, localStart) + replacement + original.substring(localEnd);
      
      return true;
      
    } else {
      console.log(`  Multi-node (${affectedNodes.length} nodes)`);
      
      const first = affectedNodes[0];
      const firstOriginal = String(first.node.data || '');
      first.node.data = firstOriginal.substring(0, first.localStart) + replacement;
      
      console.log(`  First: "${firstOriginal}" → "${first.node.data}"`);
      
      for (let i = 1; i < affectedNodes.length - 1; i++) {
        const middle = affectedNodes[i];
        const middleOriginal = String(middle.node.data || '');
        middle.node.data = '';
        console.log(`  Middle[${i}]: "${middleOriginal}" → ""`);
      }
      
      const last = affectedNodes[affectedNodes.length - 1];
      const lastOriginal = String(last.node.data || '');
      last.node.data = lastOriginal.substring(last.localEnd);
      
      console.log(`  Last: "${lastOriginal}" → "${last.node.data}"`);
      
      return true;
    }
  } catch (error) {
    console.error('❌ Error in applyReplacementToNodes:', error);
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
  console.log('\n🔧 [ATOMIC] Starting atomic verification for', edits.length, 'edits');
  
  const parseStart = Date.now();
  const $ = (cheerio as any).load(html, { decodeEntities: false });
  const parseTime = Date.now() - parseStart;
  console.log('📄 [ATOMIC] HTML parsed in', parseTime, 'ms');
  
  const deny = deniedParents();
  const results: EditResult[] = [];
  
  let appliedCount = 0;
  let failedCount = 0;
  let blockedCount = 0;
  let skippedCount = 0;
  
  const processingStart = Date.now();
  
  edits.forEach((originalEdit, index) => {
    const editStart = Date.now();
    console.log(`\n--- [EDIT ${index + 1}/${edits.length}] ---`);
    console.log('Find:', originalEdit.find?.substring(0, 50));
    console.log('Replace:', originalEdit.replace?.substring(0, 50));
    
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
      console.log('⏭️ [SKIP] Empty find or replace');
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
      console.log('⏭️ [SKIP] Find equals replace');
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
      console.log('🚫 [BLOCKED] Contains URL');
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
      console.log('🚫 [BLOCKED] Contains merge tag');
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
    
    console.log('🔍 [SEARCH] Raw occurrences:', rawOccurrences, '| Normalized:', normalizedOccurrences);

    if (rawOccurrences === 0 && normalizedOccurrences === 0) {
      console.log('❌ [NOT_FOUND] Text does not exist in HTML');
      diagnostics.timings!.search = Date.now() - searchStart;
      
      diagnostics.manualFixGuidance = {
        strategy: 'not-found',
        recommendation: 'Text may have already been corrected, or GPT hallucinated this error.',
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
        reason: 'Text not found in HTML - GPT may have hallucinated or text was already corrected',
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
  console.log('✅ [CONTEXT] Matched in', tag, 'tag');
  
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
  console.log(`💾 [BACKUP] Saved ${originalNodeStates.length} node(s) original state`);
  
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
    
    console.log('🔍 [BOUNDARY] Text spans across:', spanningElements.join(' → '));
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
    
    console.log(`  Verification: oldTextGone=${oldTextGone}, newTextPresent=${newTextPresent}, allWordsPresent=${allWordsPresent}`);
    
    if (verificationPassed) {
      console.log('✅ [APPLIED] Successfully applied and verified');
      applied = true;
      appliedTag = tag;
      return false; // Stop iteration
    } else {
      // ✅ NEW: ROLLBACK on verification failure
      console.log('⚠️ [VERIFY_FAIL] Verification failed - ROLLING BACK changes');
      console.log(`   Find text still present: ${newFullText.includes(edit.find)}`);
      console.log(`   Replace text present: ${newTextPresent}`);
      
      originalNodeStates.forEach(({ node, originalData }) => {
        node.data = originalData;
      });
      
      console.log(`🔄 [ROLLBACK] Successfully restored ${originalNodeStates.length} node(s) to original state`);
      
      // ✅ Verify rollback worked
      const { fullText: rolledBackText } = consolidateTextNodesRecursive($, el);
      const rollbackVerified = rolledBackText === fullText;
      console.log(`   Rollback verification: text restored = ${rollbackVerified}`);
      
      diagnostics.crossesBoundary = true;
    }
  } else {
    // ✅ NEW: ROLLBACK on apply failure
    console.log('❌ [APPLY_FAIL] Failed to apply - ROLLING BACK changes');
    
    originalNodeStates.forEach(({ node, originalData }) => {
      node.data = originalData;
    });
    
    console.log(`🔄 [ROLLBACK] Successfully restored ${originalNodeStates.length} node(s) to original state`);
    
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
          
          console.log('\n🔍 [CONTEXT MISMATCH DEBUG]');
          console.log('GPT Expected:');
          console.log('  Before: "' + edit.before + '"');
          console.log('  Find:   "' + edit.find + '"');
          console.log('  After:  "' + edit.after + '"');
          console.log('');
          console.log('Actually Found in HTML:');
          console.log('  "' + contextBefore + '[' + edit.find + ']' + contextAfter + '"');
          console.log('  Tag: <' + tag + '>');
        }
      }
    });

    diagnostics.timings!.search = Date.now() - searchStart;
    const editTime = Date.now() - editStart;
    console.log('⏱️ [TIMING] Edit processed in', editTime, 'ms');

    if (applied) {
      console.log('✅ [SUCCESS] Edit applied successfully');
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
        failureReason = 'Text not found in HTML';
        status = 'not_found';
        
        manualFixGuidance = {
          strategy: 'not-found',
          recommendation: 'Text was not found - it may have already been corrected, or GPT hallucinated this error.',
          searchHints: [edit.find]
        };
      }
      
      diagnostics.manualFixGuidance = manualFixGuidance;
      
      console.log('❌ [FAILED]', status, '-', failureReason);
      
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
  
  console.log('\n📊 [SUMMARY] Atomic verification complete');
  console.log('Total:', edits.length, '| Applied:', appliedCount, '| Failed:', failedCount, '| Blocked:', blockedCount);
  console.log('⏱️ Total time:', totalTime, 'ms');

  return {
    html: $.html(),
    results,
    stats: {
      total: edits.length,
      applied: appliedCount,
      failed: failedCount,
      blocked: blockedCount,
      skipped: skippedCount,
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

router.post('/:id/golden', async (req: Request, res: Response) => {
  const requestStart = Date.now();
  console.log('\n🌟 ============ GOLDEN TEMPLATE REQUEST ============');
  
  try {
    const id = String(req.params.id);
    console.log('📋 Template ID:', id);
    
    const { name, html } = await getRobustTemplateHtml(id);
    console.log('📄 Template loaded:', name, '| Size:', html.length, 'bytes');

    const visible = extractVisibleText(html);
    const chunks = chunkText(visible, 3500);
    console.log('📝 Extracted text:', visible.length, 'chars |', chunks.length, 'chunks');

    let allEdits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string }> = [];
    
    console.log('\n🤖 Calling GPT for grammar analysis...');
    for (let i = 0; i < chunks.length; i++) {
      console.log(`📤 Processing chunk ${i + 1}/${chunks.length}`);
      const chunk = chunks[i];
      
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: grammarSystemPrompt() },
          { role: 'user', content: `Visible email text:\n\n${chunk || 'No text.'}` }
        ],
        response_format: { type: 'json_object' as const }
      });

      try {
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
          
          console.log(`📥 GPT returned ${edits.length} edits for chunk ${i + 1}`);
          allEdits = allEdits.concat(edits);
          if (allEdits.length >= 60) {
            console.log('⚠️ Reached 60 edits limit, stopping');
            break;
          }
        }
      } catch (e) {
        console.error('❌ Failed to parse GPT response for chunk', i + 1, ':', e);
      }
    }

    console.log('\n✅ GPT analysis complete. Total edits suggested:', allEdits.length);
    
    console.log('\n🔬 Starting atomic verification...');
    const atomicResult = applyContextEdits(html, allEdits);
    
    const doc = ensureFullDocShell(name, atomicResult.html);

    const appliedEdits = atomicResult.results.filter(r => r.status === 'applied');
    const failedEdits = atomicResult.results.filter(r => r.status !== 'applied' && r.status !== 'skipped');
    const changes = appliedEdits.map(r => r.change!).filter(Boolean);
    
    console.log('\n📊 ============ FINAL RESULTS ============');
    console.log('✅ Applied:', atomicResult.stats.applied);
    console.log('❌ Failed:', atomicResult.stats.failed);
    console.log('🚫 Blocked:', atomicResult.stats.blocked);
    console.log('⏭️ Skipped:', atomicResult.stats.skipped);
    console.log('⏱️ Total time:', Date.now() - requestStart, 'ms');
    console.log('==========================================\n');

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
    console.error('❌ GOLDEN ERROR:', err);
    res.status(500).json({ code: 'QA_GOLDEN_ERROR', message: errMsg(err) });
  }
});

router.post('/:id/subjects', async (req: Request, res: Response) => {
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
        { role: 'system', content: 'Return ONLY valid JSON: {"subjects": ["..."]}. 5 concise subject lines, <=60 chars, no emojis.' },
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

router.post('/:id/suggestions', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
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
    skipped: number;
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

function chatSystemPrompt(): string {
  return [
    'You are a friendly and helpful email copy assistant. Be conversational, warm, and supportive.',
    '',
    '🎯 CONVERSATION MODES:',
    '',
    '1) CASUAL CHAT: When the user greets you, asks questions, or makes small talk:',
    '   - Respond naturally and warmly',
    '   - Set intent to "suggest" with friendly notes',
    '   - DO NOT force edits for casual conversation',
    '   - Example: User says "hi" → You say "Hello! 👋 How can I help you improve your email today?"',
    '',
    '2) BRAINSTORM: When the user asks for ideas or strategy:',
    '   - Set intent to "suggest"',
    '   - Provide thoughtful ideas in the "ideas" array',
    '   - Be creative and helpful',
    '',
    '3) EDIT: When the user explicitly asks to change, fix, or improve specific text:',
    '   - Set intent to "edit" or "both"',
    '   - Provide targeted edits in the "edits" array',
    '   - Keep tone & meaning. Max 20 edits.',
    '',
    '4) CLARIFY: When you need more information:',
    '   - Set intent to "clarify"',
    '   - Ask a friendly question in "notes"',
    '',
    '📋 ALWAYS return valid JSON with this structure:',
    '{',
    '  "intent": "suggest" | "edit" | "both" | "clarify",',
    '  "ideas": ["..."],  // Use for suggestions and friendly responses',
    '  "edits": [  // Only include when user explicitly requests changes',
    '    {',
    '      "find": "<exact substring from text>",',
    '      "replace": "<corrected text>",',
    '      "before_context": "<10-40 chars before>",',
    '      "after_context": "<10-40 chars after>",',
    '      "reason": "why this change helps"',
    '    }',
    '  ],',
    '  "targets": ["optional-block-hints"],',
    '  "notes": ["friendly messages or questions for the user"]',
    '}',
    '',
    '✅ EDIT RULES (only when user asks for changes):',
    '- Edits are TEXT-ONLY inside text nodes. Never include HTML tags.',
    '- "find" must be copied EXACTLY from the original text.',
    '- DO NOT change URLs, merge tags (*|FNAME|*), or tracking codes.',
    '- Keep the original tone and style.',
    '- Each edit should be small and focused (prefer single words/phrases).',
    '- Always include before_context and after_context (10-40 chars each).',
    '',
    '💡 TONE:',
    '- Be friendly, supportive, and professional',
    '- Use emojis sparingly to add warmth',
    '- Acknowledge the user\'s input and make them feel heard',
    '- If unsure, ask clarifying questions rather than making assumptions',
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
      'You are a spelling checker. Check ONLY for spelling mistakes.',
      'DO NOT check grammar, punctuation, or style.',
      'DO NOT change numbers, prices, brand names, URLs, or merge tags (*|FNAME|*).',
      'Return ONLY valid JSON with this exact structure:',
      '{',
      '  "mistakes": [',
      '    {',
      '      "word": "<misspelled word>",',
      '      "suggestion": "<correct spelling>",',
      '      "context": "<sentence where it appears>"',
      '    }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- Only flag clear spelling errors',
      '- Ignore proper nouns, brand names, and technical terms',
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

    const context = visibleTextForChat(html);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
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
      response_format: { type: 'json_object' as const },
    });

    let assistantText = '';
    let json: ChatAssistantJson = { intent: 'suggest', ideas: [] };
    try {
      const raw = completion.choices[0]?.message?.content || '{"intent":"suggest"}';
      console.log('🤖 OpenAI Response:', raw); // DEBUG: See what AI returns
      
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as any;
        
        // ✅ IMPROVED: Better formatting for different intents
        const hasIdeas = Array.isArray(obj.ideas) && obj.ideas.length > 0;
        const hasNotes = Array.isArray(obj.notes) && obj.notes.length > 0;
        const hasEdits = Array.isArray(obj.edits) && obj.edits.length > 0;
        
        // Build friendly assistant text - COMBINE notes and ideas when both exist
        const parts: string[] = [];
        
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
        
        if (hasNotes) {
          // Add notes (questions, friendly messages) - can appear with or without ideas
          parts.push(obj.notes.join('\n\n'));
        }
        
        if (hasEdits && !hasIdeas && !hasNotes) {
          // Only show edit message if no ideas/notes
          parts.push(`I've prepared ${obj.edits.length} suggested change${obj.edits.length > 1 ? 's' : ''} for you. Click "Apply Changes" to review and apply them.`);
        }
        
        assistantText = parts.length > 0 
          ? parts.join('\n\n')
          : 'Got it! Let me know if you need anything else.';
        
        json = {
          intent: (obj.intent || 'suggest') as ChatIntent,
          ideas: Array.isArray(obj.ideas) ? obj.ideas.map((s: any) => String(s || '')) : [],
          edits: Array.isArray(obj.edits)
            ? obj.edits.map((e: any) => ({
                find: String(e?.find || ''),
                replace: String(e?.replace || ''),
                before_context: String(e?.before_context || ''),
                after_context: String(e?.after_context || ''),
                reason: e?.reason ? String(e.reason) : undefined,
              })).filter((e: any) => e.find && e.replace)
            : [],
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