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
  
  pendingCount$ = new BehaviorSubject<number>(0);
  currentUser$ = this.authService.currentUser$;
  activeRoute$ = new BehaviorSubject<string>('');

  ngOnInit(): void {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntil(this.destroy$)
    ).subscribe((event: any) => {
      this.activeRoute$.next(event.urlAfterRedirects);
    });
    
    this.activeRoute$.next(this.router.url);

    if (!this.isAdmin()) {
      return;
    }

    timer(0, 30000).pipe(
      startWith(0),
      tap(() => console.log('🔄 Fetching pending count...')),
      switchMap(() => this.adminService.getPendingUsers()),
      map(response => {
        const count = response.users.length;
        console.log(`✅ Pending count: ${count}`);
        return count;
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (count) => this.pendingCount$.next(count),
      error: (err) => console.error('❌ Error fetching pending count:', err)
    });

    this.adminEventService.refreshPendingCount
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.fetchPendingCount();
      });
    
    this.adminEventService.refresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.fetchPendingCount();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.pendingCount$.complete();
  }

  private fetchPendingCount(): void {
    this.adminService.getPendingUsers()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          const count = response.users.length;
          this.pendingCount$.next(count);
        },
        error: (err) => console.error('❌ Error in manual fetch:', err)
      });
  }

  canGoBack(): boolean {
    const currentRoute = this.router.url;
    // Don't allow back on home page or auth pages
    return currentRoute !== '/' && 
           !currentRoute.includes('/auth') && 
           window.history.length > 1;
  }

  canGoForward(): boolean {
    // Forward is rarely useful in SPAs, keep disabled
    return false;
  }

  goBack(): void {
    // Only navigate back if we're not on protected routes
    const currentRoute = this.router.url;
    if (currentRoute !== '/' && !currentRoute.includes('/auth')) {
      this.location.back();
    }
  }

  goForward(): void {
    this.location.forward();
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

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
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