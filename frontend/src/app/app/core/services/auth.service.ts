import { Injectable, inject, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, catchError, of, firstValueFrom, map, interval, Subscription } from 'rxjs';

export interface User {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  role: 'super_admin' | 'admin' | 'user';  
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

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  private authCheckComplete = false;
  private statusCheckSubscription?: Subscription;

  constructor() {
    // Don't call checkAuthStatus here - it causes race conditions
  }

  ngOnDestroy(): void {
    this.stopStatusMonitoring();
  }

  /**
   * Start monitoring user status (call after successful login)
   */
  startStatusMonitoring(): void {
    // Stop any existing monitoring
    this.stopStatusMonitoring();

    // Check status every 30 seconds
    this.statusCheckSubscription = interval(30000).subscribe(() => {
      if (this.isAuthenticatedSubject.value) {
        this.checkUserStatus();
      }
    });
  }

  /**
   * Stop monitoring user status
   */
  stopStatusMonitoring(): void {
    if (this.statusCheckSubscription) {
      this.statusCheckSubscription.unsubscribe();
      this.statusCheckSubscription = undefined;
    }
  }

  /**
   * Check if current user is still active and approved
   */
  private checkUserStatus(): void {
    this.http.get<{ user: User }>('/api/auth/me', { withCredentials: true })
      .subscribe({
        next: (response) => {
          const user = response.user;
          
          // Check if user is deactivated or not approved
          if (!user.isActive || !user.isApproved) {
            console.warn('User account status changed - logging out');
            this.logout().subscribe({
              next: () => {
                this.router.navigate(['/auth'], {
                  queryParams: {
                    error: !user.isActive ? 'account_deactivated' : 'pending_approval'
                  },
                  replaceUrl: true
                });
              }
            });
          } else {
            // Update user data
            this.currentUserSubject.next(user);
          }
        },
        error: (error) => {
          // If 401 or 403, user session is invalid
          if (error.status === 401 || error.status === 403) {
            this.logout().subscribe({
              next: () => {
                this.router.navigate(['/auth'], {
                  queryParams: { error: 'session_expired' },
                  replaceUrl: true
                });
              }
            });
          }
        }
      });
  }

  /**
   * Check authentication status (call this before routing)
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
      
      // Start monitoring after successful auth
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
        tap(response => {
          this.currentUserSubject.next(response.user);
          this.isAuthenticatedSubject.next(true);
        }),
        catchError(() => {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          return of(null as any);
        }),
        map(response => response?.user)
      );
  }

  handleAuthSuccess(user: any): void {
    // Update the current user
    this.currentUserSubject.next(user);
    this.isAuthenticatedSubject.next(true);
    
    // Start monitoring
    this.startStatusMonitoring();
    
    // Store user in localStorage (if not already done)
    try {
      localStorage.setItem('user', JSON.stringify(user));
    } catch (error) {
      console.error('Failed to store user in localStorage', error);
    }
  }

  /**
   * Initiate Google OAuth login (opens popup)
   */
  loginWithGoogle(): void {
    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      '/api/auth/google',
      'Google Login',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    const pollTimer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollTimer);
        this.authCheckComplete = false;
        this.checkAuthStatus();
      }
    }, 500);
  }

  /**
   * Refresh access token
   */
  refreshToken(): Observable<any> {
    return this.http.post('/api/auth/refresh', {}, { withCredentials: true });
  }

  /**
   * Logout user
   */
  logout(): Observable<any> {
    // Stop monitoring
    this.stopStatusMonitoring();
    
    return this.http.post('/api/auth/logout', {}, { withCredentials: true }).pipe(
      tap({
        next: () => {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          this.authCheckComplete = false;
          localStorage.removeItem('user');
        },
        error: (error) => {
          console.error('Logout error:', error);
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          this.authCheckComplete = false;
          localStorage.removeItem('user');
        }
      })
    );
  }

  /**
   * Handle successful OAuth callback
   */
  handleAuthCallback(): void {
    this.authCheckComplete = false;
    this.checkAuthStatus();
  }

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