import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const isAuthenticated = await authService.checkAuthStatus();

  if (isAuthenticated) {
    return true;
  }

  const returnUrl = state.url;
  router.navigate(['/auth'], { queryParams: { returnUrl } });
  return false;
};