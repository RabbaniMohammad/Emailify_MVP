import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Handle 403 - account deactivated or not approved
      if (error.status === 403) {
        const errorMessage = error.error?.error || '';
        
        // Check if it's an account-related issue (not just insufficient permissions)
        if (errorMessage.includes('deactivated') || errorMessage.includes('pending') || errorMessage.includes('Access denied')) {
          // Force logout and redirect
          authService.logout().subscribe({
            next: () => {
              router.navigate(['/auth'], { 
                queryParams: { 
                  error: errorMessage.includes('deactivated') 
                    ? 'account_deactivated' 
                    : 'access_denied' 
                },
                replaceUrl: true
              });
            },
            error: () => {
              // Even if logout fails, redirect to auth
              router.navigate(['/auth'], { 
                queryParams: { error: 'access_denied' },
                replaceUrl: true
              });
            }
          });
        } else if (!router.url.startsWith('/auth')) {
          // For permission errors, just show the error but don't logout
          console.error('Permission denied:', errorMessage);
        }
        return throwError(() => error);
      }

      // If 401 and not already on auth routes, try refresh token
      if (error.status === 401 && !req.url.includes('/api/auth/')) {
        return authService.refreshToken().pipe(
          switchMap(() => next(authReq)),
          catchError((refreshError) => {
            authService.logout().subscribe();
            router.navigate(['/auth']);
            return throwError(() => refreshError);
          })
        );
      }

      return throwError(() => error);
    })
  );
};