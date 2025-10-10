import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError, switchMap } from 'rxjs';
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
          console.error('❌ Auth endpoint failed with 401:', req.url);
          return throwError(() => error);
        }

        // Try to refresh the token
        console.log('🔄 401 error - attempting token refresh...');
        
        return authService.refreshToken().pipe(
          switchMap(() => {
            console.log('✅ Token refreshed successfully, retrying original request');
            // Retry the original request with new token
            return next(authReq);
          }),
          catchError((refreshError) => {
            console.error('❌ Token refresh failed in interceptor:', refreshError.status);
            
            // Let auth service handle the logout and redirect
            // Don't do it here to avoid duplicate logout attempts
            return throwError(() => refreshError);
          })
        );
      }

      // ==================== Handle 403 Forbidden ====================
      if (error.status === 403) {
        const errorMessage = error.error?.error || '';
        const errorCode = error.error?.code || '';
        
        console.error('🚫 403 Forbidden:', errorMessage);

        // Check if it's an account-related issue (not just permission)
        const isAccountIssue = 
          errorCode === 'USER_INACTIVE' || 
          errorCode === 'USER_NOT_APPROVED' ||
          errorMessage.includes('deactivated') || 
          errorMessage.includes('pending approval') ||
          errorMessage.includes('Access denied');

        if (isAccountIssue && !router.url.startsWith('/auth')) {
          console.error('❌ Account status issue detected - forcing logout');
          
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
              console.error('❌ Logout failed, forcing navigation:', logoutError);
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
        console.error('🔥 Server error:', error.status, error.message);
      }

      return throwError(() => error);
    })
  );
};