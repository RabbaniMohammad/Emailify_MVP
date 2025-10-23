# Data Leakage Fix - Golden vs Original Template Editing 🔴

## 🔴 CRITICAL BUG FOUND

### Problem Report
> "when I make edits for the original template in the visual editor, the golden is also getting applied the same edits"

### Root Cause
**SHARED LOCALSTORAGE KEYS** - Both golden and original template editing were saving to the **SAME** localStorage keys!

```
📦 localStorage Keys (BEFORE FIX):

Original Template Editing:
  - Loads from: template_state_{id}_original
  - Auto-saves to: template_state_{id}_edited ❌
  - Auto-saves to: template_state_{id}_editor_progress ❌

Golden Template Editing:
  - Loads from: visual_editor_{id}_golden_html
  - Auto-saves to: template_state_{id}_edited ❌ SAME KEY!
  - Auto-saves to: template_state_{id}_editor_progress ❌ SAME KEY!

Result: Editing original overwrites golden's edits! ❌
```

---

## ✅ THE FIX

### Modified File: `visual-editor.component.ts`

Updated `autoSave()` method to check `editing_mode` and save to **different locations**:

#### Before:
```typescript
autoSave() {
  // Always saved to template_state keys (WRONG!)
  this.templateState.saveEditorProgress(templateId, html, css);
  localStorage.setItem(`visual_editor_${templateId}_progress`, ...);
}
```

#### After:
```typescript
autoSave() {
  // 🔴 CRITICAL: Check editing mode FIRST
  const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
  
  if (editingMode === 'golden') {
    // ✅ Save to visual_editor keys (GOLDEN-specific)
    localStorage.setItem(`visual_editor_${templateId}_golden_html`, html);
    localStorage.setItem(`visual_editor_${templateId}_progress`, {...});
  } else {
    // ✅ Save to template_state keys (ORIGINAL/VARIANT-specific)
    this.templateState.saveEditorProgress(templateId, html, css);
    localStorage.setItem(`visual_editor_${templateId}_progress`, {...});
  }
}
```

---

## 📦 localStorage Keys (AFTER FIX)

### Golden Template Editing ✅
```
Loads from:
  - visual_editor_{id}_golden_html ✅

Auto-saves to:
  - visual_editor_{id}_golden_html ✅ (overwrite with edits)
  - visual_editor_{id}_progress ✅ (with mode: 'golden')
```

### Original Template Editing ✅
```
Loads from:
  - template_state_{id}_original ✅

Auto-saves to:
  - template_state_{id}_edited ✅
  - template_state_{id}_editor_progress ✅
  - visual_editor_{id}_progress ✅ (with mode: 'original')
```

### Variant Template Editing ✅
```
Loads from:
  - template_state_{id}_original (variant HTML) ✅

Auto-saves to:
  - template_state_{id}_edited ✅
  - template_state_{id}_editor_progress ✅
  - visual_editor_{id}_progress ✅ (with mode: 'original')
```

---

## 🔍 Console Logs Added

### When Auto-Save Triggers:
```
🟦 [AUTO-SAVE] Called - immediate: false, templateId: 67xxxxx
🟦 [AUTO-SAVE] Editing mode: golden
🟦 [AUTO-SAVE] Debounced save triggered
🟦 [AUTO-SAVE] HTML length: 15234
🟦 [AUTO-SAVE] CSS length: 2048
🟦 [AUTO-SAVE] Editing mode: golden
✅✅✅ [AUTO-SAVE] Saving GOLDEN template to visual_editor keys
✅ [AUTO-SAVE] Golden template auto-saved to localStorage
```

OR

```
🟦 [AUTO-SAVE] Called - immediate: false, templateId: 67xxxxx
🟦 [AUTO-SAVE] Editing mode: null (or anything other than 'golden')
🟦 [AUTO-SAVE] Debounced save triggered
🟦 [AUTO-SAVE] HTML length: 15234
🟦 [AUTO-SAVE] CSS length: 2048
🟦 [AUTO-SAVE] Editing mode: original
✅✅✅ [AUTO-SAVE] Saving ORIGINAL/VARIANT template to template_state keys
✅ [AUTO-SAVE] Original template auto-saved to TemplateStateService
```

---

## 🧪 Testing Checklist

### Test 1: Edit Original Template (Should NOT affect golden)
- [ ] Generate golden template
- [ ] Click edit button for **original template**
- [ ] Make changes in visual editor
- [ ] Check console: Should see "Saving ORIGINAL/VARIANT template to template_state keys"
- [ ] Click "Check Preview"
- [ ] **Verify**: Original template updated ✅
- [ ] **Verify**: Golden template UNCHANGED ✅

### Test 2: Edit Golden Template (Should NOT affect original)
- [ ] Click "Visual Editor" button (below golden)
- [ ] Click "Open Visual Editor" in modal
- [ ] Check console: Should see "Editing mode: golden"
- [ ] Make changes in visual editor
- [ ] Check console: Should see "Saving GOLDEN template to visual_editor keys"
- [ ] Click "Check Preview"
- [ ] **Verify**: Golden template updated ✅
- [ ] **Verify**: Original template UNCHANGED ✅

### Test 3: Edit Both (Isolation test)
- [ ] Edit original template → Make change A
- [ ] Click "Check Preview" → Original shows change A ✅
- [ ] Edit golden template → Make change B
- [ ] Click "Check Preview" → Golden shows change B ✅
- [ ] **Verify**: Original still shows change A (not B) ✅
- [ ] **Verify**: Golden shows change B (not A) ✅

### Test 4: Multiple Edits (No contamination)
- [ ] Edit original → Save → Edit again → Save
- [ ] Check golden → Should be unchanged ✅
- [ ] Edit golden → Save → Edit again → Save
- [ ] Check original → Should be unchanged ✅

---

## 📊 Key Changes Summary

| Component | Method | Change |
|-----------|--------|--------|
| `visual-editor.component.ts` | `autoSave()` (immediate mode) | Added editing mode check, routes to different keys |
| `visual-editor.component.ts` | `autoSave()` (debounced mode) | Added editing mode check, routes to different keys |

**Total Lines Modified**: ~80 lines
**Files Modified**: 1 file
**Complexity**: Medium
**Risk**: Low (only affects auto-save routing)

---

## 🔒 Data Isolation Guaranteed

### Before Fix ❌
```
Edit Original → Saves to template_state_{id}_* 
Edit Golden → Saves to template_state_{id}_* (SAME!)
Result: CONTAMINATION ❌
```

### After Fix ✅
```
Edit Original → Saves to template_state_{id}_*
Edit Golden → Saves to visual_editor_{id}_*
Result: ISOLATED ✅
```

---

## 🎯 Verification Commands

### Check localStorage in DevTools Console:
```javascript
// Check all keys for template
const templateId = '67xxxxx'; // Your template ID
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key && key.includes(templateId)) {
    const value = localStorage.getItem(key);
    console.log(`${key}: ${value?.length || 0} chars`);
  }
}
```

### Expected Output (Golden Editing):
```
visual_editor_67xxxxx_editing_mode: 6 chars (value: "golden")
visual_editor_67xxxxx_golden_html: 15234 chars
visual_editor_67xxxxx_progress: 350 chars
```

### Expected Output (Original Editing):
```
template_state_67xxxxx_original: 12500 chars
template_state_67xxxxx_edited: 12600 chars
template_state_67xxxxx_editor_progress: 300 chars
```

---

## 🔄 Related Systems

### 1. TemplateStateService
- **Not Modified** - Still handles original/variant editing
- Used ONLY for original/variant, NOT for golden

### 2. navigateToVisualEditor()
- **Not Modified** - Still saves golden to localStorage correctly
- Sets `editing_mode` to 'golden'

### 3. handleVisualEditorReturn()
- **Not Modified** - Still updates golden correctly
- Reads from `visual_editor_{id}_golden_html`

### 4. getTemplateForEditor()
- **Already Fixed** - Checks editing mode and loads correct template

---

## ✅ Status

**Bug**: 🔴 Data leakage between golden and original editing
**Fix**: ✅ Implemented - Auto-save now routes to different keys based on editing mode
**Testing**: ⏳ Pending user verification
**Compilation**: ✅ No errors
**Console Logs**: ✅ Added for debugging

---

## 🎯 Next Steps

1. ✅ Test original template editing → Should not affect golden
2. ✅ Test golden template editing → Should not affect original
3. ✅ Test both → Should be completely isolated
4. ✅ Verify console logs show correct routing

**Priority**: 🔴 **CRITICAL** - Data integrity issue
**Impact**: High - Affects all template editing
**Effort**: Low - Single method fix
**Risk**: Low - Only changes routing logic

