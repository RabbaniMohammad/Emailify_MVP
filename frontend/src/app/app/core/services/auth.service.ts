import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, catchError, of, firstValueFrom, interval, Subscription, map, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CacheService } from './cache.service';
import { QaService } from '../../features/qa/services/qa.service';
import { DatabaseService } from '../../../core/services/db.service';
import { TemplatesService } from './templates.service';

export interface User {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  orgRole: 'super_admin' | 'admin' | 'member'; // Organization role
  organizationId?: {
    _id: string;
    name: string;
    slug: string;
    isOwner?: boolean; // Owner organization flag
    mailchimpAudienceId?: string; // Organization's Mailchimp audience ID
  }; // Populated organization data
  organizationIsOwner?: boolean; // Flat field for easy access
  createdAt: string;
  lastLogin: string;
  isActive: boolean;
  isApproved: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService implements OnDestroy {
  private http = inject(HttpClient);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private cache = inject(CacheService);
  private qaService = inject(QaService);
  private db = inject(DatabaseService);
  private templatesService = inject(TemplatesService);

  // ==================== State Management ====================
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  // ==================== Internal Flags ====================
  private authCheckComplete = false;
  private tokenRefreshTimer?: any;
  private isRefreshing = false; // ✅ Prevent concurrent refresh attempts
  private activityTimer?: any; // ✅ Track user activity
  private lastActivityTime = Date.now();
  private sessionWarningShown = false;

  constructor() {
    // Don't call checkAuthStatus here - it causes race conditions
    // Will be called by APP_INITIALIZER in app.config.ts
    
    // ✅ Track user activity for smart token refresh
    this.setupActivityTracking();
  }

  ngOnDestroy(): void {
    this.stopStatusMonitoring();
    this.stopActivityTracking();
  }

  // ==================== Activity Tracking ====================
  
  /**
   * Setup activity tracking for smart token refresh
   */
  private setupActivityTracking(): void {
    // Track mouse movement, keyboard, clicks
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    
    const updateActivity = () => {
      this.lastActivityTime = Date.now();
    };
    
    events.forEach(event => {
      document.addEventListener(event, updateActivity, { passive: true });
    });
  }
  
  /**
   * Stop activity tracking
   */
  private stopActivityTracking(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = undefined;
    }
  }
  
  /**
   * Check if user was recently active (within last 5 minutes)
   */
  private isUserActive(): boolean {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return this.lastActivityTime > fiveMinutesAgo;
  }

  // ==================== Status Monitoring ====================
  
  /**
   * Start token refresh monitoring
   * Call this after successful login
   * 
   * ✅ IMPROVED: Smart refresh based on user activity + session warnings
   */
  startStatusMonitoring(): void {
    this.stopStatusMonitoring();
    this.sessionWarningShown = false;

    // ✅ Check every 5 minutes for smart refresh and session warnings
    this.tokenRefreshTimer = setInterval(() => {
      if (!this.isAuthenticatedSubject.value) {
        return;
      }
      
      const now = Date.now();
      const timeSinceActivity = now - this.lastActivityTime;
      const fiftyMinutes = 50 * 60 * 1000;
      const fiftyFiveMinutes = 55 * 60 * 1000;
      
      // ✅ Show warning at 55 minutes (5 min before expiry)
      if (timeSinceActivity >= fiftyFiveMinutes && !this.sessionWarningShown) {
        this.showSessionExpiryWarning();
        this.sessionWarningShown = true;
      }
      
      // ✅ Only refresh if user was active in last 5 minutes
      if (timeSinceActivity >= fiftyMinutes && this.isUserActive()) {
        console.log('🔄 [SMART REFRESH] User active, refreshing token proactively...');
        this.refreshToken().subscribe({
          next: () => {
            console.log('✅ [SMART REFRESH] Token refreshed successfully');
            this.sessionWarningShown = false; // Reset warning flag
          },
          error: (err) => {
            console.error('❌ [SMART REFRESH] Token refresh failed:', err);
            this.handleRefreshFailure(err);
          }
        });
      } else if (timeSinceActivity >= fiftyMinutes) {
        console.log('⚠️ [SMART REFRESH] User inactive for too long, will logout on next action');
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }
  
  /**
   * Show session expiry warning to user
   */
  private showSessionExpiryWarning(): void {
    // Create a subtle toast notification
    const message = '⏰ Your session will expire in 5 minutes. Please save your work.';
    console.warn(message);
    
    // Show snackbar notification
    this.snackBar.open(message, 'Stay Logged In', {
      duration: 15000, // Show for 15 seconds
      panelClass: ['warning-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'top'
    }).onAction().subscribe(() => {
      // User clicked "Stay Logged In" - refresh token immediately
      this.attemptTokenRefresh().subscribe({
        next: () => {
          this.snackBar.open('✅ Session extended successfully', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar']
          });
        },
        error: () => {
          this.snackBar.open('❌ Failed to extend session', 'Close', {
            duration: 3000,
            panelClass: ['error-snackbar']
          });
        }
      });
    });
    
    // Also use browser notification if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Session Expiring Soon', {
        body: 'Your session will expire in 5 minutes. Click anywhere to stay logged in.',
        icon: '/favicon.svg',
        tag: 'session-warning'
      });
    }
  }

  /**
   * Stop all monitoring timers
   */
  stopStatusMonitoring(): void {
    // Removed statusCheckSubscription - no longer needed
    
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }
  }

  // ==================== Authentication Methods ====================

  /**
   * Check authentication status (call before routing)
   */
  async checkAuthStatus(): Promise<boolean> {
    if (this.authCheckComplete) {
      return this.isAuthenticatedSubject.value;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<{ user: User }>('/api/auth/me', { withCredentials: true })
      );
      
      this.currentUserSubject.next(response.user);
      this.isAuthenticatedSubject.next(true);
      this.authCheckComplete = true;
      
      // ✅ Start monitoring after successful auth check
      this.startStatusMonitoring();
      
      return true;
    } catch (error) {
      this.currentUserSubject.next(null);
      this.isAuthenticatedSubject.next(false);
      this.authCheckComplete = true;
      return false;
    }
  }

  /**
   * Get current authenticated user
   */
  getCurrentUser(): Observable<User> {
    return this.http.get<{ user: User }>('/api/auth/me', { withCredentials: true })
      .pipe(
        tap((response: { user: User }) => {
          this.currentUserSubject.next(response.user);
          this.isAuthenticatedSubject.next(true);
        }),
        catchError(() => {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          return of(null as any);
        }),
        map((response: { user: User } | null) => response?.user as User)
      );
  }

  /**
   * Handle successful authentication from OAuth callback
   */
  handleAuthSuccess(user: any): void {
    this.currentUserSubject.next(user);
    this.isAuthenticatedSubject.next(true);
    
    // ✅ Clear old cache on fresh login to get fresh data
    this.db.cleanExpiredData()
      .then(() => {
      })
      .catch((err: any) => {

      });
    
    // ✅ Start monitoring
    this.startStatusMonitoring();
  }

  /**
   * Initiate Google OAuth login (opens popup)
   * @param orgSlug - Optional organization slug for multi-tenancy
   */
  loginWithGoogle(orgSlug?: string): void {
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    // Build URL with org parameter if provided
    const url = orgSlug 
      ? `/api/auth/google?org=${encodeURIComponent(orgSlug)}`
      : '/api/auth/google';

    const popup = window.open(
      url,
      'Google Login',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // ✅ Poll for popup closure
    const pollTimer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollTimer);
        this.authCheckComplete = false;
        this.checkAuthStatus();
      }
    }, 500);
  }

  /**
   * Handle successful OAuth callback
   */
  handleAuthCallback(): void {
    this.authCheckComplete = false;
    this.checkAuthStatus();
  }

  // ==================== Token Management ====================

  /**
   * Refresh access token using refresh token
   * ⚠️ Use attemptTokenRefresh() instead for automatic concurrency handling
   */
  refreshToken(): Observable<any> {
    return this.http.post('/api/auth/refresh', {}, { withCredentials: true }).pipe(
      tap(() => {
        console.log('✅ [TOKEN REFRESH] Access token refreshed');
        this.lastActivityTime = Date.now(); // Reset activity time on successful refresh
      }),
      catchError((error) => {
        console.error('❌ [TOKEN REFRESH] Failed:', error.error?.code || error.message);
        return throwError(() => error);
      })
    );
  }
  
  /**
   * ✅ NEW: Attempt token refresh with concurrency protection
   * This prevents multiple simultaneous refresh attempts
   */
  attemptTokenRefresh(): Observable<any> {
    // If already refreshing, wait for that to complete
    if (this.isRefreshing) {
      console.log('⏳ [TOKEN REFRESH] Already in progress, waiting...');
      return new Observable<any>(observer => {
        // Poll every 100ms to check if refresh completed
        const checkInterval = setInterval(() => {
          if (!this.isRefreshing) {
            clearInterval(checkInterval);
            if (this.isAuthenticatedSubject.value) {
              console.log('✅ [TOKEN REFRESH] Concurrent request resolved successfully');
              observer.next({});
              observer.complete();
            } else {
              console.error('❌ [TOKEN REFRESH] Concurrent request failed');
              observer.error(new Error('Token refresh failed'));
            }
          }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          if (this.isRefreshing) {
            console.error('⏰ [TOKEN REFRESH] Concurrent request timed out');
            observer.error(new Error('Token refresh timeout'));
          }
        }, 10000);
      });
    }
    
    // Mark as refreshing and attempt
    this.isRefreshing = true;
    console.log('🔄 [TOKEN REFRESH] Starting new refresh...');
    
    return this.refreshToken().pipe(
      tap(() => {
        this.isRefreshing = false;
        this.sessionWarningShown = false; // Reset warning on successful refresh
      }),
      catchError((error) => {
        this.isRefreshing = false;
        return throwError(() => error);
      })
    );
  }

  /**
   * Handle refresh token failure with smart error detection
   */
  private handleRefreshFailure(error: any): void {
    const status = error.status;
    const errorMessage = error.error?.error || '';
    const errorCode = error.error?.code || '';

    // ✅ Determine the specific reason for failure
    let redirectError = 'session_expired';

    if (status === 401) {
      switch (errorCode) {
        case 'NO_REFRESH_TOKEN':
          redirectError = 'session_expired';

          break;
        case 'INVALID_REFRESH_TOKEN':
          redirectError = 'session_expired';

          break;
        case 'USER_NOT_FOUND':
          redirectError = 'session_expired';

          break;
        case 'USER_INACTIVE':
          redirectError = 'account_deactivated';

          break;
        case 'USER_NOT_APPROVED':
          redirectError = 'pending_approval';

          break;
        default:
          redirectError = 'session_expired';

      }
    } else if (status === 403) {
      redirectError = 'access_denied';

    } else {
      redirectError = 'authentication_failed';

    }

    // ✅ Force logout and redirect
    this.handleForceLogout(redirectError);
  }

  /**
   * Force logout with specific error reason
   */
  private handleForceLogout(reason: string): void {
    console.log('🚪 [FORCE LOGOUT] Reason:', reason);
    this.stopStatusMonitoring();
    
    this.logout().subscribe({
      next: () => {
        this.router.navigate(['/auth'], {
          queryParams: { error: reason },
          replaceUrl: true
        });
      },
      error: (logoutError) => {
        console.error('❌ [FORCE LOGOUT] Logout API failed, clearing state anyway');
        // Force navigation even if logout fails
        this.clearAuthState();
        this.router.navigate(['/auth'], {
          queryParams: { error: reason },
          replaceUrl: true
        });
      }
    });
  }
  
  /**
   * ✅ NEW: Public method for interceptor to call on auth failures
   * This ensures consistent handling across all auth failure scenarios
   */
  handleAuthFailure(reason: string = 'session_expired'): void {
    console.warn('🚫 [AUTH FAILURE] Handling auth failure:', reason);
    
    // Show user-friendly notification
    this.showAuthFailureMessage(reason);
    
    // Prevent duplicate logout attempts
    if (!this.isAuthenticatedSubject.value) {
      console.log('⚠️ [AUTH FAILURE] Already logged out, just navigating...');
      this.router.navigate(['/auth'], {
        queryParams: { error: reason },
        replaceUrl: true
      });
      return;
    }
    
    this.handleForceLogout(reason);
  }
  
  /**
   * Show user-friendly auth failure messages
   */
  private showAuthFailureMessage(reason: string): void {
    let message = '';
    let duration = 5000;
    
    switch (reason) {
      case 'session_expired':
        message = '⏰ Your session has expired. Please log in again.';
        break;
      case 'account_deactivated':
        message = '🚫 Your account has been deactivated. Please contact your administrator.';
        duration = 8000;
        break;
      case 'pending_approval':
        message = '⏳ Your account is pending approval. Please wait for admin approval.';
        duration = 8000;
        break;
      case 'access_denied':
        message = '🔒 Access denied. Please check your permissions.';
        break;
      case 'authentication_failed':
        message = '❌ Authentication failed. Please log in again.';
        break;
      default:
        message = '⚠️ Authentication error. Please log in again.';
    }
    
    this.snackBar.open(message, 'Close', {
      duration,
      panelClass: ['error-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'top'
    });
  }

  // ==================== Logout ====================

  /**
   * Logout user and clear all state
   */
  logout(): Observable<any> {
    this.stopStatusMonitoring();
    this.qaService.clearAllQaData(); 
    
    return this.http.post('/api/auth/logout', {}, { withCredentials: true }).pipe(
      tap({
        next: () => {
          this.clearAuthState();
        },
        error: (error) => {

          // Clear state even on error
          this.clearAuthState();
        }
      })
    );
  }

  /**
   * Clear all authentication state and caches
   */
  private clearAuthState(): void {
    // Clear auth state
    this.currentUserSubject.next(null);
    this.isAuthenticatedSubject.next(false);
    this.authCheckComplete = false;

    // ✅ Clear all user-specific caches
    // This clears:
    // - All sessionStorage (templates list, search results, selected template)
    // - User-specific localStorage items (template-, templates-, user-, last- prefixes)
    // - Grammar check cache (grammar_)
    // - Memory cache
    // But keeps: General app preferences (theme, language, etc.)
    this.cache.clearUserData(['template-', 'templates-', 'user-', 'last-', 'selected-', 'generate:', 'grammar_', 'return_to_modal_']);

    // ✅ CRITICAL: Also clear legacy keys without prefixes
    try {
      localStorage.removeItem('lastTemplateId');
      localStorage.removeItem('lastTemplateName');
    } catch (error) {

    }

    // ✅ Clear IndexedDB cache (non-blocking)
    this.db.clearAllCache()
      .then(() => {
      })
      .catch((err: any) => {

      });

    // ✅ NEW: Clear TemplatesService in-memory state
    this.templatesService.clearState();
  }

  // ==================== Getters ====================

  /**
   * Get current user value (synchronous)
   */
  get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Check if user is authenticated (synchronous)
   */
  get isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }
}