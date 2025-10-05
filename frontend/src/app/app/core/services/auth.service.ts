import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
  lastLogin: string;
  isActive: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor() {
    this.checkAuthStatus();
  }

  /**
   * Check if user is authenticated on app load
   */
  private checkAuthStatus(): void {
    this.getCurrentUser().subscribe({
      next: (user) => {
        this.currentUserSubject.next(user);
        this.isAuthenticatedSubject.next(true);
      },
      error: () => {
        this.currentUserSubject.next(null);
        this.isAuthenticatedSubject.next(false);
      }
    });
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

    // Poll for popup closure
    const pollTimer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(pollTimer);
        // Check auth status after popup closes
        this.checkAuthStatus();
      }
    }, 500);
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

  /**
   * Refresh access token
   */
  refreshToken(): Observable<any> {
    return this.http.post('/api/auth/refresh', {}, { withCredentials: true });
  }

  /**
   * Logout user
   */
  logout(): void {
    this.http.post('/api/auth/logout', {}, { withCredentials: true })
      .subscribe({
        next: () => {
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          this.router.navigate(['/auth']);
        },
        error: (error) => {
          console.error('Logout error:', error);
          // Still clear local state even if API fails
          this.currentUserSubject.next(null);
          this.isAuthenticatedSubject.next(false);
          this.router.navigate(['/auth']);
        }
      });
  }

  /**
   * Handle successful OAuth callback
   */
  handleAuthCallback(): void {
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