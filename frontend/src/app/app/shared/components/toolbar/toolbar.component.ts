import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { TemplatesService } from '../../../core/services/templates.service';
import { AuthService } from '../../../../app/core/services/auth.service';
import { AdminService } from '../../../core/services/admin.service';
import { AdminEventService } from '../../../core/services/admin-event.service';
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

  private destroy$ = new Subject<void>();
  
  // Navigation tracking
  private navigationHistory: string[] = [];
  private currentIndex = -1;
  private isNavigating = false; // Prevent double navigation
  
  pendingCount$ = new BehaviorSubject<number>(0);
  currentUser$ = this.authService.currentUser$;
  activeRoute$ = new BehaviorSubject<string>('');

  // Public observables for template
  canGoBack$ = new BehaviorSubject<boolean>(false);
  canGoForward$ = new BehaviorSubject<boolean>(false);

  ngOnInit(): void {
    // Initialize with current route
    const currentUrl = this.router.url;
    this.navigationHistory = [currentUrl];
    this.currentIndex = 0;
    this.activeRoute$.next(currentUrl);
    this.updateNavigationState();

    // Track navigation
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      filter(() => !this.isNavigating), // Ignore programmatic navigation
      takeUntil(this.destroy$)
    ).subscribe((event: any) => {
      const url = event.urlAfterRedirects;
      this.activeRoute$.next(url);
      
      // Remove forward history when user navigates normally
      if (this.currentIndex < this.navigationHistory.length - 1) {
        this.navigationHistory = this.navigationHistory.slice(0, this.currentIndex + 1);
      }
      
      // Add new page to history
      this.navigationHistory.push(url);
      this.currentIndex = this.navigationHistory.length - 1;
      
      this.updateNavigationState();
      console.log('Navigation history:', this.navigationHistory);
      console.log('Current index:', this.currentIndex);
    });

    // Admin pending count polling
    if (!this.isAdmin()) {
      return;
    }

    timer(0, 30000).pipe(
      startWith(0),
      switchMap(() => this.adminService.getPendingUsers()),
      map(response => response.users.length),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (count) => this.pendingCount$.next(count),
      error: (err) => console.error('Error fetching pending count:', err)
    });

    this.adminEventService.refreshPendingCount
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.fetchPendingCount());
    
    this.adminEventService.refresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.fetchPendingCount());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pendingCount$.complete();
    this.canGoBack$.complete();
    this.canGoForward$.complete();
  }

  private updateNavigationState(): void {
    this.canGoBack$.next(this.currentIndex > 0);
    this.canGoForward$.next(this.currentIndex < this.navigationHistory.length - 1);
  }

  private fetchPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => this.pendingCount$.next(response.users.length),
        error: (err) => console.error('Error in manual fetch:', err)
      });
  }

  canGoBack(): boolean {
    return this.canGoBack$.value;
  }

  canGoForward(): boolean {
    return this.canGoForward$.value;
  }

  goBack(): void {
    if (!this.canGoBack()) return;
    
    this.isNavigating = true;
    this.currentIndex--;
    const previousUrl = this.navigationHistory[this.currentIndex];
    
    console.log('Going back to:', previousUrl);
    
    this.router.navigateByUrl(previousUrl).then(() => {
      this.activeRoute$.next(previousUrl);
      this.updateNavigationState();
      this.isNavigating = false;
    });
  }

  goForward(): void {
    if (!this.canGoForward()) return;
    
    this.isNavigating = true;
    this.currentIndex++;
    const nextUrl = this.navigationHistory[this.currentIndex];
    
    console.log('Going forward to:', nextUrl);
    
    this.router.navigateByUrl(nextUrl).then(() => {
      this.activeRoute$.next(nextUrl);
      this.updateNavigationState();
      this.isNavigating = false;
    });
  }

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    return user?.role === 'admin' || user?.role === 'super_admin';
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

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    img.src = this.getInitialsAvatar(userName);
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

  /**
 * Navigate to home page
 */
  navigateToHome(): void {
    const currentUrl = this.router.url;
    
    // If already on home page, refresh the templates
    if (currentUrl === '/' || currentUrl === '') {
      console.log('Already on home - refreshing templates');
      // If you have access to TemplatesService, call refresh
      // this.templatesService.refresh();
      // Or just reload
      window.location.reload();
    } else {
      // Navigate to home
      console.log('Navigating to home from:', currentUrl);
      this.router.navigate(['/']);
    }
  }

  navigateToAdmin(): void {
    this.fetchPendingCount();
    this.adminEventService.triggerNavigationRefresh();
    this.router.navigate(['/admin']);
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
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
        this.router.navigate(['/auth']);
      }
    });
  }

  refresh(): void {
    this.svc.refresh();
  }
}