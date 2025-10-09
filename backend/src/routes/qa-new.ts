import { Router, type Request, type Response } from 'express';
import * as cheerio from 'cheerio';

const router = Router();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022';

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
  console.log('📄 [EXTRACT] Starting content extraction with Cheerio...');
  console.log(`   Input HTML length: ${html.length} chars`);
  
  const $ = cheerio.load(html);
  
  console.log('   🧹 Removing script, style, noscript, svg elements...');
  $('script, style, noscript, svg').remove();
  
  const titles: string[] = [];
  const mainText: string[] = [];
  const disclaimers: string[] = [];
  const footer: string[] = [];
  const seenText = new Set<string>();
  
  console.log('   📋 Extracting titles (h1-h6)...');
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 0 && !seenText.has(text)) {
      titles.push(text);
      seenText.add(text);
      console.log(`      Found title: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  });
  
  console.log('   📝 Extracting all text content...');
  
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
      console.log(`      Found footer: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } else if (isDisclaimer) {
      disclaimers.push(text);
      seenText.add(text);
      console.log(`      Found disclaimer: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } else {
      mainText.push(text);
      seenText.add(text);
      console.log(`      Found main text: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  });
  
  const extracted: ExtractedContent = {
    titles,
    mainText,
    disclaimers,
    footer
  };
  
  console.log('\n✅ [EXTRACT] Extraction complete:');
  console.log(`   Titles: ${titles.length}`);
  console.log(`   Main Text: ${mainText.length}`);
  console.log(`   Disclaimers: ${disclaimers.length}`);
  console.log(`   Footer: ${footer.length}`);
  console.log(`   Total items: ${titles.length + mainText.length + disclaimers.length + footer.length}\n`);
  
  if (titles.length === 0 && mainText.length === 0) {
    console.error('\n❌ ERROR: No text content extracted!\n');
    const bodyText = $('body').text().trim();
    console.log(`   📊 Debug Information:`);
    console.log(`   Body text length: ${bodyText.length} chars`);
    console.log(`   Total text nodes found: ${allTextNodes.length}`);
    console.log(`   Total elements in body: ${$('body *').length}`);
    
    if (bodyText.length > 0) {
      console.log(`\n   📄 Sample of body text (first 500 chars):`);
      console.log(`   "${bodyText.slice(0, 500)}..."`);
    }
  }
  
  return extracted;
}

function createTaggedContent(extracted: ExtractedContent): TaggedContent[] {
  console.log('🏷️  [TAG] Creating tagged content...');
  
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
    console.log(`   ✅ Tagged [${id}] (modifiable): "${text}..."`);
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
    console.log(`   ✅ Tagged [${id}] (modifiable): "${text}..."`);
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
    console.log(`   🔒 Tagged [${id}] (protected): "${text}..."`);
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
    console.log(`   🔒 Tagged [${id}] (protected): "${text}..."`);
  });
  
  console.log(`\n✅ [TAG] Created ${tagged.length} tagged items`);
  console.log(`   Modifiable: ${tagged.filter(t => t.modifiable).length}`);
  console.log(`   Protected: ${tagged.filter(t => !t.modifiable).length}\n`);
  
  return tagged;
}

async function getContentImprovementsForBatch(
  batch: TaggedContent[],
  taskType: TaskType = 'grammar'
): Promise<ContentChange[]> {
  
const grammarPrompt = `You are a grammar checker focused ONLY on critical errors.

CRITICAL INSTRUCTION: When you find errors, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields.

**IMPORTANT: Preserve ALL emojis, special characters, and Unicode symbols EXACTLY as they appear.**

ONLY FIX THESE ERRORS:
1. Spelling mistakes (e.g., "recieve" → "receive", "teh" → "the")
2. Clear grammar errors (e.g., "This are" → "These are", "He don't" → "He doesn't")
3. Obvious typos (e.g., "prdouct" → "product")
4. Chat GPT -> ChatGPT | capitalworld -> capital world | writers strike -> writer's strike | in “Bagel wah over us -> in “Bagel wsah over us


DO NOT CHANGE:
- Sentence fragments (e.g., "in front of", "your contacts") - these may be part of larger sentences
- Punctuation (unless clearly wrong)
- Sentence structure
- Numbers, prices, URLs, brand names

Context provided to help you understand fragments:
${batch.map((item, idx) => {
  const prevItem = idx > 0 ? batch[idx - 1] : null;
  const nextItem = idx < batch.length - 1 ? batch[idx + 1] : null;
  
  return `
ID: ${item.id}
Category: ${item.category}
${prevItem ? `PREVIOUS: "...${prevItem.text.slice(-50)}"` : 'PREVIOUS: (none)'}
CURRENT: "${item.text}"
${nextItem ? `NEXT: "${nextItem.text.slice(0, 50)}..."` : 'NEXT: (none)'}`;
}).join('\n\n')}

Return ONLY valid JSON array:
[
  {
    "id": "main-5",
    "original": "Complete full original text with eror here",
    "replacement": "Complete full original text with error here",
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

IF NO ACTUAL ERRORS FOUND: Return empty array [] `;

  const seoPrompt = `Optimize this content for engagement and clarity.

CRITICAL INSTRUCTION: When you suggest improvements, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields.

Content items to optimize:
${batch.map(item => `
ID: ${item.id}
Category: ${item.category}
FULL TEXT: "${item.text}"
`).join('\n')}

Return ONLY a valid JSON array.

CRITICAL JSON RULES:
- Return ONLY valid JSON - no markdown, no explanations
- All string values MUST be properly escaped
- Use backslash-quote for quotes inside strings
- NO trailing commas
- NO single quotes - use double quotes only

Example format:
[
  {
    "id": "title-1",
    "original": "Complete full original text here",
    "replacement": "Complete full improved text here",
    "reason": "explain improvements made",
    "changeType": "engagement",
    "confidence": 0.95
  }
]

RULES:
- Return ONLY valid JSON - no markdown
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
    console.log(`      🔄 Attempt ${attempt}/${MAX_RETRIES}...`);

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
      
      console.log(`      ✅ Response received (${content.length} chars)`);
      
      conversationHistory.push({
        role: 'assistant',
        content: content
      });
      
      if (attempt === 1) {
        console.log(`      📝 Raw response preview: "${content.slice(0, 500)}..."`);
      }
      
      let jsonStr = content.trim();
      
      if (jsonStr.startsWith('```json')) {
        console.log(`      🔧 Removing \`\`\`json wrapper...`);
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        console.log(`      🔧 Removing \`\`\` wrapper...`);
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const arrayEnd = jsonStr.lastIndexOf(']');
      if (arrayEnd > 0 && arrayEnd < jsonStr.length - 1) {
        console.log(`      🔧 Trimming content after JSON array...`);
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
          console.log(`      🔍 Context around error (position ${pos}):`);
          console.log(`      "${jsonStr.slice(start, end)}"`);
          console.log(`      ${' '.repeat(Math.min(100, pos - start))}^ ERROR HERE`);
        }
        
        if (jsonStr.length < 2000) {
          console.log(`      📄 Full JSON string:\n${jsonStr}`);
        }
        
        throw parseError;
      }
      
      const changes: ContentChange[] = Array.isArray(parsed) ? parsed : [];
      
      console.log(`      ✅ Parsed ${changes.length} suggestions\n`);
      
      return changes;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`      ❌ Attempt ${attempt} failed: ${errorMessage}`);
      
      if (errorMessage.includes('JSON') || errorMessage.includes('Unexpected token') || errorMessage.includes('Expected')) {
        if (attempt < MAX_RETRIES) {
          console.log(`      🔄 Retrying with stricter instructions...\n`);
          
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
  console.log(`\n🔄 [CONSOLIDATE] Deduplicating ${changes.length} changes...`);
  
  const changeMap = new Map<string, ContentChange>();
  
  for (const change of changes) {
    if (!changeMap.has(change.id)) {
      changeMap.set(change.id, change);
      console.log(`   ✅ Added [${change.id}] (${change.original.length} chars)`);
    } else {
      console.log(`   ⏭️  Skipped duplicate [${change.id}]`);
    }
  }
  
  const consolidated = Array.from(changeMap.values());
  console.log(`✅ [CONSOLIDATE] Result: ${changes.length} → ${consolidated.length} unique changes\n`);
  
  return consolidated;
}

async function getContentImprovements(
  taggedContent: TaggedContent[],
  taskType: TaskType = 'grammar'
): Promise<ContentChange[]> {
  console.log(`📤 [SONNET] Requesting ${taskType} improvements with batching...`);
  
  const modifiable = taggedContent.filter(c => c.modifiable);
  console.log(`   Total modifiable items: ${modifiable.length}`);
  console.log(`   Skipping ${taggedContent.length - modifiable.length} protected items\n`);
  
  const BATCH_SIZE = 20;
  const allChanges: ContentChange[] = [];
  const totalBatches = Math.ceil(modifiable.length / BATCH_SIZE);
  
  console.log(`   📦 Processing in ${totalBatches} batches of ${BATCH_SIZE} items each\n`);
  
  for (let i = 0; i < modifiable.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = modifiable.slice(i, i + BATCH_SIZE);
    
    console.log(`   🔨 Batch ${batchNum}/${totalBatches} (items ${i + 1}-${Math.min(i + BATCH_SIZE, modifiable.length)}):`);
    
    try {
      const batchChanges = await getContentImprovementsForBatch(batch, taskType);
      
      const restoredChanges = batchChanges.map(change => {
        const originalContent = taggedContent.find(t => t.id === change.id);
        if (originalContent) {
          return restoreEmojisInChange(change, originalContent);
        }
        return change;
      });
      
      allChanges.push(...restoredChanges);
      console.log(`   ✅ Batch ${batchNum} complete: ${restoredChanges.length} suggestions (emojis restored)\n`);
    } catch (error) {
      console.error(`   ❌ Batch ${batchNum} failed:`, error);
      console.log(`   ⚠️  Continuing with next batch...\n`);
    }
    
    if (i + BATCH_SIZE < modifiable.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`📊 [SONNET] Raw results: ${allChanges.length} total suggestions\n`);
  
  const consolidatedChanges = consolidateChanges(allChanges);
  
  console.log(`✅ [SONNET] Final: ${consolidatedChanges.length} unique full-text corrections\n`);
  
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
  console.log(`   🔍 [VALIDATE] Checking: ${change.id}`);
  
  const failed: string[] = [];
  
  if (change.original !== original.text) {
    console.log(`      ⚠️  Original text mismatch (non-blocking)`);
  }
  
  const similarity = calculateSimilarity(change.original, change.replacement);
  const minSimilarity = taskType === 'seo' ? 0.75 : 0.80;
  const maxSimilarity = 0.995; // ✅ CHANGED from 0.99 to 0.995
  
  console.log(`      📊 Similarity: ${(similarity * 100).toFixed(1)}% (need ${minSimilarity * 100}-${maxSimilarity * 100}%)`);
  
//   if (similarity < minSimilarity || similarity >= maxSimilarity) {
//     failed.push('SIMILARITY_OUT_OF_RANGE');
//     console.log(`      ❌ FAILED: Similarity out of range`);
//   }
  
  const hasNewFacts = checkForNewFacts(change.original, change.replacement);
  if (hasNewFacts) {
    failed.push('NEW_FACTS_DETECTED');
    console.log(`      ❌ FAILED: New facts/numbers detected`);
  }
  
  const origWords = change.original.split(/\s+/).length;
  const newWords = change.replacement.split(/\s+/).length;
  const wordDiff = Math.abs(newWords - origWords);
  const maxWordDiff = taskType === 'seo' ? 4 : 3;
  
  console.log(`      📝 Word count: ${origWords} → ${newWords} (diff: ${wordDiff}, max: ${maxWordDiff})`);
  
  if (original.category === 'title' && wordDiff > maxWordDiff) {
    failed.push('TITLE_WORD_COUNT');
    console.log(`      ❌ FAILED: Title word count exceeded`);
  } else if (wordDiff > 5) {
    failed.push('WORD_COUNT_CHANGE');
    console.log(`      ❌ FAILED: Word count change exceeded`);
  }
  
  const maxLengthChange = taskType === 'seo' ? 0.30 : 0.25;
  const lengthChange = Math.abs(change.replacement.length - change.original.length) / change.original.length;
  
  console.log(`      📏 Length change: ${(lengthChange * 100).toFixed(1)}% (max: ${maxLengthChange * 100}%)`);
  
  if (lengthChange > maxLengthChange) {
    failed.push('LENGTH_CHANGE_TOO_LARGE');
    console.log(`      ❌ FAILED: Length change too large`);
  }
  
  const passed = failed.length === 0;
  
  if (passed) {
    console.log(`      ✅ All gates PASSED`);
  } else {
    console.log(`      ❌ Gates failed: ${failed.join(', ')}`);
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
  console.log('🔄 [APPLY] Validating and applying changes...\n');
  
  const applied: ContentChange[] = [];
  const skipped: ContentChange[] = [];
  
  console.log(`   📋 Validating ${changes.length} changes...`);
  for (const change of changes) {
    const original = taggedContent.find(c => c.id === change.id);
    
    if (!original) {
      console.log(`   ⚠️  Cannot find original for: ${change.id} - SKIPPING`);
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
  
  console.log(`\n   ✅ Validation complete:`);
  console.log(`      To apply: ${applied.length}`);
  console.log(`      To skip: ${skipped.length}\n`);
  
  const stats = {
    totalSuggestions: changes.length,
    autoApplied: applied.length,
    manualReview: skipped.length,
    successRate: changes.length > 0 ? `${((applied.length / changes.length) * 100).toFixed(1)}%` : '0%'
  };
  
  console.log('📊 [STATS]');
  console.log(`   Total suggestions: ${stats.totalSuggestions}`);
  console.log(`   Auto-applied: ${stats.autoApplied}`);
  console.log(`   Manual review: ${stats.manualReview}`);
  console.log(`   Success rate: ${stats.successRate}\n`);
  
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
  console.log('🔄 [APPLY-HTML] Applying changes to HTML using ID matching...\n');
  
  if (approvedChanges.length === 0) {
    console.log('   ℹ️  No changes to apply, returning original HTML\n');
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
  
  console.log(`   📋 Processing ${approvedChanges.length} approved changes...\n`);
  
  let appliedCount = 0;
  let skippedCount = 0;
  
  for (const change of approvedChanges) {
    const tagged = taggedMap.get(change.id);
    
    if (!tagged) {
      console.log(`   ⚠️  [${change.id}] No tagged content found (skipped)`);
      skippedCount++;
      continue;
    }
    
    console.log(`   🔍 Processing [${change.id}] (${tagged.category})`);
    console.log(`      Original: "${change.original}..."`);
    console.log(`      Replace:  "${change.replacement}..."`);
    
    try {
      const success = replaceTextInHtml($, tagged, change);
      
      if (success) {
        appliedCount++;
        console.log(`      ✅ Applied successfully`);
      } else {
        skippedCount++;
        console.log(`      ⚠️  Could not find exact text in HTML (skipped)`);
      }
    } catch (error) {
      skippedCount++;
      console.error(`      ❌ Error applying change:`, error);
    }
  }
  
  console.log(`\n   📊 Results:`);
  console.log(`      Applied: ${appliedCount}`);
  console.log(`      Skipped: ${skippedCount}\n`);
  
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
    console.log('\n' + '='.repeat(70));
    console.log('🚀 GOLDEN (GRAMMAR) PROCESSING STARTED');
    console.log('='.repeat(70) + '\n');
    
    const templateId = String(req.params.id);
    const html = String(req.body?.html || '').trim();
    
    if (!html) {
      console.log('❌ No HTML provided in request body\n');
      return res.status(400).json({ 
        code: 'MISSING_HTML', 
        message: 'HTML content is required in request body' 
      });
    }
    
    console.log(`📄 Template ID: ${templateId}`);
    console.log(`📄 HTML length: ${html.length} chars\n`);
    
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    const changes = await getContentImprovements(tagged, 'grammar');
    const result = applyChangesToHtml(html, tagged, changes, 'grammar');
    const goldenHtml = applyChangesToHtmlById(html, tagged, result.applied);
    
    console.log('='.repeat(70));
    console.log('✅ GOLDEN (GRAMMAR) PROCESSING COMPLETE');
    console.log('='.repeat(70) + '\n');
    
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
    console.log('\n' + '='.repeat(70));
    console.log('🚀 SEO OPTIMIZATION PROCESSING STARTED');
    console.log('='.repeat(70) + '\n');
    
    const templateId = String(req.params.id);
    const html = String(req.body?.html || '').trim();
    
    if (!html) {
      console.log('❌ No HTML provided in request body\n');
      return res.status(400).json({ 
        code: 'MISSING_HTML', 
        message: 'HTML content is required in request body' 
      });
    }
    
    console.log(`📄 Template ID: ${templateId}`);
    console.log(`📄 HTML length: ${html.length} chars\n`);
    
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    const changes = await getContentImprovements(tagged, 'seo');
    const result = applyChangesToHtml(html, tagged, changes, 'seo');
    const optimizedHtml = applyChangesToHtmlById(html, tagged, result.applied);
    
    console.log('='.repeat(70));
    console.log('✅ SEO OPTIMIZATION PROCESSING COMPLETE');
    console.log('='.repeat(70) + '\n');
    
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