# Editing Mode Fix - visual_editor_{id}_editing_mode

## Problem Identified
Console logs showed: **🟦 [AUTO-SAVE] Editing mode: null**

The `editing_mode` localStorage key was missing when editing original templates and variants, causing auto-save to fail routing correctly.

## Root Cause
The data leakage fix implemented routing logic in `autoSave()` that checks `visual_editor_{id}_editing_mode`:
```typescript
const editingMode = localStorage.getItem(`visual_editor_${this.templateId}_editing_mode`);
if (editingMode === 'golden') {
  // Save to visual_editor_{id}_golden_html
} else {
  // Save to template_state_{id}_* via TemplateStateService
}
```

However, the `editing_mode` key was ONLY set when editing **golden templates**, not when editing **original templates** or **variants**.

## Solution Applied

### 1. Original Template Editing (`onEditOriginalTemplate`)
**Location:** `qa-page.component.ts` line ~1495

**Added:**
```typescript
// ✅ CRITICAL: Set editing mode to 'original' so auto-save routes correctly
const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
console.log('🟦 [EDIT ORIGINAL] Setting editing mode to "original"');
localStorage.setItem(editingModeKey, 'original');
console.log('✅ [EDIT ORIGINAL] Editing mode set to "original"');
```

### 2. Variant Editing (`onEditVariant`)
**Location:** `qa-page.component.ts` line ~1515

**Added:**
```typescript
// ✅ CRITICAL: Set editing mode to 'variant' so auto-save routes correctly
const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
console.log('🟦 [EDIT VARIANT] Setting editing mode to "variant"');
localStorage.setItem(editingModeKey, 'variant');
console.log('✅ [EDIT VARIANT] Editing mode set to "variant"');
```

### 3. Golden Template Editing (`navigateToVisualEditor`)
**Already Fixed** - Sets `editing_mode` to `'golden'`

## Expected Console Output After Fix

### When Editing Original Template:
```
🟦 [EDIT ORIGINAL] Setting editing mode to "original"
✅ [EDIT ORIGINAL] Editing mode set to "original"
🟦 [AUTO-SAVE] Editing mode: original
✅✅✅ [AUTO-SAVE] Saving ORIGINAL/VARIANT template to template_state keys
```

### When Editing Variant:
```
🟦 [EDIT VARIANT] Setting editing mode to "variant"
✅ [EDIT VARIANT] Editing mode set to "variant"
🟦 [AUTO-SAVE] Editing mode: variant
✅✅✅ [AUTO-SAVE] Saving ORIGINAL/VARIANT template to template_state keys
```

### When Editing Golden Template:
```
🟦 [GOLDEN EDIT] Setting editing mode to "golden"
✅ [GOLDEN EDIT] Editing mode set to "golden"
🟦 [AUTO-SAVE] Editing mode: golden
✅✅✅ [AUTO-SAVE] Saving GOLDEN template to visual_editor keys
```

## localStorage Key Architecture

### Golden Template Editing
- **editing_mode**: `'golden'`
- **Auto-save target**: `visual_editor_{id}_golden_html`
- **No TemplateStateService involvement**

### Original Template Editing
- **editing_mode**: `'original'`
- **Auto-save target**: `template_state_{id}_edited` (via TemplateStateService)
- **Uses**: `template_state_{id}_original`, `template_state_{id}_editor_progress`

### Variant Editing
- **editing_mode**: `'variant'`
- **Auto-save target**: `template_state_{id}_edited` (via TemplateStateService)
- **Uses**: `template_state_{id}_true_original` (preserves real original)

## Testing Checklist

1. **Edit Original Template**
   - [ ] Click "Edit Original Template" button
   - [ ] Check console: Should see "Editing mode: original"
   - [ ] Make edits in visual editor
   - [ ] Check localStorage: `template_state_{id}_edited` should update
   - [ ] Check localStorage: `visual_editor_{id}_golden_html` should NOT update

2. **Edit Variant**
   - [ ] Generate variants first
   - [ ] Click "Edit" on any variant
   - [ ] Check console: Should see "Editing mode: variant"
   - [ ] Make edits in visual editor
   - [ ] Check localStorage: `template_state_{id}_edited` should update
   - [ ] Check localStorage: `visual_editor_{id}_golden_html` should NOT update

3. **Edit Golden Template**
   - [ ] Generate golden template first
   - [ ] Click "Edit Golden Template" button
   - [ ] Check console: Should see "Editing mode: golden"
   - [ ] Make edits in visual editor
   - [ ] Check localStorage: `visual_editor_{id}_golden_html` should update
   - [ ] Check localStorage: `template_state_{id}_edited` should NOT update

4. **Data Isolation Verification**
   - [ ] Edit original → Check golden unchanged
   - [ ] Edit golden → Check original unchanged
   - [ ] Edit variant → Check both golden and original unchanged

## Files Modified
1. `frontend/src/app/app/features/qa/pages/qa-page/qa-page.component.ts`
   - `onEditOriginalTemplate()` - Added editing_mode = 'original'
   - `onEditVariant()` - Added editing_mode = 'variant'

## Related Documentation
- `DATA_LEAKAGE_FIX.md` - Original data leakage fix that introduced editing_mode checking
- `VARIANT_CORRUPTION_FIX.md` - TRUE_ORIGINAL_KEY preservation for variants
- `LOGOUT_CLEANUP_LOCALSTORAGE_ONLY.md` - Cleanup of all editing state on logout
