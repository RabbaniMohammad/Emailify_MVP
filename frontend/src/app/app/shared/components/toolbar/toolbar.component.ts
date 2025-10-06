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
import { map, shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import { BehaviorSubject, Subject } from 'rxjs';

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

  // Use a trigger subject to force refresh
  private refreshTrigger$ = new BehaviorSubject<void>(undefined);
  private destroy$ = new Subject<void>();  // ← Add this
  
  pendingCount$ = this.refreshTrigger$.pipe(
    switchMap(() => this.adminService.getPendingUsers()),
    map(response => response.users.length),
    shareReplay(1)
  );

  ngOnInit(): void {
    // Refresh count when admin actions occur
    this.adminEventService.refreshPendingCount
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshTrigger$.next();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isAdmin(): boolean {
    const user = this.authService.currentUserValue;
    return user?.role === 'admin' || user?.role === 'super_admin';
  }

  navigateToAdmin(): void {
    // Just refresh the count
    this.refreshTrigger$.next();
    
    // Simple navigation
    this.router.navigate(['/admin']);
  }

  refresh(): void {
    this.svc.refresh();
  }
}