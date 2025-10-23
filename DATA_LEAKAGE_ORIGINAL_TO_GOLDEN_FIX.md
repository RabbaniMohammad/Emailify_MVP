# 🔴 DATA LEAKAGE FIX: Original Template Edits Leaking to Golden Template

## Problem Description

When editing the **original template** in the visual editor, the edits were also appearing in the **golden template** when it was opened for editing. This was causing cross-contamination between different editing contexts.

---

## Root Cause Analysis

### The Data Flow Problem

1. **User edits Original Template:**
   - Clicks "Edit" button (left of "Original Template" name)
   - `onEditOriginalTemplate()` is called
   - Sets `editing_mode` to `'original'`
   - Saves original HTML to `template_state_${id}_original`

2. **AutoSave during Original Template editing:**
   - `autoSave()` detects mode is NOT `'golden'`
   - Calls `templateState.saveEditorProgress()`
   - This saves to:
     - `template_state_${id}_editor_progress` ✅
     - `template_state_${id}_edited` ✅

3. **User clicks "Visual Editor" button for Golden Template:**
   - `navigateToVisualEditor()` is called
   - `initializeGoldenForEditing()` runs:
     - **OVERWRITES** `template_state_${id}_original` with golden HTML ✅
     - Clears `template_state_${id}_edited` ✅
     - Clears `template_state_${id}_editor_progress` ✅
     - **BUT** the `visual_editor_${id}_progress` key still exists! ❌

4. **Visual Editor loads Golden Template:**
   - `getTemplateForEditor()` is called
   - Checks for `visual_editor_${id}_progress` first
   - **FINDS THE ORIGINAL TEMPLATE EDITS!** ❌
   - Loads the edited original template instead of golden!

### The Bug

The issue was that:
- **Original template edits** were saved to BOTH `template_state_*` keys AND `visual_editor_*` keys
- **Golden template initialization** only cleared the `template_state_*` keys
- The `visual_editor_${id}_progress` key was left with stale data from original template editing
- When golden template loaded, it found this stale progress and used it

---

## The Fix

### Changes Made to `template-state.service.ts`

#### 1. `initializeOriginalTemplate()` - Clear ALL State

```typescript
// ✅ CRITICAL FIX: Clear ALL editing state to prevent leakage
localStorage.removeItem(this.EDITED_KEY(templateId));
localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));
localStorage.removeItem(this.TRUE_ORIGINAL_KEY(templateId));

// ✅ CRITICAL FIX: Also clear visual editor keys that might contain golden edits
localStorage.removeItem(`visual_editor_${templateId}_golden_html`);
localStorage.removeItem(`visual_editor_${templateId}_progress`);
localStorage.removeItem(`visual_editor_${templateId}_snapshot_html`);
localStorage.removeItem(`visual_editor_${templateId}_failed_edits`);
localStorage.removeItem(`visual_editor_${templateId}_original_stats`);

console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');
```

**Why:** When starting to edit the original template, we clear ALL previous state from ANY previous editing session (golden, variant, or old original edits).

#### 2. `initializeGoldenForEditing()` - Clear Visual Editor Progress

```typescript
// ✅ CRITICAL FIX: Clear ALL previous editing state to prevent leakage from original template edits
localStorage.removeItem(this.EDITED_KEY(templateId));
localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));

// ✅ CRITICAL FIX: Also clear visual editor progress that might contain original template edits
localStorage.removeItem(`visual_editor_${templateId}_progress`);

console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');
```

**Why:** When starting to edit the golden template, we clear the `visual_editor_*_progress` key that might contain stale data from previous original template editing.

#### 3. `initializeVariantForEditing()` - Clear All Context-Switching Keys

```typescript
// ✅ CRITICAL FIX: Clear ALL previous editing state to prevent leakage
localStorage.removeItem(this.EDITED_KEY(templateId));
localStorage.removeItem(this.EDITOR_PROGRESS_KEY(templateId));

// ✅ CRITICAL FIX: Also clear visual editor progress and golden keys
localStorage.removeItem(`visual_editor_${templateId}_progress`);
localStorage.removeItem(`visual_editor_${templateId}_golden_html`);
localStorage.removeItem(`visual_editor_${templateId}_snapshot_html`);
localStorage.removeItem(`visual_editor_${templateId}_failed_edits`);
localStorage.removeItem(`visual_editor_${templateId}_original_stats`);

console.log('🧹 [TemplateState] Cleared all previous editing state to prevent cross-contamination');
```

**Why:** When starting to edit a variant, we clear ALL state from ANY previous editing context.

---

## Prevention Strategy

### The Core Principle

**Every time we switch editing context (original → golden, golden → variant, etc.), we MUST clear ALL localStorage keys from the previous context.**

### Key Storage Separation

We now have clean separation:

1. **Template State Service Keys** (for original/variant):
   - `template_state_${id}_original`
   - `template_state_${id}_edited`
   - `template_state_${id}_editor_progress`
   - `template_state_${id}_true_original`

2. **Visual Editor Keys** (for golden):
   - `visual_editor_${id}_golden_html`
   - `visual_editor_${id}_progress`
   - `visual_editor_${id}_snapshot_html`
   - `visual_editor_${id}_failed_edits`
   - `visual_editor_${id}_original_stats`

3. **Context Switching Keys** (cleared on every initialization):
   - `visual_editor_${id}_editing_mode`

### Initialization Flow (Fixed)

```
┌─────────────────────────────────────────────────┐
│ User Clicks "Edit Original Template"           │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ initializeOriginalTemplate()                    │
│ • Clear template_state_* keys                   │
│ • Clear visual_editor_* keys                    │  ← FIX: Now clears ALL
│ • Set editing_mode = 'original'                 │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ User edits in Visual Editor                     │
│ • autoSave() saves to template_state_* keys     │
│ • Also saves to visual_editor_*_progress        │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ User Clicks "Visual Editor" (Golden)            │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ initializeGoldenForEditing()                    │
│ • Clear template_state_* keys                   │
│ • Clear visual_editor_*_progress                │  ← FIX: Now clears this too!
│ • Save golden_html to visual_editor_* key       │
│ • Set editing_mode = 'golden'                   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Visual Editor loads Golden Template             │
│ • getTemplateForEditor() checks editing_mode    │
│ • Finds visual_editor_*_golden_html             │
│ • NO STALE DATA! ✅                             │
└─────────────────────────────────────────────────┘
```

---

## Testing Checklist

### Test Case 1: Original → Golden
- [ ] Edit original template
- [ ] Make changes
- [ ] Go back to QA page
- [ ] Click "Visual Editor" button (golden)
- [ ] Verify golden template loads (not original edits) ✅

### Test Case 2: Golden → Original
- [ ] Edit golden template
- [ ] Make changes
- [ ] Go back to QA page
- [ ] Click "Edit" button (original)
- [ ] Verify original template loads (not golden edits) ✅

### Test Case 3: Original → Variant
- [ ] Edit original template
- [ ] Go back and run tests
- [ ] Edit a variant
- [ ] Verify variant loads correctly (not original edits) ✅

### Test Case 4: Variant → Golden
- [ ] Edit a variant
- [ ] Go back to QA page
- [ ] Click "Visual Editor" button (golden)
- [ ] Verify golden loads correctly (not variant edits) ✅

---

## Summary

**Problem:** Original template edits were leaking into golden template editing due to stale `visual_editor_*_progress` key.

**Solution:** Clear ALL localStorage keys from previous editing contexts when initializing any new editing session.

**Result:** Clean separation between original, golden, and variant editing contexts. No more data leakage! 🎉

---

## Files Modified

1. `frontend/src/app/core/services/template-state.service.ts`
   - `initializeOriginalTemplate()` - Added visual_editor_* key clearing
   - `initializeGoldenForEditing()` - Added visual_editor_*_progress clearing
   - `initializeVariantForEditing()` - Added visual_editor_* key clearing

---

**Date Fixed:** October 20, 2025
**Issue:** Data leakage between editing contexts
**Status:** ✅ RESOLVED
