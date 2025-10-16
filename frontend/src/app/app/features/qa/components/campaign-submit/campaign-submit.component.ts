import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, firstValueFrom, takeUntil, Subscription } from 'rxjs';
import { timeout, catchError, retry } from 'rxjs/operators';
import { 
  CampaignSubmitService, 
  MailchimpAudience, 
  MasterDocRow, 
  AudienceReconciliation,
  ScheduleGroup,
  TimezoneAnalysis
} from '../../pages/use-variant-page/campaign-submit.service';
import { QaService } from '../../services/qa.service';
import { ActivatedRoute } from '@angular/router';

import { FormsModule } from '@angular/forms';

type LoadingState = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-campaign-submit',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  templateUrl: './campaign-submit.component.html',
  styleUrls: ['./campaign-submit.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CampaignSubmitComponent implements OnInit, OnDestroy {
  @Input() templateHtml: string = '';
  @Output() closeRequested = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private qa = inject(QaService);
  private ar = inject(ActivatedRoute);

  // Form Controls
  subjectControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(150)]
  });

  bodyAdditionControl = new FormControl<string>('', { nonNullable: true });

  // State Management
  private audiencesLoadingSubject = new BehaviorSubject<LoadingState>('idle');
  readonly audiencesLoading$ = this.audiencesLoadingSubject.asObservable();

  private uploadLoadingSubject = new BehaviorSubject<LoadingState>('idle');
  readonly uploadLoading$ = this.uploadLoadingSubject.asObservable();

  private reconcileLoadingSubject = new BehaviorSubject<LoadingState>('idle');
  readonly reconcileLoading$ = this.reconcileLoadingSubject.asObservable();

  private testEmailLoadingSubject = new BehaviorSubject<LoadingState>('idle');
  readonly testEmailLoading$ = this.testEmailLoadingSubject.asObservable();

  private submitLoadingSubject = new BehaviorSubject<LoadingState>('idle');
  readonly submitLoading$ = this.submitLoadingSubject.asObservable();

  // ✅ NEW: Subject line generation
  private subjectsSubject = new BehaviorSubject<string[] | null>(null);
  readonly subjects$ = this.subjectsSubject.asObservable();
  subjectsLoading = false;
  private subjectsTimeoutId?: number;
  private subjectsAborted = false;
  private subjectsSub?: Subscription;
  private readonly SUBJECTS_TIMEOUT = 60000; // 60 seconds
  // currentSubject: string = ''; // Store current subject input value

  addNewMembersToAudience = false;

  // Data
  audiences: MailchimpAudience[] = [];
  selectedAudience: MailchimpAudience | null = null;
  masterData: MasterDocRow[] = [];
  reconciliation: AudienceReconciliation | null = null;
  scheduleGroups: ScheduleGroup[] = [];
  testEmails: string[] = [];
  
  timezoneAnalysis: TimezoneAnalysis | null = null;
  
  // Test email tracking
  testEmailSent = false;
  testEmailSentAt: Date | null = null;

  // File upload
  uploadedFileName: string = '';

  get isAnyLoading(): boolean {
    return (
      this.audiencesLoadingSubject.value === 'loading' ||
      this.uploadLoadingSubject.value === 'loading' ||
      this.reconcileLoadingSubject.value === 'loading' ||
      this.testEmailLoadingSubject.value === 'loading' ||
      this.submitLoadingSubject.value === 'loading'
    );
  }

  get canSendTest(): boolean {
    return (
      this.testEmails.length > 0 &&
      this.subjectControl.valid &&
      this.testEmailLoadingSubject.value !== 'loading'
    );
  }

  get canSubmit(): boolean {
    return (
      this.subjectControl.valid &&
      this.reconciliation !== null &&
      this.scheduleGroups.length > 0 &&
      this.submitLoadingSubject.value !== 'loading'
    );
  }

  constructor(
    private campaignService: CampaignSubmitService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar
  ) {}

ngOnInit(): void {
  this.loadMailchimpAudiences();
  
  // Subscribe to service observables
  this.campaignService.audiences$
    .pipe(takeUntil(this.destroy$))
    .subscribe(audiences => {
      this.audiences = audiences;
      this.cdr.markForCheck();
    });

  this.campaignService.selectedAudience$
    .pipe(takeUntil(this.destroy$))
    .subscribe(audience => {
      this.selectedAudience = audience;
      this.cdr.markForCheck();
    });

  this.campaignService.reconciliation$
    .pipe(takeUntil(this.destroy$))
    .subscribe(reconciliation => {
      this.reconciliation = reconciliation;
      this.cdr.markForCheck();
    });

  this.campaignService.timezoneAnalysis$
    .pipe(takeUntil(this.destroy$))
    .subscribe(analysis => {
      this.timezoneAnalysis = analysis;
      this.cdr.markForCheck();
    });

  // ✅ REMOVE: Don't load cached subjects on init
  // Let user explicitly trigger generation
}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    // ✅ NEW: Cleanup subjects
    if (this.subjectsSub) this.subjectsSub.unsubscribe();
    if (this.subjectsTimeoutId) clearTimeout(this.subjectsTimeoutId);
  }

  // ============================================
  // ✅ NEW: SUBJECT LINE GENERATION
  // ============================================

  /**
   * Generate AI subject line suggestions
   */
async onGenerateSubjects(): Promise<void> {
  const templateId = this.ar.snapshot.paramMap.get('id');
  if (!templateId) {
    this.showError('Template ID not found');
    return;
  }
  
  if (this.subjectsLoading) return;
  
  console.log('🎯 Generating subject lines for template:', templateId);
  
  // ✅ CLEAR existing subjects before starting new generation
  this.subjectsSubject.next(null);
  
  this.subjectsLoading = true;
  this.subjectsAborted = false;
  this.cdr.markForCheck();
  
  // Set timeout
  this.subjectsTimeoutId = window.setTimeout(() => {
    this.handleSubjectsTimeout();
  }, this.SUBJECTS_TIMEOUT);
  
  // ✅ GET TEMPLATE HTML - Pass actual template content
  const templateHtml = this.templateHtml || '';
  
  this.subjectsSub = this.qa.generateSubjects(templateId, templateHtml, true).pipe(
    timeout(this.SUBJECTS_TIMEOUT),
    retry({ count: 2, delay: 2000, resetOnSuccess: true }),
    catchError(error => {
      if (error.name === 'TimeoutError') {
        throw new Error('Subject generation timed out. Please try again.');
      }
      throw error;
    })
  ).subscribe({
    next: (subjects) => {
      if (this.subjectsAborted) return;
      
      if (this.subjectsTimeoutId) {
        clearTimeout(this.subjectsTimeoutId);
        this.subjectsTimeoutId = undefined;
      }
      
      console.log('✅ Generated subjects:', subjects);
      
      // ✅ FIX: Set loading to false HERE, before updating subjects
      this.subjectsLoading = false;
      
      // Now update the subjects
      this.subjectsSubject.next(subjects);
      
      this.showSuccess(`Generated ${subjects.length} subject line suggestion${subjects.length > 1 ? 's' : ''}!`);
      this.cdr.markForCheck();
    },
    error: (error) => {
      if (this.subjectsAborted) return;
      
      if (this.subjectsTimeoutId) {
        clearTimeout(this.subjectsTimeoutId);
        this.subjectsTimeoutId = undefined;
      }
      
      this.subjectsLoading = false;
      this.subjectsAborted = true;
      
      // ✅ CLEAR subjects on error
      this.subjectsSubject.next(null);
      
      const errorMessage = this.getErrorMessage(error, 'subject generation');
      this.showError(errorMessage);
      
      this.cdr.markForCheck();
    },
    complete: () => {
      if (this.subjectsAborted) return;
      // Loading already set to false in next handler
      this.cdr.markForCheck();
    }
  });
}

  /**
   * Handle subject generation timeout
   */
  private handleSubjectsTimeout(): void {
    this.subjectsLoading = false;
    this.subjectsAborted = true;
    
    this.showError('Subject generation is taking longer than expected. Please try again.');
    this.cdr.markForCheck();
  }

  /**
   * Cancel subject generation
   */
  cancelSubjects(): void {
    if (!this.subjectsLoading) return;
    
    this.subjectsAborted = true;
    this.subjectsLoading = false;
    
    if (this.subjectsSub) {
      this.subjectsSub.unsubscribe();
      this.subjectsSub = undefined;
    }
    
    if (this.subjectsTimeoutId) {
      clearTimeout(this.subjectsTimeoutId);
      this.subjectsTimeoutId = undefined;
    }
    
    this.showError('Subject generation cancelled.');
    this.cdr.markForCheck();
  }

  /**
   * Select a subject line suggestion
   * - If no current subject: Set as current
   * - If current subject exists: Swap with clicked suggestion
   */
onSelectSubject(selectedSubject: string): void {
  const subjects = this.subjectsSubject.value || [];
  
  // ✅ FIX: Always get current value from form control
  const currentFormValue = this.subjectControl.value.trim();
  
  // If this subject is already selected (in input), do nothing
  if (currentFormValue === selectedSubject) {
    console.log('ℹ️ Subject already selected');
    return;
  }
  
  console.log('🔄 Selecting subject:', selectedSubject);
  console.log('  Current subject in form:', currentFormValue);
  
  // Get the index of the clicked subject
  const clickedIndex = subjects.indexOf(selectedSubject);
  
  if (clickedIndex === -1) {
    console.error('❌ Subject not found in list');
    return;
  }
  
  // Create new subjects array
  const newSubjects = [...subjects];
  
  // If there's a current subject in the form, swap it back into the list
  if (currentFormValue) {
    console.log('  Swapping with:', currentFormValue);
    newSubjects[clickedIndex] = currentFormValue;
  } else {
    // Remove the selected subject from the list (first selection)
    console.log('  Removing from list (first selection)');
    newSubjects.splice(clickedIndex, 1);
  }
  
  // Update form control with selected subject
  this.subjectControl.setValue(selectedSubject);
  
  // Update subjects list
  this.subjectsSubject.next(newSubjects);
  
  // Trigger change detection
  this.cdr.markForCheck();
  
  // Show success message
  this.showSuccess(`Subject line selected!`);
  
  console.log('✅ New subjects list:', newSubjects);
  console.log('✅ Selected subject:', selectedSubject);
}


  /**
   * Check if a subject is currently selected (in the input)
   */
isSubjectSelected(subject: string): boolean {
  // ✅ FIX: Always check against form control value
  return this.subjectControl.value.trim() === subject;
}

  /**
   * Track by function for subject chips
   */
  trackByIndex = (index: number): number => index;

  /**
   * Get error message from error object
   */
  private getErrorMessage(error: any, operation: string): string {
    if (error?.message?.includes('timeout') || error?.name === 'TimeoutError') {
      return `${operation} timed out. The server might be busy. Please try again.`;
    }
    
    if (error?.status === 0 || error?.message?.includes('Http failure')) {
      return `Cannot connect to server. Please check if the backend is running.`;
    }
    
    if (error?.status === 500) {
      return `Server error during ${operation}. Please try again.`;
    }
    
    if (error?.status === 404) {
      return `Resource not found. Please refresh the page.`;
    }
    
    return error?.message || `An error occurred during ${operation}. Please try again.`;
  }

  // ============================================
  // MAILCHIMP AUDIENCES
  // ============================================

  async loadMailchimpAudiences(): Promise<void> {
    console.log('📥 Loading Mailchimp audiences...');
    this.audiencesLoadingSubject.next('loading');
    
    try {
      await firstValueFrom(this.campaignService.fetchMailchimpAudiences());
      this.audiencesLoadingSubject.next('success');
      console.log('✅ Audiences loaded');
    } catch (error) {
      console.error('❌ Failed to load audiences:', error);
      this.audiencesLoadingSubject.next('error');
      this.showError('Failed to load Mailchimp audiences');
    }
  }

  selectAudience(audience: MailchimpAudience): void {
    console.log('🎯 Selected audience:', audience.name);
    this.campaignService.selectAudience(audience);
  }

  // ============================================
  // FILE UPLOAD
  // ============================================

  async onFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    
    if (!file) return;

    console.log('📤 Uploading file:', file.name);
    this.uploadedFileName = file.name;
    this.uploadLoadingSubject.next('loading');

    try {
      const data = await firstValueFrom(
        this.campaignService.uploadMasterDocument(file)
      );

      this.masterData = data;
      this.uploadLoadingSubject.next('success');
      
      // Extract test emails
      this.testEmails = this.campaignService.extractTestEmails(data);
      
      // Group by schedule
      this.scheduleGroups = this.campaignService.groupByScheduleTime(data);

      console.log('✅ File uploaded successfully');
      console.log('📊 Rows:', data.length);
      console.log('📧 Test emails:', this.testEmails.length);
      console.log('📅 Schedule groups:', this.scheduleGroups.length);

      this.showSuccess(`Uploaded ${data.length} rows successfully`);

      // Auto-reconcile if audience selected
      if (this.selectedAudience) {
        await this.reconcileAudiences();
      }

    } catch (error) {
      console.error('❌ Upload failed:', error);
      this.uploadLoadingSubject.next('error');
      this.showError('Failed to upload file. Check format.');
    } finally {
      input.value = ''; // Reset input
    }
  }

  // ============================================
  // RECONCILIATION
  // ============================================

  async reconcileAudiences(): Promise<void> {
    if (!this.selectedAudience || !this.masterData.length) {
      this.showError('Select audience and upload file first');
      return;
    }

    console.log('🔄 Reconciling audiences...');
    this.reconcileLoadingSubject.next('loading');

    try {
      const emails = this.masterData.map(row => row.audiences_list?.trim()).filter(Boolean);

      await firstValueFrom(
        this.campaignService.reconcileAudiences(this.selectedAudience.id, emails)
      );

      this.reconcileLoadingSubject.next('success');
      console.log('✅ Reconciliation complete');
      
    } catch (error) {
      console.error('❌ Reconciliation failed:', error);
      this.reconcileLoadingSubject.next('error');
      this.showError('Failed to reconcile audiences');
    }
  }

  // ============================================
  // TEST EMAIL
  // ============================================

  async sendTestEmail(): Promise<void> {
    if (!this.canSendTest) {
      this.showError('Add subject and ensure test emails exist');
      return;
    }

    const confirmed = confirm(
      `Send test email to ${this.testEmails.length} recipient(s)?\n\n${this.testEmails.slice(0, 5).join('\n')}${this.testEmails.length > 5 ? '\n...' : ''}`
    );

    if (!confirmed) return;

    console.log('📧 Sending test emails...');
    this.testEmailLoadingSubject.next('loading');

    try {
      const subject = this.subjectControl.value;
      let html = this.templateHtml;

      // Append body addition if provided
      if (this.bodyAdditionControl.value.trim()) {
        html += `\n\n<!-- Additional Content -->\n${this.bodyAdditionControl.value}`;
      }

      const result = await firstValueFrom(
        this.campaignService.sendTestEmails(this.testEmails, subject, html)
      );

      this.testEmailLoadingSubject.next('success');
      this.testEmailSent = true;
      this.testEmailSentAt = new Date();

      console.log('✅ Test emails sent:', result.sent);
      
      if (result.failed.length > 0) {
        this.showError(`Sent ${result.sent}, failed ${result.failed.length}`);
      } else {
        this.showSuccess(`Test email sent to ${result.sent} recipient(s)`);
      }

    } catch (error) {
      console.error('❌ Test email failed:', error);
      this.testEmailLoadingSubject.next('error');
      this.showError('Failed to send test emails');
    }
  }

  // ============================================
  // FINAL SUBMISSION
  // ============================================
  async onSubmit(): Promise<void> {
    if (!this.canSubmit) {
      this.showError('Complete all steps before submitting');
      return;
    }

    const hasImmediate = this.hasImmediateSends();
    const immediateCount = this.getImmediateSendCount();
    const hasTimezoneIssues = this.shouldShowTimezoneWarning();
    const hasNoTestEmails = this.testEmails.length === 0;
    const hasNewMembers = this.reconciliation && this.reconciliation.summary.newCount > 0;

    // ⚠️ CRITICAL: Block submission if no test emails AND user hasn't explicitly confirmed
    if (hasNoTestEmails) {
      const noTestConfirm = confirm(
        '🚨 CRITICAL WARNING 🚨\n\n' +
        '❌ NO TEST EMAILS FOUND\n' +
        '🔴 Click OK ONLY if you accept full responsibility.'
      );

      if (!noTestConfirm) return;
    }

    // Build warnings
    let warnings: string[] = [];

    if (hasNoTestEmails) {
      warnings.push('🚨 NO TEST EMAILS - Campaign is UNTESTED');
    } else if (!this.testEmailSent) {
      warnings.push('⚠️ Test email NOT sent');
    }

    if (hasImmediate) {
      warnings.push(`⚡ ${immediateCount} email(s) will be sent IMMEDIATELY`);
    }

    if (hasTimezoneIssues) {
      warnings.push(`🌍 ${this.getTimezoneWarningMessage()}`);
    }

    if (this.addNewMembersToAudience && hasNewMembers) {
      warnings.push(`➕ ${this.reconciliation!.summary.newCount} new member(s) will be saved permanently`);
    } else if (hasNewMembers) {
      warnings.push(`🗄️ ${this.reconciliation!.summary.newCount} new member(s) will be archived after sending`);
    }

    // Standard warning confirmations
    if (warnings.length > 0) {
      const warning1 = '⚠️ SUBMISSION SUMMARY:\n\n' + 
        warnings.map((w, i) => `${i + 1}. ${w}`).join('\n') + 
        '\n\nProceed with submission?';
      
      if (!confirm(warning1)) return;

      // Extra confirmation if test not sent (but test emails exist)
      if (!hasNoTestEmails && !this.testEmailSent) {
        const warning2 = 
          '⚠️ FINAL WARNING ⚠️\n\n' +
          'Test email available but NOT sent.\n' +
          'Submitting untested campaign.\n\n' +
          'Click OK to proceed.';
        
        if (!confirm(warning2)) return;
      }
    } else {
      // Normal confirmation flow (all good)
      if (!confirm(`📧 Send to ${this.reconciliation?.summary.existingCount || 0} recipients?\n\nContinue?`)) return;
      if (!confirm('🚀 FINAL CONFIRMATION\n\nThis cannot be undone.\n\nProceed?')) return;
    }

    console.log('🚀 Submitting campaign...');
    this.submitLoadingSubject.next('loading');

    try {
      // ✅ STEP 1: ALWAYS add new members (required to send emails)
      if (hasNewMembers && this.selectedAudience) {
        console.log(`➕ Adding ${this.reconciliation!.summary.newCount} new members...`);
        
        const addResult = await firstValueFrom(
          this.campaignService.addNewMembersToAudience(
            this.selectedAudience.id,
            this.reconciliation!.new
          )
        );
        
        console.log(`✅ Added ${addResult.addedCount} members`);
      }

      // ✅ STEP 2: Submit campaign
      const subject = this.subjectControl.value;
      let html = this.templateHtml;

      if (this.bodyAdditionControl.value.trim()) {
        html += `\n\n<!-- Additional Content -->\n${this.bodyAdditionControl.value}`;
      }

      const result = await firstValueFrom(
        this.campaignService.submitCampaign({
          subject,
          bodyAddition: this.bodyAdditionControl.value || undefined,
          templateHtml: html,
          scheduleGroups: this.scheduleGroups,
          testEmails: this.testEmails,
          timezoneAnalysis: this.timezoneAnalysis!
        })
      );

      // ✅ STEP 3: Archive new members if checkbox UNCHECKED
      if (hasNewMembers && !this.addNewMembersToAudience && this.selectedAudience) {
        console.log('🗄️ Archiving temporary members...');
        
        await firstValueFrom(
          this.campaignService.cleanupTempMembers(
            this.selectedAudience.id,
            this.reconciliation!.new
          )
        );
        
        console.log('✅ Temporary members archived');
      }

      this.submitLoadingSubject.next('success');
      
      console.log('✅ Campaign submitted');
      console.log('📋 Campaign IDs:', result.campaignIds);

      const successMsg = this.addNewMembersToAudience 
        ? `Campaign submitted! ${result.campaignIds.length} campaign(s) scheduled.`
        : `Campaign submitted! ${result.campaignIds.length} campaign(s) scheduled. New members will be archived.`;

      this.showSuccess(successMsg);

      setTimeout(() => {
        this.closeRequested.emit();
      }, 2000);

    } catch (error) {
      console.error('❌ Submission failed:', error);
      this.submitLoadingSubject.next('error');
      this.showError('Campaign submission failed. Please try again.');
    }
  }

  getTestEmailTooltip(): string {
    if (this.testEmails.length === 0) {
      return 'No test emails found in uploaded file';
    }
    
    if (!this.subjectControl.valid || !this.subjectControl.value.trim()) {
      return 'Add subject line first';
    }
    
    if (this.testEmailLoadingSubject.value === 'loading') {
      return 'Sending test email...';
    }
    
    return 'Send test email to recipient(s)';
  }

  // ============================================
  // TIMEZONE HELPER METHODS
  // ============================================

  hasImmediateSends(): boolean {
    return this.scheduleGroups.some(g => g.isImmediate);
  }

  getImmediateSendCount(): number {
    const immediateGroup = this.scheduleGroups.find(g => g.isImmediate);
    return immediateGroup?.count || 0;
  }

  /**
   * Get tooltip text for Submit Campaign button
   */
  getSubmitTooltip(): string {
    if (!this.subjectControl.valid || !this.subjectControl.value.trim()) {
      return 'Add subject line first';
    }
    
    if (!this.reconciliation) {
      return 'Upload and reconcile audience data first';
    }
    
    if (this.scheduleGroups.length === 0) {
      return 'No scheduled recipients found';
    }
    
    if (this.submitLoadingSubject.value === 'loading') {
      return 'Submitting campaign...';
    }
    
    return 'Submit campaign to Mailchimp';
  }

  getTimezoneWarningMessage(): string {
    if (!this.timezoneAnalysis) return '';
    
    const analysis = this.timezoneAnalysis;
    
    if (!analysis.hasTimezoneColumn || analysis.timezoneMode === 'none') {
      return `No timezone specified. All emails will be scheduled in your local timezone (${this.getBrowserTimezone()})`;
    }
    
    if (analysis.timezoneMode === 'single') {
      return `All emails will be sent in timezone: ${analysis.uniqueTimezones[0]}`;
    }
    
    if (analysis.timezoneMode === 'multiple') {
      return `Using per-customer timezones (${analysis.uniqueTimezones.length} different zones)`;
    }
    
    if (analysis.timezoneMode === 'mixed') {
      return `${analysis.emptyTimezoneCount} email(s) missing timezone will use local time (${this.getBrowserTimezone()})`;
    }
    
    return '';
  }

  getBrowserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  shouldShowTimezoneWarning(): boolean {
    if (!this.timezoneAnalysis) return false;
    
    return !this.timezoneAnalysis.hasTimezoneColumn ||
           this.timezoneAnalysis.timezoneMode === 'none' ||
           this.timezoneAnalysis.timezoneMode === 'mixed';
  }

  shouldShowTimezoneInfo(): boolean {
    if (!this.timezoneAnalysis) return false;
    
    return this.timezoneAnalysis.timezoneMode === 'single' ||
           this.timezoneAnalysis.timezoneMode === 'multiple';
  }

  // ============================================
  // UTILITIES
  // ============================================

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom'
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom'
    });
  }

  getSubjectCharCount(): string {
    const count = this.subjectControl.value.length;
    return `${count}/150`;
  }

  getTestEmailsSentTime(): string {
    if (!this.testEmailSentAt) return '';
    
    const now = new Date();
    const diff = Math.floor((now.getTime() - this.testEmailSentAt.getTime()) / 1000 / 60);
    
    if (diff < 1) return 'Just now';
    if (diff === 1) return '1 min ago';
    if (diff < 60) return `${diff} mins ago`;
    
    const hours = Math.floor(diff / 60);
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
  }
}