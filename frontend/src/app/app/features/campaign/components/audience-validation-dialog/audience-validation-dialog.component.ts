import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OptInPolicyDialogComponent } from '../opt-in-policy-dialog/opt-in-policy-dialog.component';
import { CampaignService } from '../../../../core/services/campaign.service';
import { OrganizationService } from '../../../../core/services/organization.service';
import { ScheduleEmailDialogComponent } from '../schedule-email-dialog/schedule-email-dialog.component';

interface ValidationData {
  csvFile: File;
  organizationId: string;
  organizationName?: string;
  uploadId?: string;
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
  // Optional Instagram info (added by backend)
  instagramHandles?: string[];
  instagramSummary?: {
    total: number;
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
  FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatListModule,
    MatTabsModule,
    MatTooltipModule
  ,MatCheckboxModule, MatFormFieldModule, MatInputModule
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
  consentSubmitted = false;
  savedConsentRecord: any = null;

  // Consent form state
  consent: any = {
    sms_optin: false,
    whatsapp_optin: false,
    instagram_optin: false,
    email_optin: false,
    understand: false,
    proof_file: null,
    proof_page_url: '',
    description: '',
  };

  get consentComplete(): boolean {
    return !!this.consent.sms_optin && !!this.consent.whatsapp_optin && !!this.consent.instagram_optin && !!this.consent.email_optin && !!this.consent.understand && !!this.consent.proof_file;
  }

  get canProceed(): boolean {
    return !this.loading && this.consentComplete;
  }

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
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Do not auto-validate CSV here. Consent must be captured first by the client
    this.loading = false;
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
    const count = this.validationResult.masterDocument.new.length;
    
    // Use Material snackbar with action instead of confirm()
    const snackBarRef = this.snackBar.open(
      `Add ${count} new subscribers to ${orgName}?`,
      'Add',
      {
        duration: 10000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
        panelClass: ['confirm-snackbar']
      }
    );

    snackBarRef.onAction().subscribe(() => {
      this.addingSubscribers = true;

      const subscribers = this.validationResult!.masterDocument.new.map(email => ({
        email,
        firstName: '',
        lastName: ''
      }));

      this.orgService.bulkImportSubscribers(this.data.organizationId, subscribers).subscribe({
        next: (result: any) => {
          console.log('✅ Added subscribers:', result);
          
          // Show success snackbar instead of alert()
          this.snackBar.open(
            `Successfully added ${result.addedCount} subscribers to ${orgName}!`,
            'Close',
            {
              duration: 5000,
              horizontalPosition: 'center',
              verticalPosition: 'top',
              panelClass: ['success-snackbar']
            }
          );
          
          // Re-validate to update the UI
          this.validateAudience();
          this.addingSubscribers = false;
        },
        error: (err: any) => {
          console.error('❌ Failed to add subscribers:', err);
          
          // Show error snackbar instead of alert()
          this.snackBar.open(
            'Failed to add subscribers: ' + (err.error?.error || 'Unknown error'),
            'Close',
            {
              duration: 7000,
              horizontalPosition: 'center',
              verticalPosition: 'top',
              panelClass: ['error-snackbar']
            }
          );
          
          this.addingSubscribers = false;
        }
      });
    });
  }

  onProofFileChange(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.consent.proof_file = input.files[0];
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
    // Two-step proceed logic:
    // - If consent not yet submitted: open policy dialog, submit consent, and then validate CSV in-place.
    // - If consent already submitted and we have validation results: final confirmation -> close and return results to caller.

    // Finalize and return if we already validated
    if (this.consentSubmitted && this.validationResult) {
      // Return the validation result and any additions the user made in-dialog
      const addedToMaster = Array.from(this.addedToMaster);
      const scheduledEmails = Array.from(this.scheduledEmails.values());
      this.dialogRef.close({ validated: true, consentRecord: this.savedConsentRecord, result: this.validationResult, addedToMaster, scheduledEmails });
      return;
    }

    // Ensure all required checkboxes + proof are present before opening policy
    if (!this.consentComplete) {
      this.snackBar.open('Please complete all required confirmations and upload proof before continuing.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
      return;
    }

    const policyRef = this.dialog.open(OptInPolicyDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true
    });

    policyRef.afterClosed().subscribe((accepted: boolean) => {
      if (!accepted) {
        this.snackBar.open('You must agree to the Messaging & Opt-In Policy to proceed.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
        return;
      }

      // Submit consent to backend (will store proof_file if provided)
      const formData = new FormData();
      formData.append('sms_optin', String(this.consent.sms_optin));
      formData.append('whatsapp_optin', String(this.consent.whatsapp_optin));
      formData.append('instagram_optin', String(this.consent.instagram_optin));
      formData.append('email_optin', String(this.consent.email_optin));
      formData.append('proof_page_url', this.consent.proof_page_url || '');
      formData.append('description', this.consent.description || '');
      // include client-provided upload id if available
      formData.append('uploadId', ((this.data as any)?.uploadId) || '');
      if (this.consent.proof_file) {
        formData.append('proof_file', this.consent.proof_file);
      }

      this.loading = true;
      this.campaignService.submitUploadConsent(formData).subscribe({
        next: (resp: any) => {
          this.loading = false;
          this.consentSubmitted = true;
          this.savedConsentRecord = resp.record;

          // After consent is saved and linked server-side, persist parsed master document to UploadMaster
          // so the audit chain is complete, then run audience validation to show reconciliation results.
          this.loading = true;
          this.campaignService.uploadMasterDocument(this.data.csvFile, (this.data as any)?.uploadId).subscribe({
            next: (parsed: any) => {
              // Parsed master persisted to UploadMaster on the server
              // Now run validation to compute new/existing/excluded lists
              this.validateAudience();
            },
            error: (err: any) => {
              console.error('Failed to persist master document after consent:', err);
              this.loading = false;
              this.snackBar.open('Failed to parse and save the uploaded file. Please try again.', 'Close', { duration: 7000, panelClass: ['error-snackbar'] });
            }
          });
        },
        error: (err: any) => {
          console.error('Failed to submit consent:', err);
          this.loading = false;
          this.snackBar.open('Failed to save consent. Please try again.', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
        }
      });
    });
  }

  cancel(): void {
    this.dialogRef.close({ validated: false });
  }
}
