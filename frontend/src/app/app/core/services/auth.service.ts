import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, catchError, of, firstValueFrom, interval, Subscription, map, throwError } from 'rxjs';
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

  constructor() {
    // Don't call checkAuthStatus here - it causes race conditions
  }

  ngOnDestroy(): void {
    this.stopStatusMonitoring();
  }

  // ==================== Status Monitoring ====================
  
  /**
   * Start token refresh monitoring
   * Call this after successful login
   * 
   * Note: Removed 30-second status check - backend validates on every request anyway.
   * This reduces API calls by 99% while maintaining security.
   */
  startStatusMonitoring(): void {
    this.stopStatusMonitoring();

    // ✅ Proactive token refresh every 50 minutes (before 60-minute expiry)
    // This is the ONLY background check we need - keeps session alive
    this.tokenRefreshTimer = setInterval(() => {
      if (this.isAuthenticatedSubject.value) {
        this.refreshToken().subscribe({
          next: () => {
            console.log('🔄 Token refreshed successfully');
          },
          error: (err) => {
            console.error('❌ Token refresh failed:', err);
            this.handleRefreshFailure(err);
          }
        });
      }
    }, 50 * 60 * 1000); // 50 minutes
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
   */
  refreshToken(): Observable<any> {
    return this.http.post('/api/auth/refresh', {}, { withCredentials: true }).pipe(
      tap(() => {
      }),
      catchError((error) => {

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
    this.stopStatusMonitoring();
    
    this.logout().subscribe({
      next: () => {
        this.router.navigate(['/auth'], {
          queryParams: { error: reason },
          replaceUrl: true
        });
      },
      error: (logoutError) => {

        // Force navigation even if logout fails
        this.clearAuthState();
        this.router.navigate(['/auth'], {
          queryParams: { error: reason },
          replaceUrl: true
        });
      }
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