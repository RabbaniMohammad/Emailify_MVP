# Golden Template Editing Fix

## Problem Description

When editing the **golden template** in the visual editor:
- Edits to the golden template were NOT being reflected/saved
- BUT edits to the original template were affecting BOTH original and golden templates

## Root Cause

The issue was in the `TemplateStateService.saveEditedTemplate()` method:

```typescript
// OLD CODE - BROKEN
saveEditedTemplate(templateId: string, editedHtml: string, css?: string): void {
  const fullHtml = css ? `<style>${css}</style>${editedHtml}` : editedHtml;
  
  // ❌ PROBLEM: Always saves to EDITED_KEY regardless of context
  localStorage.setItem(this.EDITED_KEY(templateId), fullHtml);
  localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'edited');
}
```

### The Flow Problem:

1. User clicks "Open Visual Editor" from failed edits modal (golden template)
2. `onGoldenTemplateClick()` sets editing mode to 'golden' ✅
3. Visual editor loads golden HTML ✅
4. User makes edits in visual editor
5. `autoSave()` is triggered → calls `saveEditorProgress()` → calls `saveEditedTemplate()`
6. **❌ BUG**: `saveEditedTemplate()` saves to `template_state_${templateId}_edited` (original key)
7. **❌ BUG**: Should save to `visual_editor_${templateId}_golden_html` (golden key)
8. When returning to QA page, `getCurrentTemplate()` checks context and looks for golden HTML
9. **❌ BUG**: Golden HTML key is empty because edits were saved to wrong key
10. Golden template appears unchanged, while original template gets the golden edits

## Solution

Modified `saveEditedTemplate()` to check the editing context and save to the appropriate key:

```typescript
// NEW CODE - FIXED ✅
saveEditedTemplate(templateId: string, editedHtml: string, css?: string): void {
  const fullHtml = css ? `<style>${css}</style>${editedHtml}` : editedHtml;
  
  // ✅ Check editing context
  const editingContext = this.getEditingContext(templateId);
  
  if (editingContext?.type === 'golden') {
    // ✅ Save golden template edits to golden-specific key
    const goldenKey = `visual_editor_${templateId}_golden_html`;
    localStorage.setItem(goldenKey, fullHtml);
    
    // Also save to edited_html key for check preview flow
    const editedHtmlKey = `visual_editor_${templateId}_edited_html`;
    localStorage.setItem(editedHtmlKey, fullHtml);
  } else {
    // ✅ Save original/variant template edits to standard edited key
    localStorage.setItem(this.EDITED_KEY(templateId), fullHtml);
  }
  
  localStorage.setItem(this.STATE_FLAG_KEY(templateId), 'edited');
}
```

## Debug Logging Added

Enhanced logging in multiple places to help track the issue:

### 1. `template-state.service.ts` - `saveEditedTemplate()`
- Logs editing context when saving
- Shows which key is being used (golden vs original)
- Shows HTML length and preview

### 2. `qa-page.component.ts` - Golden return handling
- Logs golden subject value BEFORE and AFTER update
- Shows HTML length before and after
- Shows preview of HTML content

## How to Test

1. **Generate Golden Template** in QA page
2. **Click "Open Visual Editor"** from failed edits modal (orange/red button)
3. **Make edits** to the golden template in visual editor
   - Change some text
   - Modify styles
   - Add/remove elements
4. **Click "Check Preview"** to return to QA page
5. **Verify**:
   - ✅ Golden template should show your edits
   - ✅ Original template should remain unchanged
   - ✅ Console logs should show:
     - "Saved GOLDEN template edits to: visual_editor_XXX_golden_html"
     - "After handleVisualEditorReturn, goldenSubject HTML length (AFTER): [new length]"

## Key Files Modified

1. **`frontend/src/app/app/core/services/template-state.service.ts`**
   - Modified `saveEditedTemplate()` method
   - Added context-aware saving logic

2. **`frontend/src/app/app/features/qa/pages/qa-page/qa-page.component.ts`**
   - Enhanced debug logging in golden template return handling
   - Shows before/after state of golden subject

## Related Components

- **Visual Editor**: Loads and saves template edits
- **QA Page**: Displays templates and handles return from editor
- **Template State Service**: Manages template state and storage keys
- **Storage Keys**:
  - `visual_editor_${templateId}_golden_html` - Golden template HTML
  - `visual_editor_${templateId}_editing_mode` - Editing mode flag
  - `template_state_${templateId}_edited` - Original template edits
  - `visual_editor_${templateId}_edited_html` - Generic edited HTML (used in return flow)

## Status

✅ **FIXED** - Golden template edits now save to correct key and reflect properly in QA page
