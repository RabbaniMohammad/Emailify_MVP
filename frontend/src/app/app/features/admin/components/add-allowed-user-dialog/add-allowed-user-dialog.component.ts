import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService } from '@app/app/core/services/admin.service';

@Component({
  selector: 'app-add-allowed-user-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <div class="dialog-container">
      <!-- Header -->
      <div class="dialog-header">
        <div class="icon-circle">
          <mat-icon>person_add</mat-icon>
        </div>
        <h2>Add User</h2>
        <p class="subtitle">Authorize a user to join your organization</p>
      </div>

      <!-- Form Content -->
      <div class="form-content">
        <!-- Email Field -->
        <div class="form-group">
          <label class="form-label">
            <mat-icon>email</mat-icon>
            Email Address
          </label>
          <mat-form-field appearance="outline" class="full-width">
            <input 
              matInput 
              type="email"
              [(ngModel)]="email" 
              placeholder="user@company.com"
              (ngModelChange)="emailError = ''"
              required>
            <mat-error *ngIf="emailError">{{ emailError }}</mat-error>
          </mat-form-field>
        </div>

        <!-- Role Selection -->
        <div class="form-group">
          <label class="form-label">
            <mat-icon>badge</mat-icon>
            Assign Role
          </label>
          <div class="role-options">
            <button 
              type="button"
              class="role-option"
              [class.selected]="defaultRole === 'member'"
              (click)="defaultRole = 'member'">
              <div class="role-icon member">
                <mat-icon>person</mat-icon>
              </div>
              <div class="role-details">
                <span class="role-title">Member</span>
                <span class="role-description">Create & manage own templates</span>
              </div>
              <mat-icon class="check" *ngIf="defaultRole === 'member'">check_circle</mat-icon>
            </button>
            
            <button 
              type="button"
              class="role-option"
              [class.selected]="defaultRole === 'admin'"
              (click)="defaultRole = 'admin'">
              <div class="role-icon admin">
                <mat-icon>shield</mat-icon>
              </div>
              <div class="role-details">
                <span class="role-title">Admin</span>
                <span class="role-description">Manage users & settings</span>
              </div>
              <mat-icon class="check" *ngIf="defaultRole === 'admin'">check_circle</mat-icon>
            </button>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="dialog-actions">
        <button mat-button mat-dialog-close [disabled]="saving" class="cancel-btn">
          Cancel
        </button>
        <button 
          mat-flat-button 
          class="add-btn"
          (click)="save()"
          [disabled]="!email.trim() || saving">
          <mat-spinner *ngIf="saving" diameter="18"></mat-spinner>
          <ng-container *ngIf="!saving">
            <mat-icon>add</mat-icon>
            Add User
          </ng-container>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .dialog-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* Header */
    .dialog-header {
      width: 100%;
      text-align: center;
      padding: 24px 24px 16px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .icon-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #E5893F 0%, #d4782e 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      
      mat-icon {
        color: white;
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
    }

    h2 {
      margin: 0 0 4px;
      font-size: 1.25rem;
      font-weight: 600;
      color: #1e293b;
      text-align: center;
    }

    .subtitle {
      margin: 0;
      font-size: 0.875rem;
      color: #64748b;
      text-align: center;
    }

    /* Form Content */
    .form-content {
      width: 100%;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .form-group {
      width: 100%;
      max-width: 320px;
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      
      &:last-child {
        margin-bottom: 0;
      }
    }

    .form-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #475569;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      width: 100%;
      text-align: center;
      
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #94a3b8;
      }
    }

    .full-width {
      width: 100%;
    }

    /* Role Options */
    .role-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
    }

    .role-option {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      background: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: left;
      width: 100%;
      
      &:hover {
        border-color: #cbd5e1;
        background: #f8fafc;
      }
      
      &.selected {
        border-color: #E5893F;
        background: #fef7f0;
        
        .check {
          opacity: 1;
        }
      }
    }

    .role-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      
      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }
      
      &.member {
        background: #e0f2fe;
        mat-icon { color: #0284c7; }
      }
      
      &.admin {
        background: #fce7f3;
        mat-icon { color: #db2777; }
      }
    }

    .role-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .role-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: #1e293b;
    }

    .role-description {
      font-size: 0.8rem;
      color: #64748b;
    }

    .check {
      color: #E5893F;
      font-size: 22px;
      width: 22px;
      height: 22px;
      opacity: 0;
      transition: opacity 0.2s;
    }

    /* Actions */
    .dialog-actions {
      width: 100%;
      padding: 16px 24px 24px;
      display: flex;
      justify-content: center;
      gap: 12px;
      border-top: 1px solid #f1f5f9;
    }

    .cancel-btn {
      color: #64748b;
      
      &:hover {
        background: #f1f5f9;
      }
    }

    .add-btn {
      background: linear-gradient(135deg, #E5893F 0%, #d4782e 100%);
      color: white;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 20px;
      height: 40px;
      border-radius: 8px;
      
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      
      &:disabled {
        opacity: 0.6;
      }
      
      mat-spinner {
        margin-right: 8px;
      }
    }

    /* Mat Form Field Overrides */
    ::ng-deep {
      .mat-mdc-form-field {
        width: 100%;
        
        .mat-mdc-text-field-wrapper {
          background: #f8fafc;
        }
        
        .mdc-notched-outline__leading,
        .mdc-notched-outline__trailing,
        .mdc-notched-outline__notch {
          border-color: #e2e8f0 !important;
        }
        
        &.mat-focused .mdc-notched-outline__leading,
        &.mat-focused .mdc-notched-outline__trailing,
        &.mat-focused .mdc-notched-outline__notch {
          border-color: #E5893F !important;
        }
        
        input {
          text-align: center;
          
          &::placeholder {
            text-align: center;
          }
        }
      }
    }
  `]
})
export class AddAllowedUserDialogComponent {
  private dialogRef = inject(MatDialogRef<AddAllowedUserDialogComponent>);
  private adminService = inject(AdminService);
  private snackBar = inject(MatSnackBar);

  email = '';
  defaultRole: 'admin' | 'member' = 'member';
  saving = false;
  emailError = '';

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email)) {
      this.emailError = 'Please enter a valid email address';
      return;
    }
    this.emailError = '';

    this.saving = true;

    this.adminService.addAllowedUser({
      email: this.email.trim().toLowerCase(),
      defaultRole: this.defaultRole,
      autoApprove: true // Always auto-approve since admin already authorized them
    }).subscribe({
      next: (response) => {
        this.snackBar.open(`User "${this.email}" added successfully`, 'Close', {
          duration: 3000,
          panelClass: ['success-snackbar']
        });
        this.dialogRef.close(response.allowedUser);
      },
      error: (error) => {
        this.saving = false;
        this.snackBar.open(error.error?.error || 'Failed to add user', 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
