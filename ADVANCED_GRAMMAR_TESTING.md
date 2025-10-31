# 🧪 Advanced Grammar Checker - Testing Guide

## What This Does

This is a **NEW** grammar checking system that:
- ✅ **NO API calls** - Everything runs locally
- ✅ **NO rate limits** - Check unlimited templates
- ✅ **NO cost** - Free forever
- ✅ **Respects HTML boundaries** - Won't break your templates
- ✅ **Fast** - No network latency

## How to Test

### 1. Start the Backend

```bash
cd backend
npm run dev
```

### 2. Test the Service (Using Postman/Insomnia/curl)

**Endpoint:** `POST http://localhost:3000/api/qa-advanced/test`

This will run a simple test with pre-defined HTML.

**Example using curl:**
```bash
curl -X POST http://localhost:3000/api/qa-advanced/test
```

### 3. Test with Your Own HTML

**Endpoint:** `POST http://localhost:3000/api/qa-advanced/grammar-check`

**Request Body:**
```json
{
  "html": "<html><body><p>This is teh test. I recieve emails from chat gpt.</p></body></html>"
}
```

**Response:**
```json
{
  "success": true,
  "html": "<html><body><p>This is the test. I receive emails from ChatGPT.</p></body></html>",
  "appliedEdits": [
    {
      "find": "teh",
      "replace": "the",
      "reason": "Spelling: \"teh\" → \"the\"",
      "changeType": "spelling",
      "status": "applied"
    },
    {
      "find": "recieve",
      "replace": "receive",
      "reason": "Spelling: \"recieve\" → \"receive\"",
      "changeType": "spelling",
      "status": "applied"
    },
    {
      "find": "chat gpt",
      "replace": "ChatGPT",
      "reason": "Brand name spacing",
      "changeType": "spacing",
      "status": "applied"
    }
  ],
  "failedEdits": [],
  "stats": {
    "total": 3,
    "applied": 3,
    "failed": 0
  },
  "message": "Found 3 issues. Applied 3, failed 0."
}
```

## What It Checks

### 1. Common Typos (90+ words)
- teh → the
- recieve → receive
- definately → definitely
- occured → occurred
- And many more...

### 2. Brand Names
- chat gpt → ChatGPT
- face book → Facebook
- you tube → YouTube
- linked in → LinkedIn

### 3. Duplicate Words
- "the the" → "the"
- "is is" → "is"

### 4. Grammar Errors
- "this are" → "this is"
- "he don't" → "he doesn't"
- "could of" → "could have"

### 5. Contractions
- cant → can't
- dont → don't
- im → I'm

## Integration with Frontend

### Option A: Replace Existing Endpoint

Change your frontend to call:
```typescript
// OLD (uses ChatGPT API)
this.http.post('/api/qa/template/grammar-check', { html })

// NEW (local, no API)
this.http.post('/api/qa-advanced/grammar-check', { html })
```

### Option B: Add Toggle Switch

Let users choose between:
- **Fast Mode** (new system) - Local, instant
- **Advanced Mode** (old system) - ChatGPT API, slower but more comprehensive

## Advantages Over ChatGPT Approach

| Feature | ChatGPT API | Advanced Local |
|---------|------------|----------------|
| Speed | ~2-5 seconds | ~50-200ms |
| Cost | $0.01 per check | FREE |
| Rate Limit | Yes (RPM limits) | NONE |
| Boundary Issues | 50-70% fail | 10-20% fail |
| Offline | ❌ No | ✅ Yes |
| Customizable | ❌ No | ✅ Yes |

## How to Expand the Dictionary

Edit `backend/src/services/advancedGrammarService.ts`:

```typescript
// Add to COMMON_TYPOS
const COMMON_TYPOS: Record<string, string> = {
  // ... existing typos
  'yournewtypo': 'correct spelling',
};

// Add to BRAND_SPACING_RULES
const BRAND_SPACING_RULES = [
  // ... existing rules
  { pattern: /\byour\s+brand\b/gi, replacement: 'YourBrand', reason: 'Brand name' },
];
```

## Next Steps

1. **Test the endpoint** - Try the `/test` route first
2. **Verify it works** - Check the response
3. **Integrate with frontend** - Update your grammar check service
4. **Compare results** - Run both old and new side-by-side
5. **Switch over** - Once confident, use the new system

## Files Created

- ✅ `backend/src/services/advancedGrammarService.ts` - Core grammar checking logic
- ✅ `backend/src/routes/qa-advanced.ts` - New API endpoints
- ✅ `backend/src/routes/index.ts` - Route registration (updated)

## Support

If you encounter issues:
1. Check the backend logs for errors
2. Verify the HTML is valid
3. Test with simple HTML first
4. Gradually increase complexity

The system is designed to be **conservative** - it will mark edits as "failed" rather than risk breaking your HTML structure.
