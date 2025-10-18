import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { AdminService, AdminUser } from '../../../../core/services/admin.service';
import { AuthService } from '../../../../core/services/auth.service';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { BehaviorSubject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { AdminEventService } from '../../../../core/services/admin-event.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatMenuModule,
    MatDividerModule
  ],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminDashboardComponent implements OnInit, OnDestroy {
  private adminService = inject(AdminService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private adminEventService = inject(AdminEventService);

  private allUsersSubject = new BehaviorSubject<AdminUser[]>([]);
  readonly allUsers$ = this.allUsersSubject.asObservable();

  private pendingUsersSubject = new BehaviorSubject<AdminUser[]>([]);
  readonly pendingUsers$ = this.pendingUsersSubject.asObservable();
  
  // Expose pending count for template
  readonly pendingCount$ = new BehaviorSubject<number>(0);

  readonly currentUser$ = this.authService.currentUser$;

  loading = false;
  displayedColumns = ['picture', 'name', 'email', 'role', 'status', 'createdAt', 'actions'];
  
  // Image retry logic
  private imageRetryCount = new Map<string, number>();
  private readonly MAX_RETRIES = 2;
  
  private routerSub?: Subscription;
  private refreshSub?: Subscription;
  private navigationRefreshSub?: Subscription;

  ngOnInit(): void {
    this.loadData();
    
    // Subscribe to admin events to refresh data when other admins make changes
    this.refreshSub = this.adminEventService.refresh$.subscribe(() => {
      console.log('Admin event triggered - refreshing data');
      this.loadData();
    });

    // Subscribe to navigation refresh events (when clicking admin button)
    this.navigationRefreshSub = this.adminEventService.navigationRefresh$.subscribe(() => {
      console.log('Navigation refresh triggered - loading fresh data');
      this.loadData();
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.navigationRefreshSub?.unsubscribe();
  }

  private loadData(): void {
    this.loadAllUsers();
    this.loadPendingUsers();
  }

  loadAllUsers(): void {
    this.loading = true;
    this.adminService.getAllUsers().subscribe({
      next: (response) => {
        this.allUsersSubject.next(response.users);
        this.loading = false;
      },
      error: (error) => {
        this.showError('Failed to load users');
        this.loading = false;
      }
    });
  }

  loadPendingUsers(): void {
    this.adminService.getPendingUsers().subscribe({
      next: (response) => {
        this.pendingUsersSubject.next(response.users);
        this.pendingCount$.next(response.users.length); // Update count for notification dot
      },
      error: (error) => {
        this.showError('Failed to load pending users');
      }
    });
  }

  approveUser(user: AdminUser): void {
    this.adminService.approveUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} approved successfully`);
        this.loadAllUsers();
        this.loadPendingUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to approve user');
      }
    });
  }
  
  rejectUser(user: AdminUser): void {
    const confirmMsg = `Reject ${user.name}'s registration request?`;
    
    if (!confirm(confirmMsg)) return;

    this.adminService.deleteUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name}'s request rejected`);
        this.loadAllUsers();
        this.loadPendingUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to reject user');
      }
    });
  }

  deactivateUser(user: AdminUser): void {
    const isDeactivatingSelf = this.isCurrentUser(user);
    
    const message = isDeactivatingSelf 
      ? `Deactivate your own account? You will be logged out immediately.`
      : `Deactivate ${user.name}?`;
    
    if (!confirm(message)) return;

    this.adminService.deactivateUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} deactivated`);
        
        // If deactivating yourself, logout immediately
        if (isDeactivatingSelf) {
          this.authService.logout().subscribe({
            next: () => {
              this.router.navigate(['/auth']);
            }
          });
        } else {
          // If deactivating another user, refresh the list
          this.loadAllUsers();
          this.adminEventService.triggerRefresh();
        }
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to deactivate user');
      }
    });
  }

  promoteToAdmin(user: AdminUser): void {
    if (!confirm(`Promote ${user.name} to admin?`)) return;

    this.adminService.promoteToAdmin(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} promoted to admin`);
        this.loadAllUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to promote user');
      }
    });
  }

  reactivateUser(user: AdminUser): void {
    if (!confirm(`Reactivate ${user.name}?`)) return;

    this.adminService.reactivateUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} reactivated`);
        this.loadAllUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to reactivate user');
      }
    });
  }

  demoteAdmin(user: AdminUser): void {
    if (!confirm(`Demote ${user.name} to regular user?`)) return;

    this.adminService.demoteAdmin(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} demoted to user`);
        this.loadAllUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to demote user');
      }
    });
  }

  deleteUser(user: AdminUser): void {
    const confirmMsg = `Permanently delete ${user.name}?\n\nThis action cannot be undone.`;
    
    if (!confirm(confirmMsg)) return;

    this.adminService.deleteUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} permanently deleted`);
        this.loadAllUsers();
        this.loadPendingUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to delete user');
      }
    });
  }

  isSuperAdmin(currentUser: any): boolean {
    return currentUser?.role === 'super_admin';
  }

  isCurrentUser(user: AdminUser): boolean {
    const currentUser = this.authService.currentUserValue;
    return currentUser?._id === user._id;
  }

  getAvatarUrl(user: AdminUser): string {
    if (user.picture && user.picture.startsWith('http')) {
      return user.picture;
    }
    return this.getInitialsAvatar(user.name);
  }

  getAvatarSrc(user: AdminUser): string {
    if (user.picture && user.picture.startsWith('http')) {
      return user.picture;
    }
    return this.getInitialsAvatar(user.name);
  }

  handleImageError(event: Event, userName: string): void {
    const img = event.target as HTMLImageElement;
    const originalSrc = img.src.split('?')[0]; // Remove any query params for retry tracking
    
    // Get current retry count for this URL
    const retryCount = this.imageRetryCount.get(originalSrc) || 0;
    
    if (retryCount < this.MAX_RETRIES) {
      // Increment retry count
      this.imageRetryCount.set(originalSrc, retryCount + 1);
      
      // Wait a bit before retrying (exponential backoff)
      const delay = 500 * (retryCount + 1);
      setTimeout(() => {
        // Add cache-busting parameter to force reload
        img.src = `${originalSrc}?_retry=${Date.now()}`;
      }, delay);
    } else {
      // Max retries reached, fall back to initials avatar
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

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  getRoleBadgeClass(role: string): string {
    switch (role) {
      case 'super_admin': return 'role-super-admin';
      case 'admin': return 'role-admin';
      default: return 'role-user';
    }
  }

  getStatusBadgeClass(user: AdminUser): string {
    if (!user.isActive) return 'status-inactive';
    if (!user.isApproved) return 'status-pending';
    return 'status-active';
  }

  getStatusText(user: AdminUser): string {
    if (!user.isActive) return 'Inactive';
    if (!user.isApproved) return 'Pending';
    return 'Active';
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}