import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule, Router, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { TemplatesService } from '../../../core/services/templates.service';
import { AuthService } from '../../../../app/core/services/auth.service';
import { AdminService } from '../../../core/services/admin.service';
import { AdminEventService } from '../../../core/services/admin-event.service';
import { map, takeUntil, startWith, tap, switchMap, filter } from 'rxjs/operators';
import { BehaviorSubject, Subject, timer } from 'rxjs';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [
    CommonModule, 
    MatToolbarModule, 
    MatButtonModule, 
    RouterModule, 
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
    MatDividerModule
  ],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent implements OnInit, OnDestroy {
  private svc = inject(TemplatesService);
  private authService = inject(AuthService);
  private adminService = inject(AdminService);
  private adminEventService = inject(AdminEventService);
  private router = inject(Router);
  private location = inject(Location);

  private destroy$ = new Subject<void>();
  
  // Navigation tracking with persistence
  private readonly HISTORY_KEY = 'navigation_history';
  private readonly INDEX_KEY = 'navigation_index';
  private readonly MAX_HISTORY = 50; // Prevent unlimited growth
  private navigationHistory: string[] = [];
  private currentIndex = -1;
  private isNavigating = false;
  
  pendingCount$ = new BehaviorSubject<number>(0);
  currentUser$ = this.authService.currentUser$;
  activeRoute$ = new BehaviorSubject<string>('');

  canGoBack$ = new BehaviorSubject<boolean>(false);
  canGoForward$ = new BehaviorSubject<boolean>(false);
ngOnInit(): void {
  console.log('🚀 [ngOnInit] Component initializing...');
  
  // ✅ RESTORE navigation history from sessionStorage
  console.log('📂 [ngOnInit] Restoring navigation history from sessionStorage...');
  this.restoreNavigationHistory();
  
  const currentUrl = this.router.url;
  console.log('🌐 [ngOnInit] Current URL on init:', currentUrl);
  
  // If history is empty (first load), initialize it
  if (this.navigationHistory.length === 0) {
    console.log('📝 [ngOnInit] History is empty - First load detected');
    this.navigationHistory = [currentUrl];
    this.currentIndex = 0;
    console.log('✅ [ngOnInit] Initialized history:', this.navigationHistory);
    console.log('✅ [ngOnInit] Initialized index:', this.currentIndex);
  } else {
    console.log('📚 [ngOnInit] History restored from sessionStorage');
    console.log('   - History array:', this.navigationHistory);
    console.log('   - Restored index:', this.currentIndex);
    console.log('   - Expected URL at index:', this.navigationHistory[this.currentIndex]);
    
    // Check if current URL matches the stored index
    if (this.navigationHistory[this.currentIndex] !== currentUrl) {
      console.warn('⚠️ [ngOnInit] URL mismatch detected!');
      console.log('   - Expected:', this.navigationHistory[this.currentIndex]);
      console.log('   - Actual:', currentUrl);
      console.log('   - Reason: Direct URL navigation or refresh changed route');
      
      // Check if currentUrl exists elsewhere in history
      const existingIndex = this.navigationHistory.indexOf(currentUrl);
      if (existingIndex !== -1) {
        console.log('✅ [ngOnInit] URL found in history at index:', existingIndex);
        this.currentIndex = existingIndex;
      } else {
        console.log('➕ [ngOnInit] URL not in history - Adding as new entry');
        // Add current page to history
        this.currentIndex++;
        this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex);
        this.navigationHistory.push(currentUrl);
        console.log('   - New history:', this.navigationHistory);
        console.log('   - New index:', this.currentIndex);
      }
    } else {
      console.log('✅ [ngOnInit] URL matches expected position in history');
    }
  }
  
  this.activeRoute$.next(currentUrl);
  this.updateNavigationState();
  this.saveNavigationHistory();
  console.log('💾 [ngOnInit] Initial state saved');

  // ========================================
  // 🔥 CRITICAL: Listen to browser back/forward buttons
  // ========================================
  console.log('👂 [ngOnInit] Setting up browser back/forward listener...');
  this.location.subscribe((event) => {
    console.log('🔙 [PopState] Browser back/forward detected!');
    console.log('   - Event:', event);
    console.log('   - isNavigating flag:', this.isNavigating);
    
    // Only handle if not triggered by our custom navigation
    if (!this.isNavigating) {
      const newUrl = this.router.url;
      console.log('   - Browser navigated to:', newUrl);
      console.log('   - Current history:', this.navigationHistory);
      console.log('   - Current index before update:', this.currentIndex);
      
      // Try to find the URL in history
      const foundIndex = this.navigationHistory.indexOf(newUrl);
      
      if (foundIndex !== -1) {
        console.log('✅ [PopState] URL found in history at index:', foundIndex);
        this.currentIndex = foundIndex;
      } else {
        console.warn('⚠️ [PopState] URL not found in history - Adding it');
        // URL not in history - this shouldn't happen often but handle it
        this.navigationHistory.push(newUrl);
        this.currentIndex = this.navigationHistory.length - 1;
        
        // Enforce max history
        if (this.navigationHistory.length > this.MAX_HISTORY) {
          console.log('📏 [PopState] History exceeds MAX_HISTORY, trimming...');
          this.navigationHistory.shift();
          this.currentIndex--;
        }
      }
      
      console.log('   - Updated index:', this.currentIndex);
      this.activeRoute$.next(newUrl);
      this.updateNavigationState();
      this.saveNavigationHistory();
      console.log('💾 [PopState] State updated and saved');
    } else {
      console.log('⏭️ [PopState] Ignored - triggered by custom navigation');
    }
  });

  // ========================================
  // Track Angular Router Navigation Events
  // ========================================
  console.log('🛤️ [ngOnInit] Setting up router event tracking...');
  
  this.router.events.pipe(
    filter(event => 
      event instanceof NavigationEnd || 
      event instanceof NavigationCancel || 
      event instanceof NavigationError
    ),
    takeUntil(this.destroy$)
  ).subscribe((event: any) => {
    console.log('📡 [Router Event]', event.constructor.name);
    
    if (event instanceof NavigationEnd) {
      console.log('✅ [NavigationEnd] Navigation completed successfully');
      const url = event.urlAfterRedirects;
      console.log('   - URL after redirects:', url);
      console.log('   - isNavigating flag:', this.isNavigating);
      
      // Only track if not from our custom navigation
      if (!this.isNavigating) {
        console.log('📝 [NavigationEnd] Processing new navigation...');
        this.activeRoute$.next(url);
        
        console.log('   - Current index:', this.currentIndex);
        console.log('   - History length:', this.navigationHistory.length);
        
        // Remove forward history when user navigates normally
        if (this.currentIndex < this.navigationHistory.length - 1) {
          const removedEntries = this.navigationHistory.slice(this.currentIndex + 1);
          console.log('✂️ [NavigationEnd] Removing forward history:', removedEntries);
          this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex + 1);
          console.log('   - History after trim:', this.navigationHistory);
        }
        
        // Don't add duplicate consecutive entries
        const lastUrl = this.navigationHistory[this.currentIndex];
        console.log('   - Last URL in history:', lastUrl);
        console.log('   - New URL:', url);
        
        if (lastUrl !== url) {
          console.log('➕ [NavigationEnd] Adding new entry to history');
          this.navigationHistory.push(url);
          this.currentIndex = this.navigationHistory.length - 1;
          console.log('   - History after push:', this.navigationHistory);
          console.log('   - New index:', this.currentIndex);
          
          // ✅ Limit history size
          if (this.navigationHistory.length > this.MAX_HISTORY) {
            const removed = this.navigationHistory.shift();
            this.currentIndex--;
            console.log('📏 [NavigationEnd] History limit reached!');
            console.log('   - Removed oldest entry:', removed);
            console.log('   - Adjusted index to:', this.currentIndex);
          }
        } else {
          console.log('⏭️ [NavigationEnd] Skipped - duplicate consecutive entry');
        }
        
        this.updateNavigationState();
        this.saveNavigationHistory();
        
        console.log('📊 [NavigationEnd] Final state:');
        console.log('   - Navigation history:', JSON.stringify(this.navigationHistory));
        console.log('   - Current index:', this.currentIndex);
        console.log('   - Can go back:', this.canGoBack$.value);
        console.log('   - Can go forward:', this.canGoForward$.value);
      } else {
        console.log('⏭️ [NavigationEnd] Skipped - custom navigation in progress');
        // Reset flag after custom navigation completes
        console.log('🔓 [NavigationEnd] Resetting isNavigating flag');
      }
    } 
    else if (event instanceof NavigationCancel) {
      console.warn('🚫 [NavigationCancel] Navigation was cancelled');
      console.log('   - URL:', event.url);
      console.log('   - Reason:', event.reason);
      // Navigation was cancelled (e.g., by a guard)
      // Don't update history, but reset flag if needed
      if (this.isNavigating) {
        console.log('🔓 [NavigationCancel] Resetting isNavigating flag due to cancel');
        this.isNavigating = false;
      }
    } 
    else if (event instanceof NavigationError) {
      console.error('❌ [NavigationError] Navigation failed!');
      console.error('   - URL:', event.url);
      console.error('   - Error:', event.error);
      // Navigation failed - don't update history, reset flag
      if (this.isNavigating) {
        console.log('🔓 [NavigationError] Resetting isNavigating flag due to error');
        this.isNavigating = false;
      }
    }
  });

  // ========================================
  // Admin pending count polling
  // ========================================
  console.log('👤 [ngOnInit] Checking if user is admin...');
  if (!this.isAdmin()) {
    console.log('❌ [ngOnInit] User is not admin - skipping admin features');
    console.log('✅ [ngOnInit] Component initialization complete (non-admin)');
    return;
  }

  console.log('✅ [ngOnInit] User is admin - setting up admin features');
  console.log('⏰ [ngOnInit] Starting admin pending count polling (every 30s)...');
  
  timer(0, 30000).pipe(
    startWith(0),
    switchMap(() => {
      console.log('🔄 [Admin Poll] Fetching pending users...');
      return this.adminService.getPendingUsers();
    }),
    map(response => {
      const count = response.users.length;
      console.log('📊 [Admin Poll] Pending users count:', count);
      return count;
    }),
    takeUntil(this.destroy$)
  ).subscribe({
    next: (count) => {
      console.log('✅ [Admin Poll] Updated pending count:', count);
      this.pendingCount$.next(count);
    },
    error: (err) => {
      console.error('❌ [Admin Poll] Error fetching pending count:', err);
    }
  });

  console.log('👂 [ngOnInit] Setting up admin event listeners...');
  
  this.adminEventService.refreshPendingCount
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      console.log('🔔 [Admin Event] refreshPendingCount triggered');
      this.fetchPendingCount();
    });
  
  this.adminEventService.refresh$
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      console.log('🔔 [Admin Event] refresh$ triggered');
      this.fetchPendingCount();
    });
  
  console.log('✅ [ngOnInit] Component initialization complete (admin)');
  console.log('═══════════════════════════════════════════════════════');
}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pendingCount$.complete();
    this.canGoBack$.complete();
    this.canGoForward$.complete();
  }
private restoreNavigationHistory(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📂 [restoreNavigationHistory] Attempting to restore navigation history...');
  console.log('   - Storage key for history:', this.HISTORY_KEY);
  console.log('   - Storage key for index:', this.INDEX_KEY);
  
  try {
    const savedHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const savedIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    console.log('🔍 [restoreNavigationHistory] Raw sessionStorage values:');
    console.log('   - savedHistory:', savedHistory);
    console.log('   - savedIndex:', savedIndex);
    
    if (!savedHistory || !savedIndex) {
      console.log('ℹ️ [restoreNavigationHistory] No saved history found (first time or cleared)');
      console.log('   - savedHistory exists:', !!savedHistory);
      console.log('   - savedIndex exists:', !!savedIndex);
      console.log('   - Will initialize fresh history on first navigation');
      this.navigationHistory = [];
      this.currentIndex = -1;
      console.log('✅ [restoreNavigationHistory] Initialized empty state');
      console.log('═══════════════════════════════════════════════════════');
      return;
    }
    
    console.log('📥 [restoreNavigationHistory] Parsing saved data...');
    
    // Parse history array
    let parsedHistory: string[];
    try {
      parsedHistory = JSON.parse(savedHistory);
      console.log('✅ [restoreNavigationHistory] History parsed successfully');
      console.log('   - Type:', typeof parsedHistory);
      console.log('   - Is array:', Array.isArray(parsedHistory));
      console.log('   - Length:', parsedHistory?.length);
    } catch (parseError) {
      console.error('❌ [restoreNavigationHistory] Failed to parse history JSON');
      console.error('   - Parse error:', parseError);
      console.error('   - Invalid JSON string:', savedHistory);
      throw new Error('Invalid history JSON format');
    }
    
    // Validate parsed history is an array
    if (!Array.isArray(parsedHistory)) {
      console.error('❌ [restoreNavigationHistory] Parsed history is not an array!');
      console.error('   - Type:', typeof parsedHistory);
      console.error('   - Value:', parsedHistory);
      throw new Error('History is not an array');
    }
    
    // Validate array contains only strings
    const invalidEntries = parsedHistory.filter(entry => typeof entry !== 'string');
    if (invalidEntries.length > 0) {
      console.error('❌ [restoreNavigationHistory] History contains non-string entries!');
      console.error('   - Invalid entries:', invalidEntries);
      throw new Error('History contains invalid entries');
    }
    
    // Validate array is not empty
    if (parsedHistory.length === 0) {
      console.warn('⚠️ [restoreNavigationHistory] Restored history is empty array');
      console.log('   - This is unusual but not invalid');
      console.log('   - Will initialize fresh history');
      this.navigationHistory = [];
      this.currentIndex = -1;
      console.log('═══════════════════════════════════════════════════════');
      return;
    }
    
    console.log('✅ [restoreNavigationHistory] History validation passed');
    console.log('   - Entries:', parsedHistory.length);
    console.log('   - First entry:', parsedHistory[0]);
    console.log('   - Last entry:', parsedHistory[parsedHistory.length - 1]);
    
    // Parse index
    const parsedIndex = parseInt(savedIndex, 10);
    console.log('🔢 [restoreNavigationHistory] Parsing index...');
    console.log('   - Raw value:', savedIndex);
    console.log('   - Parsed value:', parsedIndex);
    console.log('   - Is valid number:', !isNaN(parsedIndex));
    
    // Validate index is a valid number
    if (isNaN(parsedIndex)) {
      console.error('❌ [restoreNavigationHistory] Index is not a valid number!');
      console.error('   - Raw value:', savedIndex);
      console.error('   - Parsed value:', parsedIndex);
      throw new Error('Invalid index value');
    }
    
    // Validate index is within bounds
    if (parsedIndex < 0) {
      console.error('❌ [restoreNavigationHistory] Index is negative!');
      console.error('   - Index:', parsedIndex);
      console.error('   - Valid range: 0 to', parsedHistory.length - 1);
      throw new Error('Index is negative');
    }
    
    if (parsedIndex >= parsedHistory.length) {
      console.error('❌ [restoreNavigationHistory] Index exceeds history length!');
      console.error('   - Index:', parsedIndex);
      console.error('   - History length:', parsedHistory.length);
      console.error('   - Valid range: 0 to', parsedHistory.length - 1);
      throw new Error('Index out of bounds');
    }
    
    console.log('✅ [restoreNavigationHistory] Index validation passed');
    console.log('   - Index:', parsedIndex);
    console.log('   - Valid range: 0 to', parsedHistory.length - 1);
    console.log('   - URL at index:', parsedHistory[parsedIndex]);
    
    // Check if MAX_HISTORY limit is exceeded
    if (parsedHistory.length > this.MAX_HISTORY) {
      console.warn('⚠️ [restoreNavigationHistory] History exceeds MAX_HISTORY limit!');
      console.log('   - History length:', parsedHistory.length);
      console.log('   - MAX_HISTORY:', this.MAX_HISTORY);
      console.log('   - Trimming to last', this.MAX_HISTORY, 'entries...');
      
      const startIndex = parsedHistory.length - this.MAX_HISTORY;
      parsedHistory = parsedHistory.slice(startIndex);
      
      // Adjust index
      const adjustedIndex = parsedIndex - startIndex;
      if (adjustedIndex >= 0 && adjustedIndex < parsedHistory.length) {
        console.log('   - Adjusted index from', parsedIndex, 'to', adjustedIndex);
        this.currentIndex = adjustedIndex;
      } else {
        console.warn('   - Could not adjust index, setting to last entry');
        this.currentIndex = parsedHistory.length - 1;
      }
    } else {
      this.currentIndex = parsedIndex;
    }
    
    // All validations passed - restore the state
    this.navigationHistory = parsedHistory;
    
    console.log('🎉 [restoreNavigationHistory] Successfully restored navigation state!');
    console.log('   - History entries:', this.navigationHistory.length);
    console.log('   - Current index:', this.currentIndex);
    console.log('   - Full history:', JSON.stringify(this.navigationHistory));
    console.log('   - Current URL in history:', this.navigationHistory[this.currentIndex]);
    console.log('   - Can go back:', this.currentIndex > 0);
    console.log('   - Can go forward:', this.currentIndex < this.navigationHistory.length - 1);
    
  } catch (error) {
    console.error('❌ [restoreNavigationHistory] Failed to restore navigation history!');
    console.error('   - Error:', error);
    console.error('   - Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('   - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    console.log('🔄 [restoreNavigationHistory] Resetting to clean state...');
    this.navigationHistory = [];
    this.currentIndex = -1;
    
    console.log('🧹 [restoreNavigationHistory] Clearing corrupted sessionStorage...');
    try {
      sessionStorage.removeItem(this.HISTORY_KEY);
      sessionStorage.removeItem(this.INDEX_KEY);
      console.log('✅ [restoreNavigationHistory] Corrupted data cleared');
    } catch (clearError) {
      console.error('❌ [restoreNavigationHistory] Failed to clear sessionStorage:', clearError);
    }
    
    console.log('✅ [restoreNavigationHistory] Clean state initialized');
    console.log('   - navigationHistory: []');
    console.log('   - currentIndex: -1');
  }
  
  console.log('═══════════════════════════════════════════════════════');
}

private saveNavigationHistory(): void {
  console.log('💾 [saveNavigationHistory] Saving navigation state to sessionStorage...');
  console.log('   - History length:', this.navigationHistory.length);
  console.log('   - Current index:', this.currentIndex);
  console.log('   - Current URL:', this.navigationHistory[this.currentIndex]);
  
  // Validate state before saving
  if (this.currentIndex < -1) {
    console.error('❌ [saveNavigationHistory] Invalid index detected (less than -1)!');
    console.error('   - Index:', this.currentIndex);
    console.error('   - Skipping save to prevent corrupting sessionStorage');
    return;
  }
  
  if (this.currentIndex >= this.navigationHistory.length && this.navigationHistory.length > 0) {
    console.error('❌ [saveNavigationHistory] Index out of bounds!');
    console.error('   - Index:', this.currentIndex);
    console.error('   - History length:', this.navigationHistory.length);
    console.error('   - Skipping save to prevent corrupting sessionStorage');
    return;
  }
  
  if (!Array.isArray(this.navigationHistory)) {
    console.error('❌ [saveNavigationHistory] navigationHistory is not an array!');
    console.error('   - Type:', typeof this.navigationHistory);
    console.error('   - Value:', this.navigationHistory);
    console.error('   - Skipping save to prevent corrupting sessionStorage');
    return;
  }
  
  console.log('✅ [saveNavigationHistory] Pre-save validation passed');
  
  try {
    // Prepare data for storage
    const historyJson = JSON.stringify(this.navigationHistory);
    const indexString = String(this.currentIndex);
    
    console.log('📦 [saveNavigationHistory] Serialized data:');
    console.log('   - History JSON length:', historyJson.length, 'characters');
    console.log('   - History JSON preview:', historyJson.substring(0, 100) + (historyJson.length > 100 ? '...' : ''));
    console.log('   - Index string:', indexString);
    
    // Estimate storage size
    const estimatedSize = historyJson.length + indexString.length;
    console.log('   - Estimated storage size:', estimatedSize, 'bytes (~' + (estimatedSize / 1024).toFixed(2) + ' KB)');
    
    // Check if data seems too large (sessionStorage typical limit is 5-10MB)
    if (estimatedSize > 1024 * 1024) { // 1MB warning threshold
      console.warn('⚠️ [saveNavigationHistory] Large data size detected!');
      console.warn('   - Size:', (estimatedSize / 1024 / 1024).toFixed(2), 'MB');
      console.warn('   - This may cause issues with sessionStorage limits');
    }
    
    console.log('💾 [saveNavigationHistory] Writing to sessionStorage...');
    console.log('   - Key 1:', this.HISTORY_KEY);
    console.log('   - Key 2:', this.INDEX_KEY);
    
    // Save history
    sessionStorage.setItem(this.HISTORY_KEY, historyJson);
    console.log('✅ [saveNavigationHistory] History saved successfully');
    
    // Save index
    sessionStorage.setItem(this.INDEX_KEY, indexString);
    console.log('✅ [saveNavigationHistory] Index saved successfully');
    
    // Verify save by reading back
    const verifyHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const verifyIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    if (verifyHistory === historyJson && verifyIndex === indexString) {
      console.log('✅ [saveNavigationHistory] Verification successful - data saved correctly');
    } else {
      console.warn('⚠️ [saveNavigationHistory] Verification mismatch!');
      console.warn('   - History match:', verifyHistory === historyJson);
      console.warn('   - Index match:', verifyIndex === indexString);
    }
    
    console.log('🎉 [saveNavigationHistory] Save operation completed successfully');
    
  } catch (error) {
    console.error('❌ [saveNavigationHistory] Failed to save navigation history!');
    console.error('   - Error:', error);
    console.error('   - Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('   - Error message:', error instanceof Error ? error.message : 'Unknown error');
    
    // Check for specific error types
    if (error instanceof Error) {
      // Quota exceeded error
      if (error.name === 'QuotaExceededError' || 
          error.message.includes('quota') || 
          error.message.includes('storage')) {
        console.error('💾 [saveNavigationHistory] SessionStorage QUOTA EXCEEDED!');
        console.error('   - History length:', this.navigationHistory.length);
        console.error('   - Attempting to reduce history size...');
        
        // Try to trim history and save again
        if (this.navigationHistory.length > 10) {
          console.log('✂️ [saveNavigationHistory] Trimming history to last 10 entries...');
          const trimAmount = this.navigationHistory.length - 10;
          this.navigationHistory = this.navigationHistory.slice(trimAmount);
          this.currentIndex = Math.max(0, this.currentIndex - trimAmount);
          
          console.log('   - New history length:', this.navigationHistory.length);
          console.log('   - Adjusted index:', this.currentIndex);
          
          // Try saving trimmed version
          try {
            sessionStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.navigationHistory));
            sessionStorage.setItem(this.INDEX_KEY, String(this.currentIndex));
            console.log('✅ [saveNavigationHistory] Successfully saved trimmed history');
          } catch (retryError) {
            console.error('❌ [saveNavigationHistory] Failed to save even trimmed history');
            console.error('   - Error:', retryError);
            console.error('   - SessionStorage may be completely full or disabled');
          }
        } else {
          console.error('   - History already minimal (≤10 entries), cannot trim further');
          console.error('   - SessionStorage may be full from other data');
        }
      }
      // Security/Permission error
      else if (error.name === 'SecurityError' || error.name === 'InvalidAccessError') {
        console.error('🔒 [saveNavigationHistory] SessionStorage ACCESS DENIED!');
        console.error('   - Possible reasons:');
        console.error('     • Browser in private/incognito mode with strict settings');
        console.error('     • SessionStorage disabled by browser settings');
        console.error('     • Third-party cookies/storage blocked');
        console.error('     • Browser security policy preventing access');
        console.error('   - Navigation will work but won\'t persist across refreshes');
      }
      // Other errors
      else {
        console.error('❓ [saveNavigationHistory] Unknown error type');
        console.error('   - Consider implementing fallback storage mechanism');
      }
    }
    
    console.error('⚠️ [saveNavigationHistory] Navigation will continue to work in-memory');
    console.error('   - History will be lost on page refresh');
    console.error('   - Consider alternative storage if this persists');
  }
  
  console.log('═══════════════════════════════════════════════════════');
}

private clearNavigationHistory(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🧹 [clearNavigationHistory] Clearing navigation history...');
  console.log('   - Current history length:', this.navigationHistory.length);
  console.log('   - Current index:', this.currentIndex);
  console.log('   - Current history:', JSON.stringify(this.navigationHistory));
  
  // Store state before clearing for logging
  const historyBeforeClear = [...this.navigationHistory];
  const indexBeforeClear = this.currentIndex;
  const canGoBackBefore = this.canGoBack$.value;
  const canGoForwardBefore = this.canGoForward$.value;
  
  console.log('📊 [clearNavigationHistory] State before clearing:');
  console.log('   - History entries:', historyBeforeClear.length);
  console.log('   - Index position:', indexBeforeClear);
  console.log('   - canGoBack:', canGoBackBefore);
  console.log('   - canGoForward:', canGoForwardBefore);
  
  try {
    // Clear sessionStorage
    console.log('🗑️ [clearNavigationHistory] Removing from sessionStorage...');
    console.log('   - Removing key:', this.HISTORY_KEY);
    sessionStorage.removeItem(this.HISTORY_KEY);
    console.log('✅ [clearNavigationHistory] History key removed');
    
    console.log('   - Removing key:', this.INDEX_KEY);
    sessionStorage.removeItem(this.INDEX_KEY);
    console.log('✅ [clearNavigationHistory] Index key removed');
    
    // Verify removal
    const verifyHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const verifyIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    if (verifyHistory === null && verifyIndex === null) {
      console.log('✅ [clearNavigationHistory] Verification: sessionStorage cleared successfully');
    } else {
      console.warn('⚠️ [clearNavigationHistory] Verification failed!');
      console.warn('   - History key still exists:', verifyHistory !== null);
      console.warn('   - Index key still exists:', verifyIndex !== null);
    }
    
    // Clear in-memory state
    console.log('💾 [clearNavigationHistory] Clearing in-memory state...');
    this.navigationHistory = [];
    this.currentIndex = -1;
    console.log('✅ [clearNavigationHistory] In-memory state cleared');
    console.log('   - navigationHistory:', this.navigationHistory);
    console.log('   - currentIndex:', this.currentIndex);
    
    // Update navigation button states
    console.log('🔄 [clearNavigationHistory] Updating navigation states...');
    this.updateNavigationState();
    
    console.log('📊 [clearNavigationHistory] State after clearing:');
    console.log('   - History entries:', this.navigationHistory.length);
    console.log('   - Index position:', this.currentIndex);
    console.log('   - canGoBack:', this.canGoBack$.value);
    console.log('   - canGoForward:', this.canGoForward$.value);
    
    // Validate final state
    if (this.navigationHistory.length !== 0) {
      console.error('❌ [clearNavigationHistory] History not empty after clear!');
      console.error('   - Length:', this.navigationHistory.length);
    }
    
    if (this.currentIndex !== -1) {
      console.error('❌ [clearNavigationHistory] Index not reset to -1!');
      console.error('   - Index:', this.currentIndex);
    }
    
    if (this.canGoBack$.value === true) {
      console.error('❌ [clearNavigationHistory] canGoBack should be false after clear!');
    }
    
    if (this.canGoForward$.value === true) {
      console.error('❌ [clearNavigationHistory] canGoForward should be false after clear!');
    }
    
    // Log what was cleared
    if (historyBeforeClear.length > 0) {
      console.log('📋 [clearNavigationHistory] Cleared history summary:');
      console.log('   - Total entries cleared:', historyBeforeClear.length);
      console.log('   - First entry was:', historyBeforeClear[0]);
      console.log('   - Last entry was:', historyBeforeClear[historyBeforeClear.length - 1]);
      console.log('   - User was at position:', indexBeforeClear + 1, 'of', historyBeforeClear.length);
    } else {
      console.log('ℹ️ [clearNavigationHistory] History was already empty');
    }
    
    console.log('🎉 [clearNavigationHistory] Navigation history cleared successfully');
    
  } catch (error) {
    console.error('❌ [clearNavigationHistory] Failed to clear navigation history!');
    console.error('   - Error:', error);
    console.error('   - Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('   - Error message:', error instanceof Error ? error.message : 'Unknown error');
    
    // Check for specific error types
    if (error instanceof Error) {
      if (error.name === 'SecurityError' || error.name === 'InvalidAccessError') {
        console.error('🔒 [clearNavigationHistory] SessionStorage ACCESS DENIED!');
        console.error('   - Cannot remove items from sessionStorage');
        console.error('   - Possible reasons:');
        console.error('     • Browser in private/incognito mode with strict settings');
        console.error('     • SessionStorage disabled by browser settings');
        console.error('     • Third-party storage blocked');
      }
    }
    
    // Even if sessionStorage clear fails, clear in-memory state
    console.log('🔄 [clearNavigationHistory] Attempting to clear in-memory state anyway...');
    try {
      this.navigationHistory = [];
      this.currentIndex = -1;
      this.updateNavigationState();
      console.log('✅ [clearNavigationHistory] In-memory state cleared despite error');
    } catch (memoryError) {
      console.error('❌ [clearNavigationHistory] Failed to clear even in-memory state!');
      console.error('   - This should never happen');
      console.error('   - Error:', memoryError);
    }
    
    console.error('⚠️ [clearNavigationHistory] Clear operation completed with errors');
    console.error('   - SessionStorage may still contain old data');
    console.error('   - In-memory state should be cleared');
  }
  
  console.log('═══════════════════════════════════════════════════════');
}

private updateNavigationState(): void {
  console.log('🔄 [updateNavigationState] Updating navigation button states...');
  console.log('   - Current index:', this.currentIndex);
  console.log('   - History length:', this.navigationHistory.length);
  console.log('   - History:', JSON.stringify(this.navigationHistory));
  
  // Store previous values for comparison
  const previousCanGoBack = this.canGoBack$.value;
  const previousCanGoForward = this.canGoForward$.value;
  
  console.log('📊 [updateNavigationState] Previous state:');
  console.log('   - canGoBack:', previousCanGoBack);
  console.log('   - canGoForward:', previousCanGoForward);
  
  // Validate state before calculation
  if (!Array.isArray(this.navigationHistory)) {
    console.error('❌ [updateNavigationState] navigationHistory is not an array!');
    console.error('   - Type:', typeof this.navigationHistory);
    console.error('   - Value:', this.navigationHistory);
    console.error('   - Setting both states to FALSE for safety');
    this.canGoBack$.next(false);
    this.canGoForward$.next(false);
    return;
  }
  
  if (typeof this.currentIndex !== 'number' || isNaN(this.currentIndex)) {
    console.error('❌ [updateNavigationState] currentIndex is not a valid number!');
    console.error('   - Type:', typeof this.currentIndex);
    console.error('   - Value:', this.currentIndex);
    console.error('   - Setting both states to FALSE for safety');
    this.canGoBack$.next(false);
    this.canGoForward$.next(false);
    return;
  }
  
  // Calculate new states
  const canGoBack = this.currentIndex > 0;
  const canGoForward = this.currentIndex < this.navigationHistory.length - 1;
  
  console.log('🧮 [updateNavigationState] Calculation details:');
  console.log('   - canGoBack calculation:');
  console.log('     • currentIndex > 0');
  console.log('     •', this.currentIndex, '> 0 =', canGoBack);
  console.log('   - canGoForward calculation:');
  console.log('     • currentIndex < (historyLength - 1)');
  console.log('     •', this.currentIndex, '<', this.navigationHistory.length - 1, '=', canGoForward);
  
  // Validate calculated states
  if (this.currentIndex < 0 && canGoBack) {
    console.error('❌ [updateNavigationState] Logic error: index < 0 but canGoBack is true!');
    console.error('   - This should never happen');
  }
  
  if (this.currentIndex >= this.navigationHistory.length && canGoForward) {
    console.error('❌ [updateNavigationState] Logic error: index >= length but canGoForward is true!');
    console.error('   - This should never happen');
  }
  
  if (this.navigationHistory.length === 0) {
    console.log('ℹ️ [updateNavigationState] History is empty');
    if (canGoBack || canGoForward) {
      console.error('❌ [updateNavigationState] Logic error: empty history but navigation enabled!');
    }
  }
  
  if (this.navigationHistory.length === 1) {
    console.log('ℹ️ [updateNavigationState] History has only 1 entry');
    console.log('   - Both navigation buttons should be disabled');
    if (canGoBack || canGoForward) {
      console.warn('⚠️ [updateNavigationState] Warning: single entry but navigation enabled');
    }
  }
  
  // Update the observables
  console.log('📤 [updateNavigationState] Emitting new states...');
  this.canGoBack$.next(canGoBack);
  this.canGoForward$.next(canGoForward);
  
  console.log('✅ [updateNavigationState] New state:');
  console.log('   - canGoBack:', canGoBack);
  console.log('   - canGoForward:', canGoForward);
  
  // Log state changes
  if (previousCanGoBack !== canGoBack) {
    console.log('🔄 [updateNavigationState] canGoBack CHANGED:', previousCanGoBack, '→', canGoBack);
  }
  
  if (previousCanGoForward !== canGoForward) {
    console.log('🔄 [updateNavigationState] canGoForward CHANGED:', previousCanGoForward, '→', canGoForward);
  }
  
  if (previousCanGoBack === canGoBack && previousCanGoForward === canGoForward) {
    console.log('ℹ️ [updateNavigationState] No state changes (values unchanged)');
  }
  
  // Display current position in history
  if (this.navigationHistory.length > 0) {
    console.log('📍 [updateNavigationState] Current position:');
    console.log('   - Position:', this.currentIndex + 1, 'of', this.navigationHistory.length);
    console.log('   - Current URL:', this.navigationHistory[this.currentIndex]);
    
    if (canGoBack) {
      console.log('   - Previous URL:', this.navigationHistory[this.currentIndex - 1]);
    } else {
      console.log('   - Previous URL: (none - at start)');
    }
    
    if (canGoForward) {
      console.log('   - Next URL:', this.navigationHistory[this.currentIndex + 1]);
    } else {
      console.log('   - Next URL: (none - at end)');
    }
  }
  
  console.log('✅ [updateNavigationState] State update complete');
}

  private fetchPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => this.pendingCount$.next(response.users.length),
        error: (err) => console.error('Error in manual fetch:', err)
      });
  }

  canGoBack(): boolean {
    return this.canGoBack$.value;
  }

  canGoForward(): boolean {
    return this.canGoForward$.value;
  }

goBack(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🔙 [goBack] Back button clicked');
  console.log('   - Current index:', this.currentIndex);
  console.log('   - Current history:', JSON.stringify(this.navigationHistory));
  console.log('   - Can go back:', this.canGoBack$.value);
  
  if (!this.canGoBack()) {
    console.warn('⚠️ [goBack] Cannot go back - already at first entry');
    console.log('   - Index is:', this.currentIndex);
    return;
  }
  
  // Store original state in case we need to revert
  const originalIndex = this.currentIndex;
  const originalUrl = this.router.url;
  console.log('💾 [goBack] Saved original state:');
  console.log('   - Original index:', originalIndex);
  console.log('   - Original URL:', originalUrl);
  
  // Set navigation flag
  console.log('🔒 [goBack] Setting isNavigating flag to TRUE');
  this.isNavigating = true;
  
  // Decrement index
  this.currentIndex--;
  const previousUrl = this.navigationHistory[this.currentIndex];
  
  console.log('📍 [goBack] Navigation target:');
  console.log('   - New index:', this.currentIndex);
  console.log('   - Target URL:', previousUrl);
  console.log('   - Index range: 0 to', this.navigationHistory.length - 1);
  
  // Safety check - validate index
  if (this.currentIndex < 0) {
    console.error('❌ [goBack] CRITICAL: Index went negative!');
    console.log('   - Reverting to original index:', originalIndex);
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  // Safety check - validate URL exists
  if (!previousUrl) {
    console.error('❌ [goBack] CRITICAL: Target URL is undefined/null!');
    console.log('   - Index:', this.currentIndex);
    console.log('   - History:', this.navigationHistory);
    console.log('   - Reverting to original index:', originalIndex);
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  // Safety timeout to prevent stuck flag
  console.log('⏰ [goBack] Setting safety timeout (5 seconds)...');
  const safetyTimeout = setTimeout(() => {
    if (this.isNavigating) {
      console.error('⏱️ [goBack] TIMEOUT: Navigation took too long!');
      console.log('   - Force resetting isNavigating flag');
      console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
      this.currentIndex = originalIndex;
      this.isNavigating = false;
      this.updateNavigationState();
    }
  }, 5000);
  
  console.log('🚀 [goBack] Starting navigation to:', previousUrl);
  console.log('   - Using router.navigateByUrl()');
  
  this.router.navigateByUrl(previousUrl)
    .then((success) => {
      clearTimeout(safetyTimeout);
      console.log('✅ [goBack] Navigation promise resolved');
      console.log('   - Success status:', success);
      
      if (success) {
        console.log('🎉 [goBack] Navigation succeeded!');
        console.log('   - Final index:', this.currentIndex);
        console.log('   - Final URL:', previousUrl);
        
        this.activeRoute$.next(previousUrl);
        this.updateNavigationState();
        this.saveNavigationHistory();
        
        console.log('💾 [goBack] State saved:');
        console.log('   - Can go back:', this.canGoBack$.value);
        console.log('   - Can go forward:', this.canGoForward$.value);
      } else {
        console.warn('⚠️ [goBack] Navigation returned FALSE');
        console.log('   - Possible reasons: Guard rejected, invalid route, or redirect');
        console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
        this.currentIndex = originalIndex;
        this.updateNavigationState();
        console.log('   - Index reverted to:', this.currentIndex);
      }
    })
    .catch((error) => {
      clearTimeout(safetyTimeout);
      console.error('❌ [goBack] Navigation FAILED with error!');
      console.error('   - Error:', error);
      console.error('   - Error message:', error?.message);
      console.error('   - Error stack:', error?.stack);
      console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
      
      // Revert to original state
      this.currentIndex = originalIndex;
      this.updateNavigationState();
      
      console.log('   - Index reverted to:', this.currentIndex);
      console.log('   - State restored');
      
      // Optionally notify user
      console.log('💡 [goBack] Consider showing user-friendly error message');
    })
    .finally(() => {
      clearTimeout(safetyTimeout);
      console.log('🔓 [goBack] Resetting isNavigating flag to FALSE');
      this.isNavigating = false;
      console.log('✅ [goBack] Operation complete');
      console.log('═══════════════════════════════════════════════════════');
    });
}

goForward(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('➡️ [goForward] Forward button clicked');
  console.log('   - Current index:', this.currentIndex);
  console.log('   - Current history:', JSON.stringify(this.navigationHistory));
  console.log('   - Can go forward:', this.canGoForward$.value);
  
  if (!this.canGoForward()) {
    console.warn('⚠️ [goForward] Cannot go forward - already at last entry');
    console.log('   - Index is:', this.currentIndex);
    console.log('   - History length:', this.navigationHistory.length);
    return;
  }
  
  // Store original state in case we need to revert
  const originalIndex = this.currentIndex;
  const originalUrl = this.router.url;
  console.log('💾 [goForward] Saved original state:');
  console.log('   - Original index:', originalIndex);
  console.log('   - Original URL:', originalUrl);
  
  // Set navigation flag
  console.log('🔒 [goForward] Setting isNavigating flag to TRUE');
  this.isNavigating = true;
  
  // Increment index
  this.currentIndex++;
  const nextUrl = this.navigationHistory[this.currentIndex];
  
  console.log('📍 [goForward] Navigation target:');
  console.log('   - New index:', this.currentIndex);
  console.log('   - Target URL:', nextUrl);
  console.log('   - Index range: 0 to', this.navigationHistory.length - 1);
  
  // Safety check - validate index
  if (this.currentIndex >= this.navigationHistory.length) {
    console.error('❌ [goForward] CRITICAL: Index exceeds history length!');
    console.log('   - Index:', this.currentIndex);
    console.log('   - History length:', this.navigationHistory.length);
    console.log('   - Reverting to original index:', originalIndex);
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  // Safety check - validate URL exists
  if (!nextUrl) {
    console.error('❌ [goForward] CRITICAL: Target URL is undefined/null!');
    console.log('   - Index:', this.currentIndex);
    console.log('   - History:', this.navigationHistory);
    console.log('   - Reverting to original index:', originalIndex);
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  // Safety timeout to prevent stuck flag
  console.log('⏰ [goForward] Setting safety timeout (5 seconds)...');
  const safetyTimeout = setTimeout(() => {
    if (this.isNavigating) {
      console.error('⏱️ [goForward] TIMEOUT: Navigation took too long!');
      console.log('   - Force resetting isNavigating flag');
      console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
      this.currentIndex = originalIndex;
      this.isNavigating = false;
      this.updateNavigationState();
    }
  }, 5000);
  
  console.log('🚀 [goForward] Starting navigation to:', nextUrl);
  console.log('   - Using router.navigateByUrl()');
  
  this.router.navigateByUrl(nextUrl)
    .then((success) => {
      clearTimeout(safetyTimeout);
      console.log('✅ [goForward] Navigation promise resolved');
      console.log('   - Success status:', success);
      
      if (success) {
        console.log('🎉 [goForward] Navigation succeeded!');
        console.log('   - Final index:', this.currentIndex);
        console.log('   - Final URL:', nextUrl);
        
        this.activeRoute$.next(nextUrl);
        this.updateNavigationState();
        this.saveNavigationHistory();
        
        console.log('💾 [goForward] State saved:');
        console.log('   - Can go back:', this.canGoBack$.value);
        console.log('   - Can go forward:', this.canGoForward$.value);
      } else {
        console.warn('⚠️ [goForward] Navigation returned FALSE');
        console.log('   - Possible reasons: Guard rejected, invalid route, or redirect');
        console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
        this.currentIndex = originalIndex;
        this.updateNavigationState();
        console.log('   - Index reverted to:', this.currentIndex);
      }
    })
    .catch((error) => {
      clearTimeout(safetyTimeout);
      console.error('❌ [goForward] Navigation FAILED with error!');
      console.error('   - Error:', error);
      console.error('   - Error message:', error?.message);
      console.error('   - Error stack:', error?.stack);
      console.log('   - Reverting index from', this.currentIndex, 'to', originalIndex);
      
      // Revert to original state
      this.currentIndex = originalIndex;
      this.updateNavigationState();
      
      console.log('   - Index reverted to:', this.currentIndex);
      console.log('   - State restored');
      
      // Optionally notify user
      console.log('💡 [goForward] Consider showing user-friendly error message');
    })
    .finally(() => {
      clearTimeout(safetyTimeout);
      console.log('🔓 [goForward] Resetting isNavigating flag to FALSE');
      this.isNavigating = false;
      console.log('✅ [goForward] Operation complete');
      console.log('═══════════════════════════════════════════════════════');
    });
}

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    return user?.role === 'admin' || user?.role === 'super_admin';
  }

  isActive(route: string): boolean {
    const currentRoute = this.activeRoute$.value;
    if (route === '/') {
      return currentRoute === '/';
    }
    return currentRoute.startsWith(route);
  }

  getAvatarSrc(user: any): string {
    if (user.picture && user.picture.trim() !== '') {
      return user.picture;
    }
    return this.getInitialsAvatar(user.name);
  }

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    img.src = this.getInitialsAvatar(userName);
  }

  private getInitialsAvatar(name: string): string {
    const initials = name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    
    const gradient = ctx.createLinearGradient(0, 0, 80, 80);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 80, 80);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 40, 40);
    
    return canvas.toDataURL();
  }

navigateToHome(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🏠 [navigateToHome] Home navigation requested');
  
  const currentUrl = this.router.url;
  console.log('   - Current URL:', currentUrl);
  console.log('   - Current index:', this.currentIndex);
  console.log('   - History length:', this.navigationHistory.length);
  console.log('   - Full history:', JSON.stringify(this.navigationHistory));
  
  // Check if already on home page
  const isOnHomePage = currentUrl === '/' || currentUrl === '';
  console.log('   - Is on home page:', isOnHomePage);
  
  if (isOnHomePage) {
    console.log('✅ [navigateToHome] Already on home page');
    console.log('   - Triggering smart refresh instead of navigation');
    console.log('   - This prevents adding duplicate home entries to history');
    
    console.log('🧹 [navigateToHome] Clearing navigation history...');
    console.log('   - Reason: Fresh start from home');
    console.log('   - History before clear:', this.navigationHistory.length, 'entries');
    
    this.clearNavigationHistory();
    
    console.log('   - History after clear:', this.navigationHistory.length, 'entries');
    console.log('   - Index after clear:', this.currentIndex);
    
    console.log('🔄 [navigateToHome] Calling smart refresh on templates service...');
    console.log('   - This refreshes only non-cached templates');
    
    try {
      this.svc.smartRefresh();
      console.log('✅ [navigateToHome] Smart refresh triggered successfully');
    } catch (error) {
      console.error('❌ [navigateToHome] Smart refresh failed!');
      console.error('   - Error:', error);
      console.error('   - Error message:', error instanceof Error ? error.message : 'Unknown error');
      console.error('   - Templates may not be updated');
    }
    
    console.log('✅ [navigateToHome] Home refresh complete');
    
  } else {
    console.log('➡️ [navigateToHome] Not on home page - navigating...');
    console.log('   - From:', currentUrl);
    console.log('   - To: /');
    
    console.log('🚀 [navigateToHome] Starting navigation to home...');
    
    // Navigation will be tracked by the router.events subscription in ngOnInit
    // So we don't need to manually update history here
    console.log('   - Note: Navigation will be tracked automatically by router events');
    console.log('   - History will be updated by NavigationEnd handler');
    
    this.router.navigate(['/'])
      .then((success) => {
        console.log('✅ [navigateToHome] Navigation promise resolved');
        console.log('   - Success:', success);
        
        if (success) {
          console.log('🎉 [navigateToHome] Successfully navigated to home!');
          console.log('   - New URL:', this.router.url);
          console.log('   - History will be updated by router event handler');
        } else {
          console.warn('⚠️ [navigateToHome] Navigation returned false');
          console.warn('   - Possible reasons:');
          console.warn('     • Guard rejected navigation');
          console.warn('     • Already on target route');
          console.warn('     • Navigation was redirected');
          console.warn('   - Current URL:', this.router.url);
        }
      })
      .catch((error) => {
        console.error('❌ [navigateToHome] Navigation FAILED!');
        console.error('   - Error:', error);
        console.error('   - Error name:', error instanceof Error ? error.name : 'Unknown');
        console.error('   - Error message:', error instanceof Error ? error.message : 'Unknown error');
        console.error('   - User remains at:', currentUrl);
        
        // Check for specific error types
        if (error instanceof Error) {
          if (error.message.includes('Cannot match any routes')) {
            console.error('   - Route not found error');
            console.error('   - Home route (/) may not be configured in routing');
          } else if (error.message.includes('Navigation')) {
            console.error('   - Navigation-related error');
            console.error('   - Check route guards and resolvers');
          }
        }
        
        console.error('💡 [navigateToHome] Consider showing error message to user');
      });
    
    console.log('   - Navigation request sent to router');
  }
  
  console.log('═══════════════════════════════════════════════════════');
}

  navigateToAdmin(): void {
    this.fetchPendingCount();
    this.adminEventService.triggerNavigationRefresh();
    this.router.navigate(['/admin']);
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  getInitials(name: string): string {
    return name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

logout(): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚪 [logout] Logout initiated');
  console.log('   - Current URL:', this.router.url);
  console.log('   - Current user:', this.authService.currentUserValue?.name || 'Unknown');
  console.log('   - Current history entries:', this.navigationHistory.length);
  
  console.log('🧹 [logout] Step 1: Clearing navigation history...');
  const historyLengthBefore = this.navigationHistory.length;
  
  try {
    this.clearNavigationHistory();
    console.log('✅ [logout] Navigation history cleared');
    console.log('   - Entries cleared:', historyLengthBefore);
    console.log('   - Current history length:', this.navigationHistory.length);
    console.log('   - Current index:', this.currentIndex);
  } catch (error) {
    console.error('❌ [logout] Failed to clear navigation history!');
    console.error('   - Error:', error);
    console.error('   - Continuing with logout anyway...');
  }
  
  console.log('🔐 [logout] Step 2: Calling auth service logout...');
  console.log('   - This will invalidate session/token');
  
  this.authService.logout().subscribe({
    next: () => {
      console.log('✅ [logout] Auth service logout successful');
      console.log('   - Session/token invalidated');
      console.log('   - User logged out on server side');
      
      console.log('🚀 [logout] Step 3: Navigating to auth page...');
      console.log('   - Target route: /auth');
      console.log('   - Current URL:', this.router.url);
      
      this.router.navigate(['/auth'])
        .then((success) => {
          console.log('✅ [logout] Navigation to auth page resolved');
          console.log('   - Success:', success);
          
          if (success) {
            console.log('🎉 [logout] Logout complete!');
            console.log('   - User redirected to: /auth');
            console.log('   - Final URL:', this.router.url);
            console.log('   - Session cleared');
            console.log('   - History cleared');
            console.log('   - Ready for fresh login');
          } else {
            console.warn('⚠️ [logout] Navigation returned false');
            console.warn('   - User logged out but not redirected');
            console.warn('   - Possible reasons:');
            console.warn('     • Guard rejected navigation');
            console.warn('     • Already on /auth route');
            console.warn('     • Navigation was redirected');
            console.warn('   - Current URL:', this.router.url);
            console.warn('   - User is logged out but may need manual redirect');
          }
        })
        .catch((navError) => {
          console.error('❌ [logout] Navigation to auth failed!');
          console.error('   - Error:', navError);
          console.error('   - Error name:', navError instanceof Error ? navError.name : 'Unknown');
          console.error('   - Error message:', navError instanceof Error ? navError.message : 'Unknown error');
          console.error('   - User is logged out but stuck at:', this.router.url);
          
          // Check for specific navigation errors
          if (navError instanceof Error) {
            if (navError.message.includes('Cannot match any routes')) {
              console.error('   - /auth route not found!');
              console.error('   - Check routing configuration');
            }
          }
          
          console.error('💡 [logout] Consider:');
          console.error('   - Showing error message to user');
          console.error('   - Providing manual login link');
          console.error('   - Forcing page reload: window.location.href = "/auth"');
          
          // Optional: Force redirect as fallback
          console.log('🔄 [logout] Attempting force redirect...');
          try {
            window.location.href = '/auth';
            console.log('✅ [logout] Force redirect initiated');
          } catch (redirectError) {
            console.error('❌ [logout] Even force redirect failed!');
            console.error('   - Error:', redirectError);
          }
        });
    },
    error: (error) => {
      console.error('❌ [logout] Auth service logout FAILED!');
      console.error('   - Error:', error);
      console.error('   - Error status:', error?.status);
      console.error('   - Error message:', error?.message || error?.error?.message || 'Unknown error');
      console.error('   - Error details:', error?.error);
      
      // Analyze error type
      if (error?.status === 401) {
        console.error('   - 401 Unauthorized: Session already invalid');
        console.error('   - User may already be logged out on server');
        console.error('   - Proceeding with client-side cleanup...');
        
        // Still navigate to auth page
        console.log('🔄 [logout] Navigating to auth despite logout error...');
        this.router.navigate(['/auth'])
          .then(() => console.log('✅ [logout] Redirected to auth after error'))
          .catch((navError) => {
            console.error('❌ [logout] Navigation also failed:', navError);
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      } 
      else if (error?.status === 0 || error?.status === 504) {
        console.error('   - Network error: Server unreachable');
        console.error('   - User will be logged out client-side only');
        console.error('   - Server session may still be active');
        console.error('   - This could be a security concern');
        
        // Still navigate to auth page
        console.log('🔄 [logout] Navigating to auth despite network error...');
        this.router.navigate(['/auth'])
          .then(() => console.log('✅ [logout] Redirected to auth after network error'))
          .catch((navError) => {
            console.error('❌ [logout] Navigation also failed:', navError);
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else if (error?.status >= 500) {
        console.error('   - Server error:', error.status);
        console.error('   - Backend may be down');
        console.error('   - Performing client-side logout only');
        
        // Still navigate to auth page
        console.log('🔄 [logout] Navigating to auth despite server error...');
        this.router.navigate(['/auth'])
          .then(() => console.log('✅ [logout] Redirected to auth after server error'))
          .catch((navError) => {
            console.error('❌ [logout] Navigation also failed:', navError);
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else {
        console.error('   - Unexpected error during logout');
        console.error('   - Status code:', error?.status || 'Unknown');
        console.error('💡 [logout] Consider showing error to user');
        console.error('   - User state may be inconsistent');
        
        // Try to navigate anyway
        console.log('🔄 [logout] Attempting navigation despite error...');
        this.router.navigate(['/auth'])
          .catch((navError) => {
            console.error('❌ [logout] Navigation failed:', navError);
            window.location.href = '/auth';
          });
      }
      
      console.error('⚠️ [logout] Logout completed with errors');
      console.error('   - Client state cleared');
      console.error('   - Server state uncertain');
    },
    complete: () => {
      console.log('🏁 [logout] Logout observable completed');
      console.log('   - All logout operations finished');
    }
  });
  
  console.log('⏳ [logout] Logout request sent, waiting for response...');
  console.log('═══════════════════════════════════════════════════════');
}

  refresh(): void {
    this.svc.refresh();
  }
}