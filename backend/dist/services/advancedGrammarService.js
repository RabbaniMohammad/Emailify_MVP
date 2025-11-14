"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkGrammarAdvanced = checkGrammarAdvanced;
exports.applyCustomEdits = applyCustomEdits;
const jsdom_1 = require("jsdom");
const openai_1 = __importDefault(require("openai"));
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHUNK_SIZE = 200;
// ========================
// HELPER FUNCTIONS
// ========================
/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ========================
// EXTRACT TEXT NODES WITH TAGS
// ========================
/**
 * Extract all text nodes with their parent tag information
 * Returns both the text nodes AND the DOM instance
 */
function extractTextNodesWithTags(html) {
    const dom = new jsdom_1.JSDOM(html);
    const document = dom.window.document;
    const textNodes = [];
    let id = 0;
    function traverse(node, path = '') {
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
        }
        else if (node.nodeType === 1) { // Element node
            const element = node;
            // Skip script, style, etc.
            if (['SCRIPT', 'STYLE', 'HEAD', 'NOSCRIPT'].includes(element.tagName)) {
                return;
            }
            Array.from(node.childNodes).forEach((child, index) => {
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
function chunkTextNodes(textNodes, chunkSize) {
    const chunks = [];
    for (let i = 0; i < textNodes.length; i += chunkSize) {
        chunks.push(textNodes.slice(i, i + chunkSize));
    }
    return chunks;
}
/**
 * Extract context snippet around error with ellipsis
 */
function extractContextSnippet(fullText, errorWord, contextLength = 50) {
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
    if (hasLeadingEllipsis)
        snippet = '...' + snippet;
    if (hasTrailingEllipsis)
        snippet = snippet + '...';
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
async function checkChunkWithGPT(chunk) {
    try {
        // Format: Send array of {id, tag, text}
        const input = chunk.map(node => ({
            id: node.id,
            tag: node.tag,
            text: node.text,
        }));
        const prompt = `You are a grammar and spelling checker. Fix all errors in the provided text nodes.

RULES:
1. Only fix grammar, spelling, and typos
2. Preserve HTML structure (don't modify tags)
3. Maintain original meaning
4. Don't change correct text
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
    }
    catch (error) {
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
function applyCorrections(dom, textNodes, gptResults) {
    const appliedEdits = [];
    const failedEdits = [];
    // Create map of corrections by ID
    const correctionMap = new Map();
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
        const contextSnippets = [];
        const appliedChanges = [];
        correction.changes?.forEach(change => {
            if (change && change.find && change.replace) {
                // Check if the error word exists in current text
                const wordExists = currentText.includes(change.find);
                if (!wordExists) {
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
        }
        else if (correction.changes && correction.changes.length > 0) {
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
async function checkGrammarAdvanced(html) {
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
    // Step 2: Split into chunks
    const chunks = chunkTextNodes(textNodes, CHUNK_SIZE);
    // Step 3: Process chunks in parallel
    const chunkResults = await Promise.all(chunks.map(chunk => checkChunkWithGPT(chunk)));
    // Step 4: Flatten results
    const allResults = chunkResults.flat();
    // Step 5: Apply corrections using the SAME DOM instance
    const result = applyCorrections(dom, textNodes, allResults);
    return result;
}
/**
 * 🎯 Apply custom edits (for SEO variants) using the SAME advanced tag-based logic
 * This is identical to checkGrammarAdvanced but accepts pre-generated edits from GPT
 */
async function applyCustomEdits(html, customEdits) {
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
    const corrections = [];
    textNodes.forEach((textNode, index) => {
        const nodeChanges = [];
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
