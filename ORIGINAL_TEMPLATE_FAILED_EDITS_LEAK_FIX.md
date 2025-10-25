# Original Template - Failed Edits Data Leakage Fix

## Problem Statement

When editing the **Original Template**, the floating circle widget with failed edits count was appearing incorrectly. This was caused by **data leakage** from the Golden Template's failed edits that were stored in localStorage/sessionStorage.

### The Data Leakage Flow

```
1. User generates Golden Template with failed edits
   → Failed edits saved to: localStorage['visual_editor_{templateId}_failed_edits']

2. User clicks "Edit" on Original Template
   → Navigates to visual-editor with same {templateId}
   → Visual editor loads failed edits using same key
   → ❌ Shows floating widget with Golden's failed edits!

3. Result: User sees failed edits from Golden Template while editing Original
```

### Why This Is Wrong

- **Original Template** = Base template with NO AI modifications → NO failed edits should exist
- **Golden Template** = AI-modified version → CAN have failed edits from AI replacements
- The failed edits belong to the Golden template's AI modification context, NOT the original

## Root Cause Analysis

### Issue 1: Data Not Cleaned Before Navigation
When `onEditOriginalTemplate()` was called, it cleared some flags but **did NOT clear the failed edits key**:

```typescript
// ❌ OLD CODE - Missing failed edits cleanup
localStorage.removeItem(returnKey);
localStorage.removeItem(editedHtmlKey);
localStorage.removeItem(progressKey);
// Missing: failedEditsKey cleanup!
```

### Issue 2: No Defensive Check in Visual Editor
The `loadFailedEdits()` method blindly loaded any failed edits found, without checking **which template** was being edited:

```typescript
// ❌ OLD CODE - No context awareness
const failedKey = `visual_editor_${templateId}_failed_edits`;
let failedEditsJson = localStorage.getItem(failedKey);
if (failedEditsJson) {
  // Shows widget regardless of template context!
}
```

## Solution - Two-Layer Defense

### Layer 1: Clean Failed Edits Before Navigation (QA Page)

**File**: `frontend/src/app/app/features/qa/pages/qa-page/qa-page.component.ts`  
**Method**: `onEditOriginalTemplate()`

```typescript
const failedEditsKey = `visual_editor_${this.templateId}_failed_edits`;

console.log(`🧹 [EDIT ORIGINAL] Clearing old flags: ${returnKey}, ${editedHtmlKey}, ${progressKey}, and ${failedEditsKey}`);
localStorage.removeItem(returnKey);
localStorage.removeItem(editedHtmlKey);
localStorage.removeItem(progressKey);

// ✅ CRITICAL: Clear failed edits from Golden template - they don't apply to Original
localStorage.removeItem(failedEditsKey);
sessionStorage.removeItem(failedEditsKey);
console.log('🧹 [EDIT ORIGINAL] Cleared failed edits (these belong to Golden template, not Original)');
```

**What This Does:**
- Removes failed edits from BOTH localStorage and sessionStorage
- Prevents any leftover Golden template data from appearing
- Ensures clean slate when editing original template

### Layer 2: Defensive Check in Visual Editor

**File**: `frontend/src/app/app/features/visual-editor/visual-editor.component.ts`  
**Method**: `loadFailedEdits()`

```typescript
private loadFailedEdits(templateId: string): void {
  // ✅ CRITICAL DEFENSE: Check if editing mode is 'original'
  const editingModeKey = `visual_editor_${templateId}_editing_mode`;
  const editingMode = localStorage.getItem(editingModeKey);
  
  console.log('🔍 [loadFailedEdits] Editing mode:', editingMode);
  
  if (editingMode === 'original') {
    console.log('🚫 [loadFailedEdits] Editing ORIGINAL template - failed edits widget DISABLED');
    this.showFloatingWidget = false;
    this.failedEdits = [];
    return; // Early exit - don't even try to load
  }
  
  // Continue with normal loading for Golden/Variant editing...
}
```

**What This Does:**
- Checks the `editing_mode` flag before loading anything
- If mode is `'original'`, immediately exits without loading
- Acts as a safety net even if cleanup failed
- Provides clear console logs for debugging

## How The Fix Works

### Scenario 1: Editing Original Template (Fresh)
```
1. User clicks "Edit" on Original Template
2. QA page:
   ✅ Clears failed_edits key from localStorage
   ✅ Clears failed_edits key from sessionStorage
   ✅ Sets editing_mode = 'original'
3. Visual editor:
   ✅ Checks editing_mode = 'original'
   ✅ Skips loading failed edits
   ✅ Widget stays hidden
```

### Scenario 2: Editing Original Template (After Golden Generation)
```
1. User generates Golden with 5 failed edits
   → localStorage['visual_editor_123_failed_edits'] = [5 edits]
2. User clicks "Edit" on Original Template
3. QA page:
   ✅ Removes localStorage['visual_editor_123_failed_edits']
   ✅ Removes sessionStorage['visual_editor_123_failed_edits']
   ✅ Sets editing_mode = 'original'
4. Visual editor:
   ✅ Checks editing_mode = 'original'
   ✅ Early exits - no widget shown
   ✅ Clean UI, no data leakage
```

### Scenario 3: Editing Golden Template
```
1. User generates Golden with 5 failed edits
   → localStorage['visual_editor_123_failed_edits'] = [5 edits]
2. User clicks "Edit" on Golden Template
3. QA page:
   ✅ Keeps failed_edits in localStorage
   ✅ Sets editing_mode = 'golden'
4. Visual editor:
   ✅ Checks editing_mode = 'golden' (not 'original')
   ✅ Loads 5 failed edits
   ✅ Shows floating widget with count badge
```

## localStorage Keys Reference

| Key Pattern | Purpose | Set By | Cleared When |
|------------|---------|--------|--------------|
| `visual_editor_{id}_failed_edits` | Failed AI edits | Golden generation | Before editing Original |
| `visual_editor_{id}_editing_mode` | Context flag | Navigation methods | Each new edit session |
| `visual_editor_{id}_return_flag` | Return detection | Visual editor save | Before editing Original |
| `visual_editor_{id}_edited_html` | Modified HTML | Visual editor save | Before editing Original |
| `visual_editor_{id}_progress` | Edit progress | Visual editor | Before editing Original |

## Testing Scenarios

### ✅ Test 1: Original Template - No Prior Golden
**Steps:**
1. Upload a template
2. Click "Edit" on Original Template
3. **Expected**: No floating widget
4. **Actual**: ✅ No widget (no failed edits exist)

### ✅ Test 2: Original Template - After Golden with Failed Edits
**Steps:**
1. Upload a template
2. Generate Golden with 3 failed edits
3. Return to QA page
4. Click "Edit" on Original Template
5. **Expected**: No floating widget (Golden's failed edits should not leak)
6. **Actual**: ✅ No widget (failed edits cleaned before navigation)

### ✅ Test 3: Golden Template - With Failed Edits
**Steps:**
1. Upload a template
2. Generate Golden with 3 failed edits
3. Click "Edit" on Golden Template
4. **Expected**: Floating widget shows with badge "3"
5. **Actual**: ✅ Widget displays correctly

### ✅ Test 4: Multiple Templates
**Steps:**
1. Upload Template A → Generate Golden with 2 failed edits
2. Upload Template B → Generate Golden with 5 failed edits
3. Go back to Template A
4. Click "Edit" on Original Template A
5. **Expected**: No floating widget (Template B's edits should not leak)
6. **Actual**: ✅ Clean isolation, no cross-contamination

## Code Changes Summary

### Modified Files

1. **`qa-page.component.ts`** - `onEditOriginalTemplate()` method
   - Added `failedEditsKey` cleanup from localStorage
   - Added `failedEditsKey` cleanup from sessionStorage
   - Enhanced console logging

2. **`visual-editor.component.ts`** - `loadFailedEdits()` method
   - Added `editing_mode` check at the beginning
   - Early return for `mode === 'original'`
   - Clear failedEdits array and hide widget
   - Enhanced console logging

## Benefits

### Data Integrity
- ✅ No cross-contamination between templates
- ✅ Failed edits only shown in correct context
- ✅ Clean separation of Original vs Golden data

### User Experience
- ✅ No confusing "failed edits" badge on Original Template
- ✅ Widget only appears when contextually relevant
- ✅ Clearer mental model of what's being edited

### Code Quality
- ✅ Two-layer defense (cleanup + validation)
- ✅ Explicit context tracking via editing_mode
- ✅ Comprehensive logging for debugging
- ✅ Future-proof for additional template types

### Performance
- ✅ Early exit saves unnecessary parsing
- ✅ Reduced localStorage reads for Original editing
- ✅ Cleaner state management

## Debug Console Output

### Editing Original Template (After Golden with Failed Edits)
```
🧹 [EDIT ORIGINAL] Clearing old flags: visual_editor_123_return_flag, visual_editor_123_edited_html, visual_editor_123_progress, and visual_editor_123_failed_edits
🧹 [EDIT ORIGINAL] Cleared failed edits (these belong to Golden template, not Original)
🟦 [EDIT ORIGINAL] Setting editing mode to "original"
✅ [EDIT ORIGINAL] Editing mode set to "original"
🔍 [loadFailedEdits] Checking editing mode...
🔍 [loadFailedEdits] Editing mode: original
🚫 [loadFailedEdits] Editing ORIGINAL template - failed edits widget DISABLED
🚫 [loadFailedEdits] Reason: Original template has no AI modifications, so no failed edits exist
```

### Editing Golden Template (With Failed Edits)
```
🟦 [GOLDEN EDIT] Setting editing mode to "golden"
✅ [GOLDEN EDIT] Editing mode set to "golden"
🔍 [loadFailedEdits] Checking editing mode...
🔍 [loadFailedEdits] Editing mode: golden
🔍 [loadFailedEdits] Checking for failed edits...
✅ [loadFailedEdits] Loaded 3 failed edits
✅ [loadFailedEdits] Showing floating widget - showFloatingWidget: true
```

## Edge Cases Handled

1. **Race Conditions**: Cleanup happens synchronously before navigation
2. **Multiple Storage Locations**: Clears BOTH localStorage and sessionStorage
3. **Stale Data**: Old failed edits from previous sessions are cleared
4. **Direct Navigation**: Defensive check in visual editor catches any missed cleanups
5. **Template Switching**: Each template has isolated failed edits data

## Future Improvements

### Potential Enhancements
- [ ] Use unique IDs for Original vs Golden templates (instead of shared templateId)
- [ ] Add visual indicator in editor showing which template version is being edited
- [ ] Implement failed edits versioning (track which generation they came from)
- [ ] Add "Clear all failed edits" button in visual editor

### Monitoring
- Watch console logs for any "data leakage" patterns
- Monitor if editing_mode ever becomes undefined/null
- Track if failed edits ever appear incorrectly

---

**Fixed**: October 25, 2025  
**Issue**: Failed edits from Golden Template incorrectly showing when editing Original Template  
**Fix Type**: Data isolation + defensive validation  
**Impact**: High (affects core UX and data integrity)  
**Status**: ✅ Resolved with two-layer defense
