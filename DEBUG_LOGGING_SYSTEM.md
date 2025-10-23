# 🔍 Debug Logging System

## Overview

A comprehensive logging system that writes frontend console logs to files on the backend for easier debugging. Logs are automatically cleaned up on logout, ensuring fresh logs for each user session.

---

## Features

✅ **Automatic Logging**: Captures all frontend operations  
✅ **File-Based Storage**: Writes logs to `backend/logs/debug_[sessionId].log`  
✅ **Session-Based**: Each login session gets a unique log file  
✅ **Auto-Cleanup**: Logs are deleted on logout  
✅ **Categorized**: Logs are organized by category (TEMPLATE_STATE, VISUAL_EDITOR, QA_PAGE, etc.)  
✅ **Smart Buffering**: Batches logs to reduce HTTP requests  
✅ **Error Tracking**: Special handling for errors with stack traces  

---

## How It Works

### 1. **Frontend Logging**

The `DebugLoggerService` captures logs and sends them to the backend:

```typescript
// Inject the debug logger
private debugLogger = inject(DebugLoggerService);

// Log template state operations
this.debugLogger.logTemplateState('initializeOriginalTemplate', templateId, {
  htmlLength: originalHtml.length,
  action: 'Starting initialization'
});

// Log storage operations
this.debugLogger.logStorage('SET', key, { value: 'data' });

// Log errors
this.debugLogger.error('TEMPLATE_STATE', 'Failed to load template', error);
```

### 2. **Backend Storage**

The backend receives logs and writes them to files:

- **Location**: `backend/logs/`
- **Format**: `debug_session_[timestamp]_[random].log`
- **Structure**: Human-readable timestamped entries

### 3. **Automatic Cleanup**

When you logout:
1. Frontend calls `debugLogger.clearLogs()`
2. Backend deletes the session's log file
3. Next login creates a fresh log file

---

## Usage

### Enable/Disable Logging

```typescript
// Enable logging (default)
debugLogger.setEnabled(true);

// Disable logging
debugLogger.setEnabled(false);
```

### Logging Methods

#### General Log
```typescript
debugLogger.log('CATEGORY', 'message', optionalData);
```

#### Template State
```typescript
debugLogger.logTemplateState('operation', templateId, details);
```

#### Visual Editor
```typescript
debugLogger.logVisualEditor('operation', details);
```

#### QA Page
```typescript
debugLogger.logQAPage('operation', details);
```

#### Storage Operations
```typescript
debugLogger.logStorage('GET|SET|REMOVE', key, details);
```

#### Errors
```typescript
debugLogger.error('CATEGORY', 'message', errorObject);
```

---

## Backend API Endpoints

### POST `/api/debug-logs`
Receive and write debug logs from frontend.

**Request Body:**
```json
{
  "sessionId": "session_1234567890_abc123",
  "logs": [
    {
      "timestamp": "2025-10-20T10:30:00.000Z",
      "category": "TEMPLATE_STATE",
      "message": "Initialize original template",
      "data": { "templateId": "gen_123" }
    }
  ]
}
```

### POST `/api/debug-logs/clear`
Clear logs for a session (called on logout).

**Request Body:**
```json
{
  "sessionId": "session_1234567890_abc123"
}
```

### GET `/api/debug-logs/list`
List all debug log files.

**Response:**
```json
{
  "files": [
    {
      "name": "debug_session_1234567890_abc123.log",
      "size": 125432,
      "created": "2025-10-20T10:00:00.000Z",
      "modified": "2025-10-20T10:45:00.000Z"
    }
  ]
}
```

### GET `/api/debug-logs/:filename`
Read a specific log file.

**Response:**
```json
{
  "filename": "debug_session_1234567890_abc123.log",
  "content": "... log file content ..."
}
```

### DELETE `/api/debug-logs/cleanup`
Clean up old log files (older than 7 days).

---

## Log File Format

```
[2025-10-20T10:30:00.000Z] [INFO] [TEMPLATE_STATE      ] Initialize original template
    Data: {
      "templateId": "gen_123",
      "htmlLength": 5234,
      "action": "Starting initialization"
    }

[2025-10-20T10:30:01.500Z] [INFO] [STORAGE             ] SET - template_state_gen_123_original
    Data: {
      "length": 5234
    }

[2025-10-20T10:30:05.200Z] [ERROR] [TEMPLATE_STATE      ] Failed to load template
    Error: {
      "message": "Template not found",
      "stack": "Error: Template not found\n    at ..."
    }
```

---

## Integration Points

### Template State Service

All key methods are logged:
- `initializeOriginalTemplate()` - Logs initialization and all cleared keys
- `initializeGoldenForEditing()` - Logs golden setup and cleanup
- `initializeVariantForEditing()` - Logs variant initialization
- `getTemplateForEditor()` - Logs template loading priority checks
- `saveEditorProgress()` - Logs save operations
- `saveEditedTemplate()` - Logs edited template saves

### Visual Editor Component

Logs all editor operations:
- Template loading
- Auto-save operations
- User interactions
- Editor state changes

### QA Page Component

Logs all QA operations:
- Template generation
- Golden template creation
- Variant editing
- Navigation to visual editor

### Auth Service

Automatically clears logs on logout:
```typescript
logout(): Observable<any> {
  this.debugLogger.clearLogs(); // ← Cleanup logs
  // ... rest of logout logic
}
```

---

## Debugging Data Leakage Issues

### Example: Original → Golden Contamination

**What to look for in logs:**

1. **Check initialization:**
```
[TEMPLATE_STATE] initializeOriginalTemplate - gen_123
    Data: { htmlLength: 5234 }
[STORAGE] SET - template_state_gen_123_original
[STORAGE] REMOVE - visual_editor_gen_123_golden_html
[STORAGE] REMOVE - visual_editor_gen_123_progress
```

2. **Check auto-save operations:**
```
[VISUAL_EDITOR] autoSave - mode: original
[STORAGE] SET - template_state_gen_123_editor_progress
[STORAGE] SET - visual_editor_gen_123_progress  ← Should NOT appear for original editing!
```

3. **Check template loading:**
```
[TEMPLATE_STATE] getTemplateForEditor - gen_123
[STORAGE] GET - visual_editor_gen_123_editing_mode (value: golden)
[STORAGE] GET - visual_editor_gen_123_golden_html (exists: true)
[TEMPLATE_STATE] foundGoldenHtml - returning golden HTML
```

### Finding the Leak

If you see:
- Original template editing saving to `visual_editor_*_progress`
- Golden template loading finding `visual_editor_*_progress` with original content
- Missing cleanup of `visual_editor_*` keys during initialization

Then you have a data leakage issue!

---

## Performance

- **Buffer Size**: 50 logs (configurable)
- **Flush Interval**: 2 seconds
- **Network Impact**: Minimal (batched requests)
- **Storage Impact**: Logs are small (~100KB per session)
- **Cleanup**: Automatic on logout + 7-day auto-cleanup

---

## Configuration

### Disable Logging Globally

In `debug-logger.service.ts`:
```typescript
private enabled = false; // Set to false to disable
```

Or toggle at runtime:
```typescript
localStorage.setItem('debug_logging_enabled', 'false');
```

### Change Buffer/Flush Settings

In `debug-logger.service.ts`:
```typescript
private readonly FLUSH_INTERVAL = 2000; // milliseconds
private readonly MAX_BUFFER_SIZE = 50; // entries
```

---

## Security

✅ **Session-Based**: Logs are isolated per session  
✅ **Auto-Cleanup**: Logs deleted on logout  
✅ **No Sensitive Data**: HTML content is truncated (first 200 chars)  
✅ **Circular Reference Protection**: Prevents crashes from complex objects  
✅ **Path Traversal Protection**: Backend validates filenames  

---

## Files Added/Modified

### New Files
1. `frontend/src/app/core/services/debug-logger.service.ts` - Frontend logging service
2. `backend/src/routes/debug-logs.ts` - Backend API endpoints
3. `backend/logs/` - Directory for log files (auto-created)

### Modified Files
1. `frontend/src/app/core/services/template-state.service.ts` - Added logging
2. `frontend/src/app/core/services/auth.service.ts` - Added cleanup on logout
3. `backend/src/server.ts` - Registered debug-logs router

---

## Troubleshooting

### Logs Not Appearing

1. Check if logging is enabled:
```typescript
localStorage.getItem('debug_logging_enabled') // should be 'true' or null
```

2. Check backend logs directory:
```bash
ls backend/logs/
```

3. Check browser console for flush errors

### Logs Too Large

1. Reduce buffer size
2. Increase flush interval
3. Add more content truncation

### Backend Errors

Check backend console for:
- File system permissions
- Disk space
- Path issues

---

## Example Workflow

```
User logs in
    ↓
[DEBUG LOGGER] Session ID: session_1729425600_abc123
    ↓
User edits original template
    ↓
[TEMPLATE_STATE] initializeOriginalTemplate - gen_123
[STORAGE] SET - template_state_gen_123_original
[STORAGE] REMOVE - visual_editor_gen_123_golden_html
[STORAGE] REMOVE - visual_editor_gen_123_progress
    ↓
User makes changes in visual editor
    ↓
[VISUAL_EDITOR] autoSave - mode: original
[STORAGE] SET - template_state_gen_123_editor_progress
    ↓
User goes back to QA page
User clicks "Visual Editor" (golden)
    ↓
[TEMPLATE_STATE] initializeGoldenForEditing - gen_123
[STORAGE] SET - visual_editor_gen_123_golden_html
[STORAGE] REMOVE - visual_editor_gen_123_progress  ← CRITICAL CLEANUP!
    ↓
Visual editor loads
    ↓
[TEMPLATE_STATE] getTemplateForEditor - gen_123
[STORAGE] GET - visual_editor_gen_123_editing_mode (value: golden)
[STORAGE] GET - visual_editor_gen_123_golden_html (exists: true)
[TEMPLATE_STATE] foundGoldenHtml - SUCCESS! ✅
    ↓
User logs out
    ↓
[DEBUG LOGGER] clearLogs() called
[BACKEND] Delete: backend/logs/debug_session_1729425600_abc123.log
```

---

## Benefits for Debugging

1. **Complete History**: See exact sequence of operations
2. **Storage Tracking**: Know what's in localStorage at every step
3. **Data Flow Visibility**: Understand how data moves between components
4. **Error Context**: See what led to errors
5. **Cross-Component Debugging**: Track data across page boundaries
6. **Reproducible**: Share log files with team members
7. **No Browser Required**: Analyze logs in your favorite text editor

---

**Date Created:** October 20, 2025  
**Status:** ✅ ACTIVE  
**Version:** 1.0
