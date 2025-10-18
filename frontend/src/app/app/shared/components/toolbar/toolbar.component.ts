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
import { TemplateGenerationService } from '../../../core/services/template-generation.service';
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
  private generationService = inject(TemplateGenerationService);

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
  console.log('🚀 [ngOnInit] ========== COMPONENT INITIALIZATION ==========');
  console.log('🚀 [ngOnInit] Current URL:', this.router.url);
  
  // ✅ RESTORE navigation history from sessionStorage
  this.restoreNavigationHistory();
  
  const currentUrl = this.router.url;
  
  // If history is empty (first load), initialize it
  if (this.navigationHistory.length === 0) {
    this.navigationHistory = [currentUrl];
    this.currentIndex = 0;
  } else {
    
    // Check if current URL matches the stored index
    if (this.navigationHistory[this.currentIndex] !== currentUrl) {
      console.warn('⚠️ [ngOnInit] URL mismatch detected!');
      console.warn('   Expected:', this.navigationHistory[this.currentIndex]);
      console.warn('   Actual:', currentUrl);
      
      // ✅ FIX: Check if this is a temporary redirect during page load
      const isCommonRoute = currentUrl === '/' || currentUrl === '/auth' || currentUrl === '';
      const savedRoute = this.navigationHistory[this.currentIndex];
      const isComplexRoute = savedRoute && savedRoute.length > 5; // Complex routes are longer
      
      if (isCommonRoute && isComplexRoute) {
        // This is likely a temporary redirect during refresh - TRUST the saved index
        console.log('🔄 [ngOnInit] Temporary redirect detected - keeping saved index');
        console.log('   Saved route:', savedRoute);
        console.log('   Current route:', currentUrl);
        console.log('   ✅ Trusting saved history, waiting for final navigation...');
        // Don't change currentIndex - keep it as restored from sessionStorage
      } else {
        // Normal navigation - search for the URL
        const existingIndex = this.navigationHistory.lastIndexOf(currentUrl);
        if (existingIndex !== -1) {
          console.log('✅ [ngOnInit] Found URL at index', existingIndex, '- restoring position');
          this.currentIndex = existingIndex;
        } else {
          console.log('🆕 [ngOnInit] URL not in history - adding new entry');
          // Add current page to history
          this.currentIndex++;
          this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex);
          this.navigationHistory.push(currentUrl);
        }
      }
    } else {
      console.log('✅ [ngOnInit] URL matches stored index - no adjustment needed');
    }
  }
  
  this.activeRoute$.next(currentUrl);
  this.updateNavigationState();
  this.saveNavigationHistory();

  console.log('🚀 [ngOnInit] Final State After Initialization:');
  console.log('   📚 History:', JSON.stringify(this.navigationHistory));
  console.log('   📌 Index:', this.currentIndex);
  console.log('   📍 Current URL:', currentUrl);
  console.log('   ⬅️  Can Go Back:', this.canGoBack$.value);
  console.log('   ➡️  Can Go Forward:', this.canGoForward$.value);
  console.log('🚀 [ngOnInit] ========== INITIALIZATION COMPLETE ==========\n');
  
  // ========================================
  // 🔥 CRITICAL: Listen to browser back/forward buttons
  // ========================================
  this.location.subscribe((event) => {
    console.log('🔙 [PopState] Browser back/forward detected');
    
    // Only handle if not triggered by our custom navigation
    if (!this.isNavigating) {
      const newUrl = this.router.url;
      console.log('📍 [PopState] New URL:', newUrl);
      
      // ✅ FIX: Find the LAST occurrence (most recent visit)
      const foundIndex = this.navigationHistory.lastIndexOf(newUrl);
      
      if (foundIndex !== -1) {
        console.log('✅ [PopState] Found URL at index', foundIndex, '- updating position');
        this.currentIndex = foundIndex;
      } else {
        console.warn('⚠️ [PopState] URL not found in history - adding:', newUrl);
        this.navigationHistory.push(newUrl);
        this.currentIndex = this.navigationHistory.length - 1;
        
        // Enforce max history
        if (this.navigationHistory.length > this.MAX_HISTORY) {
          this.navigationHistory.shift();
          this.currentIndex--;
        }
      }
      
      this.activeRoute$.next(newUrl);
      this.updateNavigationState();
      this.saveNavigationHistory();
      
      console.log('📊 [PopState] Updated - Index:', this.currentIndex, '| History length:', this.navigationHistory.length);
    } else {
      console.log('⏭️ [PopState] Skipped - triggered by custom navigation');
    }
  });

  // ========================================
  // Track Angular Router Navigation Events
  // ========================================
  this.router.events.pipe(
    filter(event => 
      event instanceof NavigationEnd || 
      event instanceof NavigationCancel || 
      event instanceof NavigationError
    ),
    takeUntil(this.destroy$)
  ).subscribe((event: any) => {
    
    if (event instanceof NavigationEnd) {
      const url = event.urlAfterRedirects;
      
      // Only track if not from our custom navigation
      if (!this.isNavigating) {
        
        this.activeRoute$.next(url);
        
        // Remove forward history when user navigates normally
        if (this.currentIndex < this.navigationHistory.length - 1) {
          const removed = this.navigationHistory.slice(this.currentIndex + 1);
          this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex + 1);
        }
        
        // Don't add duplicate consecutive entries
        const lastUrl = this.navigationHistory[this.currentIndex];
        
        if (lastUrl !== url) {
          // Check if this is a child route of the last URL (e.g., /generate -> /generate/:id)
          // If so, replace the last entry instead of adding a new one
          const isChildRoute = lastUrl && url.startsWith(lastUrl + '/');
          
          if (isChildRoute) {
            // Replace the last entry (mimics replaceUrl behavior)
            this.navigationHistory[this.currentIndex] = url;
            console.log('🔄 Replaced history entry:', lastUrl, '→', url);
          } else {
            // Add new entry as normal
            this.navigationHistory.push(url);
            this.currentIndex = this.navigationHistory.length - 1;
            
            // Limit history size
            if (this.navigationHistory.length > this.MAX_HISTORY) {
              const removed = this.navigationHistory.shift();
              this.currentIndex--;
            }
          }
        } 
        
        this.updateNavigationState();
        this.saveNavigationHistory();
        
      } 
    } 
    else if (event instanceof NavigationCancel) {
      console.warn('🚫 [NavigationCancel] URL:', event.url, '| Reason:', event.reason);
      if (this.isNavigating) {
        this.isNavigating = false;
      }
    } 
    else if (event instanceof NavigationError) {
      if (this.isNavigating) {
        this.isNavigating = false;
      }
    }
  });

  // ========================================
  // Admin pending count polling
  // ========================================
  // Load pending count immediately if user is available
  this.currentUser$.pipe(
    filter(user => !!user && (user.role === 'admin' || user.role === 'super_admin')),
    takeUntil(this.destroy$)
  ).subscribe(() => {
    // Initial load
    this.loadPendingCount();
    
    // Poll every 30 seconds
    timer(30000, 30000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadPendingCount();
    });
  });

  // Listen to refresh events
  this.adminEventService.refreshPendingCount
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      if (this.isAdmin()) {
        this.loadPendingCount();
      }
    });
  
  this.adminEventService.refresh$
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      if (this.isAdmin()) {
        this.loadPendingCount();
      }
    });
}

  private loadPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.pendingCount$.next(response.users.length);
          console.log('📊 Toolbar: Pending count updated:', response.users.length);
        },
        error: (err) => {
          console.error('❌ Toolbar: Failed to load pending count:', err);
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pendingCount$.complete();
    this.canGoBack$.complete();
    this.canGoForward$.complete();
  }
private restoreNavigationHistory(): void {
  console.log('📂 [RESTORE] ========== RESTORING NAVIGATION HISTORY ==========');
  
  try {
    const savedHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const savedIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    console.log('📂 [RESTORE] Raw data from sessionStorage:');
    console.log('   📦 History exists:', !!savedHistory);
    console.log('   📦 Index exists:', !!savedIndex);
    
    if (!savedHistory || !savedIndex) {
      console.log('⚠️ [RESTORE] No saved data found - starting fresh');
      console.log('📂 [RESTORE] ========== RESTORE COMPLETE (EMPTY) ==========\n');
      this.navigationHistory = [];
      this.currentIndex = -1;
      return;
    }
    
    console.log('📂 [RESTORE] Found saved data:');
    console.log('   📚 History JSON:', savedHistory);
    console.log('   📌 Index string:', savedIndex);
    
    // Parse history array
    let parsedHistory: string[];
    try {
      parsedHistory = JSON.parse(savedHistory);
      console.log('✅ [RESTORE] Successfully parsed history JSON');
    } catch (parseError) {
      console.error('❌ [RESTORE] Invalid history JSON format:', parseError);
      throw new Error('Invalid history JSON format');
    }
    
    // Validate parsed history is an array
    if (!Array.isArray(parsedHistory)) {
      console.error('❌ [RESTORE] History is not an array:', typeof parsedHistory);
      throw new Error('History is not an array');
    }
    
    // Validate array contains only strings
    const invalidEntries = parsedHistory.filter(entry => typeof entry !== 'string');
    if (invalidEntries.length > 0) {
      console.error('❌ [RESTORE] History contains invalid entries:', invalidEntries);
      throw new Error('History contains invalid entries');
    }
    
    // Validate array is not empty
    if (parsedHistory.length === 0) {
      console.log('⚠️ [RESTORE] History is empty - starting fresh');
      console.log('📂 [RESTORE] ========== RESTORE COMPLETE (EMPTY) ==========\n');
      this.navigationHistory = [];
      this.currentIndex = -1;
      return;
    }
    
    console.log('✅ [RESTORE] History validation passed');
    console.log('   📊 History length:', parsedHistory.length);
    console.log('   📚 History entries:', parsedHistory);
    
    // Parse index
    const parsedIndex = parseInt(savedIndex, 10);
    
    // Validate index is a valid number
    if (isNaN(parsedIndex)) {
      console.error('❌ [RESTORE] Invalid index value:', savedIndex);
      throw new Error('Invalid index value');
    }
    
    // Validate index is within bounds
    if (parsedIndex < 0) {
      console.error('❌ [RESTORE] Index is negative:', parsedIndex);
      throw new Error('Index is negative');
    }
    
    if (parsedIndex >= parsedHistory.length) {
      console.error('❌ [RESTORE] Index out of bounds:', parsedIndex, '>=', parsedHistory.length);
      throw new Error('Index out of bounds');
    }
    
    console.log('✅ [RESTORE] Index validation passed:', parsedIndex);
    
    // Check if MAX_HISTORY limit is exceeded
    if (parsedHistory.length > this.MAX_HISTORY) {
      console.warn('⚠️ [RESTORE] History exceeds MAX_HISTORY limit');
      console.warn('   - Current length:', parsedHistory.length);
      console.warn('   - Max allowed:', this.MAX_HISTORY);
      console.warn('   - Trimming...');
      
      const startIndex = parsedHistory.length - this.MAX_HISTORY;
      parsedHistory = parsedHistory.slice(startIndex);
      
      // Adjust index
      const adjustedIndex = parsedIndex - startIndex;
      if (adjustedIndex >= 0 && adjustedIndex < parsedHistory.length) {
        this.currentIndex = adjustedIndex;
        console.log('✅ [RESTORE] Adjusted index:', adjustedIndex);
      } else {
        this.currentIndex = parsedHistory.length - 1;
        console.log('⚠️ [RESTORE] Index adjustment out of bounds - using last entry');
      }
    } else {
      this.currentIndex = parsedIndex;
    }
    
    // All validations passed - restore the state
    this.navigationHistory = parsedHistory;
    
    console.log('✅ [RESTORE] Successfully restored navigation history');
    console.log('📂 [RESTORE] Restored State:');
    console.log('   📚 History:', JSON.stringify(this.navigationHistory));
    console.log('   📌 Index:', this.currentIndex);
    console.log('   📍 URL at index:', this.navigationHistory[this.currentIndex]);
    console.log('📂 [RESTORE] ========== RESTORE COMPLETE ==========\n');
    
  } catch (error) {
    console.error('❌ [RESTORE] Restore failed:', error);
    console.log('📂 [RESTORE] Falling back to empty history');
    
    this.navigationHistory = [];
    this.currentIndex = -1;
    
    try {
      sessionStorage.removeItem(this.HISTORY_KEY);
      sessionStorage.removeItem(this.INDEX_KEY);
      console.log('🧹 [RESTORE] Cleaned up corrupted sessionStorage');
    } catch (clearError) {
      console.error('❌ [RESTORE] Failed to clean sessionStorage:', clearError);
    }
    
    console.log('📂 [RESTORE] ========== RESTORE COMPLETE (FAILED) ==========\n');
  }
}

private saveNavigationHistory(): void {
  console.log('💾 [SAVE] ========== SAVING NAVIGATION HISTORY ==========');
  console.log('💾 [SAVE] Current State BEFORE Save:');
  console.log('   📚 History:', JSON.stringify(this.navigationHistory));
  console.log('   📌 Index:', this.currentIndex);
  console.log('   📍 Current URL:', this.router.url);
  console.log('   ⬅️  Can Go Back:', this.canGoBack$.value);
  console.log('   ➡️  Can Go Forward:', this.canGoForward$.value);
  
  // Validate state before saving
  if (this.currentIndex < -1) {
    console.error('❌ [SAVE] Invalid index (< -1):', this.currentIndex);
    return;
  }
  
  if (this.currentIndex >= this.navigationHistory.length && this.navigationHistory.length > 0) {
    console.error('❌ [SAVE] Index out of bounds:', this.currentIndex, '>=', this.navigationHistory.length);
    return;
  }
  
  if (!Array.isArray(this.navigationHistory)) {
    console.error('❌ [SAVE] History is not an array!');
    return;
  }
  
  try {
    // Prepare data for storage
    const historyJson = JSON.stringify(this.navigationHistory);
    const indexString = String(this.currentIndex);
    
    console.log('💾 [SAVE] Data to be saved:');
    console.log('   📦 History JSON length:', historyJson.length, 'characters');
    console.log('   📦 Index string:', indexString);
    
    // Estimate storage size
    const estimatedSize = historyJson.length + indexString.length;
    
    // Check if data seems too large (sessionStorage typical limit is 5-10MB)
    if (estimatedSize > 1024 * 1024) { // 1MB warning threshold
      console.warn('⚠️ [SAVE] Large data size detected!');
      console.warn('   - Size:', (estimatedSize / 1024 / 1024).toFixed(2), 'MB');
      console.warn('   - This may cause issues with sessionStorage limits');
    }
    
    // Save history
    sessionStorage.setItem(this.HISTORY_KEY, historyJson);
    
    // Save index
    sessionStorage.setItem(this.INDEX_KEY, indexString);
    
    // Verify save by reading back
    const verifyHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const verifyIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    if (verifyHistory === historyJson && verifyIndex === indexString) {
      console.log('✅ [SAVE] Successfully saved to sessionStorage');
      console.log('✅ [SAVE] Verification passed');
    } else {
      console.warn('⚠️ [SAVE] Verification mismatch!');
      console.warn('   - History match:', verifyHistory === historyJson);
      console.warn('   - Index match:', verifyIndex === indexString);
    }
    
    console.log('💾 [SAVE] ========== SAVE COMPLETE ==========\n');
    
  } catch (error) {
    console.error('❌ [SAVE] Failed to save:', error);
    
    // Check for specific error types
    if (error instanceof Error) {
      // Quota exceeded error
      if (error.name === 'QuotaExceededError' || 
          error.message.includes('quota') || 
          error.message.includes('storage')) {
        console.warn('💾 [SAVE] SessionStorage QUOTA EXCEEDED!');
        console.warn('   - History length:', this.navigationHistory.length);
        console.warn('   - Attempting to reduce history size...');
        
        // Try to trim history and save again
        if (this.navigationHistory.length > 10) {
          const trimAmount = this.navigationHistory.length - 10;
          this.navigationHistory = this.navigationHistory.slice(trimAmount);
          this.currentIndex = Math.max(0, this.currentIndex - trimAmount);
          
          // Try saving trimmed version
          try {
            sessionStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.navigationHistory));
            sessionStorage.setItem(this.INDEX_KEY, String(this.currentIndex));
            console.log('✅ [SAVE] Successfully saved trimmed history');
          } catch (retryError) {
            console.warn('❌ [SAVE] Failed to save even trimmed history');
          }
        }
      }
      // Security/Permission error
      else if (error.name === 'SecurityError' || error.name === 'InvalidAccessError') {
        console.warn('🔒 [SAVE] SessionStorage ACCESS DENIED!');
        console.warn('   - Possible reasons:');
        console.warn('     • Browser in private/incognito mode with strict settings');
        console.warn('     • SessionStorage disabled by browser settings');
      }
    }
    
    console.log('💾 [SAVE] ========== SAVE FAILED ==========\n');
  }
}
private clearNavigationHistory(): void {
  console.log('🧹 [clearNavigationHistory] Clearing | Had', this.navigationHistory.length, 'entries at index', this.currentIndex);
  
  try {
    // Clear sessionStorage
    sessionStorage.removeItem(this.HISTORY_KEY);
    sessionStorage.removeItem(this.INDEX_KEY);
    
    // Clear in-memory state
    this.navigationHistory = [];
    this.currentIndex = -1;
    
    // Update navigation button states
    this.updateNavigationState();
    
    // Validate final state
    if (this.navigationHistory.length !== 0 || this.currentIndex !== -1 || 
        this.canGoBack$.value || this.canGoForward$.value) {
      console.error('❌ [clearNavigationHistory] Clear INCOMPLETE!', {
        historyLength: this.navigationHistory.length,
        index: this.currentIndex,
        canGoBack: this.canGoBack$.value,
        canGoForward: this.canGoForward$.value
      });
    }
    
  } catch (error) {
    console.error('❌ [clearNavigationHistory] Failed:', error);
    
    // Force clear in-memory state
    try {
      this.navigationHistory = [];
      this.currentIndex = -1;
      this.updateNavigationState();
    } catch (memoryError) {
      console.error('❌ [clearNavigationHistory] Memory clear also failed!');
    }
  }
}

private updateNavigationState(): void {
  
  // Store previous values for comparison
  const previousCanGoBack = this.canGoBack$.value;
  const previousCanGoForward = this.canGoForward$.value;
  
  // Validate state before calculation
  if (!Array.isArray(this.navigationHistory)) {
    this.canGoBack$.next(false);
    this.canGoForward$.next(false);
    return;
  }
  
  if (typeof this.currentIndex !== 'number' || isNaN(this.currentIndex)) {
    this.canGoBack$.next(false);
    this.canGoForward$.next(false);
    return;
  }
  
  // Calculate new states
  const canGoBack = this.currentIndex > 0;
  const canGoForward = this.currentIndex < this.navigationHistory.length - 1;
  
  // Validate calculated states
  if (this.currentIndex < 0 && canGoBack) {
    // should never happen
  }
  
  if (this.currentIndex >= this.navigationHistory.length && canGoForward) {
    // should never happen
  }
  
  if (this.navigationHistory.length === 0) {
    if (canGoBack || canGoForward) {
      // logic inconsistency guard
    }
  }
  
  if (this.navigationHistory.length === 1) {
    if (canGoBack || canGoForward) {
      console.warn('⚠️ [updateNavigationState] Warning: single entry but navigation enabled');
    }
  }
  
  // Update the observables
  this.canGoBack$.next(canGoBack);
  this.canGoForward$.next(canGoForward);
  
  // Log state changes
  if (previousCanGoBack !== canGoBack) {
    // changed
  }
  
  if (previousCanGoForward !== canGoForward) {
    // changed
  }
  
  if (previousCanGoBack === canGoBack && previousCanGoForward === canGoForward) {
    // unchanged
  }
  
  // Display current position in history
  if (this.navigationHistory.length > 0) {
    // info display removed
  }
  
}

  canGoBack(): boolean {
    // Always allow back button - browser will handle if there's no history
    return true;
  }

  canGoForward(): boolean {
    // Always allow forward button - browser will handle if there's no history
    return true;
  }

goBack(): void {
  // Use browser's native back - this always works correctly!
  this.location.back();
}

goForward(): void {
  // Use browser's native forward
  this.location.forward();
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

  private imageRetryCount = new Map<string, number>();
  private readonly MAX_RETRIES = 2;

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    const originalSrc = img.src;
    
    // Get or initialize retry count for this image
    const retryCount = this.imageRetryCount.get(originalSrc) || 0;
    
    console.log(`📸 Image load failed for ${userName}:`, originalSrc, `(attempt ${retryCount + 1}/${this.MAX_RETRIES + 1})`);
    
    // Try to reload the image up to MAX_RETRIES times
    if (retryCount < this.MAX_RETRIES) {
      this.imageRetryCount.set(originalSrc, retryCount + 1);
      
      // Add a cache-busting parameter and retry after a short delay
      setTimeout(() => {
        const timestamp = new Date().getTime();
        const separator = originalSrc.includes('?') ? '&' : '?';
        img.src = `${originalSrc}${separator}_retry=${timestamp}`;
        console.log(`🔄 Retrying image load... (attempt ${retryCount + 2})`);
      }, 500 * (retryCount + 1)); // Exponential backoff: 500ms, 1000ms
      
    } else {
      // After max retries, fall back to initials avatar
      console.log(`❌ Max retries reached. Falling back to initials for ${userName}`);
      this.imageRetryCount.delete(originalSrc);
      img.src = this.getInitialsAvatar(userName);
    }
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
  const currentUrl = this.router.url;
  console.log('🏠 [navigateToHome] Current:', currentUrl, '| isHome:', currentUrl === '/' || currentUrl === '');
  
  const isOnHomePage = currentUrl === '/' || currentUrl === '';
  
  if (isOnHomePage) {
    console.log('🔄 [navigateToHome] Already on home - refreshing WITHOUT clearing history');
    
    // ✅ FIX: DON'T clear history, just refresh templates
    try {
      this.svc.smartRefresh();
    } catch (error) {
      console.error('❌ [navigateToHome] smartRefresh failed:', error);
    }
  } else {
    console.log('➡️ [navigateToHome] Navigating to home from:', currentUrl);
    
    this.router.navigate(['/'])
      .then((success) => {
        if (!success) {
          console.warn('⚠️ [navigateToHome] Navigation blocked');
        }
      })
      .catch((error) => {
        console.error('❌ [navigateToHome] Navigation failed:', error?.message);
      });
  }
}

  navigateToAdmin(): void {
    this.loadPendingCount();
    this.adminEventService.triggerNavigationRefresh();
    this.router.navigate(['/admin']);
  }

  navigateToGenerate(): void {
    // Smart navigation: check if user has an active conversation
    const activeConversationId = this.generationService.getCurrentConversationId();
    
    if (activeConversationId) {
      console.log('📍 Navigating to active conversation:', activeConversationId);
      this.router.navigate(['/generate', activeConversationId]);
    } else {
      console.log('📍 Navigating to fresh generate page');
      this.router.navigate(['/generate']);
    }
  }

navigateTo(route: string): void {
  
  this.router.navigate([route])
    .then((success) => {
      if (!success) {
        console.warn('⚠️ [navigateTo] Navigation returned FALSE - might be blocked or already there');
      }
    })
    .catch((error) => {
      console.warn('❌ [navigateTo] Navigation FAILED!');
    });
  
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
  
  const historyLengthBefore = this.navigationHistory.length;
  
  try {
    this.clearNavigationHistory();
  } catch (error) {
  }
  
  
  this.authService.logout().subscribe({
    next: () => {
      
      
      this.router.navigate(['/auth'])
        .then((success) => {
          
          if (success) {
          } else {
          }
        })
        .catch((navError) => {
          
          // Check for specific navigation errors
          if (navError instanceof Error) {
            if (navError.message.includes('Cannot match any routes')) {
              console.warn('   - /auth route not found!');
              console.warn('   - Check routing configuration');
            }
          }
          
          console.warn('💡 [logout] Consider:');
          console.warn('   - Showing error message to user');
          console.warn('   - Providing manual login link');
          
          // Optional: Force redirect as fallback
          try {
            window.location.href = '/auth';
          } catch (redirectError) {
          }
        });
    },
    error: (error) => {
      
      // Analyze error type
      if (error?.status === 401) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      } 
      else if (error?.status === 0 || error?.status === 504) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else if (error?.status >= 500) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else {
        
        // Try to navigate anyway
        this.router.navigate(['/auth'])
          .catch((navError) => {
            window.location.href = '/auth';
          });
      }
      
    },
    complete: () => {
    }
  });
  
}

  refresh(): void {
    this.svc.refresh();
  }
}
