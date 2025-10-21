# ✅ Fix: Skip Variants & Bypass Golden Template Persistence

## 🐛 Problem
When clicking "Skip Variants" or "Bypass to Golden Template", the data was being lost after:
- Page refresh
- Navigation between pages
- Browser back/forward

**Root Cause:**
- Data was only stored in `sessionStorage` 
- `sessionStorage` was being **consumed and deleted** after first use
- No persistence to IndexedDB for long-term storage

## 🔧 Solution Implemented

### **Storage Strategy: Dual-Layer Persistence**

```typescript
// Layer 1: sessionStorage (fast, immediate access)
sessionStorage.setItem(`synthetic_run_${runId}`, JSON.stringify(syntheticRun));

// Layer 2: IndexedDB (persistent, survives refresh)
await this.qa.saveChatThreadToCache(runId, no, thread);
```

### **Data Flow Priority:**

```
1. sessionStorage (PRIORITY 1) ← Fast access on navigation
2. IndexedDB (PRIORITY 2A) ← Fallback on refresh/lost session
3. localStorage (PRIORITY 2B) ← Additional fallback
4. Memory cache (PRIORITY 3) ← Variants run in memory
5. API (PRIORITY 4) ← Last resort
```

## 📝 Files Modified

### 1. `qa-page.component.ts`

#### Changes to `onBypassVariants()`:
- ✅ Changed from `void` to `async Promise<void>`
- ✅ Added IndexedDB persistence via `saveChatThreadToCache()`
- ✅ Created initial chat thread with intro message
- ✅ Saves to both sessionStorage AND IndexedDB

#### Changes to `onSkipToChat()`:
- ✅ Changed from `void` to `async Promise<void>`
- ✅ Added IndexedDB persistence via `saveChatThreadToCache()`
- ✅ Created initial chat thread with intro message
- ✅ Saves to both sessionStorage AND IndexedDB

#### New Import:
```typescript
import { QaService, ..., ChatTurn, ChatThread } from '../../services/qa.service';
```

### 2. `use-variant-page.component.ts`

#### Changes to PRIORITY 1 Check:
- ❌ **REMOVED**: `sessionStorage.removeItem()` after consumption
- ✅ **KEEPS**: sessionStorage data for fast repeated access
- ✅ Added logging for better debugging

**Before:**
```typescript
// ✅ CONSUME IT - Remove from sessionStorage so it's only used ONCE
sessionStorage.removeItem(`synthetic_run_${runId}`);
```

**After:**
```typescript
// ✅ DON'T REMOVE - Keep in sessionStorage for fast access on navigation
// sessionStorage.removeItem(`synthetic_run_${runId}`); // ❌ REMOVED
```

## 🎯 Benefits

### ✅ **Persistence**
- Data survives page refresh
- Data survives browser navigation (back/forward)
- Data survives tab close/reopen (IndexedDB)

### ✅ **Performance**
- **First load**: sessionStorage (instant)
- **Refresh**: IndexedDB (< 10ms)
- **No API calls needed** for synthetic runs

### ✅ **Reliability**
- Multiple fallback layers
- Graceful degradation
- Consistent user experience

## 🧪 Testing Scenarios

### Test 1: Skip Variants Flow
1. ✅ Click "Skip Variants" button on original template
2. ✅ Navigate to use-variant page
3. ✅ **Refresh page** → Template should still be there
4. ✅ Navigate back → Template should still be there
5. ✅ Close tab, reopen → Template should still be there

### Test 2: Bypass Golden Template Flow
1. ✅ Generate Golden Template
2. ✅ Click "Bypass Variants" button on golden template
3. ✅ Navigate to use-variant page
4. ✅ **Refresh page** → Golden template should still be there
5. ✅ Navigate back → Golden template should still be there
6. ✅ Close tab, reopen → Golden template should still be there

### Test 3: Navigation Between Pages
1. ✅ Skip to chat interface
2. ✅ Navigate to another page
3. ✅ Navigate back to `/qa/{templateId}/use/{runId}/1`
4. ✅ Template should load from IndexedDB/sessionStorage

## 📊 Data Storage Breakdown

| Storage | Purpose | Lifespan | Speed |
|---------|---------|----------|-------|
| **sessionStorage** | Fast access on navigation | Tab session | Instant |
| **IndexedDB** | Persistent storage | 30 days* | < 10ms |
| **localStorage** | Backup persistence | Forever | < 5ms |

*Configurable in `db.service.ts` via `MAX_AGE_DAYS`

## 🔍 How It Works

### On "Skip" or "Bypass" Click:

```typescript
1. Create syntheticRun object with template HTML
2. Save to sessionStorage (immediate)
3. Create ChatThread with intro message
4. Save to localStorage (backup)
5. Save to IndexedDB (persistent)
6. Navigate to use-variant page
```

### On Use-Variant Page Load:

```typescript
1. Check sessionStorage (PRIORITY 1) ✓
   ├─ Found? → Use it, keep in storage
   └─ Not found? → Continue to step 2

2. Check IndexedDB (PRIORITY 2A) ✓
   ├─ Found? → Restore and display
   └─ Not found? → Continue to step 3

3. Check localStorage (PRIORITY 2B)
4. Check memory cache (PRIORITY 3)
5. Check API (PRIORITY 4)
```

## 🎉 Result

Users can now:
- ✅ Skip variants generation and go straight to chat
- ✅ Use golden template directly without variants
- ✅ Refresh the page without losing data
- ✅ Navigate back and forth without issues
- ✅ Close and reopen tabs with data intact

---

**Fixed on:** October 20, 2025  
**Issue:** Synthetic runs not persisting across page loads  
**Solution:** Dual-layer persistence (sessionStorage + IndexedDB)
