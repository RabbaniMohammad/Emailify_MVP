import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Clone request to add withCredentials for cookies
  const authReq = req.clone({
    withCredentials: true
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If 401 and not already on auth routes, try refresh token
      if (error.status === 401 && !req.url.includes('/api/auth/')) {
        return authService.refreshToken().pipe(
          switchMap(() => {
            // Retry original request after refresh
            return next(authReq);
          }),
          catchError((refreshError) => {
            // Refresh failed, redirect to login
            authService.logout();
            return throwError(() => refreshError);
          })
        );
      }

      return throwError(() => error);
    })
  );
};