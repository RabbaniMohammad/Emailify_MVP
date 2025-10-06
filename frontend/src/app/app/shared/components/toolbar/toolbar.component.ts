import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';  
import { RouterModule, Router } from '@angular/router';
import { TemplatesService } from '../../../core/services/templates.service';
import { AuthService } from '../../../../app/core/services/auth.service';
import { AdminService } from '../../../core/services/admin.service';
import { AdminEventService } from '../../../core/services/admin-event.service';
import { map, shareReplay, switchMap, takeUntil, startWith, tap } from 'rxjs/operators';
import { BehaviorSubject, Subject, interval, timer } from 'rxjs';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatButtonModule, RouterModule, MatIconModule],
  templateUrl: './toolbar.component.html',
  styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent implements OnInit, OnDestroy {
  private svc = inject(TemplatesService);
  private authService = inject(AuthService);
  private adminService = inject(AdminService);
  private adminEventService = inject(AdminEventService);
  private router = inject(Router);

  private destroy$ = new Subject<void>();
  private manualRefresh$ = new Subject<void>();
  
  // Observable that emits the pending count
  pendingCount$ = new BehaviorSubject<number>(0);

  ngOnInit(): void {
    // Only set up polling if user is admin
    if (!this.isAdmin()) {
      return;
    }

    console.log('🔍 Toolbar: Setting up admin badge polling');

    // Create polling stream that combines:
    // 1. Immediate first fetch (startWith)
    // 2. Auto-refresh every 30 seconds
    // 3. Manual refresh triggers
    // 4. Admin action triggers
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

    // Also refresh on manual triggers (admin actions)
    this.adminEventService.refreshPendingCount
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('🔔 Manual refresh triggered');
        this.fetchPendingCount();
      });
    
    this.adminEventService.refresh$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('🔔 Admin action refresh triggered');
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
          console.log(`🔄 Manual fetch - Pending count: ${count}`);
          this.pendingCount$.next(count);
        },
        error: (err) => console.error('❌ Error in manual fetch:', err)
      });
  }

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    return user?.role === 'admin' || user?.role === 'super_admin';
  }

  navigateToAdmin(): void {
    console.log('🚀 Navigating to admin page');
    // Trigger immediate refresh
    this.fetchPendingCount();
    this.adminEventService.triggerNavigationRefresh();
    
    // Navigate to admin
    this.router.navigate(['/admin']);
  }

  refresh(): void {
    this.svc.refresh();
  }
}