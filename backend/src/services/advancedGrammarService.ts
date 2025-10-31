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

    console.log('📤 [GPT CHUNK] SENDING TO GPT:');
    console.log(JSON.stringify(input, null, 2));

    const prompt = `You are a grammar and spelling checker. Fix all errors in the provided text nodes.

RULES:
1. Only fix grammar, spelling, and typos
2. Preserve HTML structure (don't modify tags)
3. Maintain original meaning
4. Don't change correct text
5. Return EXACT format as specified

CRITICAL RULE FOR "find" FIELD:
- Copy the COMPLETE wrong word/phrase EXACTLY as it appears in the input text
- Include ALL characters, even repeated letters (e.g., "natureeeee" not "natur")
- Character-by-character match - do NOT shorten or abbreviate
- If the text has "beautyyy", your find must be "beautyyy", NOT "beauty" or "beaut"

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

    console.log(`🔍 [GPT CHUNK] Checking ${chunk.length} text nodes...`);

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
    
    console.log('📥 [GPT CHUNK] RECEIVED FROM GPT:');
    console.log(responseText);
    
    const parsed = JSON.parse(responseText);
    
    // Handle both array and object with array property
    const results = parsed.corrections || parsed.results || [];
    
    console.log(`✅ [GPT CHUNK] Parsed ${results.length} correction results`);
    console.log('📋 [GPT CHUNK] RESULTS:');
    console.log(JSON.stringify(results, null, 2));
    
    return results;
  } catch (error) {
    console.error('❌ [GPT CHUNK] Error:', error);
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
    
    console.log(`🔧 [APPLY] Node ${textNode.id} (${textNode.tag}):`);
    console.log(`   Original: "${textNode.originalText}"`);
    console.log(`   Expected: "${correction.original}"`);
    console.log(`   Corrected: "${correction.corrected}"`);
    
    // Apply correction to the actual DOM node
    const originalText = textNode.node.textContent || '';
    
    // Try exact match first
    if (originalText.trim() === correction.original?.trim()) {
      // ✅ CAPTURE CONTEXT SNIPPETS BEFORE APPLYING CHANGES
      const contextSnippets = correction.changes.map(change => {
        if (change && change.find && change.replace) {
          return extractContextSnippet(
            textNode.originalText, // Use original text BEFORE any corrections
            change.find,
            50
          );
        }
        return null;
      });
      
      // Direct replacement
      textNode.node.textContent = correction.corrected;
      
      console.log(`   ✅ APPLIED (exact match)!`);
      
      // Record all changes
      correction.changes.forEach((change, index) => {
        if (change && change.find && change.replace) {
          console.log(`      - "${change.find}" → "${change.replace}" (${change.reason})`);
          
          // ✅ VERIFY: Check if the error word actually exists in the original text
          const wordExists = textNode.originalText.includes(change.find);
          
          if (!wordExists) {
            console.log(`      ⚠️  HALLUCINATION DETECTED & DISCARDED: "${change.find}" not found in original text`);
            return; // Silently skip this hallucinated change
          }
          
          // ✅ Use pre-captured context snippet
          const context = contextSnippets[index] || {
            snippet: textNode.originalText,
            highlightStart: 0,
            highlightEnd: 0
          };
          const { snippet, highlightStart, highlightEnd } = context;
          
          appliedEdits.push({
            find: change.find,
            replace: change.replace,
            before_context: '',
            after_context: '',
            reason: change.reason || 'Grammar correction',
            changeType: 'spelling',
            status: 'applied',
            // ✅ Add full sentence and highlight info
            fullSentence: snippet,
            highlightStart: highlightStart,
            highlightEnd: highlightEnd,
          });
        }
      });
    } 
    // Try partial match - GPT might have returned only part of the text
    else if (originalText.includes(correction.original || '')) {
      // ✅ CAPTURE CONTEXT SNIPPETS BEFORE APPLYING CHANGES
      const contextSnippets = correction.changes.map(change => {
        if (change && change.find && change.replace) {
          return extractContextSnippet(
            textNode.originalText, // Use original text BEFORE any corrections
            change.find,
            50
          );
        }
        return null;
      });
      
      // Find and replace the corrected portion
      const newText = originalText.replace(correction.original || '', correction.corrected || '');
      textNode.node.textContent = newText;
      
      console.log(`   ✅ APPLIED (partial match)!`);
      console.log(`      Full result: "${newText.trim()}"`);
      
      // Record all changes
      correction.changes.forEach((change, index) => {
        if (change && change.find && change.replace) {
          console.log(`      - "${change.find}" → "${change.replace}" (${change.reason})`);
          
          // ✅ VERIFY: Check if the error word actually exists in the original text
          const wordExists = textNode.originalText.includes(change.find);
          
          if (!wordExists) {
            console.log(`      ⚠️  HALLUCINATION DETECTED & DISCARDED: "${change.find}" not found in original text`);
            return; // Silently skip this hallucinated change
          }
          
          // ✅ Use pre-captured context snippet
          const context = contextSnippets[index] || {
            snippet: textNode.originalText,
            highlightStart: 0,
            highlightEnd: 0
          };
          const { snippet, highlightStart, highlightEnd } = context;
          
          appliedEdits.push({
            find: change.find,
            replace: change.replace,
            before_context: '',
            after_context: '',
            reason: change.reason || 'Grammar correction',
            changeType: 'spelling',
            status: 'applied',
            // ✅ Add full sentence and highlight info
            fullSentence: snippet,
            highlightStart: highlightStart,
            highlightEnd: highlightEnd,
          });
        }
      });
    }
    else {
      console.log(`   ❌ MISMATCH - NOT APPLIED`);
      
      // Text mismatch
      correction.changes?.forEach(change => {
        if (change && change.find && change.replace) {
          failedEdits.push({
            find: change.find,
            replace: change.replace,
            before_context: '',
            after_context: '',
            reason: change.reason || 'Unknown',
            changeType: 'spelling',
            status: 'failed',
            error: `Text mismatch: expected "${correction.original}" but found "${originalText.trim()}"`,
          });
        }
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
  };
}

// ========================
// MAIN FUNCTION
// ========================

/**
 * Main grammar check function using GPT-4o-mini with chunking strategy
 */
export async function checkGrammarAdvanced(html: string): Promise<GrammarCheckResult> {
  console.log('🚀 [ADVANCED GRAMMAR] Starting GPT-based check with chunking');
  
  // Step 1: Extract text nodes with tags (and get the DOM instance)
  const { textNodes, dom } = extractTextNodesWithTags(html);
  console.log(`📝 [ADVANCED GRAMMAR] Extracted ${textNodes.length} text nodes`);
  
  if (textNodes.length === 0) {
    return {
      html,
      appliedEdits: [],
      failedEdits: [],
      stats: { total: 0, applied: 0, failed: 0 },
    };
  }
  
  // Step 2: Split into chunks
  const chunks = chunkTextNodes(textNodes, CHUNK_SIZE);
  console.log(`📦 [ADVANCED GRAMMAR] Split into ${chunks.length} chunks (size: ${CHUNK_SIZE})`);
  
  // Step 3: Process chunks in parallel
  console.log(`⚡ [ADVANCED GRAMMAR] Processing ${chunks.length} chunks in parallel...`);
  const chunkResults = await Promise.all(
    chunks.map(chunk => checkChunkWithGPT(chunk))
  );
  
  // Step 4: Flatten results
  const allResults = chunkResults.flat();
  console.log(`🔍 [ADVANCED GRAMMAR] Got ${allResults.length} correction results`);
  
  // Step 5: Apply corrections using the SAME DOM instance
  const result = applyCorrections(dom, textNodes, allResults);
  
  console.log(`✅ [ADVANCED GRAMMAR] Applied: ${result.stats.applied}, Failed: ${result.stats.failed}`);
  
  return result;
}
