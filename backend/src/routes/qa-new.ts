import { Router, type Request, type Response } from 'express';
import * as cheerio from 'cheerio';

const router = Router();

// Anthropic Claude API key
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.HAIKU_MODEL || 'claude-3-5-haiku-20241022';

/* ================================================================
   STEP 1: EXTRACT CONTENT WITH CHEERIO (NO HAIKU)
   ================================================================ */

   // ✅ BEST: Uses Unicode emoji property (catches everything)
function restoreEmojisInChange(
  change: ContentChange,
  originalTaggedContent: TaggedContent
): ContentChange {
  const fullOriginal = originalTaggedContent.text;
  
  // ✅ This regex catches ALL emojis (including compound emojis)
  const emojiRegex = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;
  const emojisInOriginal = fullOriginal.match(emojiRegex) || [];
  
  if (emojisInOriginal.length === 0) {
    return change;
  }
  
  let restoredOriginal = change.original;
  let restoredReplacement = change.replacement;
  
  // Replace placeholders with actual emojis
  let emojiIndex = 0;
  
  // Pattern: ??, ???, ?, or leading numbers
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


interface ExtractedContent {
  titles: string[];
  mainText: string[];
  disclaimers: string[];
  footer: string[];
}

function extractContentWithCheerio(html: string): ExtractedContent {
  console.log('📄 [EXTRACT] Starting content extraction with Cheerio...');
  console.log(`   Input HTML length: ${html.length} chars`);
  
  const $ = cheerio.load(html);
  
  // Remove unwanted elements
  console.log('   🧹 Removing script, style, noscript, svg elements...');
  $('script, style, noscript, svg').remove();
  
  const titles: string[] = [];
  const mainText: string[] = [];
  const disclaimers: string[] = [];
  const footer: string[] = [];
  
  // Extract titles (h1-h6)
  console.log('   📋 Extracting titles (h1-h6)...');
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      titles.push(text);
      console.log(`      Found title: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  });
  
  // Extract main content (paragraphs and list items, excluding footer)
  console.log('   📝 Extracting main text (p, li)...');
  $('body p, body li').not('footer p, footer li, .footer p, .footer li').each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;
    
    // Check if looks like disclaimer (contains certain keywords)
    const isDisclaimer = /terms|conditions|privacy|policy|disclaimer|all rights reserved/i.test(text);
    
    if (isDisclaimer) {
      disclaimers.push(text);
      console.log(`      Found disclaimer: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    } else {
      mainText.push(text);
      console.log(`      Found main text: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  });
  
  // Extract footer content
  console.log('   🔖 Extracting footer...');
  $('footer, footer p, .footer, .footer p').each((_, el) => {
    const text = $(el).text().trim();
    if (text && !footer.includes(text) && !disclaimers.includes(text)) {
      footer.push(text);
      console.log(`      Found footer: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
    }
  });
  
  const extracted: ExtractedContent = {
    titles,
    mainText,
    disclaimers,
    footer
  };
  
  console.log('✅ [EXTRACT] Extraction complete:');
  console.log(`   Titles: ${titles.length}`);
  console.log(`   Main Text: ${mainText.length}`);
  console.log(`   Disclaimers: ${disclaimers.length}`);
  console.log(`   Footer: ${footer.length}`);
  console.log(`   Total items: ${titles.length + mainText.length + disclaimers.length + footer.length}\n`);
  
  return extracted;
}

/* ================================================================
   STEP 2: CREATE TAGGED CONTENT
   ================================================================ */

type ContentCategory = 'title' | 'main' | 'disclaimer' | 'footer';

interface TaggedContent {
  id: string;
  category: ContentCategory;
  index: number;
  text: string;
  modifiable: boolean;
}

function createTaggedContent(extracted: ExtractedContent): TaggedContent[] {
  console.log('🏷️  [TAG] Creating tagged content...');
  
  const tagged: TaggedContent[] = [];
  
  // Process titles
  extracted.titles.forEach((text, idx) => {
    const id = `title-${idx}`;
    tagged.push({
      id,
      category: 'title',
      index: idx,
      text: text,
      modifiable: true
    });
    console.log(`   ✅ Tagged [${id}] (modifiable): "${text.slice(0, 40)}..."`);
  });
  
  // Process main text
  extracted.mainText.forEach((text, idx) => {
    const id = `main-${idx}`;
    tagged.push({
      id,
      category: 'main',
      index: idx,
      text: text,
      modifiable: true
    });
    console.log(`   ✅ Tagged [${id}] (modifiable): "${text.slice(0, 40)}..."`);
  });
  
  // Process disclaimers (NOT modifiable)
  extracted.disclaimers.forEach((text, idx) => {
    const id = `disclaimer-${idx}`;
    tagged.push({
      id,
      category: 'disclaimer',
      index: idx,
      text: text,
      modifiable: false
    });
    console.log(`   🔒 Tagged [${id}] (protected): "${text.slice(0, 40)}..."`);
  });
  
  // Process footer (NOT modifiable)
  extracted.footer.forEach((text, idx) => {
    const id = `footer-${idx}`;
    tagged.push({
      id,
      category: 'footer',
      index: idx,
      text: text,
      modifiable: false
    });
    console.log(`   🔒 Tagged [${id}] (protected): "${text.slice(0, 40)}..."`);
  });
  
  console.log(`\n✅ [TAG] Created ${tagged.length} tagged items`);
  console.log(`   Modifiable: ${tagged.filter(t => t.modifiable).length}`);
  console.log(`   Protected: ${tagged.filter(t => !t.modifiable).length}\n`);
  
  return tagged;
}

/* ================================================================
   STEP 3: GET IMPROVEMENTS FROM SONNET (WITH BATCHING & RETRY)
   ================================================================ */

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

// Helper function to process a single batch
// Helper function to process a single batch
async function getContentImprovementsForBatch(
  batch: TaggedContent[],
  taskType: TaskType = 'grammar'
): Promise<ContentChange[]> {
  
const grammarPrompt = `You are a thorough grammar checker. Review EVERY item carefully and find ALL spelling, grammar, and readability errors.

CRITICAL INSTRUCTION: When you find errors, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields. NEVER return partial text or fragments.

**IMPORTANT: Preserve ALL emojis, special characters, and Unicode symbols EXACTLY as they appear in the original text. Do NOT remove, replace, or convert emojis to question marks or other characters. Emojis like 🛍️ 🎉 ⭐ 💰 🚚 must remain intact.**

Content items to check:
${batch.map(item => `
ID: ${item.id}
Category: ${item.category}
FULL TEXT: "${item.text}"
`).join('\n')}

Return ONLY a valid JSON array. For EACH item with errors, return the COMPLETE FULL TEXT:

[
  {
    "id": "title-1",
    "original": "COMPLETE FULL ORIGINAL TEXT HERE WITH EMOJIS - entire sentence/paragraph",
    "replacement": "COMPLETE FULL CORRECTED TEXT HERE WITH EMOJIS - entire sentence/paragraph with all fixes applied",
    "reason": "list all corrections made",
    "changeType": "grammar_fix|spelling|word_choice|readability",
    "confidence": 0.95
  }
]

EXAMPLES:

❌ WRONG (partial text):
{
  "id": "main-5",
  "original": "powerfull laptop",
  "replacement": "powerful laptop"
}

❌ WRONG (emojis removed):
{
  "id": "main-5",
  "original": "??? This powerfull laptop",
  "replacement": "This powerful laptop"
}

✅ CORRECT (full text with emojis preserved):
{
  "id": "main-5",
  "original": "🛍️ This powerfull laptop is perfet for work, school, or entertanment. 🎉",
  "replacement": "🛍️ This powerful laptop is perfect for work, school, or entertainment. 🎉"
}

RULES:
- Return ONLY valid JSON - no markdown, no explanations
- ALWAYS include the COMPLETE FULL TEXT in both original and replacement
- **PRESERVE all emojis: 🛍️ 🎉 ⭐ 💰 🚚 📱 💻 🎮 etc.**
- Fix ALL errors in each text: spelling, grammar, punctuation
- DO NOT change numbers, prices, brand names, or emojis
- DO NOT add new information
- If a text has NO errors, skip it (don't include in response)
- Check EVERY item thoroughly`;

  const seoPrompt = `Optimize this content for engagement and clarity.

CRITICAL INSTRUCTION: When you suggest improvements, you MUST return the COMPLETE FULL TEXT of the entire content item in both "original" and "replacement" fields. NEVER return partial text or fragments.

Content items to optimize:
${batch.map(item => `
ID: ${item.id}
Category: ${item.category}
FULL TEXT: "${item.text}"
`).join('\n')}

Return ONLY a valid JSON array. For EACH item with improvements, return the COMPLETE FULL TEXT:

[
  {
    "id": "title-1",
    "original": "COMPLETE FULL ORIGINAL TEXT HERE - entire sentence/paragraph",
    "replacement": "COMPLETE FULL IMPROVED TEXT HERE - entire sentence/paragraph with improvements",
    "reason": "explain improvements made",
    "changeType": "engagement|clarity|word_choice",
    "confidence": 0.95
  }
]

EXAMPLES:

❌ WRONG (partial text):
{
  "id": "main-10",
  "original": "grate prices",
  "replacement": "great prices"
}

✅ CORRECT (full text):
{
  "id": "main-10",
  "original": "We offer grate prices and excelent service to all customers.",
  "replacement": "We offer great prices and excellent service to all customers."
}

RULES:
- Return ONLY valid JSON - no markdown, no explanations
- ALWAYS include the COMPLETE FULL TEXT in both original and replacement
- Make 1-3 word improvements per sentence for engagement
- Keep 90%+ similarity to original
- Preserve exact meaning and tone
- DO NOT change numbers, prices, or brand names
- If no improvements needed, skip that item`;

  const initialPrompt = taskType === 'seo' ? seoPrompt : grammarPrompt;

  const MAX_RETRIES = 5;
  let attempt = 0;
  const conversationHistory: ConversationMessage[] = [];
  
  // Add initial user prompt
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
      
      // Add assistant response to conversation history
      conversationHistory.push({
        role: 'assistant',
        content: content
      });
      
      // Parse JSON (handle if wrapped in markdown code blocks)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        console.log(`      🔧 Removing markdown wrapper...`);
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        console.log(`      🔧 Removing code block wrapper...`);
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const parsed = JSON.parse(jsonStr);
      const changes: ContentChange[] = Array.isArray(parsed) ? parsed : [];
      
      console.log(`      ✅ Parsed ${changes.length} suggestions\n`);
      
      return changes;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`      ❌ Attempt ${attempt} failed: ${errorMessage}`);
      
      // Check if it's a JSON parse error
      if (errorMessage.includes('JSON') || errorMessage.includes('Unexpected token')) {
        if (attempt < MAX_RETRIES) {
          console.log(`      🔄 Retrying with error feedback...\n`);
          
          conversationHistory.push({
            role: 'user',
            content: `ERROR: Your previous response was not valid JSON. The error was: "${errorMessage}". 

Please return ONLY a valid JSON array with NO additional text, markdown code blocks, or explanations.

CRITICAL: You MUST return the COMPLETE FULL TEXT in both "original" and "replacement" fields. 

Example of CORRECT format:
[
  {
    "id": "title-0",
    "original": "This is the complete full original text with errrors in it that needs fixing",
    "replacement": "This is the complete full corrected text with errors in it that needs fixing",
    "reason": "fix spelling errors",
    "changeType": "spelling",
    "confidence": 0.95
  }
]

Return the array now:`
          });
          
          continue;
        } else {
          console.error(`      ❌ Max retries reached. Returning empty array.`);
          return [];
        }
      } else {
        throw error;
      }
    }
  }
  
  return [];
}

// Simplified consolidation - just remove duplicates
function consolidateChanges(changes: ContentChange[]): ContentChange[] {
  console.log(`\n🔄 [CONSOLIDATE] Deduplicating ${changes.length} changes...`);
  
  // Use Map to keep only one change per ID (keep the first one)
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

// Main function stays the same
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
      
      // 👇 ADD THIS: Restore emojis after getting changes from Claude
      const restoredChanges = batchChanges.map(change => {
        const originalContent = taggedContent.find(t => t.id === change.id);
        if (originalContent) {
          return restoreEmojisInChange(change, originalContent);
        }
        return change;
      });
      
      allChanges.push(...restoredChanges); // 👈 Use restoredChanges instead of batchChanges
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
  
  // Simple deduplication
  const consolidatedChanges = consolidateChanges(allChanges);
  
  console.log(`✅ [SONNET] Final: ${consolidatedChanges.length} unique full-text corrections\n`);
  
  consolidatedChanges.sort((a, b) => {
    const aNum = parseInt(a.id.split('-')[1]) || 0;
    const bNum = parseInt(b.id.split('-')[1]) || 0;
    return aNum - bNum;
  });
  
  return consolidatedChanges;
}

// Main function with batching
// async function getContentImprovements(
//   taggedContent: TaggedContent[],
//   taskType: TaskType = 'grammar'
// ): Promise<ContentChange[]> {
//   console.log(`📤 [SONNET] Requesting ${taskType} improvements with batching...`);
  
//   const modifiable = taggedContent.filter(c => c.modifiable);
//   console.log(`   Total modifiable items: ${modifiable.length}`);
//   console.log(`   Skipping ${taggedContent.length - modifiable.length} protected items\n`);
  
//   // Process in batches of 20 items
//   const BATCH_SIZE = 20;
//   const allChanges: ContentChange[] = [];
//   const totalBatches = Math.ceil(modifiable.length / BATCH_SIZE);
  
//   console.log(`   📦 Processing in ${totalBatches} batches of ${BATCH_SIZE} items each\n`);
  
//   for (let i = 0; i < modifiable.length; i += BATCH_SIZE) {
//     const batchNum = Math.floor(i / BATCH_SIZE) + 1;
//     const batch = modifiable.slice(i, i + BATCH_SIZE);
    
//     console.log(`   🔨 Batch ${batchNum}/${totalBatches} (items ${i + 1}-${Math.min(i + BATCH_SIZE, modifiable.length)}):`);
    
//     try {
//       const batchChanges = await getContentImprovementsForBatch(batch, taskType);
//       allChanges.push(...batchChanges);
//       console.log(`   ✅ Batch ${batchNum} complete: ${batchChanges.length} suggestions\n`);
//     } catch (error) {
//       console.error(`   ❌ Batch ${batchNum} failed:`, error);
//       console.log(`   ⚠️  Continuing with next batch...\n`);
//     }
    
//     // Small delay between batches to avoid rate limits
//     if (i + BATCH_SIZE < modifiable.length) {
//       await new Promise(resolve => setTimeout(resolve, 500));
//     }
//   }
  
//   console.log(`✅ [SONNET] All batches complete: ${allChanges.length} total suggestions\n`);
  
//   return allChanges;
// }

/* ================================================================
   STEP 4: VALIDATION GATES
   ================================================================ */

interface ValidationResult {
  passed: boolean;
  failedGates: string[];
  shouldAutoApply: boolean;
  shouldManualReview: boolean;
  similarity?: number;
  reason?: string;
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
  
  // Gate 1: Original match - warning only
  if (change.original !== original.text) {
    console.log(`      ⚠️  Original text mismatch (non-blocking)`);
  }
  
  // Gate 2: Similarity check
  const similarity = calculateSimilarity(change.original, change.replacement);
  const minSimilarity = taskType === 'seo' ? 0.75 : 0.80; // Lowered from 0.85
  const maxSimilarity = 0.99;
  
  console.log(`      📊 Similarity: ${(similarity * 100).toFixed(1)}% (need ${minSimilarity * 100}-${maxSimilarity * 100}%)`);
  
  if (similarity < minSimilarity || similarity >= maxSimilarity) {
    failed.push('SIMILARITY_OUT_OF_RANGE');
    console.log(`      ❌ FAILED: Similarity out of range`);
  }
  
  // Gate 3: No new facts
  const hasNewFacts = checkForNewFacts(change.original, change.replacement);
  if (hasNewFacts) {
    failed.push('NEW_FACTS_DETECTED');
    console.log(`      ❌ FAILED: New facts/numbers detected`);
  }
  
  // Gate 4: Word count
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
  
  // Gate 5: Length change
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

/* ================================================================
   STEP 5: APPLY CHANGES TO HTML
   ================================================================ */

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  
  // Validate each change
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

/* ================================================================
   MAIN ROUTES
   ================================================================ */

// GRAMMAR/GOLDEN ROUTE
router.post('/:id/golden-new', async (req: Request, res: Response) => {
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
    
    console.log(`📝 Template ID: ${templateId}`);
    console.log(`📏 HTML length: ${html.length} chars\n`);
    
    // STEP 1: Extract with Cheerio
    let extracted: ExtractedContent;
    try {
      extracted = extractContentWithCheerio(html);
    } catch (error) {
      console.error('❌ [ERROR] Extraction failed:', error);
      return res.status(500).json({
        code: 'EXTRACTION_FAILED',
        message: 'Failed to extract content from HTML',
        error: String(error)
      });
    }
    
    // STEP 2: Tag content
    let tagged: TaggedContent[];
    try {
      tagged = createTaggedContent(extracted);
    } catch (error) {
      console.error('❌ [ERROR] Tagging failed:', error);
      return res.status(500).json({
        code: 'TAGGING_FAILED',
        message: 'Failed to create tagged content',
        error: String(error)
      });
    }
    
    // STEP 3: Get improvements from Sonnet (with batching & retry logic)
    let changes: ContentChange[];
    try {
      changes = await getContentImprovements(tagged, 'grammar');
    } catch (error) {
      console.error('❌ [ERROR] Grammar improvement failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        code: 'IMPROVEMENT_FAILED',
        message: 'Failed to get grammar improvements',
        error: errorMessage
      });
    }
    
    // STEP 4: Validate and prepare result
    const result = applyChangesToHtml(html, tagged, changes, 'grammar');
    
    console.log('='.repeat(70));
    console.log('✅ GOLDEN (GRAMMAR) PROCESSING COMPLETE');
    console.log('='.repeat(70) + '\n');
    
    // Return response matching frontend expectations
    res.json({
      changes: result.applied.map(c => ({
        find: c.original,
        replace: c.replacement,
        reason: c.reason,
        changeType: c.changeType,
        id: c.id
      })),
      stats: result.stats
    });
    
  } catch (err: unknown) {
    console.error('❌ [ERROR] Unexpected error:', err);
    res.status(500).json({ 
      code: 'GOLDEN_NEW_ERROR', 
      message: 'Unexpected error during processing',
      error: String(err)
    });
  }
});

// SEO OPTIMIZATION ROUTE
router.post('/:id/seo-new', async (req: Request, res: Response) => {
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
    
    console.log(`📝 Template ID: ${templateId}`);
    console.log(`📏 HTML length: ${html.length} chars\n`);
    
    const extracted = extractContentWithCheerio(html);
    const tagged = createTaggedContent(extracted);
    
    let changes: ContentChange[];
    try {
      changes = await getContentImprovements(tagged, 'seo');
    } catch (error) {
      console.error('❌ [ERROR] SEO improvement failed:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({
        code: 'SEO_IMPROVEMENT_FAILED',
        message: 'Failed to get SEO improvements',
        error: errorMessage
      });
    }
    
    const result = applyChangesToHtml(html, tagged, changes, 'seo');
    
    console.log('='.repeat(70));
    console.log('✅ SEO OPTIMIZATION PROCESSING COMPLETE');
    console.log('='.repeat(70) + '\n');
    
    // Return response matching frontend expectations
    res.json({
      changes: result.applied.map(c => ({
        find: c.original,
        replace: c.replacement,
        reason: c.reason,
        changeType: c.changeType,
        id: c.id
      })),
      stats: result.stats
    });
    
  } catch (err: unknown) {
    console.error('❌ [ERROR] SEO processing failed:', err);
    res.status(500).json({ 
      code: 'SEO_NEW_ERROR', 
      message: String(err)
    });
  }
});

// TEST ENDPOINT: EXTRACTION ONLY
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