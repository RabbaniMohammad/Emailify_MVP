import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take, filter } from 'rxjs/operators';

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Wait for the first non-null user value to avoid race conditions on refresh
  return authService.currentUser$.pipe(
    filter((user): user is NonNullable<typeof user> => user !== null), // Type guard: ensures user is not null
    take(1), // Take only the first emitted value
    map(user => {
      const isAdmin = user.orgRole === 'admin' || user.orgRole === 'super_admin';
      
      if (!isAdmin) {
        router.navigate(['/']);
        return false;
      }

      return true;
    })
  );
};