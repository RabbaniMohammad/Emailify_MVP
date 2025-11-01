import { Router, type Request, type Response } from 'express';
import { checkGrammarAdvanced, applyCustomEdits } from '@src/services/advancedGrammarService';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';

const router = Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Helper function to ensure full HTML document
 */
function ensureFullDocShell(name: string, bodyOrDocHtml: string): string {
  const html = bodyOrDocHtml || "<div style='padding:16px;color:#666'>No content.</div>";
  const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
  if (hasDoc) return html;
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
router.post('/:id/golden', async (req: Request, res: Response) => {
  const requestStart = Date.now();
  try {
    const id = String(req.params.id);
    let html = String(req.body?.html || '').trim();
    let name = `Template ${id}`;
    
    if (!html) {
      return res.status(400).json({ 
        code: 'QA_GOLDEN_ERROR', 
        message: 'HTML is required in request body' 
      });
    }
    
    console.log('🔍 [ADVANCED GOLDEN] Template ID:', id);
    console.log('📏 [ADVANCED GOLDEN] HTML length:', html.length);
    console.log('🚀 [ADVANCED GOLDEN] Using GPT-4o-mini with tag-based chunking');
    
    const parseStart = Date.now();
    
    // Use advanced grammar checker with timeout
    console.log('⏳ [ADVANCED GOLDEN] Starting grammar check...');
    const grammarResult = await checkGrammarAdvanced(html);
    console.log('⏱️ [ADVANCED GOLDEN] Grammar check completed in', Date.now() - parseStart, 'ms');
    
    console.log('✅ [ADVANCED GOLDEN] Check complete:', {
      total: grammarResult.stats.total,
      applied: grammarResult.stats.applied,
      failed: grammarResult.stats.failed
    });
    
    if (grammarResult.appliedEdits.length > 0) {
      console.log('📝 [ADVANCED GOLDEN] Corrections:');
      grammarResult.appliedEdits.forEach((edit, i) => {
        console.log(`   ${i + 1}. "${edit.find}" → "${edit.replace}" (${edit.changeType})`);
      });
    }
    
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
        status: 'applied' as const,
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
        status: 'not_found' as const,
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
      status: 'failed' as const,
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
    
  } catch (err: unknown) {
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
router.post('/grammar-check', async (req: Request, res: Response) => {
  try {
    const html: string = String(req.body?.html || '').trim();
    
    if (!html) {
      return res.status(400).json({ 
        code: 'GRAMMAR_CHECK_BAD_REQUEST', 
        message: 'HTML is required' 
      });
    }

    console.log('🔍 [ADVANCED GRAMMAR] Received HTML length:', html.length);
    console.log('🔍 [ADVANCED GRAMMAR] Checking for errors...');

    // Run the advanced grammar checker
    const result = await checkGrammarAdvanced(html);

    console.log('✅ [ADVANCED GRAMMAR] Check complete:', {
      total: result.stats.total,
      applied: result.stats.applied,
      failed: result.stats.failed
    });

    // Log what was found
    if (result.appliedEdits.length > 0) {
      console.log('📝 [ADVANCED GRAMMAR] Corrections made:');
      result.appliedEdits.forEach((edit, i) => {
        console.log(`   ${i + 1}. "${edit.find}" → "${edit.replace}" (${edit.changeType})`);
      });
    }

    if (result.failedEdits.length > 0) {
      console.log('⚠️ [ADVANCED GRAMMAR] Could not fix (boundary issues):');
      result.failedEdits.forEach((edit, i) => {
        console.log(`   ${i + 1}. "${edit.find}" → "${edit.replace}"`);
      });
    }

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

  } catch (err: unknown) {
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
router.post('/test', async (req: Request, res: Response) => {
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

    const result = await checkGrammarAdvanced(testHtml);

    res.json({
      success: true,
      testHtml,
      result,
      message: 'Test completed successfully'
    });

  } catch (err: unknown) {
    console.error('❌ Test Error:', err);
    res.status(500).json({ 
      code: 'TEST_ERROR', 
      message: String(err)
    });
  }
});

// ========================
// VARIANTS ENDPOINTS  
// ========================

type VariantItem = {
  no: number;
  html: string;
  changes: Array<any>;
  why: string[];
  artifacts?: any;
  failedEdits?: any;
  stats?: any;
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ✅ Get variant edits with SEO focus
async function getVariantEditsAndWhy(sourceHtml: string, usedIdeas: Set<string>): Promise<{ edits: Array<{ find: string; replace: string; before_context: string; after_context: string; reason?: string; idea?: string }>; why: string[]; }> {
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
    
    console.log(`🎯 [QA-ADVANCED] Started variant run ${runId} for template ${templateId} (target: ${target})`);
    
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

    console.log(`🔄 [QA-ADVANCED] Generating variant ${run.variants.length + 1}/${run.target} for run ${runId}`);
    
    // ✅ STEP 1: Get SEO-focused edits from GPT
    const sourceHtml = run.goldenHtml;
    const { edits, why } = await getVariantEditsAndWhy(sourceHtml, run.usedIdeas);
    console.log(`📝 [QA-ADVANCED] Got ${edits.length} SEO-focused edits from GPT`);
    
    // ✅ STEP 2: Apply edits using ADVANCED tag-based logic (SAME as golden template)
    const result = await applyCustomEdits(sourceHtml, edits);
    console.log(`✅ [QA-ADVANCED] Applied ${result.stats.applied} edits, ${result.stats.failed} failed`);
    
    const variantNo = run.variants.length + 1;

    // Track used ideas
    const ideas = Array.from(new Set((edits || []).map((e) => (e as any).idea).filter(Boolean) as string[]));
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
      status: 'failed' as const,
      diagnostics: {
        error: edit.error
      },
    }));
    
    const item: VariantItem = {
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
  } catch (err: unknown) {
    console.error('❌ [QA-ADVANCED] Variant generation error:', err);
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

export default router;
