import { Component, OnInit, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrganizationService, Organization } from '@app/app/core/services/organization.service';
import { AuthService } from '@app/app/core/services/auth.service';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { BehaviorSubject } from 'rxjs';
import { DeleteOrgDialogComponent } from './delete-org-dialog/delete-org-dialog.component';

@Component({
  selector: 'app-organization-management',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCheckboxModule,
    MatDividerModule,
    MatMenuModule,
    MatChipsModule
  ],
  templateUrl: './organization-management.component.html',
  styleUrl: './organization-management.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrganizationManagementComponent implements OnInit {
  private organizationService = inject(OrganizationService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private organizationsSubject = new BehaviorSubject<Organization[]>([]);
  readonly organizations$ = this.organizationsSubject.asObservable();

  readonly currentUser$ = this.authService.currentUser$;
  
  loading = false;
  displayedColumns = ['name', 'slug', 'users', 'status', 'created', 'actions'];

  ngOnInit(): void {
    this.loadOrganizations();
  }

  loadOrganizations(): void {
    this.loading = true;
    this.organizationService.getAllOrganizations().subscribe({
      next: (response: { organizations: Organization[] }) => {
        this.organizationsSubject.next(response.organizations || []);
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Failed to load organizations:', error);
        this.snackBar.open('Failed to load organizations', 'Close', {
          duration: 3000,
          horizontalPosition: 'end',
          verticalPosition: 'top'
        });
        this.organizationsSubject.next([]);
        this.loading = false;
      }
    });
  }

  deleteOrganization(org: Organization): void {
    const dialogRef = this.dialog.open(DeleteOrgDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: { organization: org },
      disableClose: true,
      panelClass: 'delete-org-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.confirmed) {
        this.performDelete(org, result.deleteData);
      }
    });
  }

  private performDelete(org: Organization, deleteData: boolean): void {
    this.loading = true;
    
    this.organizationService.deleteOrganization(org.slug, deleteData).subscribe({
      next: (response: { message: string }) => {
        this.snackBar.open(response.message, 'Close', {
          duration: 5000,
          horizontalPosition: 'end',
          verticalPosition: 'top',
          panelClass: 'success-snackbar'
        });
        
        // Remove from list
        const currentOrgs = this.organizationsSubject.value;
        this.organizationsSubject.next(currentOrgs.filter(o => o._id !== org._id));
        
        this.loading = false;
      },
      error: (error: any) => {
        console.error('Failed to delete organization:', error);
        this.snackBar.open(
          error.error?.message || 'Failed to delete organization',
          'Close',
          {
            duration: 5000,
            horizontalPosition: 'end',
            verticalPosition: 'top',
            panelClass: 'error-snackbar'
          }
        );
        this.loading = false;
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
}
