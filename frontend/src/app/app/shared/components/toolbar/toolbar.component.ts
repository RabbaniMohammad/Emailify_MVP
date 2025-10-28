import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { RouterModule, Router, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { TemplatesService } from '../../../core/services/templates.service';
import { AuthService } from '../../../../app/core/services/auth.service';
import { AdminService } from '../../../core/services/admin.service';
import { AdminEventService } from '../../../core/services/admin-event.service';
import { TemplateGenerationService } from '../../../core/services/template-generation.service';
import { PerformanceDashboardComponent } from '../performance-dashboard/performance-dashboard.component';
import { map, takeUntil, startWith, tap, switchMap, filter } from 'rxjs/operators';
import { BehaviorSubject, Subject, timer } from 'rxjs';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [
    CommonModule, 
    MatToolbarModule, 
    MatButtonModule, 
    RouterModule, 
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
    MatDividerModule
  ],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent implements OnInit, OnDestroy {
  private svc = inject(TemplatesService);
  private authService = inject(AuthService);
  private adminService = inject(AdminService);
  private adminEventService = inject(AdminEventService);
  private router = inject(Router);
  private location = inject(Location);
  private generationService = inject(TemplateGenerationService);
  private dialog = inject(MatDialog);

  private destroy$ = new Subject<void>();
  
  pendingCount$ = new BehaviorSubject<number>(0);
  currentUser$ = this.authService.currentUser$;
  activeRoute$ = new BehaviorSubject<string>('');

  canGoBack$ = new BehaviorSubject<boolean>(false);
  canGoForward$ = new BehaviorSubject<boolean>(false);

ngOnInit(): void {
  // Track current route for highlighting active nav items
  this.activeRoute$.next(this.router.url);
  
  // Listen to router events to update active route
  this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    takeUntil(this.destroy$)
  ).subscribe((event) => {
    this.activeRoute$.next(event.urlAfterRedirects);
  });

  // ========================================
  // Admin pending count polling
  // ========================================
  // Load pending count immediately if user is available
  this.currentUser$.pipe(
    filter(user => {
      if (!user) return false;
      const isOrgAdmin = user.orgRole === 'admin' || user.orgRole === 'super_admin';
      return isOrgAdmin;
    }),
    takeUntil(this.destroy$)
  ).subscribe(() => {
    // Initial load
    this.loadPendingCount();
    
    // Poll every 30 seconds
    timer(30000, 30000).pipe(
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadPendingCount();
    });
  });

  // Listen to refresh events
  this.adminEventService.refreshPendingCount
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      if (this.isAdmin()) {
        this.loadPendingCount();
      }
    });
  
  this.adminEventService.refresh$
    .pipe(takeUntil(this.destroy$))
    .subscribe(() => {
      if (this.isAdmin()) {
        this.loadPendingCount();
      }
    });
}

  private loadPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.pendingCount$.next(response.users.length);
        },
        error: (err) => {

        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pendingCount$.complete();
    this.canGoBack$.complete();
    this.canGoForward$.complete();
  }

  canGoBack(): boolean {
    // Always allow back button - browser will handle if there's no history
    return true;
  }

  canGoForward(): boolean {
    // Always allow forward button - browser will handle if there's no history
    return true;
  }

goBack(): void {
  // Use browser's native back - this always works correctly!
  this.location.back();
}

goForward(): void {
  // Use browser's native forward
  this.location.forward();
}

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    // Check orgRole for admin access
    const isOrgAdmin = user?.orgRole === 'admin' || user?.orgRole === 'super_admin';
    return isOrgAdmin;
  }

  isActive(route: string): boolean {
    const currentRoute = this.activeRoute$.value;
    if (route === '/') {
      return currentRoute === '/';
    }
    return currentRoute.startsWith(route);
  }

  getAvatarSrc(user: any): string {
    if (user.picture && user.picture.trim() !== '') {
      return user.picture;
    }
    return this.getInitialsAvatar(user.name);
  }

  private imageRetryCount = new Map<string, number>();
  private readonly MAX_RETRIES = 2;

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    const originalSrc = img.src;
    
    // Get or initialize retry count for this image
    const retryCount = this.imageRetryCount.get(originalSrc) || 0;
    
    // Try to reload the image up to MAX_RETRIES times
    if (retryCount < this.MAX_RETRIES) {
      this.imageRetryCount.set(originalSrc, retryCount + 1);
      
      // Add a cache-busting parameter and retry after a short delay
      setTimeout(() => {
        const timestamp = new Date().getTime();
        const separator = originalSrc.includes('?') ? '&' : '?';
        img.src = `${originalSrc}${separator}_retry=${timestamp}`;
      }, 500 * (retryCount + 1)); // Exponential backoff: 500ms, 1000ms
      
    } else {
      // After max retries, fall back to initials avatar
      this.imageRetryCount.delete(originalSrc);
      img.src = this.getInitialsAvatar(userName);
    }
  }

  private getInitialsAvatar(name: string): string {
    const initials = name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    
    const gradient = ctx.createLinearGradient(0, 0, 80, 80);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 80, 80);
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 40, 40);
    
    return canvas.toDataURL();
  }

navigateToHome(): void {
  const currentUrl = this.router.url;
  const isOnHomePage = currentUrl === '/' || currentUrl === '';
  
  if (isOnHomePage) {
    // ✅ FIX: DON'T clear history, just refresh templates
    try {
      this.svc.smartRefresh();
    } catch (error) {

    }
  } else {
    this.router.navigate(['/'])
      .then((success) => {
        if (!success) {
        }
      })
      .catch((error) => {

      });
  }
}

  navigateToAdmin(): void {
    // Data loads automatically when admin page component initializes
    // No need to trigger refresh here - was causing 368ms delay!
    this.router.navigate(['/admin']);
  }

  navigateToGenerate(): void {
    // Smart navigation: check if user has an active conversation
    const activeConversationId = this.generationService.getCurrentConversationId();
    
    if (activeConversationId) {
      this.router.navigate(['/generate', activeConversationId]);
    } else {
      this.router.navigate(['/generate/new']);
    }
  }

navigateTo(route: string): void {
  
  this.router.navigate([route])
    .then((success) => {
      if (!success) {
      }
    })
    .catch((error) => {
    });
  
}

  openPerformanceDashboard(): void {
    this.dialog.open(PerformanceDashboardComponent, {
      width: '95vw',
      maxWidth: '1200px',
      height: '90vh',
      panelClass: 'performance-dashboard-dialog',
      disableClose: false,
      autoFocus: false
    });
  }

  getInitials(name: string): string {
    return name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

logout(): void {
  this.authService.logout().subscribe({
    next: () => {
      
      
      this.router.navigate(['/auth'])
        .then((success) => {
          
          if (success) {
          } else {
          }
        })
        .catch((navError) => {
          
          // Check for specific navigation errors
          if (navError instanceof Error) {
            if (navError.message.includes('Cannot match any routes')) {
            }
          }
          
          // Optional: Force redirect as fallback
          try {
            window.location.href = '/auth';
          } catch (redirectError) {
          }
        });
    },
    error: (error) => {
      
      // Analyze error type
      if (error?.status === 401) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      } 
      else if (error?.status === 0 || error?.status === 504) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else if (error?.status >= 500) {
        
        // Still navigate to auth page
        this.router.navigate(['/auth'])
          .then(() => {})
          .catch((navError) => {
            // Force redirect as last resort
            window.location.href = '/auth';
          });
      }
      else {
        
        // Try to navigate anyway
        this.router.navigate(['/auth'])
          .catch((navError) => {
            window.location.href = '/auth';
          });
      }
      
    },
    complete: () => {
    }
  });
  
}

  refresh(): void {
    this.svc.refresh();
  }
}
