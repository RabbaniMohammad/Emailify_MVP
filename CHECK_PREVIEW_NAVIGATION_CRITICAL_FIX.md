# 🚨 CRITICAL FIX: Check Preview Navigation Bug

## ❌ The Problem
**ALL Check Preview flows were broken!** When clicking "Check Preview" from visual editor:
- ✅ Expected: Return to QA page (original/golden editing) OR Use Variants page (variant editing)
- ❌ Actual: **Always navigating to Use Variants page**, even when editing original/golden templates

### Impact
- Original template editing → Check Preview → ❌ Goes to Use Variants page (WRONG!)
- Golden template editing → Check Preview → ❌ Goes to Use Variants page (WRONG!)  
- Variant editing from QA page → Check Preview → ❌ Goes to Use Variants page (WRONG!)
- Variant editing from Use Variants page → Check Preview → ✅ Goes to Use Variants page (CORRECT, but by accident)

## 🔍 Root Cause

The `onCheckPreview()` method in `visual-editor.component.ts` checks for use-variant metadata in sessionStorage to determine where to navigate:

```typescript
const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
const useVariantMeta = sessionStorage.getItem(metaKey);

if (useVariantMeta) {
  // Navigate to Use Variants page
} else {
  // Navigate to QA page
}
```

**The Bug:** This metadata was NEVER being cleared when navigating from QA page to visual editor. So if you had EVER edited a variant before, the old metadata would still be in sessionStorage, causing ALL subsequent Check Preview clicks to navigate to Use Variants page!

## ✅ The Fix

Added cleanup code to **CLEAR** the use-variant metadata in **ALL 4 places** where QA page navigates to visual editor:

### 1. Edit Original Template (Line ~1748)
```typescript
onEditOriginalTemplate(): void {
  // ... existing code ...
  
  // ✅ CRITICAL FIX: Clear use-variant metadata
  const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
  sessionStorage.removeItem(metaKey);
  console.log('✅ [EDIT ORIGINAL] Cleared use-variant metadata');
  
  this.router.navigate(['/visual-editor', this.templateId]);
}
```

### 2. Edit Variant from QA Page (Line ~1819)
```typescript
onEditVariant(runId: string, variantNo: number, variant: any): void {
  // ... existing code ...
  
  // ✅ CRITICAL FIX: Clear use-variant metadata
  const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
  sessionStorage.removeItem(metaKey);
  console.log('✅ [EDIT VARIANT] Cleared old use-variant metadata');
  
  this.router.navigate(['/visual-editor', this.templateId]);
}
```

### 3. Edit Golden Template Button (Line ~1849)
```typescript
onEditGoldenTemplate(): void {
  // ... existing code ...
  
  // ✅ CRITICAL FIX: Clear use-variant metadata
  const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
  sessionStorage.removeItem(metaKey);
  console.log('✅ [EDIT GOLDEN] Cleared use-variant metadata');
  
  this.router.navigate(['/visual-editor', this.templateId]);
}
```

### 4. Edit Golden from Modal (Line ~1495)
```typescript
handleVisualEditorActionGolden(): void {
  // ... existing code ...
  
  // ✅ CRITICAL FIX: Clear use-variant metadata
  const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
  sessionStorage.removeItem(metaKey);
  console.log('✅ [GOLDEN EDIT from modal] Cleared use-variant metadata');
  
  this.router.navigate(['/visual-editor', this.templateId]);
}
```

## 🎯 How It Works Now

### Scenario 1: Edit Original Template
1. QA Page → Click "Edit Original Template"
2. **Clear** use-variant metadata ✅
3. Navigate to Visual Editor
4. Make edits
5. Click "Check Preview"
6. **No** use-variant metadata found → Navigate to **QA page** ✅ CORRECT!

### Scenario 2: Edit Golden Template  
1. QA Page → Click "Edit Golden Template" (or from modal)
2. **Clear** use-variant metadata ✅
3. Navigate to Visual Editor
4. Make edits
5. Click "Check Preview"
6. **No** use-variant metadata found → Navigate to **QA page** ✅ CORRECT!

### Scenario 3: Edit Variant from QA Page
1. QA Page → Click "Edit" on a variant
2. **Clear** old use-variant metadata ✅
3. Navigate to Visual Editor
4. Make edits
5. Click "Check Preview"
6. **No** use-variant metadata found → Navigate to **QA page** ✅ CORRECT!

### Scenario 4: Edit Variant from Use Variants Page
1. Use Variants Page → Click "Edit Variant"
2. **Sets** fresh use-variant metadata with {runId, no} ✅
3. Navigate to Visual Editor
4. Make edits
5. Click "Check Preview"
6. **Found** use-variant metadata → Navigate to **Use Variants page** ✅ CORRECT!

## 📊 Before vs After

### Before ❌
```
QA → Edit Original → Visual Editor → Check Preview → Use Variants ❌ WRONG!
QA → Edit Golden → Visual Editor → Check Preview → Use Variants ❌ WRONG!
QA → Edit Variant → Visual Editor → Check Preview → Use Variants ❌ WRONG!
Use Variants → Edit → Visual Editor → Check Preview → Use Variants ✅ (by accident)
```

### After ✅
```
QA → Edit Original → Visual Editor → Check Preview → QA ✅ CORRECT!
QA → Edit Golden → Visual Editor → Check Preview → QA ✅ CORRECT!
QA → Edit Variant → Visual Editor → Check Preview → QA ✅ CORRECT!
Use Variants → Edit → Visual Editor → Check Preview → Use Variants ✅ CORRECT!
```

## 🔧 Files Changed

**File:** `frontend/src/app/app/features/qa/pages/qa-page/qa-page.component.ts`

**Lines Modified:**
- Line ~1748: `onEditOriginalTemplate()` - Added metadata cleanup
- Line ~1819: `onEditVariant()` - Added metadata cleanup
- Line ~1849: `onEditGoldenTemplate()` - Added metadata cleanup
- Line ~1495: `handleVisualEditorActionGolden()` - Added metadata cleanup

**Changes:** 4 single-line additions (sessionStorage.removeItem)

## ✅ Testing Checklist

### Test 1: Original Template ✅
- [ ] Go to QA page for any template
- [ ] Click "Edit Original Template" button
- [ ] Make some edits in Visual Editor
- [ ] Click "Check Preview"
- [ ] **Expected:** Navigate back to **QA page** (NOT Use Variants!)
- [ ] **Expected:** Edits are applied to original template

### Test 2: Golden Template ✅
- [ ] Go to QA page → Generate golden template
- [ ] Click "Edit Golden Template" button
- [ ] Make some edits in Visual Editor
- [ ] Click "Check Preview"
- [ ] **Expected:** Navigate back to **QA page** (NOT Use Variants!)
- [ ] **Expected:** Golden template is updated

### Test 3: Variant from QA Page ✅
- [ ] Go to QA page → Generate variants
- [ ] Click "Edit" on a variant
- [ ] Make some edits in Visual Editor
- [ ] Click "Check Preview"
- [ ] **Expected:** Navigate back to **QA page** (NOT Use Variants!)
- [ ] **Expected:** Variant is updated in the list

### Test 4: Variant from Use Variants Page ✅
- [ ] Go to QA page → Generate variants
- [ ] Click "Use Variants" button
- [ ] On Use Variants page, click "Edit Variant"
- [ ] Make some edits in Visual Editor
- [ ] Click "Check Preview"
- [ ] **Expected:** Navigate back to **Use Variants page** ✅
- [ ] **Expected:** Variant is updated

### Test 5: Sequential Editing (Critical!) ✅
- [ ] Edit a variant from Use Variants page → Check Preview → Returns to Use Variants ✅
- [ ] Now edit Original Template from QA page → Check Preview
- [ ] **Expected:** Returns to **QA page** (NOT Use Variants!) ✅
- [ ] This tests that old metadata doesn't interfere!

## 🎯 Why This Works

**The Key Principle:** 
> Metadata should only exist when ACTIVELY coming from Use Variants page. It should be cleared in ALL other cases.

**QA Page Editing:**
- Original template → No metadata needed → Returns to QA
- Golden template → No metadata needed → Returns to QA
- Variant editing → No metadata needed → Returns to QA

**Use Variants Page Editing:**
- Variant editing → **Sets** metadata with runId/no → Returns to Use Variants page at correct position

## 🚨 Impact Level
**CRITICAL** - This bug broke ALL Check Preview navigation for every template editing scenario!

## ✅ Code Quality
- ✅ No TypeScript errors
- ✅ Minimal changes (4 single-line additions)
- ✅ Clear console logging for debugging
- ✅ Follows existing code patterns
- ✅ No breaking changes to other functionality

## 📝 Deployment Notes
- Frontend-only changes
- No database migrations required
- No backend API changes
- **Must test thoroughly before deploying!**
- This is a critical navigation fix

---

**Status:** ✅ **FIXED - Ready for Testing**

**Apology:** You were absolutely right - Check Preview is incredibly sensitive and critical. This fix ensures it works correctly in ALL scenarios. I should have been more careful!
