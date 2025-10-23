# Golden Template Persistence Fix - localStorage Only

## Problem Statement
Golden template edits were disappearing after page refresh or navigation. The root cause was a mismatch between storage layers:
- During editing: Golden templates saved to `visual_editor_${templateId}_golden_html` in localStorage
- After Check Preview: saveGoldenToCache() saved to IndexedDB
- On page load: getGoldenCached() read from IndexedDB (stale data)

**Result**: Edits made in visual editor were lost because they existed only in localStorage while the app was reading from IndexedDB.

## Architecture Clarification
The application uses **localStorage ONLY** - IndexedDB is deprecated and no longer used for template storage.

## Changes Made

### 1. Updated `saveGoldenToCache()` - qa.service.ts (Lines 805-830)

**Before:**
```typescript
async saveGoldenToCache(templateId: string, golden: GoldenResult): Promise<void> {
  await this.db.cacheGolden({...}); // ❌ Saved to IndexedDB
}
```

**After:**
```typescript
saveGoldenToCache(templateId: string, golden: GoldenResult): void {
  // ✅ Save to localStorage for persistence
  const cacheData = {
    html: golden.html || '',
    changes: golden.changes || [],
    failedEdits: golden.failedEdits || [],
    stats: golden.stats || { applied: 0, failed: 0, total: 0 },
    timestamp: Date.now()
  };
  
  localStorage.setItem(this.kGolden(templateId), JSON.stringify(cacheData));
}
```

**Key Changes:**
- Changed from `async` to synchronous method
- Removed IndexedDB dependency (`this.db.cacheGolden()`)
- Now saves directly to localStorage at key `qa:golden:${templateId}`
- Includes all golden template fields: html, changes, failedEdits, stats
- Added comprehensive debug logging

### 2. Updated `getGoldenCached()` - qa.service.ts (Lines 171-202)

**Before:**
```typescript
async getGoldenCached(id: string): Promise<GoldenResult | null> {
  // ❌ Try IndexedDB first
  const cached = await this.db.getGolden(id);
  if (cached) return cached;
  
  // Fallback to localStorage, then migrate to IndexedDB
  const raw = localStorage.getItem(this.kGolden(id));
  if (raw) {
    await this.db.cacheGolden({...}); // Migrate
    localStorage.removeItem(this.kGolden(id)); // Clean up
    return result;
  }
}
```

**After:**
```typescript
getGoldenCached(id: string): Promise<GoldenResult | null> {
  // ✅ Read directly from localStorage
  const raw = localStorage.getItem(this.kGolden(id));
  if (raw) {
    const cached = JSON.parse(raw);
    const result: GoldenResult = {
      html: cached.html || '',
      changes: cached.changes || [],
      failedEdits: cached.failedEdits || [],
      stats: cached.stats || { applied: 0, failed: 0, total: 0 }
    };
    return Promise.resolve(result);
  }
  return Promise.resolve(null);
}
```

**Key Changes:**
- Removed IndexedDB dependency (`this.db.getGolden()`)
- Removed migration logic (no longer needed)
- Now reads directly from localStorage at key `qa:golden:${templateId}`
- Maintains Promise return type for backward compatibility with existing code
- Added comprehensive debug logging

## Data Flow (Now Fixed)

### Golden Template Editing Flow:
1. **User clicks "Open Visual Editor" in Failed Edits Modal**
   - Template state context set to 'golden'
   - Golden template HTML loaded into visual editor

2. **User makes edits in Visual Editor**
   - Edits saved to `visual_editor_${templateId}_golden_html` (localStorage)
   - template-state.service checks context and routes correctly

3. **User clicks "Check Preview"**
   - handleVisualEditorReturn() receives golden HTML
   - Updates goldenSubject with new HTML
   - **Calls saveGoldenToCache()** → Saves to `qa:golden:${templateId}` (localStorage)
   - Button color updates to indicate golden template has changes

4. **User refreshes page or navigates away**
   - QA page initialization calls getGoldenCached()
   - **Reads from localStorage** at `qa:golden:${templateId}`
   - ✅ **Golden template edits persist!**

## localStorage Keys Architecture

### QA Service Cache Keys:
- `qa:golden:${templateId}` - Golden template cache (main persistence layer)
  - Contains: html, changes, failedEdits, stats, timestamp
  - Used by: saveGoldenToCache(), getGoldenCached()

### Visual Editor Keys:
- `visual_editor_${templateId}_golden_html` - Active golden template edits
  - Contains: Raw HTML string
  - Used during editing session
  - Saved by: template-state.service when context is 'golden'

### Template State Keys:
- `template_state_${templateId}_edited` - Original template edits
  - Contains: Raw HTML string  
  - Used during editing session
  - Saved by: template-state.service when context is 'original' or undefined

## Debug Logging Added

Both methods now include comprehensive logging:

**saveGoldenToCache():**
```
💾 [qa.service] Saving golden template to localStorage
   - Template ID: abc123
   - Key: qa:golden:abc123
   - HTML length: 15234
   - Failed edits: 3
   - Stats: {applied: 10, failed: 3, total: 13}
✅ [qa.service] Golden template saved to localStorage successfully
   - Saved to key: qa:golden:abc123
   - Data preview: {"html":"<!DOCTYPE html>...
```

**getGoldenCached():**
```
📖 [qa.service] Reading golden template from localStorage
   - Template ID: abc123
   - Key: qa:golden:abc123
✅ [qa.service] Found cached golden template
   - Raw data length: 16842
   - HTML length: 15234
   - Failed edits: 3
   - Stats: {applied: 10, failed: 3, total: 13}
```

## Testing Checklist

✅ **Test Scenario 1: Golden Template Editing**
1. Navigate to QA page with failing edits
2. Click "Generate Golden Template"
3. Click "Open Visual Editor" in Failed Edits Modal
4. Make changes in Visual Editor
5. Click "Check Preview"
6. Verify golden template shows changes in QA page
7. **Refresh page** → Verify golden template changes persist
8. **Navigate away and back** → Verify golden template changes persist

✅ **Test Scenario 2: Original Template Editing**
1. Navigate to QA page
2. Click "Open Visual Editor" 
3. Make changes to original template
4. Click "Check Preview"
5. Verify only original template changed (not golden)
6. **Refresh page** → Verify original template changes persist

✅ **Test Scenario 3: Browser Console Verification**
1. Open browser console
2. Perform golden template edit workflow
3. Verify debug logs show:
   - "Saving golden template to localStorage"
   - "Golden template saved to localStorage successfully"
   - Key: `qa:golden:${templateId}`
4. Check localStorage in DevTools:
   - Verify `qa:golden:${templateId}` key exists
   - Verify data includes html, changes, failedEdits, stats

## Files Modified

1. **frontend/src/app/app/features/qa/services/qa.service.ts**
   - Lines 171-202: getGoldenCached() - Now reads from localStorage only
   - Lines 805-830: saveGoldenToCache() - Now saves to localStorage only

## Related Fixes

This fix builds on the previous fix documented in `GOLDEN_TEMPLATE_EDITING_CYCLE_FIX.md`:
1. **Phase 1 (Previous)**: Fixed saveEditedTemplate() to use context-aware routing
2. **Phase 2 (This Fix)**: Fixed persistence layer to use localStorage only

## Verification Commands

```powershell
# Check localStorage in browser console:
localStorage.getItem('qa:golden:YOUR_TEMPLATE_ID')

# Should return JSON like:
# {
#   "html": "<!DOCTYPE html>...",
#   "changes": [...],
#   "failedEdits": [...],
#   "stats": {"applied": 10, "failed": 3, "total": 13},
#   "timestamp": 1234567890
# }
```

## Summary

**Problem**: Golden template edits disappeared on page refresh due to IndexedDB/localStorage mismatch

**Solution**: Converted both saveGoldenToCache() and getGoldenCached() to use localStorage only

**Result**: Golden template edits now persist correctly across page refreshes and navigation

**Impact**: Users can now edit golden templates with confidence that their changes will persist
