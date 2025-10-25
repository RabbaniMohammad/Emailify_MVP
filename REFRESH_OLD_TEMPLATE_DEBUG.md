# Use Variants - Refresh Loading Old Template Debug

## Problem
After editing a template in Visual Editor and returning to Use Variants page:
- ✅ Edited template displays correctly when first returning
- ❌ **Old template loads after refreshing the page**

## Expected vs Actual

### Expected Flow (After Refresh)
```
1. Page loads
2. PRIORITY 1: Check localStorage cache
3. Find edited HTML in cache
4. Display edited HTML ✅
```

### Actual Flow (What's Happening)
```
1. Page loads
2. PRIORITY 1: Check localStorage cache
3. ???
4. Display old HTML ❌
```

## Investigation Steps

### Step 1: Verify Save is Working

I've added comprehensive logging to the return-from-editor handler:

```typescript
✅ [RETURN FROM EDITOR] Edited HTML received, length: 45678
✅ [RETURN FROM EDITOR] Messages to preserve: 10
✅ [RETURN FROM EDITOR] Saved edited HTML to localStorage cache
✅ [RETURN FROM EDITOR] VERIFIED: Edited HTML successfully saved to cache
```

**Action**: After clicking "Check Preview" and returning to Use Variants, check the console for these messages.

**If you see:**
- ✅ `VERIFIED: Edited HTML successfully saved to cache` → Save is working
- ❌ `FAILED: Cache verification failed!` → Save is NOT working (critical bug)

### Step 2: Verify Refresh is Loading from Cache

After refresh, look for this console message:

```typescript
⚡ [use-variant] PRIORITY 1: Checking localStorage for runId: ...
✅ [use-variant] PRIORITY 1: Found in localStorage, loading template
🎯 [use-variant] localStorage restore complete. HTML in subject: 45678 chars
```

**If you see:**
- ✅ `PRIORITY 1: Found in localStorage` → Cache is being loaded
- ❌ `PRIORITY 2: ...` or `PRIORITY 3: ...` → Cache is MISSING, falling back to old data

### Step 3: Check localStorage Directly

**In Browser DevTools:**
1. Open DevTools (F12)
2. Go to **Application** tab
3. Click **LocalStorage** → your domain
4. Look for key pattern: `chat_{runId}_{no}`
5. Check the value - it should contain your edited HTML

**Example:**
```
Key: chat_run_123_1
Value: {"html":"<style>...</style><html>...</html>","messages":[...]}
```

**Check:**
- Does the HTML contain your edits?
- Does the HTML have `<style>` tag with CSS?

## Possible Causes

### Cause 1: localStorage Not Persisting
**Symptom**: Save verification passes, but data is gone after refresh

**Why**: 
- Browser settings blocking localStorage persistence
- Private/Incognito mode (localStorage cleared on tab close)
- Browser extension clearing storage

**Fix**: Check browser settings, disable incognito mode

### Cause 2: Wrong Storage Key
**Symptom**: Save works, but load uses different key

**Why**:
- `runId` or `no` parameter changed between save and load
- URL parameter mismatch

**Fix**: Verify `runId` and `no` are same in console logs

### Cause 3: Cache Cleared Before Refresh
**Symptom**: Cache exists right after save, but cleared before refresh

**Why**:
- Another part of code clearing cache
- Logout/session cleanup running

**Fix**: Check for cache clear operations in code

### Cause 4: Priority Order Issue
**Symptom**: PRIORITY 1 is skipped, goes to PRIORITY 2/3

**Why**:
- localStorage cache check returns falsy (empty, null, etc.)
- Cached thread exists but `html` property is missing
- Async timing issue

**Fix**: Check the exact condition in PRIORITY 1:

```typescript
const cachedThread = this.qa.getChatCached(runId, no);
if (cachedThread?.html) { // ← This condition must be true
```

## Debug Console Commands

Run these in browser console to manually check cache:

```javascript
// Check if chat cache exists
const runId = 'run_123'; // Replace with actual runId
const no = 1; // Replace with actual variant number
const key = `chat_${runId}_${no}`;
const cached = localStorage.getItem(key);
console.log('Cached data:', cached);

// Parse and check HTML
if (cached) {
  const thread = JSON.parse(cached);
  console.log('HTML length:', thread.html?.length);
  console.log('Messages count:', thread.messages?.length);
  console.log('Has <style> tag:', thread.html?.includes('<style>'));
}
```

## Temporary Workaround

If the issue persists, you can manually check the console logs after refresh:

1. After editing and returning → Check logs for "VERIFIED: Edited HTML successfully saved"
2. After refresh → Check logs for "PRIORITY 1: Found in localStorage"

**If PRIORITY 1 is NOT found:**
- The cache is being lost/cleared somehow
- Check for any code that might clear localStorage
- Check browser console for localStorage errors

## Next Steps

Please run the app and:

1. **Edit a template** in Visual Editor
2. **Click "Check Preview"** to return
3. **Check console logs** - should see verification message
4. **Refresh the page**
5. **Check console logs** - should see PRIORITY 1 loading
6. **Share the console logs** with me

This will help me identify exactly where the data is being lost!

---

**Status**: 🔍 Debugging  
**Added**: Comprehensive logging for save verification  
**Next**: Analyze console logs to identify exact failure point
