# 🧪 Quick Test Instructions

## Step 1: Start Backend
```bash
cd backend
npm run dev
```

Wait for: `Server started on port 3000` or similar message.

## Step 2: Update Frontend (Temporarily)

**File:** `frontend/src/app/app/features/qa/services/qa.service.ts`

**Find this method (around line 577):**
```typescript
checkTemplateGrammar(html: string): Observable<{
  hasErrors: boolean;
  mistakes: Array<{ word: string; suggestion: string; context: string }>;
  count: number;
  message: string;
}> {
  return this.http.post<{
    hasErrors: boolean;
    mistakes: Array<{ word: string; suggestion: string; context: string }>;
    count: number;
    message: string;
  }>('/api/qa/template/grammar-check', { html });
}
```

**Change ONLY the URL (one line change):**
```typescript
checkTemplateGrammar(html: string): Observable<{
  hasErrors: boolean;
  mistakes: Array<{ word: string; suggestion: string; context: string }>;
  count: number;
  message: string;
}> {
  return this.http.post<{
    hasErrors: boolean;
    mistakes: Array<{ word: string; suggestion: string; context: string }>;
    count: number;
    message: string;
  }>('/api/qa-advanced/grammar-check', { html });  // ← CHANGED THIS LINE ONLY
}
```

## Step 3: Test in Browser

1. Go to your QA page
2. Load a template
3. Click **"Run Tests"** button (your existing button)
4. Open Browser DevTools Console (F12)
5. Watch for logs:

```
🔍 [ADVANCED GRAMMAR] Received HTML length: 12345
🔍 [ADVANCED GRAMMAR] Checking for errors...
✅ [ADVANCED GRAMMAR] Check complete: { total: 5, applied: 3, failed: 2 }
```

## Step 4: Check Results

The response will look EXACTLY like the old system:

```json
{
  "hasErrors": true,
  "mistakes": [
    {
      "word": "teh",
      "suggestion": "the",
      "context": "Spelling: \"teh\" → \"the\""
    },
    {
      "word": "recieve",
      "suggestion": "receive",
      "context": "Spelling: \"recieve\" → \"receive\""
    }
  ],
  "count": 2,
  "message": "Found 2 spelling mistakes"
}
```

## Step 5: Compare Performance

**Old System (ChatGPT):**
- Takes 2-5 seconds
- Costs money per check
- Rate limited

**New System (Advanced Local):**
- Takes 50-200ms (10-50x faster!)
- FREE
- No limits

## Step 6: Revert When Done Testing

**Change the URL back:**
```typescript
}>('/api/qa/template/grammar-check', { html });  // ← Back to original
```

## What to Look For

✅ **Success indicators:**
- Faster response time
- Same UI behavior
- Detects common typos (teh, recieve, etc.)
- No errors in console

❌ **If something breaks:**
- Check backend logs
- Check browser console for errors
- Make sure backend is running
- Verify the URL change was correct

## Testing Different Templates

Try templates with these errors to verify it works:
- Common typos: "teh", "recieve", "seperate", "definately"
- Brand names: "chat gpt", "face book", "you tube"
- Duplicate words: "the the", "is is"
- Grammar: "this are", "he don't", "could of"

## Backend Logs

Watch your backend terminal for:
```
🔍 [ADVANCED GRAMMAR] Received HTML length: 12345
🔍 [ADVANCED GRAMMAR] Checking for errors...
✅ [ADVANCED GRAMMAR] Check complete: { total: 5, applied: 3, failed: 2 }
```

## Quick Comparison Test

1. Test with NEW endpoint (note the time)
2. Change URL back to OLD endpoint
3. Test same template (note the time)
4. Compare results!

---

**Remember:** This is just a temporary test. The response format is EXACTLY the same, so your frontend won't know the difference!
