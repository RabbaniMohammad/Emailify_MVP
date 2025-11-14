import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError, switchMap, tap } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Clone request with credentials
  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      
      // ==================== Handle 401 Unauthorized ====================
      if (error.status === 401) {
        // Don't try to refresh if already on auth endpoints
        if (req.url.includes('/api/auth/refresh') || 
            req.url.includes('/api/auth/logout') ||
            req.url.includes('/api/auth/google')) {
          console.warn('🚫 Auth endpoint failed:', req.url);
          return throwError(() => error);
        }

        console.log('🔄 [AUTH INTERCEPTOR] 401 received, attempting token refresh...');
        
        // Try to refresh the token using the service method that handles concurrency
        return authService.attemptTokenRefresh().pipe(
          switchMap(() => {
            console.log('✅ [AUTH INTERCEPTOR] Token refreshed, retrying original request');
            // Retry the original request with new token
            return next(authReq);
          }),
          catchError((refreshError) => {
            console.error('❌ [AUTH INTERCEPTOR] Token refresh failed, forcing logout');
            
            // ✅ FIX: Properly handle refresh failure with redirect
            const errorCode = refreshError.error?.code || '';
            const errorMessage = refreshError.error?.error || 'Session expired';
            
            // Determine the error type for better user feedback
            let redirectError = 'session_expired';
            if (errorCode === 'USER_INACTIVE') {
              redirectError = 'account_deactivated';
            } else if (errorCode === 'USER_NOT_APPROVED') {
              redirectError = 'pending_approval';
            } else if (errorCode === 'NO_REFRESH_TOKEN' || errorCode === 'INVALID_REFRESH_TOKEN') {
              redirectError = 'session_expired';
            }
            
            // Force logout and redirect (don't wait for response)
            authService.handleAuthFailure(redirectError);
            
            return throwError(() => new Error(errorMessage));
          })
        );
      }

      // ==================== Handle 403 Forbidden ====================
      if (error.status === 403) {
        const errorMessage = error.error?.error || '';
        const errorCode = error.error?.code || '';

        // Check if it's an account-related issue (not just permission)
        const isAccountIssue = 
          errorCode === 'USER_INACTIVE' || 
          errorCode === 'USER_NOT_APPROVED' ||
          errorMessage.includes('deactivated') || 
          errorMessage.includes('pending approval') ||
          errorMessage.includes('Access denied');

        if (isAccountIssue && !router.url.startsWith('/auth')) {

          // Force logout and redirect
          authService.logout().subscribe({
            next: () => {
              const errorParam = 
                errorCode === 'USER_INACTIVE' || errorMessage.includes('deactivated')
                  ? 'account_deactivated'
                  : errorMessage.includes('pending')
                  ? 'pending_approval'
                  : 'access_denied';

              router.navigate(['/auth'], { 
                queryParams: { error: errorParam },
                replaceUrl: true
              });
            },
            error: (logoutError) => {

              // Force navigation even if logout fails
              router.navigate(['/auth'], { 
                queryParams: { error: 'access_denied' },
                replaceUrl: true
              });
            }
          });
        }

        return throwError(() => error);
      }

      // ==================== Handle Other Errors ====================
      if (error.status >= 500) {

      }

      return throwError(() => error);
    })
  );
};