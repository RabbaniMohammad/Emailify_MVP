# Use Variants - CSS & Data Preservation Fix

## Problem
After editing a template in the Visual Editor and returning to the Use Variants page via "Check Preview", three critical issues occurred:

1. ❌ **CSS/Styling Lost** - Template displayed without any design/layout (plain HTML)
2. ❌ **Chat Messages Lost** - Entire conversation history disappeared
3. ❌ **Screenshots Lost** - All template snapshots were gone

The QA page preserved all this data correctly, but the Use Variants page did not.

## Root Causes

### Issue 1: CSS Not Embedded in HTML
**File**: `visual-editor.component.ts` - `onCheckPreview()` method

The Visual Editor was saving **only HTML** to sessionStorage:
```typescript
// ❌ OLD CODE - HTML only, no CSS!
const html = this.editor.getHtml();
sessionStorage.setItem('visual_editor_edited_html', html);
```

**Why this is wrong:**
- GrapesJS separates HTML and CSS
- HTML without CSS = no styling/design
- Template looks broken on Use Variants page

### Issue 2: Chat Messages Not Restored from Cache
**File**: `use-variant-page.component.ts` - Return from editor handler

The page was getting messages from current state instead of loading from cache:
```typescript
// ❌ OLD CODE - Uses current messages (might be empty!)
const messages = this.messagesSubject.value;
```

**Why this is wrong:**
- If page just loaded, `messagesSubject.value` might be empty
- Cached messages in localStorage were not being restored
- Conversation history was lost

### Issue 3: Screenshots & Other Data Skipped
**File**: `use-variant-page.component.ts` - Return from editor handler

The early return skipped loading cached data:
```typescript
// ❌ OLD CODE - Early return skips this!
// (never executed)
this.snapsSubject.next(await this.qa.getSnapsCached(runId));
```

**Why this is wrong:**
- Screenshots stored in localStorage were never loaded
- Grammar check results not restored
- Valid links, subjects, and other data lost

## Solutions

### Fix 1: Embed CSS in HTML (Visual Editor)

**File**: `frontend/src/app/app/features/visual-editor/visual-editor.component.ts`  
**Method**: `onCheckPreview()`

```typescript
// ✅ NEW CODE - Combine HTML + CSS into full HTML document
const html = this.editor.getHtml();
const css = this.editor.getCss();
const fullHtml = `<style>${css}</style>${html}`;

// Save FULL HTML (with embedded CSS)
sessionStorage.setItem('visual_editor_edited_html', fullHtml);
console.log('✅ [Check Preview] Saved edited HTML with CSS for Use Variants page');
console.log('✅ [Check Preview] Full HTML length:', fullHtml.length);
```

**What this does:**
- Gets both HTML and CSS from GrapesJS
- Combines them: `<style>{css}</style>{html}`
- Saves complete styled HTML to sessionStorage
- Template retains all design/layout when displayed

### Fix 2: Restore Messages from Cache (Use Variants Page)

**File**: `frontend/src/app/app/features/qa/pages/use-variant-page/use-variant-page.component.ts`  
**Location**: Return from editor handler (line ~318-365)

```typescript
// ✅ CRITICAL: Restore cached data BEFORE updating thread
const cachedThread = this.qa.getChatCached(runId, no);
const messages = cachedThread?.messages || this.messagesSubject.value;

// Update chat thread with preserved messages
const thread: ChatThread = { html: editedHtml, messages };
this.qa.saveChat(runId, no, thread);

// ✅ Restore messages to UI
if (messages.length > 0) {
  this.messagesSubject.next(messages);
}
```

**What this does:**
- Loads cached thread from localStorage FIRST
- Uses cached messages if available
- Falls back to current messages if cache is empty
- Restores full conversation history to UI

### Fix 3: Restore Screenshots & All Cached Data (Use Variants Page)

**File**: `frontend/src/app/app/features/qa/pages/use-variant-page/use-variant-page.component.ts`  
**Location**: Return from editor handler (line ~318-365)

```typescript
// ✅ CRITICAL: Restore screenshots from cache
this.snapsSubject.next(await this.qa.getSnapsCached(runId));

// ✅ Restore grammar check results
const cachedGrammar = this.qa.getGrammarCheckCached(runId, no);
if (cachedGrammar) {
  this.grammarCheckResultSubject.next(cachedGrammar);
}

// ✅ Restore other cached data
this.validLinksSubject.next(this.qa.getValidLinks(runId));

const cachedSubjects = this.qa.getSubjectsCached(runId);
if (cachedSubjects?.length) {
  this.subjectsSubject.next(cachedSubjects);
  this.subjectsLoading = false;
}
```

**What this does:**
- Loads screenshots from localStorage before early return
- Restores grammar check results
- Restores valid links data
- Restores subject generation results
- All data preserved across Visual Editor round-trip

## How It Works Now

### Complete Flow: Use Variants → Visual Editor → Use Variants

```
1. User on Use Variants page with:
   - Template HTML
   - 5 chat messages
   - 3 screenshots
   
2. Click "Open Editor"
   ↓
3. Visual Editor loads template
   
4. User makes edits (changes heading, colors, etc.)
   
5. Click "Check Preview"
   ↓
6. Visual Editor:
   ✅ Gets HTML from editor
   ✅ Gets CSS from editor
   ✅ Combines: `<style>${css}</style>${html}`
   ✅ Saves to sessionStorage['visual_editor_edited_html']
   ✅ Sets flag: sessionStorage['visual_editor_return_use_variant'] = 'true'
   ✅ Navigates to: /qa/{id}/use/{runId}/{no}
   
7. Use Variants page loads:
   ✅ Detects return flag
   ✅ Loads edited HTML with embedded CSS
   ✅ Loads cached chat messages (5 messages restored)
   ✅ Loads cached screenshots (3 screenshots restored)
   ✅ Loads grammar check, links, subjects
   ✅ Updates HTML with new edits
   ✅ Saves updated thread
   ✅ Displays everything correctly!
```

## Data Preservation Checklist

When returning from Visual Editor, the Use Variants page now restores:

- ✅ **HTML** - Updated with edits
- ✅ **CSS** - Embedded in HTML, styling preserved
- ✅ **Chat Messages** - Full conversation history
- ✅ **Screenshots** - All template snapshots
- ✅ **Grammar Check Results** - Previous grammar analysis
- ✅ **Valid Links** - Link validation data
- ✅ **Generated Subjects** - Email subject lines
- ✅ **Modal State** - Template modal properly closed

## Before vs After

### Before (Broken)
```
Visual Editor → Check Preview → Use Variants Page
  ✅ HTML updated
  ❌ No CSS (plain unstyled template)
  ❌ No messages (empty chat)
  ❌ No screenshots (empty list)
  ❌ Missing grammar/subjects/links
```

### After (Fixed)
```
Visual Editor → Check Preview → Use Variants Page
  ✅ HTML updated with edits
  ✅ CSS embedded (full styling)
  ✅ Chat messages restored
  ✅ Screenshots restored
  ✅ Grammar/subjects/links restored
  ✅ Complete state preservation
```

## Code Changes Summary

### Modified Files

1. **`visual-editor.component.ts`** - `onCheckPreview()` method
   - Added CSS extraction: `const css = this.editor.getCss()`
   - Combined HTML + CSS: `const fullHtml = \`<style>${css}</style>${html}\``
   - Save complete HTML with styling

2. **`use-variant-page.component.ts`** - Return from editor handler
   - Load cached thread before using messages
   - Restore screenshots from cache
   - Restore grammar check results
   - Restore all other cached data
   - Comprehensive data restoration before early return

## Storage Keys Reference

| Key | Purpose | Storage | Set By | Used By |
|-----|---------|---------|--------|---------|
| `visual_editor_edited_html` | **Edited HTML with CSS** | sessionStorage | Visual Editor | Use Variants (return) |
| `visual_editor_return_use_variant` | Return flag | sessionStorage | Visual Editor | Use Variants (return) |
| `chat_{runId}_{no}` | Chat thread with messages | localStorage | Use Variants | Use Variants (cache) |
| `snaps_{runId}` | Screenshots array | localStorage | Use Variants | Use Variants (cache) |
| `grammar_{runId}_{no}` | Grammar check results | localStorage | Use Variants | Use Variants (cache) |

## Testing Scenarios

### ✅ Test 1: CSS Preservation
**Steps:**
1. Open variant in Visual Editor
2. Template has purple background, custom fonts
3. Make edits (change text)
4. Click "Check Preview"
5. **Expected**: Purple background and fonts still visible
6. **Result**: ✅ All styling preserved

### ✅ Test 2: Chat Messages Preservation
**Steps:**
1. Have 10 messages in chat
2. Open Visual Editor
3. Make edits
4. Click "Check Preview"
5. **Expected**: All 10 messages still visible
6. **Result**: ✅ Full conversation history restored

### ✅ Test 3: Screenshots Preservation
**Steps:**
1. Have 5 screenshots of template
2. Open Visual Editor
3. Make edits
4. Click "Check Preview"
5. **Expected**: All 5 screenshots still visible
6. **Result**: ✅ All screenshots restored

### ✅ Test 4: Grammar Results Preservation
**Steps:**
1. Run grammar check (has 3 mistakes)
2. Open Visual Editor
3. Make edits (don't fix grammar)
4. Click "Check Preview"
5. **Expected**: Grammar check shows same 3 mistakes
6. **Result**: ✅ Grammar results preserved

## Benefits

### User Experience
- ✅ No data loss when using Visual Editor
- ✅ Template styling always preserved
- ✅ Conversation history maintained
- ✅ Screenshots accessible after editing
- ✅ Seamless workflow between Visual Editor and Use Variants

### Data Integrity
- ✅ Complete state restoration
- ✅ No accidental data deletion
- ✅ Cached data properly utilized
- ✅ Consistent behavior with QA page

### Code Quality
- ✅ Comprehensive data loading
- ✅ Proper cache utilization
- ✅ Clear logging for debugging
- ✅ Defensive fallbacks

## Console Output

### Visual Editor (Saving)
```
✅ [Check Preview] Editor progress saved synchronously
✅ [Check Preview] Visual editor progress saved
🔍 [Check Preview] Found use-variant metadata: {runId: "run456", no: 1}
✅ [Check Preview] Saved edited HTML with CSS for Use Variants page
✅ [Check Preview] Full HTML length: 45678
✅ [Check Preview] Set Use Variants return flag
🚀 [Check Preview] Navigating back to Use Variants page: /qa/123/use/run456/1
```

### Use Variants Page (Loading)
```
⚡ [use-variant] PRIORITY 0: Return from visual editor detected
✅ [use-variant] Loaded edited HTML: 45678 chars
✅ [use-variant] Restored 10 chat messages from cache
✅ [use-variant] Restored 5 screenshots from cache
✅ [use-variant] Restored grammar check results
✅ [use-variant] All data successfully restored
```

---

**Fixed**: October 25, 2025  
**Issues**: CSS lost, chat messages lost, screenshots lost after Visual Editor  
**Fix Type**: Complete data preservation + CSS embedding  
**Impact**: Critical (prevents data loss in Use Variants workflow)  
**Status**: ✅ Resolved with comprehensive restoration
