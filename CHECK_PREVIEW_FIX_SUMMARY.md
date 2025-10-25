# Quick Fix: Check Preview Smart Navigation + Data Persistence

## Problem
1. "Check Preview" button always navigated to QA page, even when user came from Use Variants page
2. Edited HTML was not displayed on Use Variants page after returning (wrong storage keys)

## Solution
Added **context-aware navigation + data persistence** that saves to correct keys based on origin:

```typescript
// Check for Use Variants metadata
const metaKey = `visual_editor_${templateId}_use_variant_meta`;
const useVariantMeta = sessionStorage.getItem(metaKey);

if (useVariantMeta) {
  // Parse runId and no from metadata
  const { runId, no } = JSON.parse(useVariantMeta);
  
  // ✅ Save edited HTML with Use Variants key
  const html = this.editor.getHtml();
  sessionStorage.setItem('visual_editor_edited_html', html);
  
  // ✅ Set return flag for Use Variants
  sessionStorage.setItem('visual_editor_return_use_variant', 'true');
  
  // Navigate back to Use Variants page
  router.navigate(['/qa', templateId, 'use', runId, no]);
} else {
  // ✅ Use QA page keys
  localStorage.setItem(`visual_editor_${templateId}_return_flag`, 'true');
  router.navigate(['/qa', templateId]);
}
```

## How It Works

### From Use Variants Page
```
Use Variants → [Open Editor] → Visual Editor (make edits) → [Check Preview] 
  → Save to: sessionStorage['visual_editor_edited_html']
  → Set flag: sessionStorage['visual_editor_return_use_variant']
  → Navigate to: Use Variants ✅
  → Display: Edited HTML ✅
```

### From QA Page
```
QA Page → [Edit Golden] → Visual Editor (make edits) → [Check Preview] 
  → Set flag: localStorage['visual_editor_{id}_return_flag']
  → Navigate to: QA Page ✅
  → Display: Edited HTML ✅
```

## Storage Keys

| Origin | Return Flag | Edited HTML Location |
|--------|-------------|---------------------|
| Use Variants | `sessionStorage['visual_editor_return_use_variant']` | `sessionStorage['visual_editor_edited_html']` |
| QA Page | `localStorage['visual_editor_{id}_return_flag']` | `localStorage['visual_editor_{id}_edited_html']` |

## Safety Features
- ✅ **Try-catch** protection for corrupted metadata
- ✅ **Safe fallback** to QA page on errors
- ✅ **Comprehensive logging** for debugging
- ✅ **sessionStorage** auto-cleanup

## File Changed
`frontend/src/app/app/features/visual-editor/visual-editor.component.ts` - `onCheckPreview()` method

---
**Status**: ✅ Fixed  
**Date**: October 25, 2025
