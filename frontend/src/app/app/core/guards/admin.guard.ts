import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs/operators';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    map(user => {
      if (!user) {
        router.navigate(['/auth']);
        return false;
      }

      const isAdmin = user.role === 'admin' || user.role === 'super_admin';
      
      if (!isAdmin) {
        router.navigate(['/']);
        return false;
      }

      return true;
    })
  );
};