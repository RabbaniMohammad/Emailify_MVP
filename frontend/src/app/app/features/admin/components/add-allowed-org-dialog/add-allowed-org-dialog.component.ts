import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminService } from '@app/app/core/services/admin.service';

@Component({
  selector: 'app-add-allowed-org-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  template: `
    <div class="dialog-container">
      <!-- Header -->
      <div class="dialog-header">
        <div class="icon-circle">
          <mat-icon>add_business</mat-icon>
        </div>
        <h2>Add Organization</h2>
        <p class="subtitle">Add an organization to the reference list</p>
      </div>

      <!-- Form Content -->
      <div class="form-content">
        <!-- Organization Name -->
        <div class="form-group">
          <label class="form-label">
            <mat-icon>business</mat-icon>
            Organization Name
          </label>
          <mat-form-field appearance="outline" class="full-width">
            <input 
              matInput 
              [(ngModel)]="name" 
              placeholder="e.g., DBS Services"
              required>
          </mat-form-field>
          <div class="slug-preview" *ngIf="name">
            Slug: <strong>{{ getSlugPreview() }}</strong>
          </div>
        </div>

        <!-- Allowed Domains -->
        <div class="form-group">
          <label class="form-label">
            <mat-icon>alternate_email</mat-icon>
            Allowed Domains
            <span class="optional">(optional)</span>
          </label>
          <mat-form-field appearance="outline" class="full-width">
            <input 
              matInput 
              [(ngModel)]="domainsInput" 
              placeholder="@company.com"
              (keydown.enter)="addDomain(); $event.preventDefault()">
          </mat-form-field>
          <div class="hint">Press Enter to add. Leave empty to allow all domains.</div>

          <div class="domains-list" *ngIf="allowedDomains.length > 0">
            <mat-chip-set>
              <mat-chip 
                *ngFor="let domain of allowedDomains; let i = index"
                (removed)="removeDomain(i)"
                [removable]="true">
                {{ domain }}
                <mat-icon matChipRemove>cancel</mat-icon>
              </mat-chip>
            </mat-chip-set>
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
          [disabled]="!name.trim() || saving">
          <mat-spinner *ngIf="saving" diameter="18"></mat-spinner>
          <ng-container *ngIf="!saving">
            <mat-icon>add</mat-icon>
            Add Organization
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
      
      .optional {
        font-weight: 400;
        text-transform: none;
        color: #94a3b8;
        font-size: 0.75rem;
      }
    }

    .full-width {
      width: 100%;
    }

    .slug-preview {
      font-size: 0.8rem;
      color: #64748b;
      margin-top: 4px;
      text-align: center;
      
      strong {
        color: #E5893F;
        font-family: monospace;
      }
    }

    .hint {
      font-size: 0.75rem;
      color: #94a3b8;
      margin-top: 4px;
      text-align: center;
    }

    /* Domains List */
    .domains-list {
      margin-top: 12px;
      width: 100%;
      display: flex;
      justify-content: center;
      
      mat-chip-set {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
      }

      mat-chip {
        background: #e0f2fe !important;
        color: #0369a1 !important;
        font-size: 13px;
      }
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
export class AddAllowedOrgDialogComponent {
  private dialogRef = inject(MatDialogRef<AddAllowedOrgDialogComponent>);
  private adminService = inject(AdminService);
  private snackBar = inject(MatSnackBar);

  name = '';
  domainsInput = '';
  allowedDomains: string[] = [];
  saving = false;

  getSlugPreview(): string {
    if (!this.name) return '—';
    return this.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || '—';
  }

  addDomain(): void {
    const domain = this.domainsInput.trim();
    if (domain) {
      // Ensure domain starts with @
      const formattedDomain = domain.startsWith('@') ? domain : `@${domain}`;
      if (!this.allowedDomains.includes(formattedDomain)) {
        this.allowedDomains.push(formattedDomain);
      }
      this.domainsInput = '';
    }
  }

  removeDomain(index: number): void {
    this.allowedDomains.splice(index, 1);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (!this.name.trim()) return;

    // Add any remaining domain in input
    if (this.domainsInput.trim()) {
      this.addDomain();
    }

    this.saving = true;

    this.adminService.addAllowedOrganization({
      name: this.name.trim(),
      allowedDomains: this.allowedDomains
    }).subscribe({
      next: (response) => {
        this.snackBar.open(`Organization "${this.name}" added successfully`, 'Close', {
          duration: 3000,
          panelClass: ['success-snackbar']
        });
        this.dialogRef.close(response.allowedOrganization);
      },
      error: (error) => {
        this.saving = false;
        this.snackBar.open(error.error?.error || 'Failed to add organization', 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
