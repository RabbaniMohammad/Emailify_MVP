import { Router, type Request, type Response } from 'express';
import mailchimp from '@mailchimp/mailchimp_marketing';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import puppeteer from 'puppeteer'; // ⬅️ ADDED
import type { Browser } from 'puppeteer';

// let browser: Browser | null = null;

const router = Router();
const MC: any = mailchimp as any;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));


/* ------------------------------------------------------------------ */
/*                       Helpers & safe typings                        */
/* ------------------------------------------------------------------ */

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
    "- ‘find’ and contexts must be copied from the input text (no HTML).",
    "- Keep edits minimal; don’t rewrite tone or meaning.",
    "- Max 30 edits per request.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*             Entity-aware, context-aware text patching               */
/* ------------------------------------------------------------------ */

const ZWS = /[\u200B\u200C\u200D\uFEFF]/;

// Minimal named entity table for the cases we care about in email copy
const NAMED_ENT: Record<string, string> = {
  nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', ndash: '–', mdash: '—',
};

function decodeHtmlEntityAt(raw: string, i: number): { ch: string; end: number } | null {
  if (raw[i] !== '&') return null;
  const semi = raw.indexOf(';', i + 1);
  if (semi < 0 || semi - i > 31) return null; // sanity cap
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
  if (ch === '“' || ch === '”') return '"';
  if (ch === '‘' || ch === '’') return "'";
  if (ch === '–' || ch === '—') return '-';
  if (ch === '…') return '...';
  return ch;
}

/** Build normalized string with precise RAW span mapping per character.
 *  - Decodes entities (&rsquo;, &#160;, &#x2019;) to single chars before normalization.
 *  - Collapses all whitespace to single spaces (with coalescing).
 */
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
    mapEnd[norm.length] = end; // exclusive end in RAW
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

  // 1) exact raw match + raw context
  let i = raw.indexOf(nRaw);
  while (i >= 0) {
    const okBefore = bRaw ? raw.slice(Math.max(0, i - bRaw.length), i).endsWith(bRaw) : true;
    const okAfter  = aRaw ? raw.slice(i + nRaw.length, i + nRaw.length + aRaw.length).startsWith(aRaw) : true;
    if (okBefore && okAfter) return { start: i, end: i + nRaw.length };
    i = raw.indexOf(nRaw, i + 1);
  }

  // 2) normalized match + normalized context (entity-aware)
  const H = normalizeAndMap(raw);
  const nNeedle = normalizeOnly(nRaw);
  const nBefore = normalizeOnly(bRaw);
  const nAfter  = normalizeOnly(aRaw);

  let ni = H.norm.indexOf(nNeedle);
  while (ni >= 0) {
    const okBefore = nBefore ? H.norm.slice(Math.max(0, ni - nBefore.length), ni).endsWith(nBefore) : true;
    const okAfter  = nAfter  ? H.norm.slice(ni + nNeedle.length, ni + nNeedle.length + nAfter.length).startsWith(nAfter) : true;
    if (okBefore && okAfter) {
      const span = mapNormSpanToRawSpan(H.mapStart, H.mapEnd, ni, nNeedle.length, raw.length);
      if (span) return span;
    }
    ni = H.norm.indexOf(nNeedle, ni + 1);
  }

  // 3) contextual fallbacks
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
  // Allow <a> so CTA/link text can be edited; still block script/style/title/svg
  return new Set(['style', 'script', 'title', 'svg']);
}

/** Apply grammar/SEO edits INSIDE TEXT NODES ONLY (never tags/attrs). */
function applyContextEdits(
  html: string,
  edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string }>
): { html: string; changes: Array<{ before: string; after: string; parent: string; reason?: string }>; } {
  // use `as any` to allow decodeEntities option
  const $ = (cheerio as any).load(html, { decodeEntities: false });
  const deny = deniedParents();
  const changes: Array<{ before: string; after: string; parent: string; reason?: string }> = [];

  const queue = (Array.isArray(edits) ? edits : [])
    .map((e: any) => ({
      find: String(e?.find || ''),
      replace: String(e?.replace || ''),
      before: String(e?.before_context || ''),
      after: String(e?.after_context || ''),
      reason: e?.reason ? String(e.reason) : undefined,
    }))
    .filter((e: any) => e.find && e.replace && e.find !== e.replace);

  $('body *').each((_: any, el: any) => {
    const tag = (el as any).tagName?.toLowerCase?.() || '';
    if (deny.has(tag)) return;

    $(el).contents().each((__: any, node: any) => {
      if ((node as any).type !== 'text') return;
      let txt: string = (node as any).data || '';

      for (const e of queue) {
        // hard safety: don’t allow URL or merge-tag manipulation
        if (/https?:\/\//i.test(e.find) || /https?:\/\//i.test(e.replace)) continue;
        if (/\*\|[A-Z0-9_]+\|\*/.test(e.find) || /\*\|[A-Z0-9_]+\|\*/.test(e.replace)) continue;

        const span = findWithContextSpan(txt, e.find, e.before, e.after);
        if (!span) continue;

        const next = txt.slice(0, span.start) + e.replace + txt.slice(span.end);
        if (next !== txt) {
          changes.push({ before: e.find, after: e.replace, parent: tag, reason: e.reason });
          txt = next;
        }
      }

      (node as any).data = txt;
    });
  });

  return { html: $.html(), changes };
}

/* ------------------------------------------------------------------ */
/*                      Loose word fallback (safe)                     */
/* ------------------------------------------------------------------ */

// Gentle fallback when the model sent too-wide 'find' and context didn't match.
// Swaps a meaningful word inside the 'find' with 'replace' (text nodes only).
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

        // Only try if replacement is basically one token.
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

// GOLDEN
router.post('/:id/golden', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, html } = await getRobustTemplateHtml(id);

    const visible = extractVisibleText(html);
    const chunks = chunkText(visible, 3500);

    let allEdits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string }> = [];
    for (const chunk of chunks) {
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0,
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
          allEdits = allEdits.concat(edits);
          if (allEdits.length >= 60) break;
        }
      } catch (_e: unknown) { /* ignore invalid JSON */ }
    }

    const applied = applyContextEdits(html, allEdits);
    const doc = ensureFullDocShell(name, applied.html);

    res.json({ html: doc, edits: allEdits, changes: applied.changes });
  } catch (err: unknown) {
    res.status(500).json({ code: 'QA_GOLDEN_ERROR', message: errMsg(err) });
  }
});

// SUBJECTS
router.post('/:id/subjects', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { name, html } = await getRobustTemplateHtml(id);

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

// SUGGESTIONS
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

// -------------------------- VARIANTS (single-click sequential) --------------------------

type VariantChange = { before: string; after: string; parent: string; reason?: string };
type VariantArtifacts = { usedIdeas: string[] };
type VariantItem = { no: number; html: string; changes: VariantChange[]; why: string[]; artifacts: VariantArtifacts };

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

/** Ask model for "enhancement" edits (NOT HTML), with idea tags & "why" bullets, avoiding used ideas */
async function getVariantEditsAndWhy(sourceHtml: string, usedIdeas: Set<string>): Promise<{ edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string; idea?: string }>; why: string[]; }> {
  const $ = cheerio.load(sourceHtml);
  $('script, style, noscript').remove();
  const plain = $('body').text().replace(/\s+/g, ' ').trim();

  const system = [
    'You generate SMALL, high-signal copy tweaks for an email variant.',
    'Return ONLY valid JSON:',
    '{ "edits":[{ "find":"...", "replace":"...", "before_context":"...", "after_context":"...", "reason":"...", "idea":"<short tag>"}], "why":["..."] }',
    'Rules:',
    '- Up to 12 edits. Each edit must be within ONE text node (use the given contexts).',
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

/** POST /api/qa/:id/variants/start  { html, target? } -> { runId, target } */
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

/** POST /api/qa/variants/:runId/next -> next variant (1..target) */
router.post('/variants/:runId/next', async (req: Request, res: Response) => {
  try {
    const runId = String(req.params.runId);
    const run = variantRuns.get(runId);
    if (!run) return res.status(404).json({ code: 'VARIANTS_RUN_NOT_FOUND', message: 'Run not found' });

    if (run.variants.length >= run.target) {
      return res.status(200).json({ done: true, message: 'All variants generated', no: run.variants.length });
    }

    const sourceHtml = run.currentHtml;
    const { edits, why } = await getVariantEditsAndWhy(sourceHtml, run.usedIdeas);

    const applied = applyContextEdits(sourceHtml, edits);
    const variantNo = run.variants.length + 1;

    // Harvest ideas from edits
    const ideas = Array.from(new Set((edits || []).map((e) => (e as any).idea).filter(Boolean) as string[]));
    ideas.forEach((i) => run.usedIdeas.add(i));

    const item: VariantItem = {
      no: variantNo,
      html: ensureFullDocShell(`Variant ${variantNo}`, applied.html),
      changes: (applied as any).changes || [],
      why: (why && why.length) ? why : ['Small clarity and deliverability improvements.'],
      artifacts: { usedIdeas: ideas },
    };

    run.currentHtml = item.html;
    run.variants.push(item);

    res.json(item);
  } catch (err: unknown) {
    res.status(500).json({ code: 'VARIANTS_NEXT_ERROR', message: errMsg(err) });
  }
});

/** (Optional) GET status for a run (useful on refresh) */
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

// ---------------------------- CHATBOT (Use Variant) ----------------------------

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
    'You are an email copy assistant.',
    'You can do TWO things:',
    '1) SUGGEST: Ideas/strategy notes. No edits returned.',
    '2) EDIT: Targeted text fixes with a JSON patch. Keep tone & meaning. Max 20 edits.',
    '',
    'ALWAYS return ONLY valid JSON with this shape:',
    '{',
    '  "intent": "suggest" | "edit" | "both" | "clarify",',
    '  "ideas": ["..."],',
    '  "edits": [',
    '    { "find":"...", "replace":"...", "before_context":"...", "after_context":"...", "reason":"..." }',
    '  ],',
    '  "targets": ["optional-block-hints"],',
    '  "notes": ["optional warnings"]',
    '}',
    '',
    'Strict rules:',
    '- Edits are TEXT-ONLY inside text nodes. Do NOT output HTML in `find`/`replace`.',
    '- Do NOT change URLs, anchor text, merge tags (*|FNAME|*), or tracking codes.',
    '- Keep language/tone. ≤20% length delta per edit.',
    '- If ambiguous, set intent "clarify" and ask a short question in `notes".',
    // critical nudges for reliable matching:
    '- Each edit MUST use the smallest possible `find` (prefer a single word or tiny phrase). Never include a whole sentence unless unavoidable.',
    '- ALWAYS include 10–40 characters of `before_context` and `after_context`, copied verbatim from around the `find` in the original text.',
  ].join('\n');
}

/**
 * POST /api/qa/variants/:runId/chat/message
 * body: { no:number, html?:string, history?: ChatTurn[], userMessage:string }
 * resp: { assistantText: string, json: ChatAssistantJson }
 */
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

    // We only send a very short sketch of history to control tokens
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
        assistantText =
          (Array.isArray(obj.ideas) && obj.ideas.length)
            ? `Ideas:\n- ${obj.ideas.map((s: any) => String(s || '')).join('\n- ')}`
            : (Array.isArray(obj.notes) && obj.notes.length)
              ? obj.notes.join('\n')
              : 'Okay.';
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

/**
 * POST /api/qa/variants/:runId/chat/apply
 * body: { html:string, edits:GoldenEdit[] }
 * resp: { html:string, changes: [...] }
 */
router.post('/variants/:runId/chat/apply', async (req: Request, res: Response) => {
  try {
    const html: string = String(req.body?.html || '');
    const edits = Array.isArray(req.body?.edits) ? req.body.edits : [];
    if (!html) return res.status(400).json({ code: 'CHAT_APPLY_BAD_REQUEST', message: 'html is required' });

    // 1) strict, context-aware apply (text nodes only, with entity-aware matching)
    const strict = applyContextEdits(html, edits);
    let best = strict;

    // 2) if nothing matched, try a careful word-level fallback
    if (!best.changes?.length) {
      const loose = applyLooseWordFallback(html, edits);
      if (loose.changes.length > (best.changes?.length || 0)) best = loose;
    }

    const doc = ensureFullDocShell('Edited Variant', best.html);
    return res.json({ html: doc, changes: best.changes || [] });
  } catch (err: unknown) {
    res.status(500).json({ code: 'CHAT_APPLY_ERROR', message: errMsg(err) });
  }
});

/* ------------------------------------------------------------------ */
/*                          Headless screenshot                        */
/* ------------------------------------------------------------------ */

/** POST /api/qa/snap  body: { url } → { url, ok, status?, finalUrl?, dataUrl?, error? } */
router.post('/snap', async (req: Request, res: Response) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ url, ok: false, error: 'Invalid URL' });
  }

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true, // ✅ boolean, not "new"
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // If Chromium didn't download (e.g., corporate proxy), set this env var:
      // PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
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
