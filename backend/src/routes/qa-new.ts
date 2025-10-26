
// DUMMY FILE USED FOR FUTURE BACKUP AND REFERENCE
import { Router, type Request, type Response } from 'express';
import * as cheerio from 'cheerio';

const router = Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

interface ExtractedContent {
  titles: string[];
  mainText: string[];
  disclaimers: string[];
  footer: string[];
}

type ContentCategory = 'title' | 'main' | 'disclaimer' | 'footer';

interface TaggedContent {
  id: string;
  category: ContentCategory;
  index: number;
  text: string;
  modifiable: boolean;
}

interface ContentChange {
  id: string;
  original: string;
  replacement: string;
  reason: string;
  changeType: string;
  confidence?: number;
  before_context?: string;  
  after_context?: string;
}

type TaskType = 'grammar' | 'seo';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ValidationResult {
  passed: boolean;
  failedGates: string[];
  shouldAutoApply: boolean;
  shouldManualReview: boolean;
  similarity?: number;
  reason?: string;
}

interface ApplyResult {
  applied: ContentChange[];
  skipped: ContentChange[];
  stats: {
    totalSuggestions: number;
    autoApplied: number;
    manualReview: number;
    successRate: string;
  };
}

function restoreEmojisInChange(
  change: ContentChange,
  originalTaggedContent: TaggedContent
): ContentChange {
  const fullOriginal = originalTaggedContent.text;
  const emojiRegex = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
  const emojisInOriginal = fullOriginal.match(emojiRegex) || [];
  
  if (emojisInOriginal.length === 0) {
    return change;
  }
  
  let restoredOriginal = change.original;
  let restoredReplacement = change.replacement;
  let emojiIndex = 0;
  const placeholderPattern = /\?\?+|\?|^\d{1,3}\s+/g;
  
  restoredOriginal = restoredOriginal.replace(placeholderPattern, () => {
    if (emojiIndex < emojisInOriginal.length) {
      return emojisInOriginal[emojiIndex++];
    }
    return '?';
  });
  
  emojiIndex = 0;
  
  restoredReplacement = restoredReplacement.replace(placeholderPattern, () => {
    if (emojiIndex < emojisInOriginal.length) {
      return emojisInOriginal[emojiIndex++];
    }
    return '?';
  });
  
  return {
    ...change,
    original: restoredOriginal,
    replacement: restoredReplacement
  };
}

function extractContentWithCheerio(html: string): ExtractedContent {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  
  const titles: string[] = [];
  const mainText: string[] = [];
  const disclaimers: string[] = [];
  const footer: string[] = [];
  const seenText = new Set<string>();
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 0 && !seenText.has(text)) {
      titles.push(text);
      seenText.add(text);
    }
  });
  const allTextNodes = $('body')
    .find('*')
    .addBack()
    .contents()
    .filter(function() {
      return this.type === 'text' && $(this).text().trim().length > 0;
    });
  
  allTextNodes.each((_, node) => {
    const text = $(node).text().trim();
    
    if (!text || text.length < 5 || seenText.has(text)) {
      return;
    }
    
    const $parent = $(node).parent();
    
    if ($parent.is('h1, h2, h3, h4, h5, h6')) {
      return;
    }
    
    const inFooter = $parent.closest('footer, .footer, [class*="footer"], [id*="footer"]').length > 0;
    const isDisclaimer = /terms|conditions|privacy|policy|disclaimer|all rights reserved|unsubscribe|copyright|©/i.test(text);
    
    if (inFooter) {
      footer.push(text);
      seenText.add(text);
    } else if (isDisclaimer) {
      disclaimers.push(text);
      seenText.add(text);
    } else {
      mainText.push(text);
      seenText.add(text);
    }
  });
  
  const extracted: ExtractedContent = {
    titles,
    mainText,
    disclaimers,
    footer
  };
  if (titles.length === 0 && mainText.length === 0) {
    console.error('\n❌ ERROR: No text content extracted!\n');
    const bodyText = $('body').text().trim();
    if (bodyText.length > 0) {
    }
  }
  
  return extracted;
}

function createTaggedContent(extracted: ExtractedContent): TaggedContent[] {
  const tagged: TaggedContent[] = [];
  
  extracted.titles.forEach((text, idx) => {
    const id = `title-${idx}`;
    tagged.push({
      id,
      category: 'title',
      index: idx,
      text: text,
      modifiable: true
    });
  });
  
  extracted.mainText.forEach((text, idx) => {
    const id = `main-${idx}`;
    tagged.push({
      id,
      category: 'main',
      index: idx,
      text: text,
      modifiable: true
    });
  });
  
  extracted.disclaimers.forEach((text, idx) => {
    const id = `disclaimer-${idx}`;
    tagged.push({
      id,
      category: 'disclaimer',
      index: idx,
      text: text,
      modifiable: false
    });
  });
  
  extracted.footer.forEach((text, idx) => {
    const id = `footer-${idx}`;
    tagged.push({
      id,
      category: 'footer',
      index: idx,
      text: text,
      modifiable: false
    });
  });
  return tagged;
}

// ADD THIS NEW FUNCTION (place it near the top with other helper functions)
function extractContextFromHtml(
  html: string,
  targetText: string,
  contextChars: number = 50
): { before: string; after: string } {
  // Normalize the target text for searching
  const normalizedTarget = normalizeText(targetText);
  
  // Load HTML and get plain text
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const fullText = $('body').text();
  const normalizedFullText = normalizeText(fullText);
  
  // Find the target in the full text
  const index = normalizedFullText.indexOf(normalizedTarget);
  
  if (index === -1) {
    return { before: '', after: '' };
  }
  
  // Extract context
  const beforeStart = Math.max(0, index - contextChars);
  const before = normalizedFullText.slice(beforeStart, index).trim();
  
  const afterEnd = Math.min(normalizedFullText.length, index + normalizedTarget.length + contextChars);
  const after = normalizedFullText.slice(index + normalizedTarget.length, afterEnd).trim();
  
  return { before, after };
}

// Add this new helper function for extracting context
function extractContext(
  allTagged: TaggedContent[],
  currentItem: TaggedContent,
  contextChars: number = 40
): { before: string; after: string } {
  const currentIndex = allTagged.findIndex(t => t.id === currentItem.id);
  
  if (currentIndex === -1) {
    return { before: '', after: '' };
  }
  
  // Get previous items for before context
  let before = '';
  for (let i = currentIndex - 1; i >= 0 && before.length < contextChars; i--) {
    const prevText = allTagged[i].text;
    if (before.length === 0) {
      // Take end of previous item
      before = prevText.slice(-contextChars);
    } else {
      before = prevText + ' ' + before;
      if (before.length > contextChars) {
        before = before.slice(-contextChars);
        break;
      }
    }
  }
  
  // Get next items for after context
  let after = '';
  for (let i = currentIndex + 1; i < allTagged.length && after.length < contextChars; i++) {
    const nextText = allTagged[i].text;
    if (after.length === 0) {
      // Take start of next item
      after = nextText.slice(0, contextChars);
    } else {
      after = after + ' ' + nextText;
      if (after.length > contextChars) {
        after = after.slice(0, contextChars);
        break;
      }
    }
  }
  
  // Trim to exact length
  before = before.slice(-contextChars);
  after = after.slice(0, contextChars);
  
  return { before, after };
}

// REPLACE your existing getContentImprovementsForBatch with this:
async function getContentImprovementsForBatch(
  batch: TaggedContent[],
  allTagged: TaggedContent[], // 👈 NEW PARAMETER
  taskType: TaskType = 'grammar'
): Promise<ContentChange[]> {
  
const grammarPrompt = `You are a grammar checker focused ONLY on critical errors.

CRITICAL INSTRUCTION: When you find errors, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields.

**IMPORTANT: Preserve ALL emojis, special characters, and Unicode symbols EXACTLY as they appear.**

ONLY FIX THESE ERRORS:
1. Spelling mistakes (e.g., "recieve" → "receive", "teh" → "the")
2. Clear grammar errors (e.g., "This are" → "These are", "He don't" → "He doesn't")
3. Obvious typos (e.g., "prdouct" → "product")
4. Chat GPT -> ChatGPT | capitalworld -> capital world | writers strike -> writer's strike

DO NOT CHANGE:
- Sentence fragments - these may be part of larger sentences
- Punctuation (unless clearly wrong)
- Sentence structure
- Numbers, prices, URLs, brand names

Context provided to help you understand fragments:
${batch.map((item) => {
  const context = extractContext(allTagged, item, 50);
  
  return `
ID: ${item.id}
Category: ${item.category}
BEFORE CONTEXT: "${context.before}"
CURRENT TEXT: "${item.text}"
AFTER CONTEXT: "${context.after}"`;
}).join('\n\n')}

Return ONLY valid JSON array. Each edit MUST include:
- "id": the ID of the item
- "original": COMPLETE FULL original text with error
- "replacement": COMPLETE FULL corrected text
- "before_context": text that appears BEFORE this item (provided above)
- "after_context": text that appears AFTER this item (provided above)
- "reason": what was fixed
- "changeType": "spelling" | "grammar" | "typo"
- "confidence": 0.0 to 1.0

Example:
[
  {
    "id": "main-5",
    "original": "Complete full original text with eror here",
    "replacement": "Complete full original text with error here",
    "before_context": "previous sentence ending here",
    "after_context": "next sentence starting here",
    "reason": "Fixed spelling: 'eror' → 'error'",
    "changeType": "spelling",
    "confidence": 0.99
  }
]

CRITICAL JSON RULES:
- Return ONLY valid JSON - no markdown, no explanations
- Properly escape all quotes and special characters
- NO trailing commas
- Use double quotes only

IF NO ACTUAL ERRORS FOUND: Return empty array []`;

  const seoPrompt = `Optimize this content for engagement and clarity.

CRITICAL INSTRUCTION: When you suggest improvements, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields.

Content items with context:
${batch.map((item) => {
  const context = extractContext(allTagged, item, 50);
  
  return `
ID: ${item.id}
Category: ${item.category}
BEFORE CONTEXT: "${context.before}"
CURRENT TEXT: "${item.text}"
AFTER CONTEXT: "${context.after}"`;
}).join('\n\n')}

Return ONLY valid JSON array. Each edit MUST include:
- "id": the ID of the item
- "original": COMPLETE FULL original text
- "replacement": COMPLETE FULL improved text
- "before_context": text that appears BEFORE this item (provided above)
- "after_context": text that appears AFTER this item (provided above)
- "reason": explain improvements made
- "changeType": "engagement" | "clarity" | "word_choice"
- "confidence": 0.0 to 1.0

Example:
[
  {
    "id": "title-1",
    "original": "Complete full original text here",
    "replacement": "Complete full improved text here",
    "before_context": "previous content",
    "after_context": "next content",
    "reason": "Improved clarity and engagement",
    "changeType": "engagement",
    "confidence": 0.95
  }
]

CRITICAL JSON RULES:
- Return ONLY valid JSON - no markdown, no explanations
- All string values MUST be properly escaped
- Use backslash-quote for quotes inside strings
- NO trailing commas
- NO single quotes - use double quotes only

RULES:
- Return ONLY valid JSON
- ALWAYS include the COMPLETE FULL TEXT
- Keep 90%+ similarity to original
- DO NOT change numbers, prices, or brand names`;

  const initialPrompt = taskType === 'seo' ? seoPrompt : grammarPrompt;
  const MAX_RETRIES = 5;
  let attempt = 0;
  const conversationHistory: ConversationMessage[] = [];
  
  conversationHistory.push({
    role: 'user',
    content: initialPrompt
  });

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 8192,
          messages: conversationHistory
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`      ❌ Sonnet API error ${response.status}: ${errorText}`);
        throw new Error(`Sonnet API error ${response.status}: ${errorText}`);
      }

      const data: any = await response.json();
      const content = data.content?.[0]?.text || '[]';
      conversationHistory.push({
        role: 'assistant',
        content: content
      });
      
      if (attempt === 1) {
      }
      
      let jsonStr = content.trim();
      
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const arrayEnd = jsonStr.lastIndexOf(']');
      if (arrayEnd > 0 && arrayEnd < jsonStr.length - 1) {
        jsonStr = jsonStr.substring(0, arrayEnd + 1);
      }
      
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`      ❌ JSON Parse Error: ${errorMsg}`);
        
        const match = errorMsg.match(/position (\d+)/);
        if (match) {
          const pos = parseInt(match[1]);
          const start = Math.max(0, pos - 100);
          const end = Math.min(jsonStr.length, pos + 100);
        }
        
        if (jsonStr.length < 2000) {
        }
        
        throw parseError;
      }
      
      const changes: ContentChange[] = Array.isArray(parsed) ? parsed : [];
      changes.forEach((change, idx) => {
      });
      
      // 👇 ADD VALIDATION: Ensure before_context and after_context are present
      const validatedChanges = changes.filter(change => {
        if (!change.before_context && !change.after_context) {
        }
        return true; // Accept all changes but log warning
      });
      return validatedChanges;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`      ❌ Attempt ${attempt} failed: ${errorMessage}`);
      
      if (errorMessage.includes('JSON') || errorMessage.includes('Unexpected token') || errorMessage.includes('Expected')) {
        if (attempt < MAX_RETRIES) {
          conversationHistory.push({
            role: 'user',
            content: `ERROR: Your response was not valid JSON. Error: "${errorMessage}".

CRITICAL: You MUST fix these issues:
1. Properly escape ALL quotes inside strings using backslash-quote
2. Properly escape ALL backslashes using double-backslash
3. Do NOT use single quotes - ONLY double quotes
4. Remove ANY text after the closing bracket
5. Do NOT add explanations or comments
6. Make sure ALL strings are properly closed
7. Check for unescaped newlines or special characters

Return ONLY a valid JSON array with this EXACT format (no markdown, no extras):
[
  {
    "id": "title-0",
    "original": "complete text here",
    "replacement": "corrected text here",
    "before_context": "text before",
    "after_context": "text after",
    "reason": "what was fixed",
    "changeType": "spelling",
    "confidence": 0.95
  }
]

Return the corrected JSON now:`
          });
          
          continue;
        } else {
          console.error(`      ❌ Max retries reached. Returning empty array.\n`);
          return [];
        }
      } else {
        throw error;
      }
    }
  }
  
  console.error(`      ❌ Unexpected: Exited retry loop without returning. Returning empty array.\n`);
  return [];
}


function consolidateChanges(changes: ContentChange[]): ContentChange[] {
  const changeMap = new Map<string, ContentChange>();
  
  for (const change of changes) {
    if (!changeMap.has(change.id)) {
      changeMap.set(change.id, change);
    } else {
    }
  }
  
  const consolidated = Array.from(changeMap.values());
  return consolidated;
}

// REPLACE your existing getContentImprovements with this:
async function getContentImprovements(
  taggedContent: TaggedContent[],
  taskType: TaskType = 'grammar'
): Promise<ContentChange[]> {
  const modifiable = taggedContent.filter(c => c.modifiable);
  const BATCH_SIZE = 20;
  const allChanges: ContentChange[] = [];
  const totalBatches = Math.ceil(modifiable.length / BATCH_SIZE);
  for (let i = 0; i < modifiable.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = modifiable.slice(i, i + BATCH_SIZE);
    try {
      // 👇 PASS taggedContent as second parameter
      const batchChanges = await getContentImprovementsForBatch(batch, taggedContent, taskType);
      
      const restoredChanges = batchChanges.map(change => {
        const originalContent = taggedContent.find(t => t.id === change.id);
        if (originalContent) {
          return restoreEmojisInChange(change, originalContent);
        }
        return change;
      });
      
      allChanges.push(...restoredChanges);
    } catch (error) {
      console.error(`   ❌ Batch ${batchNum} failed:`, error);
    }
    
    if (i + BATCH_SIZE < modifiable.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const consolidatedChanges = consolidateChanges(allChanges);
  consolidatedChanges.sort((a, b) => {
    const aNum = parseInt(a.id.split('-')[1]) || 0;
    const bNum = parseInt(b.id.split('-')[1]) || 0;
    return aNum - bNum;
  });
  
  return consolidatedChanges;
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1.0;
  
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

function levenshteinDistance(s1: string, s2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[s2.length][s1.length];
}

function checkForNewFacts(original: string, replacement: string): boolean {
  const origNumbers: string[] = original.match(/\d+/g) || [];
  const newNumbers: string[] = replacement.match(/\d+/g) || [];
  
  for (const num of newNumbers) {
    if (!origNumbers.includes(num)) {
      return true;
    }
  }
  
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const origEmails: string[] = original.match(emailRegex) || [];
  const newEmails: string[] = replacement.match(emailRegex) || [];
  
  for (const email of newEmails) {
    if (!origEmails.includes(email)) {
      return true;
    }
  }
  
  const urlRegex = /https?:\/\/[^\s]+/g;
  const origUrls: string[] = original.match(urlRegex) || [];
  const newUrls: string[] = replacement.match(urlRegex) || [];
  
  for (const url of newUrls) {
    if (!origUrls.includes(url)) {
      return true;
    }
  }
  
  return false;
}

function validateChange(
  change: ContentChange,
  original: TaggedContent,
  taskType: TaskType = 'grammar'
): ValidationResult {
  const failed: string[] = [];
  
  if (change.original !== original.text) {
  }
  
  const similarity = calculateSimilarity(change.original, change.replacement);
  const minSimilarity = taskType === 'seo' ? 0.75 : 0.80;
  const maxSimilarity = 0.995; // ✅ CHANGED from 0.99 to 0.995
//   if (similarity < minSimilarity || similarity >= maxSimilarity) {
//     failed.push('SIMILARITY_OUT_OF_RANGE');
//     console.log(`      ❌ FAILED: Similarity out of range`);
//   }
  
  const hasNewFacts = checkForNewFacts(change.original, change.replacement);
  if (hasNewFacts) {
    failed.push('NEW_FACTS_DETECTED');
  }
  
  const origWords = change.original.split(/\s+/).length;
  const newWords = change.replacement.split(/\s+/).length;
  const wordDiff = Math.abs(newWords - origWords);
  const maxWordDiff = taskType === 'seo' ? 4 : 3;
  if (original.category === 'title' && wordDiff > maxWordDiff) {
    failed.push('TITLE_WORD_COUNT');
  } else if (wordDiff > 5) {
    failed.push('WORD_COUNT_CHANGE');
  }
  
  const maxLengthChange = taskType === 'seo' ? 0.30 : 0.25;
  const lengthChange = Math.abs(change.replacement.length - change.original.length) / change.original.length;
  if (lengthChange > maxLengthChange) {
    failed.push('LENGTH_CHANGE_TOO_LARGE');
  }
  
  const passed = failed.length === 0;
  
  if (passed) {
  } else {
  }
  
  return {
    passed,
    failedGates: failed,
    shouldAutoApply: passed,
    shouldManualReview: !passed,
    similarity,
    reason: failed.length > 0 ? failed.join(', ') : undefined
  };
}

function applyChangesToHtml(
  originalHtml: string,
  taggedContent: TaggedContent[],
  changes: ContentChange[],
  taskType: TaskType = 'grammar'
): ApplyResult {
  const applied: ContentChange[] = [];
  const skipped: ContentChange[] = [];
  for (const change of changes) {
    const original = taggedContent.find(c => c.id === change.id);
    
    if (!original) {
      skipped.push(change);
      continue;
    }
    
    const validation = validateChange(change, original, taskType);
    
    if (!validation.shouldAutoApply) {
      skipped.push(change);
    } else {
      applied.push(change);
    }
  }
  const stats = {
    totalSuggestions: changes.length,
    autoApplied: applied.length,
    manualReview: skipped.length,
    successRate: changes.length > 0 ? `${((applied.length / changes.length) * 100).toFixed(1)}%` : '0%'
  };
  return {
    applied,
    skipped,
    stats
  };
}

function normalizeText(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&rdquo;/gi, '"')
    .replace(/&ldquo;/gi, '"')
    .replace(/&hellip;/gi, '...')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/&#(\d+);/gi, (match, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function applyChangesToHtmlById(
  originalHtml: string,
  taggedContent: TaggedContent[],
  approvedChanges: ContentChange[]
): string {
  if (approvedChanges.length === 0) {
    return originalHtml;
  }
  
  const $ = cheerio.load(originalHtml);
  
  const changeMap = new Map<string, ContentChange>();
  approvedChanges.forEach(change => {
    changeMap.set(change.id, change);
  });
  
  const taggedMap = new Map<string, TaggedContent>();
  taggedContent.forEach(tagged => {
    taggedMap.set(tagged.id, tagged);
  });
  let appliedCount = 0;
  let skippedCount = 0;
  
  for (const change of approvedChanges) {
    const tagged = taggedMap.get(change.id);
    
    if (!tagged) {
      skippedCount++;
      continue;
    }
    try {
      const success = replaceTextInHtml($, tagged, change);
      
      if (success) {
        appliedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      skippedCount++;
      console.error(`      ❌ Error applying change:`, error);
    }
  }
  return $.html();
}

function replaceTextInHtml(
  $: cheerio.CheerioAPI,
  tagged: TaggedContent,
  change: ContentChange
): boolean {
  const targetText = tagged.text;
  const sonnetOriginal = change.original;
  const newText = change.replacement;
  
  let searchSelector = 'body *';
  
  switch (tagged.category) {
    case 'title':
      searchSelector = 'h1, h2, h3, h4, h5, h6';
      break;
    case 'main':
      searchSelector = 'p, li, div, span, td, th, a';
      break;
    case 'disclaimer':
      searchSelector = 'p, div, span, small';
      break;
    case 'footer':
      searchSelector = 'footer *, .footer *';
      break;
  }
  
  let found = false;
  
  const normalizedTarget = normalizeText(targetText);
  const normalizedSonnet = normalizeText(sonnetOriginal);
  
  $(searchSelector).each((_, element) => {
    if (found) return false;
    
    const elementText = $(element).text();
    const normalizedElement = normalizeText(elementText);
    
    if (elementText === targetText || elementText === sonnetOriginal) {
      $(element).text(newText);
      found = true;
      return false;
    }
    
    if (normalizedElement === normalizedTarget || normalizedElement === normalizedSonnet) {
      $(element).text(newText);
      found = true;
      return false;
    }
    
    if (normalizedElement.includes(normalizedTarget) || normalizedElement.includes(normalizedSonnet)) {
      $(element).contents().each((__, node) => {
        if (found) return false;
        
        if (node.type === 'text' && node.data) {
          const nodeText = node.data;
          const normalizedNode = normalizeText(nodeText);
          
          if (nodeText === targetText || nodeText === sonnetOriginal) {
            node.data = newText;
            found = true;
            return false;
          }
          
          if (normalizedNode === normalizedTarget || normalizedNode === normalizedSonnet) {
            node.data = newText;
            found = true;
            return false;
          }
          
          if (normalizedNode.includes(normalizedTarget)) {
            const startIdx = normalizedNode.indexOf(normalizedTarget);
            if (startIdx !== -1) {
              const beforeLength = normalizedNode.slice(0, startIdx).length;
              const targetLength = targetText.length;
              
              node.data = nodeText.slice(0, beforeLength) + newText + nodeText.slice(beforeLength + targetLength);
              found = true;
              return false;
            }
          }
        }
      });
    }
  });
  
  return found;
}

router.post('/:id/golden', async (req: Request, res: Response) => {
  try {
    const templateId = String(req.params.id);
    const html = String(req.body?.html || '').trim();
    
    if (!html) {
      return res.status(400).json({ 
        code: 'MISSING_HTML', 
        message: 'HTML content is required in request body' 
      });
    }
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    const changes = await getContentImprovements(tagged, 'grammar');
    const result = applyChangesToHtml(html, tagged, changes, 'grammar');
    const goldenHtml = applyChangesToHtmlById(html, tagged, result.applied);
    res.json({
      html: goldenHtml,
      edits: result.applied.map(c => ({
        find: c.original,
        replace: c.replacement,
        before_context: '',
        after_context: '',
        reason: c.reason,
        changeType: c.changeType,
        confidence: c.confidence,
        id: c.id
      })),
      stats: result.stats
    });
    
  } catch (err: unknown) {
    console.error('❌ [ERROR] Unexpected error:', err);
    res.status(500).json({ 
      code: 'GOLDEN_ERROR', 
      message: 'Unexpected error during processing',
      error: String(err)
    });
  }
});

router.post('/:id/seo', async (req: Request, res: Response) => {
  try {
    const templateId = String(req.params.id);
    const html = String(req.body?.html || '').trim();
    
    if (!html) {
      return res.status(400).json({ 
        code: 'MISSING_HTML', 
        message: 'HTML content is required in request body' 
      });
    }
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    const changes = await getContentImprovements(tagged, 'seo');
    const result = applyChangesToHtml(html, tagged, changes, 'seo');
    const optimizedHtml = applyChangesToHtmlById(html, tagged, result.applied);
    res.json({
      html: optimizedHtml,
      edits: result.applied.map(c => ({
        find: c.original,
        replace: c.replacement,
        before_context: '',
        after_context: '',
        reason: c.reason,
        changeType: c.changeType,
        confidence: c.confidence,
        id: c.id
      })),
      stats: result.stats
    });
    
  } catch (err: unknown) {
    console.error('❌ [ERROR] SEO processing failed:', err);
    res.status(500).json({ 
      code: 'SEO_ERROR', 
      message: String(err)
    });
  }
});

router.post('/:id/test-extraction', async (req: Request, res: Response) => {
  try {
    const html = String(req.body?.html || '').trim();
    
    if (!html) {
      return res.status(400).json({ message: 'HTML required' });
    }
    
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    
    res.json({
      extracted,
      tagged,
      summary: {
        titles: extracted.titles.length,
        mainText: extracted.mainText.length,
        disclaimers: extracted.disclaimers.length,
        footer: extracted.footer.length,
        totalTagged: tagged.length,
        modifiable: tagged.filter(t => t.modifiable).length,
        protected: tagged.filter(t => !t.modifiable).length
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;