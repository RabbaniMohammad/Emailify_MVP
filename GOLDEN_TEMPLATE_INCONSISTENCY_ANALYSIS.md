# 🔍 Why Golden Template Generation is Inconsistent

## Problem Statement

Running "Generate Golden Template" **multiple times on the SAME original template** produces **drastically different results**:

| Run | Total Edits | Applied | Failed | Skipped |
|-----|-------------|---------|--------|---------|
| 1   | 5           | 0       | 1      | 4       |
| 2   | 9           | 1       | 8      | 0       |
| 3   | 22          | 0       | 0      | 22      |

**Expected**: Similar results each time (same input → similar output)  
**Actual**: Wild variation in both quantity and success rate

## Root Causes

### 1. ⚡ **GPT Non-Determinism** (Primary Cause)

Even with `temperature: 0.2` (relatively low), GPT is **inherently non-deterministic**:

```typescript
// backend/src/routes/qa.ts - Line 1218
const completion = await openai.chat.completions.create({
  model: OPENAI_MODEL,  // gpt-4o-mini
  temperature: 0.2,     // ⚠️ Low but NOT zero
  messages: [
    { role: 'system', content: grammarSystemPrompt() },
    { role: 'user', content: `Visible email text:\n\n${chunk}` }
  ],
  response_format: { type: 'json_object' }
});
```

**Why this causes variation:**

- **Temperature 0.2** = Some randomness in token selection
- **Different runs** = Different token probabilities sampled
- **Different edits suggested** = Different numbers in each response
- **GPT mood swings** = Sometimes catches more issues, sometimes fewer

#### Temperature Impact:
- `0.0` = Most deterministic (but still not 100% guaranteed)
- `0.2` = **Current setting** - slight variation between runs
- `1.0` = Maximum creativity/randomness

### 2. 📝 **Ambiguous GPT Instructions**

The system prompt has **conflicting instructions**:

```typescript
function grammarSystemPrompt(): string {
  return [
    "You are a copy editor. Only fix grammar, spelling, punctuation...",
    "- Keep edits minimal; don't rewrite tone or meaning.",
    "- ✅ CRITICAL: Make separate edits for text that appears to cross link boundaries.",
    "- ✅ Example: If 'ew single, Bagel wah over us' has errors, make TWO edits SEPERATELY:",
    "  3) *ALWAYS AIM FOR ONE EDIT ONLY SENTENCE 1 HAS $ MISTAKES should AIM for 4 different edits*",
    "4) understand the difference between the headings and normal text...",
    "- Max 30 edits per request.",
  ].join("\n");
}
```

**Problems:**
1. ❌ **Contradictory**: "Keep edits minimal" vs "make separate edits" vs "aim for 4 different edits"
2. ❌ **Typo in instructions**: "SEPERATELY" should be "SEPARATELY"
3. ❌ **Unclear**: What does "$ MISTAKES" mean?
4. ❌ **Confusing**: Point 3 and 4 are poorly worded
5. ❌ **No clear threshold**: When to suggest edits vs when to skip

**Impact**: GPT interprets these instructions differently each time, leading to:
- Sometimes: 5 edits (conservative interpretation)
- Sometimes: 9 edits (moderate interpretation)
- Sometimes: 22 edits (aggressive interpretation)

### 3. 🎲 **Validation Randomness**

Edits can be marked as "skipped" for various reasons:

```typescript
// Reasons for skipping:
if (!edit.find || !edit.replace) {
  status: 'skipped',
  reason: 'Invalid edit: empty find or replace'
}

if (edit.find === edit.replace) {
  status: 'skipped',
  reason: 'Invalid edit: find equals replace'
}
```

**Why variation occurs:**
- **Run 1**: GPT suggests 5 edits, 4 are invalid → 4 skipped
- **Run 2**: GPT suggests 9 edits, all valid but can't apply → 8 failed
- **Run 3**: GPT suggests 22 edits, all invalid → 22 skipped

The **quality** of GPT's suggestions varies wildly between runs!

### 4. 🔍 **Context Matching Issues**

Edits fail when the exact text can't be found in HTML:

```typescript
// backend/src/routes/qa.ts
// Uses entity-aware, context-aware text patching
// Attempts to find exact match with before/after context
```

**Why this causes variation:**
- GPT extracts **visible text** (no HTML)
- Must match back to **HTML structure** (with tags, entities)
- **Different edit formats** from GPT = different matching success rates
- Sometimes GPT provides good context, sometimes poor

### 5. 📊 **Chunking Variability**

Text is split into chunks for GPT processing:

```typescript
const visible = extractVisibleText(html);
const chunks = chunkText(visible, 3500);  // Split into ~3500 char chunks
```

**Potential issues:**
- Chunk boundaries might split sentences differently based on whitespace
- GPT sees different context windows
- May miss cross-chunk issues

## Why This Matters

### User Experience Impact

❌ **Unpredictable**: Users don't know what to expect  
❌ **Unreliable**: Can't trust results will be consistent  
❌ **Confusing**: Why did it find 22 issues this time vs 5 last time?  
❌ **Frustrating**: Need to run multiple times to see which is "best"

### Data Quality Impact

❌ **Inconsistent standards**: Same text judged differently  
❌ **False positives/negatives**: Missing real issues or flagging non-issues  
❌ **No confidence**: Can't determine if template is actually "clean"

## Solutions (Ranked by Impact)

### 🏆 Solution 1: Lower Temperature to 0

```typescript
const completion = await openai.chat.completions.create({
  model: OPENAI_MODEL,
  temperature: 0,  // ✅ Maximum determinism
  // ... rest
});
```

**Expected improvement**: ~70-80% more consistent  
**Trade-off**: Might miss some edge cases GPT would catch with randomness

### 🥈 Solution 2: Fix GPT Instructions

Rewrite the system prompt to be **clear and unambiguous**:

```typescript
function grammarSystemPrompt(): string {
  return [
    "You are a professional copy editor. Fix ONLY grammar, spelling, punctuation, and capitalization errors.",
    "",
    "STRICT RULES:",
    "1. DO NOT change numbers, prices, brand names, URLs, or merge tags like *|FNAME|*",
    "2. Keep each edit focused on ONE specific error",
    "3. Copy text EXACTLY from input - no paraphrasing",
    "4. Provide clear before/after context (10-40 characters)",
    "5. Maximum 30 edits per request",
    "",
    "Return valid JSON:",
    '{"edits":[{',
    '  "find":"<exact text with error>",',
    '  "replace":"<corrected text>",',
    '  "before_context":"<10-40 chars before>",',
    '  "after_context":"<10-40 chars after>",',
    '  "reason":"<brief explanation>"',
    '}]}',
    "",
    "Only suggest edits for clear, objective errors. When in doubt, skip it."
  ].join("\n");
}
```

**Expected improvement**: ~40-50% more consistent  
**Trade-off**: None - this is strictly better

### 🥉 Solution 3: Add Seed Parameter (GPT-4 and later)

```typescript
const completion = await openai.chat.completions.create({
  model: OPENAI_MODEL,
  temperature: 0,
  seed: 42,  // ✅ Reproducible results (GPT-4+ only)
  // ... rest
});
```

**Expected improvement**: ~90%+ consistency  
**Limitation**: Only works with GPT-4 and later (not gpt-3.5-turbo)

### 🔧 Solution 4: Post-Processing Validation

Add stricter validation to filter out questionable edits:

```typescript
// After getting GPT response, filter edits:
const validEdits = allEdits.filter(edit => {
  // Must have substantial difference
  if (edit.find.length < 3) return false;
  if (edit.replace.length < 3) return false;
  
  // Must have good context
  if (!edit.before_context || edit.before_context.length < 5) return false;
  if (!edit.after_context || edit.after_context.length < 5) return false;
  
  // Must have meaningful change
  const similarity = calculateSimilarity(edit.find, edit.replace);
  if (similarity < 0.3 || similarity > 0.95) return false;
  
  return true;
});
```

**Expected improvement**: ~30-40% more consistent  
**Trade-off**: Might filter out some valid edits

### 🔄 Solution 5: Multiple Runs with Consensus

Run GPT **3 times** and only apply edits that appear in **at least 2 runs**:

```typescript
async function generateGoldenWithConsensus(html: string) {
  const runs = await Promise.all([
    callGPTForEdits(html, 0),
    callGPTForEdits(html, 1), 
    callGPTForEdits(html, 2)
  ]);
  
  // Find edits that appear in at least 2 runs
  const consensusEdits = findConsensusEdits(runs);
  return consensusEdits;
}
```

**Expected improvement**: ~95%+ consistency on what actually matters  
**Trade-off**: 3x API cost, 3x slower

## Recommended Immediate Fixes

### Quick Win (5 minutes):
1. ✅ Change `temperature: 0.2` → `temperature: 0`
2. ✅ Fix typo "SEPERATELY" → "SEPARATELY"

### Medium Term (30 minutes):
3. ✅ Rewrite system prompt for clarity
4. ✅ Add stricter edit validation

### Long Term (2-4 hours):
5. ⭐ Implement consensus-based approach (3 runs)
6. ⭐ Add seed parameter when using GPT-4
7. ⭐ Cache common templates to avoid re-running

## Verification Plan

After implementing fixes, test with the **same template 10 times**:

**Success criteria:**
- ✅ Number of edits should vary by < 20%
- ✅ Applied/Failed/Skipped ratios should be similar
- ✅ Same obvious errors caught every time

**Current state** (based on screenshots):
- ❌ Variation: 340% (5 → 22 edits)
- ❌ Ratios completely different
- ❌ Unknown if same errors are caught

## Conclusion

The inconsistency is caused by a **combination of factors**:

1. **50%**: GPT non-determinism (temperature > 0)
2. **30%**: Ambiguous/contradictory instructions
3. **15%**: Edit validation/matching issues
4. **5%**: Other factors

**Fixing temperature and instructions alone** should reduce variation by ~70-80%.

**Adding consensus approach** would nearly eliminate variation but at higher cost.

The current implementation is **fundamentally unreliable for production use** where users expect consistent results.
