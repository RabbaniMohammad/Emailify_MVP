import { Router, type Request, type Response } from 'express';
import { checkGrammarAdvanced } from '@src/services/advancedGrammarService';
import * as cheerio from 'cheerio';

const router = Router();

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

export default router;
