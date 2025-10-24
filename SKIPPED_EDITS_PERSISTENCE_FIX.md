# ✅ Skipped Edits Persistence Fix

## Problem

The **skipped edits** data shown in the QA Page Verification Summary modal was **NOT persisting** across page refreshes or navigation. 

### Root Cause

1. **`skippedEdits`** array was stored only in component memory (`qa-page.component.ts`)
2. It was populated from `golden.atomicResults` when golden generation completed
3. **BUT `atomicResults` was never saved to localStorage or IndexedDB**
4. When the page refreshed, `getGoldenCached()` would restore:
   - ✅ `html`
   - ✅ `changes`
   - ✅ `failedEdits`
   - ✅ `stats`
   - ✅ `timings`
   - ❌ **`atomicResults` (missing!)**

5. Result: `skippedEdits` array became empty after refresh

## Solution

### 1. Added localStorage key for atomicResults

```typescript
// qa.service.ts - Line 158
private kAtomicResults(id: string) { return `qa:atomicResults:${id}`; }
```

### 2. Save atomicResults when golden is generated

Updated **three** locations where golden data is saved:

#### A. In `saveGoldenToCache()` method
```typescript
// Save atomicResults to localStorage (includes skipped edits)
if (golden.atomicResults && golden.atomicResults.length > 0) {
  localStorage.setItem(this.kAtomicResults(templateId), JSON.stringify(golden.atomicResults));
  console.log('✅ [qa.service] Saved atomicResults to localStorage:', golden.atomicResults.length, 'items');
}
```

#### B. In `golden$()` observable tap operator
```typescript
// Save atomicResults when golden is generated from API
if (res.atomicResults && res.atomicResults.length > 0) {
  localStorage.setItem(this.kAtomicResults(id), JSON.stringify(res.atomicResults));
  console.log('✅ [qa.service] Saved atomicResults to localStorage:', res.atomicResults.length, 'items');
}
```

#### C. In `getGoldenCached()` migration logic
```typescript
// Also save atomicResults during migration from old localStorage format
if (result.atomicResults && result.atomicResults.length > 0) {
  localStorage.setItem(this.kAtomicResults(id), JSON.stringify(result.atomicResults));
}
```

### 3. Restore atomicResults when loading cached data

```typescript
// getGoldenCached() method
const atomicResultsJson = localStorage.getItem(this.kAtomicResults(id));
let atomicResults = null;
if (atomicResultsJson) {
  try {
    atomicResults = JSON.parse(atomicResultsJson);
    console.log('✅ [qa.service] Restored atomicResults from localStorage:', atomicResults?.length || 0, 'items');
  } catch (e) {
    console.warn('⚠️ Failed to parse atomicResults from localStorage');
  }
}

return {
  html: cached.html,
  changes: cached.changes,
  failedEdits: cached.failedEdits || [],
  stats: stats,
  timings: timings,
  atomicResults: atomicResults  // ✅ NOW INCLUDED
} as GoldenResult;
```

### 4. Clean up atomicResults when clearing golden data

```typescript
clearGolden(id: string) {
  try {
    localStorage.removeItem(this.kGolden(id));
    localStorage.removeItem(this.kStats(id));
    localStorage.removeItem(this.kTimings(id));
    localStorage.removeItem(this.kAtomicResults(id));  // ✅ Clear atomic results
    this.goldenCache$.delete(id);
  } catch {}
}
```

## Data Flow

### Before Fix
```
Backend → GoldenResult (with atomicResults)
         ↓
Component extracts skippedEdits from atomicResults
         ↓
Saved to IndexedDB: html, changes, failedEdits ❌ atomicResults NOT saved
         ↓
PAGE REFRESH
         ↓
Restore from cache: atomicResults = undefined
         ↓
skippedEdits = [] (empty!)
```

### After Fix
```
Backend → GoldenResult (with atomicResults)
         ↓
Component extracts skippedEdits from atomicResults
         ↓
Saved to:
  - IndexedDB: html, changes, failedEdits
  - localStorage: stats, timings, atomicResults ✅
         ↓
PAGE REFRESH
         ↓
Restore from cache:
  - IndexedDB: html, changes, failedEdits
  - localStorage: stats, timings, atomicResults ✅
         ↓
skippedEdits populated from atomicResults ✅
```

## Testing Verification

To verify the fix works:

1. **Generate golden template** for a template that has some skipped edits
2. **Open the Verification Summary modal** - should see "Auto-Skipped Edits" section
3. **Refresh the page (F5)**
4. **Open the Verification Summary modal again** - skipped edits should still be there ✅
5. **Navigate away** to another page, then come back
6. **Open the modal** - skipped edits should persist ✅

## Files Modified

- ✅ `frontend/src/app/app/features/qa/services/qa.service.ts`
  - Added `kAtomicResults()` localStorage key method
  - Updated `getGoldenCached()` to restore atomicResults
  - Updated `saveGoldenToCache()` to save atomicResults
  - Updated `golden$()` tap operator to save atomicResults
  - Updated `clearGolden()` to clean up atomicResults
  - Updated migration logic to handle atomicResults

## Impact

- ✅ Skipped edits now persist across page refreshes
- ✅ Skipped edits persist when navigating between pages
- ✅ Verification summary modal shows complete data
- ✅ No data loss on refresh
- ✅ Backward compatible (handles missing atomicResults gracefully)

## Related

- `atomicResults` contains all edit results including:
  - Applied edits
  - Failed edits
  - **Skipped edits** (reason: empty text, no changes, etc.)
  - Blocked edits
  - Context mismatches
  - etc.

The `skippedEdits` array in the component is filtered from `atomicResults` where `status === 'skipped'`.
