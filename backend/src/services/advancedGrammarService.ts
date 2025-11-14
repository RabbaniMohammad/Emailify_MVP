/**
 * 🚀 TAG-BASED GRAMMAR CHECKER WITH GPT-4O-MINI
 * 
 * Strategy:
 * 1. Extract text nodes with their HTML tags
 * 2. Send (tag + text) pairs to GPT-4o-mini in parallel chunks
 * 3. Get corrected text back
 * 4. Apply corrections directly to DOM nodes
 * 5. Return response matching /api/qa/:id/golden format
 * 
 * Chunk size: 200 text nodes per chunk
 * Processing: Parallel chunks for speed
 */

import { JSDOM } from 'jsdom';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHUNK_SIZE = 200;

// ========================
// TYPES
// ========================

export interface GrammarEdit {
  find: string;
  replace: string;
  before_context: string;
  after_context: string;
  reason: string;
  changeType: 'spelling' | 'grammar' | 'typo' | 'duplicate' | 'spacing' | 'capitalization';
  confidence: number;
}

export interface GrammarCheckResult {
  html: string;
  appliedEdits: Array<{
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason: string;
    changeType: string;
    status: 'applied';
    fullSentence: string;        // ✅ NEW: Full sentence with the error
    highlightStart: number;      // ✅ NEW: Start position of error word
    highlightEnd: number;        // ✅ NEW: End position of error word
  }>;
  failedEdits: Array<{
    find: string;
    replace: string;
    before_context: string;
    after_context: string;
    reason: string;
    changeType: string;
    status: 'failed';
    error: string;
  }>;
  stats: {
    total: number;
    applied: number;
    failed: number;
  };
  tagsNeedingRetry?: Array<{
    tagId: number;
    tag: string;
    currentText: string;
    failedChanges: Array<{
      find: string;
      replace: string;
      reason: string;
    }>;
  }>;
}

interface TextNodeWithTag {
  id: number;
  tag: string;
  text: string;
  node: any;
  path: string;
  originalText: string; // Store original full text
}

interface GPTCorrectionResult {
  id: number;
  tag: string;
  original: string;
  corrected: string;
  changes: Array<{
    find: string;
    replace: string;
    reason: string;
  }>;
}

// ========================
// HELPER FUNCTIONS
// ========================

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========================
// EXTRACT TEXT NODES WITH TAGS
// ========================

/**
 * Extract all text nodes with their parent tag information
 * Returns both the text nodes AND the DOM instance
 */
function extractTextNodesWithTags(html: string): { textNodes: TextNodeWithTag[]; dom: JSDOM } {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const textNodes: TextNodeWithTag[] = [];
  let id = 0;

  function traverse(node: any, path: string = '') {
    if (node.nodeType === 3) { // Text node
      const text = (node.textContent || '').trim();
      if (text.length > 0) {
        const parentTag = node.parentElement?.tagName?.toLowerCase() || 'unknown';
        textNodes.push({
          id: id++,
          tag: parentTag,
          text,
          originalText: text, // Store full original text
          node,
          path,
        });
      }
    } else if (node.nodeType === 1) { // Element node
      const element = node as any;
      
      // Skip script, style, etc.
      if (['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT'].includes(element.tagName)) {
        return;
      }
      
      Array.from(node.childNodes).forEach((child: any, index: number) => {
        traverse(child, `${path}/${element.tagName.toLowerCase()}[${index}]`);
      });
    }
  }

  traverse(document.body || document.documentElement, '/root');
  return { textNodes, dom }; // Return BOTH!
}

// ========================
// CHUNK TEXT NODES
// ========================

/**
 * Chunk text nodes into smaller groups for parallel processing
 */
function chunkTextNodes(textNodes: TextNodeWithTag[], chunkSize: number): TextNodeWithTag[][] {
  const chunks: TextNodeWithTag[][] = [];
  
  for (let i = 0; i < textNodes.length; i += chunkSize) {
    chunks.push(textNodes.slice(i, i + chunkSize));
  }
  
  return chunks;
}

/**
 * Extract context snippet around error with ellipsis
 */
function extractContextSnippet(
  fullText: string,
  errorWord: string,
  contextLength: number = 50
): { snippet: string; highlightStart: number; highlightEnd: number } {
  const errorIndex = fullText.indexOf(errorWord);
  
  if (errorIndex === -1) {
    // Error word not found, return full text
    return {
      snippet: fullText,
      highlightStart: 0,
      highlightEnd: 0,
    };
  }
  
  // Calculate snippet boundaries
  const snippetStart = Math.max(0, errorIndex - contextLength);
  const snippetEnd = Math.min(fullText.length, errorIndex + errorWord.length + contextLength);
  
  // Extract snippet
  let snippet = fullText.substring(snippetStart, snippetEnd);
  
  // Add ellipsis if we cut off text
  const hasLeadingEllipsis = snippetStart > 0;
  const hasTrailingEllipsis = snippetEnd < fullText.length;
  
  if (hasLeadingEllipsis) snippet = '...' + snippet;
  if (hasTrailingEllipsis) snippet = snippet + '...';
  
  // Calculate highlight positions relative to snippet
  const highlightStart = errorIndex - snippetStart + (hasLeadingEllipsis ? 3 : 0);
  const highlightEnd = highlightStart + errorWord.length;
  
  return { snippet, highlightStart, highlightEnd };
}

// ========================
// GPT GRAMMAR CHECK
// ========================

/**
 * Send chunk to GPT-4o-mini for grammar checking
 */
async function checkChunkWithGPT(chunk: TextNodeWithTag[]): Promise<GPTCorrectionResult[]> {
  try {
    // Format: Send array of {id, tag, text}
    const input = chunk.map(node => ({
      id: node.id,
      tag: node.tag,
      text: node.text,
    }));


    const prompt = `You are a multilingual grammar and spelling checker. Fix all errors in the provided text nodes.

LANGUAGE DETECTION (CRITICAL):
- FIRST, detect the language of each text node
- Apply grammar/spelling rules for THAT SPECIFIC LANGUAGE ONLY
- If text is English, use ENGLISH spelling (e.g., "industry" NOT "industrie")
- If text is French, use FRENCH spelling (e.g., "industrie" is CORRECT)
- If text is Spanish, use SPANISH spelling
- Do NOT accept foreign language spellings in English text (e.g., "industrie" in English text is WRONG)

RULES:
1. Only fix grammar, spelling, and typos FOR THE DETECTED LANGUAGE
2. Preserve HTML structure (don't modify tags)
3. Maintain original meaning
4. Don't change correct text IN THAT LANGUAGE
5. Return EXACT format as specified
6. Find EVERY occurrence of each error - don't skip duplicates

CRITICAL RULE FOR "find" FIELD:
- Copy the COMPLETE wrong word/phrase EXACTLY as it appears in the input text
- Include ALL characters, even repeated letters (e.g., "natureeeee" not "natur")
- Character-by-character match - do NOT shorten or abbreviate
- If the text has "beautyyy", your find must be "beautyyy", NOT "beauty" or "beaut"
- If a misspelled word appears MULTIPLE times, report it MULTIPLE times (once per occurrence)

INPUT: Array of text nodes with their HTML tags:
${JSON.stringify(input, null, 2)}

OUTPUT: Return JSON with "corrections" array:
{
  "corrections": [
    {
      "id": <node_id>,
      "tag": "<parent_tag>",
      "original": "<original text>",
      "corrected": "<corrected text>",
      "changes": [
        {
          "find": "<EXACT COMPLETE substring from input - copy character-by-character>",
          "replace": "<corrected version>",
          "reason": "<brief explanation>"
        }
      ]
    }
  ]
}

EXAMPLE:
If input text is "Discover the beautyyy of natureee", your changes must be:
{ "find": "beautyyy", "replace": "beauty", "reason": "Spelling error" }
{ "find": "natureee", "replace": "nature", "reason": "Spelling error" }
NOT: { "find": "beauty", ... } or { "find": "natur", ... }

If text is already correct, return empty changes array for that node.
CRITICAL: Return ONLY valid JSON, no other text.`;


    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a precise grammar checker. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    
    
    const parsed = JSON.parse(responseText);
    
    // Handle both array and object with array property
    const results = parsed.corrections || parsed.results || [];
    
    
    return results;
  } catch (error) {
    console.error('❌ [GPT CHUNK] Error:', error);
    return [];
  }
}

// ========================
// GPT RETRY FOR FAILED EDITS
// ========================

/**
 * Retry failed edits by sending partially-corrected text back to GPT
 * This gives GPT a second chance with clearer context
 */
async function retryFailedEdits(
  tagsNeedingRetry: Array<{
    tagId: number;
    tag: string;
    currentText: string;
    failedChanges: Array<{ find: string; replace: string; reason: string }>;
  }>,
  retryAttempt: number
): Promise<GPTCorrectionResult[]> {
  try {
    console.log(`🔄 [RETRY ${retryAttempt}] Processing ${tagsNeedingRetry.length} tags with failures`);
    
    // Build focused retry input
    const retryInput = tagsNeedingRetry.map(t => ({
      id: t.tagId,
      tag: t.tag,
      text: t.currentText, // ← CRITICAL: Send partially-corrected text
    }));

    const prompt = `RETRY ATTEMPT ${retryAttempt}: Previous grammar corrections failed to apply.

CRITICAL CONTEXT:
- These texts were ALREADY partially corrected in a previous pass
- Some corrections succeeded, but the ones below FAILED to apply
- The text you see below is the CURRENT state (after partial corrections)
- Your previous "find" strings didn't match the text EXACTLY

YOUR TASK:
Re-analyze the CURRENT text below and suggest corrections.
The "find" field MUST be an EXACT substring from the current text - copy character-by-character.

Previously failed suggestions (for reference - these didn't match):
${JSON.stringify(tagsNeedingRetry.map(t => ({ tagId: t.tagId, failures: t.failedChanges })), null, 2)}

CURRENT TEXT to analyze (after partial corrections):
${JSON.stringify(retryInput, null, 2)}

OUTPUT FORMAT: Same as before - return JSON with "corrections" array.
Only suggest corrections if you find ACTUAL errors in the CURRENT text.
If the text is now correct, return empty changes array.

CRITICAL: The "find" field must be copy-pasted EXACTLY from the current text above.`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are retrying failed corrections. Be extremely precise with exact character matching.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.0, // ← Maximum determinism for retries
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(responseText);
    const results = parsed.corrections || parsed.results || [];
    
    console.log(`✅ [RETRY ${retryAttempt}] GPT returned ${results.length} correction suggestions`);
    return results;
    
  } catch (error) {
    console.error(`❌ [RETRY ${retryAttempt}] Error:`, error);
    return [];
  }
}

// ========================
// APPLY CORRECTIONS
// ========================

/**
 * Apply GPT corrections to HTML
 * Uses the SAME DOM instance that was used for extraction
 */
function applyCorrections(
  dom: JSDOM,
  textNodes: TextNodeWithTag[],
  gptResults: GPTCorrectionResult[]
): GrammarCheckResult {
  const appliedEdits: GrammarCheckResult['appliedEdits'] = [];
  const failedEdits: GrammarCheckResult['failedEdits'] = [];
  const tagsNeedingRetry: GrammarCheckResult['tagsNeedingRetry'] = [];
  
  // Create map of corrections by ID
  const correctionMap = new Map<number, GPTCorrectionResult>();
  gptResults.forEach(result => {
    if (result && typeof result.id === 'number') {
      correctionMap.set(result.id, result);
    }
  });
  
  // Apply corrections to each text node
  textNodes.forEach(textNode => {
    const correction = correctionMap.get(textNode.id);
    
    if (!correction || !correction.changes || correction.changes.length === 0) {
      return; // No changes needed
    }
    
    
    // Apply correction to the actual DOM node
    let originalText = textNode.node.textContent || '';
    let currentText = originalText;
    let hasAppliedAny = false;
    
    // ✅ NEW APPROACH: Apply each change individually (word-by-word)
    // This handles multiple errors in the same sentence better
    const contextSnippets: any[] = [];
    const appliedChanges: any[] = [];
    const failedChangesForThisTag: any[] = [];
    
    correction.changes?.forEach(change => {
      if (change && change.find && change.replace) {
        // Check if the error word exists in current text
        const wordExists = currentText.includes(change.find);
        
        if (!wordExists) {
          // Track failed edit
          failedEdits.push({
            find: change.find,
            replace: change.replace,
            before_context: '',
            after_context: '',
            reason: change.reason || 'Unknown',
            changeType: 'spelling',
            status: 'failed',
            error: `Word not found in text`,
          });
          
          // Collect for retry
          failedChangesForThisTag.push({
            find: change.find,
            replace: change.replace,
            reason: change.reason || 'Unknown',
          });
          
          return;
        }
        
        // Capture context BEFORE replacement
        const context = extractContextSnippet(currentText, change.find, 50);
        
        // ✅ Apply replacement - ONLY FIRST OCCURRENCE (no 'g' flag)
        // This allows users to fix duplicates one at a time
        const newText = currentText.replace(change.find, change.replace);
        
        if (newText !== currentText) {
          currentText = newText;
          hasAppliedAny = true;
          
          
          appliedChanges.push({
            change,
            context
          });
        }
      }
    });
    
    // If we applied any changes, update the DOM
    if (hasAppliedAny) {
      textNode.node.textContent = currentText;
      
      // Record all applied changes
      appliedChanges.forEach(({ change, context }) => {
        const { snippet, highlightStart, highlightEnd } = context;
        
        appliedEdits.push({
          find: change.find,
          replace: change.replace,
          before_context: '',
          after_context: '',
          reason: change.reason || 'Grammar correction',
          changeType: change.changeType || 'spelling',
          status: 'applied',
          fullSentence: snippet,
          highlightStart: highlightStart,
          highlightEnd: highlightEnd,
        });
      });
    } else if (correction.changes && correction.changes.length > 0) {
    }
    
    // If this tag had any failures, track it for retry
    if (failedChangesForThisTag.length > 0) {
      tagsNeedingRetry.push({
        tagId: textNode.id,
        tag: textNode.tag,
        currentText: currentText, // Current state after any successful edits
        failedChanges: failedChangesForThisTag,
      });
    }
  });
  
  const resultHtml = dom.serialize();
  
  return {
    html: resultHtml,
    appliedEdits,
    failedEdits,
    stats: {
      total: appliedEdits.length + failedEdits.length,
      applied: appliedEdits.length,
      failed: failedEdits.length,
    },
    tagsNeedingRetry: tagsNeedingRetry.length > 0 ? tagsNeedingRetry : undefined,
  };
}

// ========================
// MAIN FUNCTION
// ========================

/**
 * Main grammar check function using GPT-4o-mini with chunking strategy + retry logic
 */
export async function checkGrammarAdvanced(html: string): Promise<GrammarCheckResult> {
  const startTime = Date.now();
  
  // Step 1: Extract text nodes with tags (and get the DOM instance)
  const { textNodes, dom } = extractTextNodesWithTags(html);
  
  if (textNodes.length === 0) {
    return {
      html,
      appliedEdits: [],
      failedEdits: [],
      stats: { total: 0, applied: 0, failed: 0 },
    };
  }
  
  console.log(`📊 [GRAMMAR CHECK] Processing ${textNodes.length} text nodes`);
  
  // Step 2: Split into chunks
  const chunks = chunkTextNodes(textNodes, CHUNK_SIZE);
  console.log(`📦 [GRAMMAR CHECK] Split into ${chunks.length} chunks`);
  
  // Step 3: Process chunks in parallel (initial pass)
  const chunkResults = await Promise.all(
    chunks.map(chunk => checkChunkWithGPT(chunk))
  );
  
  // Step 4: Flatten results
  const allResults = chunkResults.flat();
  console.log(`✅ [GRAMMAR CHECK] GPT returned ${allResults.length} correction suggestions`);
  
  // Step 5: Apply corrections and collect failures
  let result = applyCorrections(dom, textNodes, allResults);
  console.log(`📊 [GRAMMAR CHECK] Initial pass: ${result.stats.applied} applied, ${result.stats.failed} failed`);
  
  // Step 6: Retry logic (max 2 attempts)
  const MAX_RETRIES = 2;
  const permanentlyFailedEdits: typeof result.failedEdits = [];
  
  for (let retryAttempt = 1; retryAttempt <= MAX_RETRIES; retryAttempt++) {
    // Check if we have tags needing retry
    if (!result.tagsNeedingRetry || result.tagsNeedingRetry.length === 0) {
      console.log(`✅ [GRAMMAR CHECK] No retries needed, all corrections successful`);
      break;
    }
    
    console.log(`🔄 [GRAMMAR CHECK] Retry attempt ${retryAttempt}/${MAX_RETRIES} for ${result.tagsNeedingRetry.length} tags`);
    
    // Batch retry all failed tags
    const retryResults = await retryFailedEdits(result.tagsNeedingRetry, retryAttempt);
    
    if (retryResults.length === 0) {
      console.log(`⚠️ [GRAMMAR CHECK] Retry ${retryAttempt} returned no results - GPT thinks text is correct`);
      // Move current failed edits to permanent failures
      permanentlyFailedEdits.push(...result.failedEdits);
      break;
    }
    
    // Clear failed edits before reapplying (we'll regenerate them)
    const previousFailedCount = result.failedEdits.length;
    
    // Re-apply corrections with retry results
    // NOTE: textNodes already have partially-corrected text from previous pass
    const retryResult = applyCorrections(dom, textNodes, retryResults);
    
    console.log(`📊 [GRAMMAR CHECK] Retry ${retryAttempt}: ${retryResult.stats.applied} applied, ${retryResult.stats.failed} still failed`);
    
    // Check if same edits failed again (hallucination - unrecoverable)
    if (retryResult.failedEdits.length > 0 && retryAttempt === MAX_RETRIES) {
      console.log(`❌ [GRAMMAR CHECK] ${retryResult.failedEdits.length} edits failed after ${MAX_RETRIES} retries - marking as hallucinations`);
      retryResult.failedEdits.forEach(edit => {
        edit.error = `Hallucination - failed after ${MAX_RETRIES} retry attempts`;
      });
      permanentlyFailedEdits.push(...retryResult.failedEdits);
    }
    
    // Merge results
    result.appliedEdits.push(...retryResult.appliedEdits);
    result.failedEdits = retryResult.failedEdits;
    result.tagsNeedingRetry = retryResult.tagsNeedingRetry;
    result.stats.applied += retryResult.stats.applied;
    result.stats.failed = retryResult.stats.failed;
    result.stats.total = result.stats.applied + result.stats.failed;
  }
  
  // Add permanently failed edits to final result
  if (permanentlyFailedEdits.length > 0) {
    result.failedEdits = permanentlyFailedEdits;
    result.stats.failed = permanentlyFailedEdits.length;
    result.stats.total = result.stats.applied + result.stats.failed;
  }
  
  // Remove tagsNeedingRetry from final result (internal only)
  delete result.tagsNeedingRetry;
  
  const duration = Date.now() - startTime;
  console.log(`✅ [GRAMMAR CHECK] Complete in ${duration}ms: ${result.stats.applied} applied, ${result.stats.failed} failed`);
  
  return result;
}

/**
 * 🎯 Apply custom edits (for SEO variants) using the SAME advanced tag-based logic
 * This is identical to checkGrammarAdvanced but accepts pre-generated edits from GPT
 */
export async function applyCustomEdits(
  html: string,
  customEdits: Array<{ find: string; replace: string; reason?: string; idea?: string }>
): Promise<GrammarCheckResult> {
  
  // Step 1: Extract text nodes with tags (and get the DOM instance)
  const { textNodes, dom } = extractTextNodesWithTags(html);
  
  if (textNodes.length === 0 || customEdits.length === 0) {
    return {
      html,
      appliedEdits: [],
      failedEdits: [],
      stats: { total: 0, applied: 0, failed: 0 },
    };
  }
  
  // Step 2: Convert custom edits to correction format
  // Group edits by which text node they belong to
  const corrections: GPTCorrectionResult[] = [];
  
  textNodes.forEach((textNode, index) => {
    const nodeChanges: Array<{ find: string; replace: string; reason: string }> = [];
    
    customEdits.forEach(edit => {
      // Check if this edit applies to this text node
      if (textNode.text.includes(edit.find)) {
        nodeChanges.push({
          find: edit.find,
          replace: edit.replace,
          reason: edit.reason || 'SEO optimization'
        });
      }
    });
    
    if (nodeChanges.length > 0) {
      corrections.push({
        id: textNode.id,
        tag: textNode.tag,
        original: textNode.text,
        corrected: textNode.text, // Will be updated during application
        changes: nodeChanges
      });
    }
  });
  
  
  // Step 3: Apply corrections using the SAME DOM instance and SAME logic
  const result = applyCorrections(dom, textNodes, corrections);
  
  
  return result;
}
