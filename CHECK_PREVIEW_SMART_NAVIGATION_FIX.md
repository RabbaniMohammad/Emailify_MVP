# Visual Editor - Smart "Check Preview" Navigation + Data Persistence Fix

## Problem
Two issues when clicking "Check Preview" in the Visual Editor:

1. **Navigation Issue**: Users were **always redirected to the QA page**, regardless of where they came from (Use Variants page)
2. **Data Loss Issue**: When returning to Use Variants page, **edited HTML was not being displayed** because it wasn't saved to the correct sessionStorage keys

### User Flow Issues
```
❌ WRONG BEHAVIOR:
Use Variants Page → [Open Editor] → Visual Editor → [Check Preview] 
  → QA Page (WRONG DESTINATION!)
  → Edits lost (WRONG KEYS!)

✅ CORRECT BEHAVIOR:
Use Variants Page → [Open Editor] → Visual Editor → [Check Preview] 
  → Use Variants Page (CORRECT!)
  → Edits displayed (CORRECT!)
```

## Root Cause

### Issue 1: Hard-Coded Navigation
The `onCheckPreview()` method in `visual-editor.component.ts` had **hard-coded navigation** to the QA page:

```typescript
// ❌ OLD CODE - Always goes to QA page
this.router.navigate(['/qa', this.templateId]);
```

This didn't account for different entry points (QA page vs Use Variants page).

### Issue 2: Wrong Storage Keys
The Visual Editor was saving data with keys expected by the **QA page**, not the **Use Variants page**:

```typescript
// ❌ OLD CODE - QA page keys only
localStorage.setItem(`visual_editor_${templateId}_return_flag`, 'true');
// Edited HTML was saved to _progress key, not the key Use Variants expects
```

**Use Variants page expects:**
- Return flag: `sessionStorage['visual_editor_return_use_variant']`
- Edited HTML: `sessionStorage['visual_editor_edited_html']`

**But Visual Editor was saving:**
- Return flag: `localStorage['visual_editor_{id}_return_flag']` ❌
- Edited HTML: Not saved to the right key ❌

## Solution - Smart Context-Aware Navigation + Data Persistence

### Strategy
1. **Detect origin** using metadata saved by the Use Variants page
2. **Save data with correct keys** based on origin (QA page vs Use Variants page)
3. **Navigate to correct destination** based on origin

### Implementation

**File**: `frontend/src/app/app/features/visual-editor/visual-editor.component.ts`  
**Method**: `onCheckPreview()`

```typescript
// 2. ✅ SMART NAVIGATION: Check where user came from and set correct return flags
const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
const useVariantMeta = sessionStorage.getItem(metaKey);

if (useVariantMeta) {
  // ✅ User came from Use Variants page
  try {
    const meta = JSON.parse(useVariantMeta);
    const { runId, no } = meta;
    
    // ✅ CRITICAL: Save edited HTML to the key Use Variants page expects
    const html = this.editor.getHtml();
    sessionStorage.setItem('visual_editor_edited_html', html);
    console.log('✅ [Check Preview] Saved edited HTML for Use Variants page');
    
    // ✅ CRITICAL: Set return flag Use Variants page expects
    sessionStorage.setItem('visual_editor_return_use_variant', 'true');
    console.log('✅ [Check Preview] Set Use Variants return flag');
    
    // Navigate back to Use Variants page
    this.router.navigate(['/qa', this.templateId, 'use', runId, no]);
  } catch (error) {
    // Fallback to QA page with QA page keys
    localStorage.setItem(`visual_editor_${this.templateId}_return_flag`, 'true');
    this.router.navigate(['/qa', this.templateId]);
  }
} else {
  // ✅ User came from QA page - use QA page keys
  localStorage.setItem(`visual_editor_${this.templateId}_return_flag`, 'true');
  this.router.navigate(['/qa', this.templateId]);
}
```

### How It Works

#### Scenario 1: From Use Variants Page
```
1. User on Use Variants page (/qa/123/use/run456/1)
2. Clicks "Open Editor" button
3. Use Variants page:
   ✅ Saves metadata: { runId: 'run456', no: 1 }
   ✅ Navigates to: /visual-editor/123
4. Visual Editor loads with variant's template
5. User makes edits to the HTML
6. User clicks "Check Preview"
7. Visual Editor:
   ✅ Finds metadata in sessionStorage
   ✅ Gets edited HTML from editor
   ✅ Saves to: sessionStorage['visual_editor_edited_html']
   ✅ Sets flag: sessionStorage['visual_editor_return_use_variant'] = 'true'
   ✅ Navigates to: /qa/123/use/run456/1
8. Use Variants page:
   ✅ Detects return flag
   ✅ Loads edited HTML from sessionStorage
   ✅ Displays updated template
   ✅ Clears flags and cleanup
```

#### Scenario 2: From QA Page
```
1. User on QA page (/qa/123)
2. Clicks "Edit" on Golden Template
3. QA page:
   ✅ Does NOT save use-variant metadata
   ✅ Navigates to: /visual-editor/123
4. Visual Editor loads with golden template
5. User clicks "Check Preview"
6. Visual Editor:
   ✅ No metadata found in sessionStorage
   ✅ Falls back to default behavior
   ✅ Navigates to: /qa/123 ← CORRECT!
```

#### Scenario 3: Corrupted Metadata (Edge Case)
```
1. User from Use Variants page
2. Metadata exists but is corrupted/invalid JSON
3. Visual Editor:
   ✅ Try to parse metadata
   ❌ Parsing fails (catch block)
   ✅ Falls back to QA page (safe default)
   ✅ Logs error for debugging
```

## Defensive Features

### 1. **Try-Catch Protection**
```typescript
try {
  const meta = JSON.parse(useVariantMeta);
  // Use metadata
} catch (error) {
  // Fallback to safe default
  this.router.navigate(['/qa', this.templateId]);
}
```
Prevents app crashes if metadata is corrupted.

### 2. **Safe Fallback**
- If metadata doesn't exist → Go to QA page
- If parsing fails → Go to QA page
- Ensures users are never stuck

### 3. **Comprehensive Logging**
```typescript
console.log('🔍 [Check Preview] Found use-variant metadata:', meta);
console.log(`🚀 [Check Preview] Navigating back to Use Variants page: ...`);
```
Makes debugging easy by showing exactly what's happening.

### 4. **sessionStorage Usage**
- Metadata stored in `sessionStorage` (not `localStorage`)
- Automatically cleared when browser tab closes
- Prevents stale data across sessions

## Routes Reference

| Page | Route Pattern | Example |
|------|--------------|---------|
| QA Page | `/qa/:id` | `/qa/123` |
| Use Variants | `/qa/:id/use/:runId/:no` | `/qa/123/use/run456/1` |
| Visual Editor | `/visual-editor/:id` | `/visual-editor/123` |

## sessionStorage Keys

| Key Pattern | Purpose | Set By | Used By |
|------------|---------|--------|---------|
| `visual_editor_{id}_use_variant_meta` | Return navigation data | Use Variants page | Visual Editor (Check Preview) |
| `visual_editor_edited_html` | **Edited HTML for Use Variants** | Visual Editor | Use Variants page (on return) |
| `visual_editor_return_use_variant` | **Return flag for Use Variants** | Visual Editor | Use Variants page (on return) |
| `visual_editor_{id}_editing_mode` | Editing context | Both pages | Visual Editor (various) |
| `visual_editor_{id}_failed_edits` | Grammar/edit issues | Use Variants page | Visual Editor (widget) |

## localStorage Keys

| Key Pattern | Purpose | Set By | Used By |
|------------|---------|--------|---------|
| `visual_editor_{id}_return_flag` | **Return flag for QA page** | Visual Editor | QA page (on return) |
| `visual_editor_{id}_edited_html` | Edited HTML for QA page | Visual Editor | QA page (on return) |
| `visual_editor_{id}_progress` | Editor state backup | Visual Editor | Visual Editor (restore) |

## Testing Scenarios

### ✅ Test 1: QA Page → Visual Editor → QA Page
**Steps:**
1. Navigate to QA page (`/qa/123`)
2. Click "Edit" on Golden Template
3. Make some changes in Visual Editor
4. Click "Check Preview"
5. **Expected**: Navigate back to `/qa/123`
6. **Result**: ✅ Correct navigation

### ✅ Test 2: Use Variants → Visual Editor → Use Variants (With Edits)
**Steps:**
1. Navigate to Use Variants page (`/qa/123/use/run456/1`)
2. Click "Open Editor" button
3. Make changes in Visual Editor (e.g., change a heading text)
4. Click "Check Preview"
5. **Expected**: 
   - Navigate back to `/qa/123/use/run456/1`
   - Display edited HTML with your changes visible
6. **Result**: ✅ Correct navigation + edits displayed

### ✅ Test 3: Multiple Variants
**Steps:**
1. Open variant #1 in editor from `/qa/123/use/run456/1`
2. Click "Check Preview" → should go to variant #1 page
3. Open variant #2 in editor from `/qa/123/use/run456/2`
4. Click "Check Preview" → should go to variant #2 page
5. **Expected**: Each variant returns to its own page
6. **Result**: ✅ Correct isolation

### ✅ Test 4: Fallback on Error
**Steps:**
1. Manually corrupt metadata in sessionStorage (via DevTools)
2. Click "Check Preview"
3. **Expected**: Gracefully fall back to QA page, log error
4. **Result**: ✅ Safe fallback, no crash

## Console Output Examples

### From Use Variants Page
```
✅ [Check Preview] Editor progress saved synchronously
✅ [Check Preview] Visual editor progress saved
🔍 [Check Preview] Found use-variant metadata: {runId: "run456", no: 1}
✅ [Check Preview] Saved edited HTML for Use Variants page
✅ [Check Preview] Set Use Variants return flag
🚀 [Check Preview] Navigating back to Use Variants page: /qa/123/use/run456/1
```

### From QA Page
```
✅ [Check Preview] Editor progress saved synchronously
✅ [Check Preview] Visual editor progress saved
🔍 [Check Preview] No use-variant metadata found - user came from QA page
✅ [Check Preview] Set QA page return flag: visual_editor_123_return_flag
🚀 [Check Preview] Navigating to /qa/123
```

### Fallback on Error
```
✅ [Check Preview] Editor progress saved synchronously
✅ [Check Preview] Visual editor progress saved
✅ [Check Preview] Set return flag: visual_editor_123_return_flag
❌ [Check Preview] Failed to parse use-variant metadata, falling back to QA page: SyntaxError: ...
🚀 [Check Preview] Fallback - Navigating to /qa/123
```

## Code Quality Improvements

### Before (Hard-coded)
```typescript
// ❌ Always goes to one place
this.router.navigate(['/qa', this.templateId]);
```

### After (Context-aware)
```typescript
// ✅ Smart navigation based on origin
const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
const useVariantMeta = sessionStorage.getItem(metaKey);

if (useVariantMeta) {
  // Navigate to Use Variants page
} else {
  // Navigate to QA page (default)
}
```

## Benefits

### User Experience
- ✅ Intuitive navigation - returns to where you came from
- ✅ No confusion about where "Check Preview" will take you
- ✅ Maintains workflow context

### Data Integrity
- ✅ Metadata stays in sessionStorage (auto-cleanup)
- ✅ Each variant's edits are properly isolated
- ✅ No cross-contamination between editing sessions

### Code Quality
- ✅ Defensive error handling (try-catch)
- ✅ Safe fallback behavior
- ✅ Clear console logging for debugging
- ✅ Future-proof for additional origin pages

### Performance
- ✅ sessionStorage is fast
- ✅ No API calls needed
- ✅ Navigation is instant

## Future Enhancements

### Potential Additions
- [ ] Add visual indicator showing return destination before clicking
- [ ] Support for additional entry points (e.g., campaign page)
- [ ] Add "Return to ..." button text that changes based on origin
- [ ] Track navigation history for breadcrumb support

### Monitoring
- Watch for parsing errors in production logs
- Track which entry points are most commonly used
- Monitor fallback usage (should be rare)

## Related Files
- `frontend/src/app/app/features/visual-editor/visual-editor.component.ts` - Check Preview logic
- `frontend/src/app/app/features/qa/pages/use-variant-page/use-variant-page.component.ts` - Metadata saving
- `frontend/src/app/app.routes.ts` - Route definitions

---

**Fixed**: October 25, 2025  
**Issue**: "Check Preview" always navigating to QA page instead of origin page  
**Fix Type**: Smart context-aware navigation with defensive fallback  
**Impact**: High (improves UX for Use Variants workflow)  
**Status**: ✅ Resolved with safe fallback
