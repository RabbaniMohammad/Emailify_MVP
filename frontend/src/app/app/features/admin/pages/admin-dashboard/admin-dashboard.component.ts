import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { AdminService, AdminUser, AuthorizedUserWithStatus } from '../../../../core/services/admin.service';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';

import { AdminEventService } from '../../../../core/services/admin-event.service';
import { OrganizationManagementComponent } from '../../components/organization-management/organization-management.component';
import { AddAllowedUserDialogComponent } from '../../components/add-allowed-user-dialog/add-allowed-user-dialog.component';
import { CacheService } from '../../../../core/services/cache.service';
import { MatDialog } from '@angular/material/dialog';

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
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    FormsModule,
    OrganizationManagementComponent,
    AddAllowedUserDialogComponent
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
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);
  private cdr = inject(ChangeDetectorRef);
  private dialog = inject(MatDialog);

  private allUsersSubject = new BehaviorSubject<AdminUser[]>([]);
  readonly allUsers$ = this.allUsersSubject.asObservable();

  private authorizedUsersSubject = new BehaviorSubject<AuthorizedUserWithStatus[]>([]);
  readonly authorizedUsers$ = this.authorizedUsersSubject.asObservable();
  
  // Count of users awaiting signup (for notification dot)
  readonly awaitingSignupCount$ = new BehaviorSubject<number>(0);

  readonly currentUser$ = this.authService.currentUser$;

  loading = false;
  displayedColumns = ['picture', 'name', 'email', 'role', 'status', 'createdAt', 'actions'];
  
  // Sender settings
  fromEmail = '';
  fromName = '';
  savingSenderSettings = false;
  loadingSenderSettings = false;
  editingSenderSettings = false;
  senderSettingsConfigured = false;
  
  // Image retry logic
  private imageRetryCount = new Map<string, number>();
  private readonly MAX_RETRIES = 2;
  
  private routerSub?: Subscription;
  private refreshSub?: Subscription;
  private navigationRefreshSub?: Subscription;

  ngOnInit(): void {
    this.loadData();
    this.loadSenderSettings();
    
    // Subscribe to admin events to refresh data when other admins make changes
    this.refreshSub = this.adminEventService.refresh$.subscribe(() => {
      this.loadData();
    });

    // NOTE: Removed navigationRefresh subscription - it was causing 368ms delay on menu clicks
    // Data loads automatically on ngOnInit when navigating to admin page
    // Only refresh$ is needed for real-time updates when data changes
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.navigationRefreshSub?.unsubscribe();
  }

  private loadData(): void {
    this.loadAllUsers();
    this.loadAuthorizedUsers();
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

  loadAuthorizedUsers(): void {
    this.adminService.getAuthorizedUsersWithStatus().subscribe({
      next: (response) => {
        this.authorizedUsersSubject.next(response.authorizedUsers);
        this.awaitingSignupCount$.next(response.stats.awaitingSignup);
      },
      error: (error) => {
        console.error('Failed to load authorized users:', error);
      }
    });
  }

  approveUser(user: AdminUser): void {
    this.adminService.approveUser(user._id).subscribe({
      next: (response) => {
        this.showSuccess(`${user.name} approved successfully`);
        this.loadAllUsers();
        this.loadAuthorizedUsers();
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
        this.loadAuthorizedUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to reject user');
      }
    });
  }

  removeAuthorization(user: AuthorizedUserWithStatus): void {
    const confirmMsg = `Remove authorization for ${user.email}?${user.hasSignedUp ? ' This will not delete their account but they won\'t be able to sign in again.' : ''}`;
    
    if (!confirm(confirmMsg)) return;

    this.adminService.deleteAllowedUser(user._id).subscribe({
      next: () => {
        this.showSuccess(`Authorization removed for ${user.email}`);
        this.loadAuthorizedUsers();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to remove authorization');
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
        this.loadAuthorizedUsers();
        this.adminEventService.triggerRefresh();
      },
      error: (error) => {
        this.showError(error.error?.error || 'Failed to delete user');
      }
    });
  }

  isSuperAdmin(currentUser: any): boolean {
    return currentUser?.orgRole === 'super_admin';
  }

  isOwnerOrgSuperAdmin(currentUser: any): boolean {
    // Check if user is super_admin AND belongs to camply organization
    const isCamplyOrg = currentUser?.organizationId?.slug === 'camply' || 
                         currentUser?.organizationIsOwner === true;
    return currentUser?.orgRole === 'super_admin' && isCamplyOrg;
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
    gradient.addColorStop(0, '#E5893F');
    gradient.addColorStop(1, '#E5893F');
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

  // Sender Settings Methods
  loadSenderSettings(): void {
    this.currentUser$.pipe(take(1)).subscribe(user => {
      if (user?.organizationId) {
        this.loadingSenderSettings = true;
        // organizationId can be an object with _id or a string
        const orgId = typeof user.organizationId === 'object' ? user.organizationId._id : user.organizationId;
        this.http.get<any>(`/api/organizations/${orgId}/sender-settings`).subscribe({
          next: (response) => {
            this.fromEmail = response.fromEmail || '';
            this.fromName = response.fromName || '';
            this.senderSettingsConfigured = response.isConfigured || false;
            this.editingSenderSettings = !this.senderSettingsConfigured; // Auto-edit if not configured
            this.loadingSenderSettings = false;
            this.cdr.markForCheck();
          },
          error: (error) => {
            console.error('Failed to load sender settings:', error);
            this.loadingSenderSettings = false;
            this.cdr.markForCheck();
            this.editingSenderSettings = true; // Show form on error
          }
        });
      }
    });
  }

  enableEditSenderSettings(): void {
    this.editingSenderSettings = true;
  }

  cancelEditSenderSettings(): void {
    this.editingSenderSettings = false;
    this.loadSenderSettings(); // Reload original values
  }

  saveSenderSettings(): void {
    // Validate inputs
    if (!this.fromEmail || !this.fromName) {
      this.showError('Both sender email and name are required');
      return;
    }

    // Email validation
    const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    if (!emailRegex.test(this.fromEmail)) {
      this.showError('Please enter a valid email address');
      return;
    }

    // Check for generic domains
    const genericDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
    const domain = this.fromEmail.split('@')[1]?.toLowerCase();
    if (genericDomains.includes(domain)) {
      this.showError('Cannot use generic email providers (Gmail, Yahoo, etc). Please use your organization\'s domain.');
      return;
    }

    this.currentUser$.pipe(take(1)).subscribe(user => {
      if (user?.organizationId) {
        this.savingSenderSettings = true;
        // organizationId can be an object with _id or a string
        const orgId = typeof user.organizationId === 'object' ? user.organizationId._id : user.organizationId;
        this.http.put<any>(`/api/organizations/${orgId}/sender-settings`, {
          fromEmail: this.fromEmail,
          fromName: this.fromName
        }).subscribe({
          next: (response) => {
            this.savingSenderSettings = false;
            this.senderSettingsConfigured = true;
            this.editingSenderSettings = false; // Switch to display mode
            this.cdr.markForCheck();
            
            // ✅ INVALIDATE SENDER SETTINGS CACHE
            // This ensures campaign pages fetch fresh data after admin updates
            this.cacheService.invalidatePrefix('sender_settings_');
            
            if (response.warning) {
              this.snackBar.open(`⚠️  ${response.message}. ${response.warning}`, 'Close', {
                duration: 8000,
                panelClass: ['warning-snackbar']
              });
            } else {
              this.snackBar.open('✅ Sender settings saved successfully! Remember to verify your domain.', 'Close', {
                duration: 6000,
                panelClass: ['success-snackbar']
              });
            }
          },
          error: (error) => {
            this.savingSenderSettings = false;
            this.cdr.markForCheck();
            this.showError(error.error?.message || 'Failed to save sender settings');
          }
        });
      }
    });
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Open dialog to add authorized user
  openAddAllowedUserDialog(): void {
    const dialogRef = this.dialog.open(AddAllowedUserDialogComponent, {
      width: '480px',
      panelClass: ['modern-glass-dialog'],
      backdropClass: 'modern-dialog-backdrop'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Refresh the users list after adding
        this.loadAllUsers();
      }
    });
  }
}