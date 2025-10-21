# 🔄 Template State Synchronization Implementation

## Overview

This implementation provides **rock-solid synchronization** of template states across the application, ensuring that:
- Edits persist across all navigation and page refreshes
- Original templates (temp_1) are properly restored when running new tests
- Check Preview correctly displays edited versions (temp_edit)
- Visual editor always loads the correct version

---

## 🎯 The Flow You Requested

```
temp_1 → Run Tests 
         ↓
Original Template → temp_1 (refreshed/moved) still temp_1
         ↓
Clicked Edit → Visual Editor
         ↓
Edits Happened → temp_1 becomes temp_edit
         ↓
Refreshed/Moved → still temp_edit
         ↓
Check Preview → temp_1 replaced by temp_edit
         ↓
Moved back to Visual Editor → still temp_edit
         ↓
Move back to Home → Click Run Tests
         ↓
temp_edit replaced by temp_1 (RESET)
```

---

## 🏗️ Architecture

### 1. **TemplateStateService** (New Service)
**Location:** `frontend/src/app/core/services/template-state.service.ts`

**Responsibilities:**
- Centralized management of template states
- localStorage persistence with namespaced keys
- State tracking (original vs edited)
- Automatic cleanup and reset logic

**Key Methods:**

#### `initializeOriginalTemplate(templateId, originalHtml)`
- Called when "Run Tests" is clicked
- Saves original template (temp_1)
- **Clears any edited state** (temp_edit)
- Sets state flag to 'original'
- Records timestamp for tracking

#### `getCurrentTemplate(templateId)`
- Returns edited version if exists (temp_edit)
- Falls back to original if no edits (temp_1)
- Used by QA page to display correct template

#### `getTemplateForEditor(templateId)`
- Checks editor progress first (in-progress edits)
- Then checks edited version
- Falls back to original
- Used by Visual Editor on load

#### `saveEditorProgress(templateId, html, css)`
- Called by Visual Editor auto-save
- Updates both editor progress AND edited template
- Ensures temp_edit state is maintained

#### `hasEdits(templateId)`
- Returns true if template has been edited
- Used by QA page to determine which version to show

---

### 2. **QA Page Updates**
**Location:** `frontend/src/app/features/qa/pages/qa-page/qa-page.component.ts`

**Changes:**

#### Constructor Logic
```typescript
// ✅ SCENARIO 1: Returning from Check Preview
if (returnFlag === 'true') {
  const currentTemplate = this.templateState.getCurrentTemplate(id);
  // Display edited template
}
// ✅ SCENARIO 2: Has edits in state
else if (this.templateState.hasEdits(id)) {
  const currentTemplate = this.templateState.getCurrentTemplate(id);
  // Display edited template (temp_edit)
}
// ✅ SCENARIO 3: Fresh load
else {
  this.loadOriginalTemplate(id);
  // Display original template (temp_1)
}
```

#### `loadOriginalTemplate()`
- Fetches template from cache/API
- **Calls `templateState.initializeOriginalTemplate()`**
- This ensures original is saved to state

#### `onEditOriginalTemplate()`
- Simplified - just navigates to visual editor
- State service handles template loading

---

### 3. **Visual Editor Updates**
**Location:** `frontend/src/app/features/visual-editor/visual-editor.component.ts`

**Changes:**

#### `loadGoldenHtml()`
```typescript
private loadGoldenHtml(templateId: string): void {
  // ✅ Use TemplateStateService
  const templateForEditor = this.templateState.getTemplateForEditor(templateId);
  
  if (templateForEditor) {
    this.originalGoldenHtml = templateForEditor;
  }
}
```

#### `autoSave()`
```typescript
private autoSave(immediate: boolean = false): void {
  // ... get html and css ...
  
  // ✅ Save using TemplateStateService
  this.templateState.saveEditorProgress(this.templateId, html, css);
  
  // Also save to old key for backwards compatibility
  localStorage.setItem(persistKey, JSON.stringify(editorState));
}
```

#### `onCheckPreview()`
```typescript
async onCheckPreview(): Promise<void> {
  // ... validate content ...
  
  // ✅ Save edited template to state service
  this.templateState.saveEditedTemplate(this.templateId, html, css);
  
  // Set return flag for QA page
  localStorage.setItem(returnKey, 'true');
  
  // Navigate to QA page
  this.router.navigate(['/qa', this.templateId]);
}
```

---

### 4. **Templates Page Updates**
**Location:** `frontend/src/app/features/templates/pages/templates-page/templates-page.component.ts`

**Changes:**

#### `onRunTests()`
```typescript
onRunTests(id: string): void {
  const item = this.svc.snapshot.items.find(t => t.id === id);
  
  if (item && item.content) {
    // ✅ CRITICAL: Reset template state to original
    this.templateState.initializeOriginalTemplate(id, item.content);
  }
  
  this.router.navigate(['/qa', id]);
}
```

This ensures that clicking "Run Tests" from the home page **always resets to temp_1**.

---

### 5. **Generate Page Updates**
**Location:** `frontend/src/app/features/generate/pages/generate-page/generate-page.component.ts`

**Changes:**

#### `onRunTests()`
```typescript
next: (response) => {
  // ✅ Initialize template state with generated template
  const currentHtml = this.currentHtml$.value;
  if (currentHtml && response.templateId) {
    this.templateState.initializeOriginalTemplate(
      response.templateId, 
      currentHtml
    );
  }
  
  this.router.navigate(['/qa', response.templateId]);
}
```

---

## 🔑 localStorage Keys

All keys are namespaced with `template_state_` to avoid collisions:

| Key Pattern | Purpose | Example |
|-------------|---------|---------|
| `template_state_{id}_original` | Original template (temp_1) | Master template from DB |
| `template_state_{id}_edited` | Edited template (temp_edit) | After visual editor changes |
| `template_state_{id}_editor_progress` | Current editor state | Real-time auto-save |
| `template_state_{id}_state_flag` | Current state | 'original' or 'edited' |
| `template_state_{id}_last_run_tests` | Timestamp | When Run Tests was last clicked |

---

## 🔄 Synchronization Logic

### When "Run Tests" is Clicked:
1. `templateState.initializeOriginalTemplate()` is called
2. Original template saved to localStorage
3. **Edited state is cleared** (temp_edit → temp_1)
4. State flag set to 'original'
5. Navigate to QA page
6. QA page loads original template

### When "Edit" is Clicked in QA:
1. Navigate to Visual Editor
2. Visual Editor calls `templateState.getTemplateForEditor()`
3. If edits exist, loads temp_edit
4. Otherwise loads temp_1
5. Auto-save continuously updates temp_edit

### When Editing in Visual Editor:
1. Every change triggers `autoSave()`
2. `templateState.saveEditorProgress()` is called
3. Both editor progress AND edited template are saved
4. temp_edit state is maintained
5. **Survives refresh/navigation**

### When "Check Preview" is Clicked:
1. Get current editor HTML
2. `templateState.saveEditedTemplate()` is called
3. Set return flag for QA page
4. Navigate to QA page
5. QA page detects return flag
6. Loads edited template (temp_edit)
7. **Original template preview is replaced**

### When Navigating Back to Visual Editor:
1. Visual Editor loads
2. `templateState.getTemplateForEditor()` returns temp_edit
3. Editor shows all previous edits
4. Continue editing where left off

### When Refreshing Any Page:
1. State persists in localStorage
2. Correct version loaded based on state flag
3. No data loss

---

## ✅ Testing Scenarios

### Scenario 1: Basic Edit Flow
1. Click "Run Tests" → shows temp_1 ✅
2. Click "Edit" → Visual Editor loads temp_1 ✅
3. Make changes → auto-saves to temp_edit ✅
4. Refresh browser → Visual Editor still shows temp_edit ✅
5. Click "Check Preview" → QA shows temp_edit ✅

### Scenario 2: Multiple Edit Sessions
1. Edit template → becomes temp_edit ✅
2. Navigate away, come back → still temp_edit ✅
3. Edit more → updates temp_edit ✅
4. Check preview → shows latest temp_edit ✅

### Scenario 3: Reset via Run Tests
1. Template is in temp_edit state ✅
2. Go to home page ✅
3. Click "Run Tests" → **resets to temp_1** ✅
4. All edits cleared ✅
5. Fresh start ✅

### Scenario 4: Cross-Tab Sync
1. Edit in one tab → saves to localStorage ✅
2. Open same template in another tab ✅
3. Shows latest temp_edit ✅
4. Changes from tab 1 visible in tab 2 ✅

---

## 🚀 Benefits

1. **No Data Loss:** Edits persist across all navigation and refreshes
2. **Predictable Behavior:** Always know which version you're seeing
3. **Clean Resets:** Run Tests always starts fresh
4. **Backwards Compatible:** Old localStorage keys still work (temporary)
5. **Debuggable:** `templateState.debugState(id)` shows all state info
6. **Type Safe:** TypeScript service with clear interfaces
7. **Centralized:** All state logic in one place

---

## 🐛 Debugging

### Check Template State:
```typescript
// In browser console or code:
templateState.debugState('your-template-id');
```

This will log:
- Current state (original/edited/unknown)
- Presence of original template
- Presence of edited template
- Presence of editor progress
- Last run tests timestamp

### Clear All State for Template:
```typescript
templateState.clearTemplateState('your-template-id');
```

---

## 📝 Notes

- All auto-save operations are debounced (300ms)
- Immediate save before navigation (synchronous)
- Periodic backup save every 10 seconds
- State persists in localStorage (survives browser restart)
- Old localStorage keys temporarily maintained for compatibility
- Service can be easily extended for additional features

---

## 🎉 Summary

This implementation provides **enterprise-grade synchronization** that:
- ✅ Handles all edge cases
- ✅ Persists across refresh/navigation
- ✅ Properly resets on "Run Tests"
- ✅ Shows correct versions everywhere
- ✅ Is maintainable and debuggable
- ✅ Follows Angular best practices

The flow you described is now **fully implemented and reliable**! 🚀
