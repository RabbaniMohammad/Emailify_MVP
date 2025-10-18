# Link Matrix Validation - Auto-Clear on Navigation Fix

## 🐛 Problem

When navigating from the **QA page** back to the **Use Variant page** for the same template, the link matrix validation section was not being cleared. This caused confusion because:

1. User goes to **Use Variant** page for Template 1
2. Uploads CSV with link matrix data
3. Finalizes and captures screenshots
4. Navigates back to QA page
5. Clicks on **"Skip Variants"**, **"Golden Template"**, or **"Use Variant"** button again
6. **Issue:** Link matrix data was still present, even though the system should require re-finalization

The system should treat navigation from QA page as "potential changes happened" and force the user to:
- Re-upload the link matrix CSV (if needed)
- Re-finalize the template
- Re-capture screenshots

## ✅ Solution

Added automatic clearing of link matrix validation data when navigating from QA page to Use Variant page.

### Changes Made

#### 1. **QA Service** (`qa.service.ts`)
Added new method to clear valid links for a specific run:

```typescript
/**
 * Clear valid links for a specific run
 * Called when navigating to a template from QA page to force re-finalization
 */
clearValidLinks(runId: string): void {
  try {
    const key = this.kValidLinks(runId);
    localStorage.removeItem(key);
    console.log(`🧹 Cleared valid links for ${runId}`);
  } catch (e) {
    console.error('Failed to clear valid links:', e);
  }
}
```

#### 2. **QA Page Component** (`qa-page.component.ts`)

**Updated `onBypassVariants()` method:**
```typescript
onBypassVariants(): void {
  // ... existing code ...
  
  // Clear data for this run (force re-finalization)
  this.qa.clearChatForRun(syntheticRun.runId, 1);
  this.qa.clearSnapsForRun(syntheticRun.runId);
  this.qa.clearValidLinks(syntheticRun.runId); // ✅ NEW: Clear link matrix data
  
  // ... existing code ...
}
```

**Updated `onUseVariant()` method:**
```typescript
onUseVariant(templateId: string, runId: string, no: number) {
  // Clear data for this run (force re-finalization on navigation)
  this.qa.clearChatForRun(runId, no);
  this.qa.clearSnapsForRun(runId);
  this.qa.clearValidLinks(runId); // ✅ NEW: Clear link matrix data
  
  this.router.navigate(['/qa', templateId, 'use', runId, no]);
}
```

## 🎯 Behavior After Fix

### Scenario 1: Skip Variants Button
1. User is on QA page for Template 1
2. Clicks **"Skip Variants"** button (bypass variants, use golden template)
3. ✅ Navigates to Use Variant page
4. ✅ Link matrix section is **cleared** (empty state)
5. ✅ Screenshots are **cleared**
6. ✅ Chat is **cleared**
7. User must re-upload CSV and re-finalize

### Scenario 2: Use Variant Button
1. User is on QA page for Template 1
2. Clicks **"Use This Template"** button for Variant 2
3. ✅ Navigates to Use Variant page for Variant 2
4. ✅ Link matrix section is **cleared** (empty state)
5. ✅ Screenshots are **cleared**
6. ✅ Chat is **cleared**
7. User must re-upload CSV and re-finalize

### Scenario 3: Different Template
1. User is on Use Variant page for **Template 1** with link matrix data uploaded
2. Navigates back to QA page
3. Clicks on **Template 2** → Use Variant
4. ✅ Template 1's link matrix data remains intact (not affected)
5. ✅ Template 2's link matrix section is cleared
6. Each template's data is isolated by `runId`

## 🔍 What Gets Cleared

When navigating from QA page to Use Variant page, the following data is cleared **for that specific runId**:

| Data Type | Storage Key | Cleared By |
|-----------|-------------|------------|
| **Chat Messages** | `qa:chat:${runId}:${no}` | `clearChatForRun()` |
| **Link Screenshots** | `qa:snaps:${runId}` | `clearSnapsForRun()` |
| **Link Matrix (Valid Links)** | `qa:validlinks:${runId}` | `clearValidLinks()` ✅ NEW |

## 🛡️ Data Isolation

Each template variant has a unique `runId`, ensuring:
- ✅ Template 1's data doesn't affect Template 2
- ✅ Variant 1's data doesn't affect Variant 2
- ✅ Only the specific `runId` being navigated to gets cleared
- ✅ Other templates' data remains intact in localStorage

### runId Examples:
```
Template 1, Variant 1: runId = "abc123-run-1"
Template 1, Variant 2: runId = "abc123-run-2"
Template 2, Variant 1: runId = "xyz789-run-1"
Bypass Variants:       runId = "bypass-abc123"
```

## 📊 Storage Keys Structure

```
localStorage:
  qa:chat:abc123-run-1:1          → Chat for Template 1, Variant 1
  qa:snaps:abc123-run-1           → Screenshots for Template 1, Variant 1
  qa:validlinks:abc123-run-1      → Link matrix for Template 1, Variant 1 ✅ NOW CLEARED
  
  qa:chat:abc123-run-2:2          → Chat for Template 1, Variant 2
  qa:snaps:abc123-run-2           → Screenshots for Template 1, Variant 2
  qa:validlinks:abc123-run-2      → Link matrix for Template 1, Variant 2 ✅ NOW CLEARED
  
  qa:chat:xyz789-run-1:1          → Chat for Template 2, Variant 1
  qa:snaps:xyz789-run-1           → Screenshots for Template 2, Variant 1
  qa:validlinks:xyz789-run-1      → Link matrix for Template 2, Variant 1 (independent)
```

## 🧪 Testing

### Test Case 1: Link Matrix Cleared on Skip Variants
1. Go to QA page → Template 1
2. Click "Skip Variants" button
3. Upload link matrix CSV
4. Finalize and capture screenshots
5. Navigate back to QA page
6. Click "Skip Variants" again
7. ✅ **Expected:** Link matrix section is empty, no uploaded CSV, no validation results

### Test Case 2: Link Matrix Cleared on Use Variant
1. Go to QA page → Template 1
2. Generate variants (or use existing)
3. Click "Use This Template" for Variant 2
4. Upload link matrix CSV
5. Finalize and capture screenshots
6. Navigate back to QA page
7. Click "Use This Template" for Variant 2 again
8. ✅ **Expected:** Link matrix section is empty, must re-upload

### Test Case 3: Different Template Not Affected
1. Use Variant page for Template 1 → Upload CSV
2. Navigate to QA page
3. Go to Template 2 → Use Variant
4. Upload different CSV for Template 2
5. Navigate back to Template 1 → Use Variant
6. ✅ **Expected:** Template 1's CSV data is CLEARED (must re-upload)
7. Navigate to Template 2 → Use Variant  
8. ✅ **Expected:** Template 2's CSV data is CLEARED (must re-upload)

### Test Case 4: Screenshot Clearing (Existing Behavior - Unchanged)
The screenshot clearing was already working correctly because:
- `clearSnapsForRun()` was already being called
- This fix adds the same pattern for link matrix data

## 🔄 User Flow Comparison

### Before Fix:
```
QA Page (Template 1)
   ↓ Click "Use Variant"
Use Variant Page
   ↓ Upload CSV with 20 links
   ↓ Finalize
   ↓ Capture 20 screenshots
   ↓ Navigate back
QA Page
   ↓ Click "Use Variant" again
Use Variant Page
   ❌ Link matrix STILL SHOWS 20 links (confusing!)
   ❌ Screenshots cleared (inconsistent!)
   ❌ User thinks: "Are these the old links or new?"
```

### After Fix:
```
QA Page (Template 1)
   ↓ Click "Use Variant"
Use Variant Page
   ↓ Upload CSV with 20 links
   ↓ Finalize
   ↓ Capture 20 screenshots
   ↓ Navigate back
QA Page
   ↓ Click "Use Variant" again
Use Variant Page
   ✅ Link matrix CLEARED (empty state)
   ✅ Screenshots CLEARED (consistent!)
   ✅ User knows: "I need to re-upload and re-finalize"
   ✅ Treats it as fresh start
```

## 💡 Why This Fix Is Important

### 1. **Consistency**
- Screenshots are cleared → Link matrix should also be cleared
- Both are part of the finalization process
- Both should require re-upload on navigation

### 2. **User Clarity**
- Clear empty state = user knows what to do
- Old data persisting = confusion about whether it's valid

### 3. **Data Integrity**
- HTML might have changed (variants are different)
- Old link matrix validation might not match new HTML
- Force re-validation ensures accuracy

### 4. **Expected Behavior**
- Navigation from QA page = "I want to work on this template fresh"
- System should reflect this by clearing finalization data

## 📝 Technical Notes

### Why Clear on Navigation?

The system can't know if the HTML changed between QA page and Use Variant page:
- Golden template might have been regenerated
- Variant might be different
- User might have made changes

Therefore, **safest approach** is to clear finalization data and force re-validation.

### Why Not Clear on Every Page Load?

We only clear when navigating **from QA page to Use Variant page** via the buttons because:
- ✅ These buttons indicate "I want to work on this template"
- ✅ Browser refresh should preserve data (user might refresh by accident)
- ✅ Direct URL navigation should preserve data (user might bookmark the page)

### Future Enhancement Ideas

1. **Smart Detection**: Only clear if HTML changed since last finalization
2. **Confirmation Dialog**: Ask user "Link matrix data exists, clear it?"
3. **Auto-Restore**: Remember CSV file name and offer to re-validate automatically
4. **Versioning**: Track HTML versions and link them to finalization data

## 🎓 Summary

This fix ensures that link matrix validation data is cleared when navigating from the QA page to the Use Variant page, matching the existing behavior for screenshots and chat messages. This creates a consistent, predictable user experience and ensures data integrity across template variations.

---

**Files Modified:**
- `frontend/src/app/app/features/qa/services/qa.service.ts`
- `frontend/src/app/app/features/qa/pages/qa-page/qa-page.component.ts`

**Date:** October 18, 2025
**Status:** ✅ Implemented and Ready for Testing
