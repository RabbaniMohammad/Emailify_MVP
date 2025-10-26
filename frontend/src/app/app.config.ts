import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { authInterceptor } from './app/core/interceptors/auth.interceptor';
import { DatabaseService } from './core/services/db.service';
import { CacheMonitorService } from './core/services/cache-monitor.service';
import { AuthService } from './app/core/services/auth.service';

// Initialize auth state before app starts
export function initializeAuth(authService: AuthService) {
  return () => authService.checkAuthStatus();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),
    provideAnimations(),
    // Database & Cache Services
    { provide: DatabaseService, useValue: new DatabaseService() },
    CacheMonitorService,
    // Initialize auth before app loads
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      deps: [AuthService],
      multi: true
    }
  ]
};