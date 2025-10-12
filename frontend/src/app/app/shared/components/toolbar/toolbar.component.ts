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
      
      // Check if currentUrl exists elsewhere in history
      const existingIndex = this.navigationHistory.indexOf(currentUrl);
      if (existingIndex !== -1) {
        this.currentIndex = existingIndex;
      } else {
        // Add current page to history
        this.currentIndex++;
        this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex);
        this.navigationHistory.push(currentUrl);
      }
    } else {
    }
  }
  
  this.activeRoute$.next(currentUrl);
  this.updateNavigationState();
  this.saveNavigationHistory();

  // ========================================
  // 🔥 CRITICAL: Listen to browser back/forward buttons
  // ========================================
this.location.subscribe((event) => {
  
  // Only handle if not triggered by our custom navigation
  if (!this.isNavigating) {
    const newUrl = this.router.url;
    
    // Try to find the URL in history
    const foundIndex = this.navigationHistory.indexOf(newUrl);
    
    if (foundIndex !== -1) {

      this.currentIndex = foundIndex;
    } else {
      console.warn('⚠️ [PopState] NOT FOUND - Adding:', newUrl, '| This might indicate the issue!');
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
        this.navigationHistory.push(url);
        this.currentIndex = this.navigationHistory.length - 1;
        
        // Limit history size
        if (this.navigationHistory.length > this.MAX_HISTORY) {
          const removed = this.navigationHistory.shift();
          this.currentIndex--;
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
  if (!this.isAdmin()) {
    return;
  }

  
  timer(0, 30000).pipe(
    startWith(0),
    switchMap(() => {
      return this.adminService.getPendingUsers();
    }),
    map(response => {
      const count = response.users.length;
      return count;
    }),
    takeUntil(this.destroy$)
  ).subscribe({
    next: (count) => {
      this.pendingCount$.next(count);
    },
    error: (err) => {
    }
  });

  
  this.adminEventService.refreshPendingCount
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      this.fetchPendingCount();
    });
  
  this.adminEventService.refresh$
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      this.fetchPendingCount();
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
  
  try {
    const savedHistory = sessionStorage.getItem(this.HISTORY_KEY);
    const savedIndex = sessionStorage.getItem(this.INDEX_KEY);
    
    
    if (!savedHistory || !savedIndex) {
      this.navigationHistory = [];
      this.currentIndex = -1;
      return;
    }
    
    
    // Parse history array
    let parsedHistory: string[];
    try {
      parsedHistory = JSON.parse(savedHistory);
    } catch (parseError) {
      throw new Error('Invalid history JSON format');
    }
    
    // Validate parsed history is an array
    if (!Array.isArray(parsedHistory)) {
      throw new Error('History is not an array');
    }
    
    // Validate array contains only strings
    const invalidEntries = parsedHistory.filter(entry => typeof entry !== 'string');
    if (invalidEntries.length > 0) {
      throw new Error('History contains invalid entries');
    }
    
    // Validate array is not empty
    if (parsedHistory.length === 0) {
      this.navigationHistory = [];
      this.currentIndex = -1;
      return;
    }
    
    
    // Parse index
    const parsedIndex = parseInt(savedIndex, 10);
    
    // Validate index is a valid number
    if (isNaN(parsedIndex)) {
      throw new Error('Invalid index value');
    }
    
    // Validate index is within bounds
    if (parsedIndex < 0) {
      throw new Error('Index is negative');
    }
    
    if (parsedIndex >= parsedHistory.length) {
      throw new Error('Index out of bounds');
    }
    
    
    // Check if MAX_HISTORY limit is exceeded
    if (parsedHistory.length > this.MAX_HISTORY) {
      const startIndex = parsedHistory.length - this.MAX_HISTORY;
      parsedHistory = parsedHistory.slice(startIndex);
      
      // Adjust index
      const adjustedIndex = parsedIndex - startIndex;
      if (adjustedIndex >= 0 && adjustedIndex < parsedHistory.length) {
        this.currentIndex = adjustedIndex;
      } else {
        this.currentIndex = parsedHistory.length - 1;
      }
    } else {
      this.currentIndex = parsedIndex;
    }
    
    // All validations passed - restore the state
    this.navigationHistory = parsedHistory;
    
    
  } catch (error) {
    this.navigationHistory = [];
    this.currentIndex = -1;
    
    try {
      sessionStorage.removeItem(this.HISTORY_KEY);
      sessionStorage.removeItem(this.INDEX_KEY);
    } catch (clearError) {
    }
    
  }
  
}

private saveNavigationHistory(): void {
  
  // Validate state before saving
  if (this.currentIndex < -1) {
    return;
  }
  
  if (this.currentIndex >= this.navigationHistory.length && this.navigationHistory.length > 0) {
    return;
  }
  
  if (!Array.isArray(this.navigationHistory)) {
    return;
  }
  
  try {
    // Prepare data for storage
    const historyJson = JSON.stringify(this.navigationHistory);
    const indexString = String(this.currentIndex);
    
    
    // Estimate storage size
    const estimatedSize = historyJson.length + indexString.length;
    
    // Check if data seems too large (sessionStorage typical limit is 5-10MB)
    if (estimatedSize > 1024 * 1024) { // 1MB warning threshold
      console.warn('⚠️ [saveNavigationHistory] Large data size detected!');
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
    } else {
      console.warn('⚠️ [saveNavigationHistory] Verification mismatch!');
      console.warn('   - History match:', verifyHistory === historyJson);
      console.warn('   - Index match:', verifyIndex === indexString);
    }
    
    
  } catch (error) {
    
    // Check for specific error types
    if (error instanceof Error) {
      // Quota exceeded error
      if (error.name === 'QuotaExceededError' || 
          error.message.includes('quota') || 
          error.message.includes('storage')) {
        console.warn('💾 [saveNavigationHistory] SessionStorage QUOTA EXCEEDED!');
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
          } catch (retryError) {
            console.warn('❌ [saveNavigationHistory] Failed to save even trimmed history');
          }
        } else {
          console.warn('   - History already minimal (≤10 entries), cannot trim further');
          console.warn('   - SessionStorage may be full from other data');
        }
      }
      // Security/Permission error
      else if (error.name === 'SecurityError' || error.name === 'InvalidAccessError') {
        console.warn('🔒 [saveNavigationHistory] SessionStorage ACCESS DENIED!');
        console.warn('   - Possible reasons:');
        console.warn('     • Browser in private/incognito mode with strict settings');
        console.warn('     • SessionStorage disabled by browser settings');
        console.warn('     • Third-party cookies/storage blocked');
        console.warn('     • Browser security policy preventing access');
        console.warn('   - Navigation will work but won\'t persist across refreshes');
      }
      // Other errors
      else {
        console.warn('❓ [saveNavigationHistory] Unknown error type');
        console.warn('   - Consider implementing fallback storage mechanism');
      }
    }
    
    console.warn('⚠️ [saveNavigationHistory] Navigation will continue to work in-memory');
    console.warn('   - History will be lost on page refresh');
    console.warn('   - Consider alternative storage if this persists');
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

  private fetchPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => this.pendingCount$.next(response.users.length),
        error: (err) => {}
      });
  }

  canGoBack(): boolean {
    return this.canGoBack$.value;
  }

  canGoForward(): boolean {
    return this.canGoForward$.value;
  }

goBack(): void {
  console.log('🔙 [goBack] Index:', this.currentIndex, '| History:', this.navigationHistory, '| canGoBack:', this.canGoBack$.value);
  
  if (!this.canGoBack()) {
    console.warn('⚠️ [goBack] Cannot go back - at first entry');
    return;
  }
  
  const originalIndex = this.currentIndex;
  const originalUrl = this.router.url;
  
  console.log('🔒 [goBack] Setting isNavigating=TRUE | Original:', originalIndex);
  this.isNavigating = true;
  
  this.currentIndex--;
  const previousUrl = this.navigationHistory[this.currentIndex];
  
  console.log('🎯 [goBack] Target:', previousUrl, '| New index:', this.currentIndex);
  
  // Safety checks
  if (this.currentIndex < 0 || !previousUrl) {
    console.error('❌ [goBack] Invalid state! Reverting');
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  const safetyTimeout = setTimeout(() => {
    if (this.isNavigating) {
      console.error('⏱️ [goBack] TIMEOUT - force reset');
      this.currentIndex = originalIndex;
      this.isNavigating = false;
      this.updateNavigationState();
    }
  }, 5000);
  
  this.router.navigateByUrl(previousUrl)
    .then((success) => {
      clearTimeout(safetyTimeout);
      console.log(success ? '✅' : '⚠️', '[goBack] Result:', success, '| Index:', this.currentIndex);
      
      if (success) {
        this.activeRoute$.next(previousUrl);
        this.updateNavigationState();
        this.saveNavigationHistory();
      } else {
        console.warn('⚠️ [goBack] Navigation blocked - reverting');
        this.currentIndex = originalIndex;
        this.updateNavigationState();
      }
    })
    .catch((error) => {
      clearTimeout(safetyTimeout);
      console.error('❌ [goBack] FAILED:', error?.message);
      this.currentIndex = originalIndex;
      this.updateNavigationState();
    })
    .finally(() => {
      clearTimeout(safetyTimeout);
      console.log('🔓 [goBack] isNavigating=FALSE | Final index:', this.currentIndex);
      this.isNavigating = false;
    });
}

goForward(): void {
  console.log('➡️ [goForward] Index:', this.currentIndex, '→', this.currentIndex + 1, '| History length:', this.navigationHistory.length);
  
  if (!this.canGoForward()) {
    console.warn('⚠️ [goForward] Cannot go forward - already at last entry');
    return;
  }
  
  const originalIndex = this.currentIndex;
  const originalUrl = this.router.url;

  this.isNavigating = true;
  this.currentIndex++;
  const nextUrl = this.navigationHistory[this.currentIndex];
  
  // Safety checks
  if (this.currentIndex >= this.navigationHistory.length || !nextUrl) {
    console.error('❌ [goForward] Invalid state - reverting');
    this.currentIndex = originalIndex;
    this.isNavigating = false;
    return;
  }
  
  const safetyTimeout = setTimeout(() => {
    if (this.isNavigating) {
      console.error('⏱️ [goForward] TIMEOUT');
      this.currentIndex = originalIndex;
      this.isNavigating = false;
      this.updateNavigationState();
    }
  }, 5000);
  
  this.router.navigateByUrl(nextUrl)
    .then((success) => {
      clearTimeout(safetyTimeout);
      
      if (success) {
        this.activeRoute$.next(nextUrl);
        this.updateNavigationState();
        this.saveNavigationHistory();
      } else {
        console.warn('⚠️ [goForward] Navigation blocked - reverting');
        this.currentIndex = originalIndex;
        this.updateNavigationState();
      }
    })
    .catch((error) => {
      clearTimeout(safetyTimeout);
      console.error('❌ [goForward] Failed:', error?.message);
      this.currentIndex = originalIndex;
      this.updateNavigationState();
    })
    .finally(() => {
      clearTimeout(safetyTimeout);
      this.isNavigating = false;
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
    this.fetchPendingCount();
    this.adminEventService.triggerNavigationRefresh();
    this.router.navigate(['/admin']);
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
