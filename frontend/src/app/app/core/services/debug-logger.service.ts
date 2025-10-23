import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';

/**
 * Debug Logger Service
 * 
 * Writes frontend console logs to a file on the backend for debugging.
 * Logs are automatically cleared on logout.
 * 
 * Usage:
 * - Call debugLogger.log('category', 'message', data) instead of console.log
 * - Logs are written to: backend/logs/debug_[timestamp].log
 * - Logs are cleared on logout
 */
@Injectable({
  providedIn: 'root'
})
export class DebugLoggerService {
  private logBuffer: any[] = [];
  private flushTimer: any;
  private readonly FLUSH_INTERVAL = 2000; // Flush every 2 seconds
  private readonly MAX_BUFFER_SIZE = 50; // Flush if buffer reaches 50 entries
  private sessionId: string;
  private enabled = true; // Can be toggled via localStorage

  constructor(private http: HttpClient) {
    // Generate unique session ID
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Check if logging is enabled
    const loggingEnabled = localStorage.getItem('debug_logging_enabled');
    this.enabled = loggingEnabled !== 'false';
    
    // Start periodic flush
    this.startFlushTimer();
    
    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      this.flush(true);
    });
    
    // Log initialization
    if (this.enabled) {
      this.log('INIT', 'Debug logger initialized', { sessionId: this.sessionId });
    }
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem('debug_logging_enabled', enabled ? 'true' : 'false');
    console.log(`🔧 [DebugLogger] Logging ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Log a message with category and optional data
   */
  log(category: string, message: string, data?: any): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      sessionId: this.sessionId,
      category,
      message,
      data: data ? this.sanitizeData(data) : undefined
    };

    // Also log to console for immediate visibility
    console.log(`📝 [${category}] ${message}`, data || '');

    // Add to buffer
    this.logBuffer.push(logEntry);

    // Flush if buffer is full
    if (this.logBuffer.length >= this.MAX_BUFFER_SIZE) {
      this.flush();
    }
  }

  /**
   * Log an error
   */
  error(category: string, message: string, error?: any): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      sessionId: this.sessionId,
      category,
      level: 'ERROR',
      message,
      error: error ? {
        message: error.message,
        stack: error.stack,
        ...error
      } : undefined
    };

    console.error(`❌ [${category}] ${message}`, error || '');

    this.logBuffer.push(logEntry);

    // Flush errors immediately
    this.flush();
  }

  /**
   * Log template state operations
   */
  logTemplateState(operation: string, templateId: string, details: any): void {
    this.log('TEMPLATE_STATE', `${operation} - ${templateId}`, details);
  }

  /**
   * Log visual editor operations
   */
  logVisualEditor(operation: string, details: any): void {
    this.log('VISUAL_EDITOR', operation, details);
  }

  /**
   * Log QA page operations
   */
  logQAPage(operation: string, details: any): void {
    this.log('QA_PAGE', operation, details);
  }

  /**
   * Log localStorage operations
   */
  logStorage(operation: string, key: string, details?: any): void {
    this.log('STORAGE', `${operation} - ${key}`, details);
  }

  /**
   * Flush logs to backend
   */
  private flush(synchronous: boolean = false): void {
    if (this.logBuffer.length === 0) return;

    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    const payload = {
      sessionId: this.sessionId,
      logs: logsToSend
    };

    if (synchronous) {
      // Synchronous request for page unload
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/debug-logs', blob);
      } catch (e) {
        console.error('Failed to send logs via beacon:', e);
      }
    } else {
      // Async request
      this.http.post('/api/debug-logs', payload)
        .pipe(
          catchError(err => {
            console.error('Failed to send logs to backend:', err);
            return of(null);
          })
        )
        .subscribe();
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Clear all logs (called on logout)
   */
  clearLogs(): void {
    this.log('CLEANUP', 'Clearing all debug logs');
    this.flush(true); // Final flush
    
    this.http.post('/api/debug-logs/clear', { sessionId: this.sessionId })
      .pipe(
        catchError(err => {
          console.error('Failed to clear logs:', err);
          return of(null);
        })
      )
      .subscribe(() => {
        console.log('✅ Debug logs cleared');
      });
  }

  /**
   * Sanitize data to prevent circular references
   */
  private sanitizeData(data: any): any {
    if (data === null || data === undefined) return data;
    
    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }
    
    // Handle objects
    if (typeof data === 'object') {
      try {
        // Check for circular references by attempting to stringify
        JSON.stringify(data);
        
        // If successful, return sanitized version
        const sanitized: any = {};
        for (const key in data) {
          if (data.hasOwnProperty(key)) {
            // Skip functions and large HTML strings
            if (typeof data[key] === 'function') {
              sanitized[key] = '[Function]';
            } else if (typeof data[key] === 'string' && data[key].length > 500) {
              sanitized[key] = `[String: ${data[key].length} chars] ${data[key].substring(0, 100)}...`;
            } else {
              sanitized[key] = data[key];
            }
          }
        }
        return sanitized;
      } catch (e) {
        return '[Circular Reference]';
      }
    }
    
    return data;
  }

  /**
   * Get current session logs (for debugging)
   */
  getCurrentLogs(): any[] {
    return [...this.logBuffer];
  }
}
