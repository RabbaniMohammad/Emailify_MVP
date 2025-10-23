# 🔧 Golden Template Check Preview Fix

## 🐛 The Problem

**Issue:** When editing the golden template via the visual editor (opened from the failed edits modal/banner), changes made in the visual editor were not showing up in the QA page after clicking "Check Preview".

### User Flow That Was Broken:
1. ✅ Generate golden template on QA page
2. ✅ Click "Open Visual Editor" from failed edits modal
3. ✅ Visual editor loads with golden template
4. ✅ User makes changes in visual editor
5. ✅ User clicks "Check Preview" button
6. ❌ **QA page doesn't show the changes made in visual editor**
7. ❌ **Golden template in QA page shows the OLD version (pre-edit)**

---

## 🔍 Root Cause Analysis

The issue was in the `TemplateStateService.getCurrentTemplate()` method:

### What Was Happening:

1. **Visual Editor (Saving):**
   - When editing golden template, `autoSave()` correctly saved to: `visual_editor_{id}_golden_html` ✅
   - Editing mode was set to `'golden'` ✅

2. **QA Page (Loading):**
   - When user clicked "Check Preview", QA page called `getCurrentTemplate(id)` ❌
   - `getCurrentTemplate()` only checked `editingContext.type` for golden detection
   - **BUT** the `editingContext` might not be set if only `editing_mode` flag was set
   - Method would fall through to checking `template_state_{id}_edited` (wrong key!)
   - No golden HTML found, returned original template instead ❌

### The Core Issue:

```typescript
// ❌ OLD CODE - Only checked editing context
if (context?.type === 'golden') {
  const goldenHtml = localStorage.getItem(`visual_editor_${templateId}_golden_html`);
  if (goldenHtml) {
    return goldenHtml;
  }
}
// Falls through to checking original/edited keys (wrong for golden editing!)
```

**Problem:** If `editing_mode` flag was set but `editing_context` wasn't, the method would miss the golden HTML and return the wrong template.

---

## ✅ The Fix

Updated `TemplateStateService.getCurrentTemplate()` to check **BOTH** the editing context AND the editing mode flag:

```typescript
// ✅ NEW CODE - Check both context and mode flag
const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
console.log('🔍 [TemplateState] Editing mode flag:', editingMode);

// Check BOTH context AND mode flag
if (context?.type === 'golden' || editingMode === 'golden') {
  const goldenHtml = localStorage.getItem(`visual_editor_${templateId}_golden_html`);
  if (goldenHtml) {
    console.log('✅ [TemplateState] Returning GOLDEN template (edited)');
    console.log('   - Length:', goldenHtml.length);
    console.log('   - Preview (first 100 chars):', goldenHtml.substring(0, 100));
    return goldenHtml;
  } else {
    console.warn('⚠️ [TemplateState] Golden editing mode detected but no golden HTML found!');
  }
}
```

### Why This Works:

1. **Redundancy:** Checks both `editingContext.type` AND `editing_mode` flag
2. **Backwards Compatibility:** Works even if only one of the flags is set
3. **Better Logging:** Added warning if golden mode is detected but no HTML found
4. **Debug Info:** Logs length and preview of golden HTML for troubleshooting

---

## 🧪 Testing Checklist

### ✅ Test Golden Template Editing Flow:

1. **Generate Golden Template:**
   - [ ] Go to QA page
   - [ ] Click "Generate Golden" button
   - [ ] Wait for golden template to generate
   - [ ] Verify golden template shows in right column

2. **Open Visual Editor:**
   - [ ] Click "Visual Editor" button (should be orange/red if failed edits exist)
   - [ ] Modal opens showing failed edits
   - [ ] Click "Open Visual Editor" button
   - [ ] Visual editor loads with golden template

3. **Make Changes:**
   - [ ] Make some visible changes in visual editor (e.g., change text, colors)
   - [ ] Wait for auto-save indicator

4. **Check Preview:**
   - [ ] Click "Check Preview" button
   - [ ] Navigate back to QA page
   - [ ] **VERIFY:** Golden template (right column) shows your changes ✅
   - [ ] **VERIFY:** Original template (left column) is unchanged ✅

5. **Console Logs to Verify:**
   ```
   🔍 [TemplateState] Getting current template for: {template_id}
   🔍 [TemplateState] Editing mode flag: golden
   🔍 [TemplateState] Looking for golden HTML: true
   ✅ [TemplateState] Returning GOLDEN template (edited)
      - Length: {some_number}
      - Preview (first 100 chars): {html_preview}
   ```

### ✅ Test Original Template Editing Flow (Regression Test):

1. **Edit Original Template:**
   - [ ] Click pencil icon on original template (left column)
   - [ ] Visual editor loads with original template
   - [ ] Make changes
   - [ ] Click "Check Preview"
   - [ ] **VERIFY:** Original template (left column) shows changes ✅
   - [ ] **VERIFY:** Golden template (right column) is unchanged ✅

---

## 📝 Files Modified

1. **`frontend/src/app/app/core/services/template-state.service.ts`**
   - Method: `getCurrentTemplate()`
   - Added check for `editing_mode` flag alongside `editingContext.type`
   - Enhanced logging for debugging

---

## 🎯 Expected Behavior After Fix

### Golden Template Editing:
```
QA Page → Open Visual Editor → Edit Golden → Check Preview
   ↓                                            ↓
   Golden Template (v1)              Golden Template (v2) ✅
   Original Template (v1)            Original Template (v1) ✅
```

### Original Template Editing:
```
QA Page → Edit Original → Check Preview
   ↓                         ↓
   Original (v1)            Original (v2) ✅
   Golden (v1)              Golden (v1) ✅
```

---

## 🔄 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Golden Template Editing                   │
└─────────────────────────────────────────────────────────────┘

1. QA Page - Open Visual Editor
   ├─ Set: visual_editor_{id}_editing_mode = 'golden'
   ├─ Set: visual_editor_{id}_golden_html = {original_golden}
   ├─ Set: template_state_{id}_editing_context = { type: 'golden' }
   └─ Navigate to /visual-editor/{id}

2. Visual Editor - Load Golden Template
   ├─ getTemplateForEditor() checks editing_mode === 'golden'
   ├─ Returns: visual_editor_{id}_golden_html
   └─ Editor loads golden template ✅

3. Visual Editor - User Makes Changes
   ├─ User edits content
   └─ autoSave() triggered

4. Visual Editor - Auto Save
   ├─ Check: editing_mode === 'golden'
   ├─ Save to: visual_editor_{id}_golden_html (UPDATED) ✅
   └─ Save to: visual_editor_{id}_progress

5. Visual Editor - Check Preview Clicked
   ├─ Final autoSave(true) to ensure latest changes saved
   ├─ Set: visual_editor_{id}_return_flag = 'true'
   └─ Navigate to /qa/{id}

6. QA Page - Return from Editor (THE FIX!)
   ├─ Detect: return_flag === 'true'
   ├─ Call: getCurrentTemplate(id)
   │  ├─ Check: editing_mode === 'golden' ✅ (THE FIX!)
   │  ├─ OR: editingContext.type === 'golden' ✅
   │  └─ Return: visual_editor_{id}_golden_html (EDITED VERSION) ✅
   ├─ Call: handleVisualEditorReturn(id, editedHtml)
   │  ├─ Compare edited vs original for failed edit fixes
   │  ├─ Update golden stats
   │  └─ Update goldenSubject with new HTML ✅
   └─ Display updated golden template in QA page ✅
```

---

## 🚨 Important Notes

1. **Two Flag System:** The app uses both `editing_context` (new) and `editing_mode` (legacy) for redundancy
2. **Key Consistency:** Golden edits always save to `visual_editor_{id}_golden_html`
3. **Original Untouched:** When editing golden, original template remains unchanged
4. **Stats Update:** Failed edits are recalculated after each Check Preview

---

## 🐛 If Issue Persists

### Debug Steps:

1. **Open Browser Console (F12)**

2. **Before Clicking "Open Visual Editor":**
   ```javascript
   // Check if golden template exists
   console.log('Golden exists:', !!localStorage.getItem('visual_editor_YOUR_TEMPLATE_ID_golden_html'));
   ```

3. **After Clicking "Open Visual Editor":**
   ```javascript
   // Verify editing mode is set
   console.log('Editing mode:', localStorage.getItem('visual_editor_YOUR_TEMPLATE_ID_editing_mode'));
   // Should be: "golden"
   ```

4. **After Making Changes:**
   ```javascript
   // Verify golden HTML was updated
   const goldenHtml = localStorage.getItem('visual_editor_YOUR_TEMPLATE_ID_golden_html');
   console.log('Golden length:', goldenHtml?.length);
   console.log('Preview:', goldenHtml?.substring(0, 200));
   ```

5. **After Clicking "Check Preview" (on QA page):**
   - Look for console logs starting with `🔍 [TemplateState]`
   - Should see: `Returning GOLDEN template (edited)`
   - Should NOT see: `Returning ORIGINAL template`

---

## ✅ Success Criteria

- [ ] Golden template changes from visual editor appear in QA page
- [ ] Original template remains unchanged when editing golden
- [ ] Failed edits are recalculated correctly
- [ ] Button color updates based on remaining failed edits
- [ ] Console logs show correct template is being loaded
- [ ] No regression in original template editing flow

---

**Status:** ✅ Fixed
**Date:** 2025-10-21
**Priority:** High
**Impact:** Golden template editing workflow
