import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CampaignService } from '../../../../core/services/campaign.service';
import { OrganizationService } from '../../../../core/services/organization.service';
import { ScheduleEmailDialogComponent } from '../schedule-email-dialog/schedule-email-dialog.component';

interface ValidationData {
  csvFile: File;
  organizationId: string;
  organizationName?: string;
}

interface ValidationResult {
  masterDocument: {
    total: number;
    new: string[];
    existing: string[];
  };
  excludedFromCampaign: {
    total: number;
    subscribers: string[];
  };
  summary: {
    newCount: number;
    existingCount: number;
    excludedCount: number;
    totalInCsv: number;
    totalInMailchimp: number;
  };
}

interface ScheduledEmail {
  email: string;
  time: string;
  timezone: string;
}

@Component({
  selector: 'app-audience-validation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatListModule,
    MatTabsModule,
    MatTooltipModule
  ],
  templateUrl: './audience-validation-dialog.component.html',
  styleUrls: ['./audience-validation-dialog.component.scss']
})
export class AudienceValidationDialogComponent implements OnInit {
  loading = true;
  validationResult: ValidationResult | null = null;
  error: string | null = null;
  addingSubscribers = false;
  addingToMaster = false;

  // Track emails added to master document with schedule info
  addedToMaster: Set<string> = new Set();
  scheduledEmails: Map<string, ScheduledEmail> = new Map();

  // Pagination
  newPage = 0;
  existingPage = 0;
  excludedPage = 0;
  pageSize = 50;

  // Make Math available in template
  Math = Math;

  constructor(
    private dialogRef: MatDialogRef<AudienceValidationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ValidationData,
    private campaignService: CampaignService,
    private orgService: OrganizationService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.validateAudience();
  }

  validateAudience(): void {
    this.loading = true;
    this.error = null;

    const formData = new FormData();
    formData.append('csvFile', this.data.csvFile);

    this.campaignService.validateAudience(formData).subscribe({
      next: (result: any) => {
        console.log('✅ Validation result:', result);
        this.validationResult = result;
        this.loading = false;
      },
      error: (err: any) => {
        console.error('❌ Validation failed:', err);
        this.error = err.error?.error || 'Failed to validate audience';
        this.loading = false;
      }
    });
  }

  get paginatedNew(): string[] {
    if (!this.validationResult) return [];
    const start = this.newPage * this.pageSize;
    return this.validationResult.masterDocument.new.slice(start, start + this.pageSize);
  }

  get paginatedExisting(): string[] {
    if (!this.validationResult) return [];
    const start = this.existingPage * this.pageSize;
    return this.validationResult.masterDocument.existing.slice(start, start + this.pageSize);
  }

  get paginatedExcluded(): string[] {
    if (!this.validationResult) return [];
    const start = this.excludedPage * this.pageSize;
    return this.validationResult.excludedFromCampaign.subscribers.slice(start, start + this.pageSize);
  }

  get hasMoreNew(): boolean {
    return this.validationResult 
      ? (this.newPage + 1) * this.pageSize < this.validationResult.masterDocument.new.length
      : false;
  }

  get hasMoreExisting(): boolean {
    return this.validationResult 
      ? (this.existingPage + 1) * this.pageSize < this.validationResult.masterDocument.existing.length
      : false;
  }

  get hasMoreExcluded(): boolean {
    return this.validationResult 
      ? (this.excludedPage + 1) * this.pageSize < this.validationResult.excludedFromCampaign.subscribers.length
      : false;
  }

  nextNewPage(): void {
    if (this.hasMoreNew) this.newPage++;
  }

  prevNewPage(): void {
    if (this.newPage > 0) this.newPage--;
  }

  nextExistingPage(): void {
    if (this.hasMoreExisting) this.existingPage++;
  }

  prevExistingPage(): void {
    if (this.existingPage > 0) this.existingPage--;
  }

  nextExcludedPage(): void {
    if (this.hasMoreExcluded) this.excludedPage++;
  }

  prevExcludedPage(): void {
    if (this.excludedPage > 0) this.excludedPage--;
  }

  addAllNewSubscribers(): void {
    if (!this.validationResult || this.validationResult.masterDocument.new.length === 0) {
      return;
    }

    const orgName = this.data.organizationName || 'audience';
    const confirmMsg = `Add ${this.validationResult.masterDocument.new.length} new subscribers to ${orgName}?`;
    if (!confirm(confirmMsg)) return;

    this.addingSubscribers = true;

    const subscribers = this.validationResult.masterDocument.new.map(email => ({
      email,
      firstName: '',
      lastName: ''
    }));

    this.orgService.bulkImportSubscribers(this.data.organizationId, subscribers).subscribe({
      next: (result: any) => {
        console.log('✅ Added subscribers:', result);
        alert(`Successfully added ${result.addedCount} subscribers to ${orgName}!`);
        
        // Re-validate to update the UI
        this.validateAudience();
        this.addingSubscribers = false;
      },
      error: (err: any) => {
        console.error('❌ Failed to add subscribers:', err);
        alert('Failed to add subscribers: ' + (err.error?.error || 'Unknown error'));
        this.addingSubscribers = false;
      }
    });
  }

  addExcludedToMaster(email: string): void {
    if (this.addedToMaster.has(email)) {
      // Already added, remove it (toggle off)
      this.addedToMaster.delete(email);
      this.scheduledEmails.delete(email);
      return;
    }

    // Open schedule dialog
    const dialogRef = this.dialog.open(ScheduleEmailDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      panelClass: 'schedule-email-dialog-container',
      data: { email }
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        // Add to master document with schedule info
        this.addedToMaster.add(email);
        this.scheduledEmails.set(email, {
          email: result.email,
          time: result.time || '',
          timezone: result.timezone || ''
        });
      }
    });
  }

  addAllExcludedToMaster(): void {
    if (!this.validationResult || this.validationResult.excludedFromCampaign.total === 0) {
      return;
    }

    // Open schedule dialog for all excluded subscribers
    const dialogRef = this.dialog.open(ScheduleEmailDialogComponent, {
      width: '700px',
      maxWidth: '90vw',
      panelClass: 'schedule-email-dialog-container',
      data: { email: `All ${this.validationResult.excludedFromCampaign.total} excluded subscribers` }
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        this.addingToMaster = true;

        // Mark all as added to master with the same schedule
        this.validationResult!.excludedFromCampaign.subscribers.forEach((email: string) => {
          this.addedToMaster.add(email);
          this.scheduledEmails.set(email, {
            email,
            time: result.time || '',
            timezone: result.timezone || ''
          });
        });

        this.addingToMaster = false;
      }
    });
  }

  proceed(): void {
    // Close dialog and pass validation result + added emails + scheduled emails back
    this.dialogRef.close({
      validated: true,
      result: this.validationResult,
      addedToMaster: Array.from(this.addedToMaster),
      scheduledEmails: Array.from(this.scheduledEmails.values())
    });
  }

  cancel(): void {
    this.dialogRef.close({ validated: false });
  }
}
