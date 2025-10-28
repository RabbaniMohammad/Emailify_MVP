import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Input, Output, EventEmitter, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, firstValueFrom, takeUntil, Subscription, debounceTime } from 'rxjs';
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
import { CampaignStorageService } from '../../services/campaign-storage.service';

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
export class CampaignSubmitComponent implements OnInit, OnDestroy, OnChanges {
  @Input() templateHtml: string = '';
  @Input() templateId: string = '';
  @Input() runId: string = '';
  @Input() variantNo: string = '';
  @Output() closeRequested = new EventEmitter<void>();

  private destroy$ = new Subject<void>();
  private qa = inject(QaService);
  private ar = inject(ActivatedRoute);
  private storageService = inject(CampaignStorageService);
  private currentSelectedSubject: string | null = null;
  
  // ✅ Flag to prevent saving during initial load
  private isInitialized = false;
  
  // Route params for storage key - now also available as inputs
  private _templateId: string = '';
  private _runId: string = '';
  private _variantNo: string = '';

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

  ngOnChanges(changes: SimpleChanges): void {
    // Update internal params if inputs change
    if (changes['templateId']) {
      this._templateId = this.templateId;
    }
    if (changes['runId']) {
      this._runId = this.runId;
    }
    if (changes['variantNo']) {
      this._variantNo = this.variantNo;
    }
    
    // Save template HTML when it changes (set from parent)
    // Only save if we have valid storage keys
    if (changes['templateHtml'] && changes['templateHtml'].currentValue && this._templateId && this._runId && this._variantNo) {
      this.saveCurrentState();
    }
  }

  constructor(
    private campaignService: CampaignSubmitService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar
  ) {}

ngOnInit(): void {
  // Get route params - prefer @Input over route params for child components
  this._templateId = this.templateId || this.ar.snapshot.paramMap.get('id') || '';
  this._runId = this.runId || this.ar.snapshot.paramMap.get('runId') || '';
  this._variantNo = this.variantNo || this.ar.snapshot.paramMap.get('no') || '';
  // Load saved data if exists
  this.loadSavedData();
  
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
      // ✅ Only update if we have new data (don't overwrite restored data with null)
      if (audience) {
        this.selectedAudience = audience;
        this.saveCurrentState();
      }
      this.cdr.markForCheck();
    });

  this.campaignService.reconciliation$
    .pipe(takeUntil(this.destroy$))
    .subscribe(reconciliation => {
      // ✅ Only update if we have new data (don't overwrite restored data with null)
      if (reconciliation) {
        this.reconciliation = reconciliation;
        this.saveCurrentState();
      }
      this.cdr.markForCheck();
    });

  this.campaignService.timezoneAnalysis$
    .pipe(takeUntil(this.destroy$))
    .subscribe(analysis => {
      // ✅ Only update if we have new data (don't overwrite restored data with null)
      if (analysis) {
        this.timezoneAnalysis = analysis;
        this.saveCurrentState();
      }
      this.cdr.markForCheck();
    });

  // ✅ Auto-save form controls with debounce
  this.subjectControl.valueChanges
    .pipe(
      debounceTime(500),
      takeUntil(this.destroy$)
    )
    .subscribe(value => {
      const trimmedValue = value.trim();
      
      // If input is now empty AND we had a selected subject
      if (!trimmedValue && this.currentSelectedSubject) {
        const subjects = this.subjectsSubject.value || [];
        
        // Add the previous subject back to the list
        this.subjectsSubject.next([...subjects, this.currentSelectedSubject]);
        
        // Clear tracking
        this.currentSelectedSubject = null;
        
        this.cdr.markForCheck();
      }
      
      // Auto-save subject
      this.saveCurrentState();
    });
    
  this.bodyAdditionControl.valueChanges
    .pipe(
      debounceTime(500),
      takeUntil(this.destroy$)
    )
    .subscribe(() => {
      this.saveCurrentState();
    });
  
  // ✅ Mark as initialized - allow saves from now on
  // Small delay to ensure all observables have emitted initial values
  setTimeout(() => {
    this.isInitialized = true;
    // Force change detection to update button state
    this.cdr.markForCheck();
  }, 100);
}

  ngOnDestroy(): void {
    // Save current state before destroying
    this.saveCurrentState();
    
    this.destroy$.next();
    this.destroy$.complete();
    
    // ✅ NEW: Cleanup subjects
    if (this.subjectsSub) this.subjectsSub.unsubscribe();
    if (this.subjectsTimeoutId) clearTimeout(this.subjectsTimeoutId);
  }

  // ============================================
  // PERSISTENCE METHODS
  // ============================================

  /**
   * Load saved data from localStorage
   */
  private loadSavedData(): void {
    if (!this._templateId || !this._runId || !this._variantNo) {
      return;
    }
    const savedData = this.storageService.getCampaignData(
      this._templateId,
      this._runId,
      this._variantNo
    );
    
    if (!savedData || !savedData.savedAt) {
      return;
    }
    // Restore form controls
    if (savedData.subject) {
      this.subjectControl.setValue(savedData.subject, { emitEvent: false });
    }
    if (savedData.bodyAddition) {
      this.bodyAdditionControl.setValue(savedData.bodyAddition, { emitEvent: false });
    }
    
    // Restore state
    if (savedData.selectedAudience) {
      this.selectedAudience = savedData.selectedAudience;
      this.campaignService.selectAudience(savedData.selectedAudience);
    }
    
    if (savedData.masterData && savedData.masterData.length > 0) {
      this.masterData = savedData.masterData;
      this.uploadedFileName = savedData.uploadedFileName || '';
      
      // Set upload state to success to show the upload status UI
      this.uploadLoadingSubject.next('success');
      
      // Re-extract test emails and schedule groups if not already saved
      if (!savedData.testEmails || savedData.testEmails.length === 0) {
        this.testEmails = this.campaignService.extractTestEmails(savedData.masterData);
      }
      
      if (!savedData.scheduleGroups || savedData.scheduleGroups.length === 0) {
        this.scheduleGroups = this.campaignService.groupByScheduleTime(savedData.masterData);
      }
    }
    
    if (savedData.reconciliation) {
      this.reconciliation = savedData.reconciliation;
      // Set reconciliation state to success to show the reconciliation UI
      this.reconcileLoadingSubject.next('success');
    }
    
    if (savedData.scheduleGroups && savedData.scheduleGroups.length > 0) {
      this.scheduleGroups = savedData.scheduleGroups;
    }
    
    if (savedData.timezoneAnalysis) {
      this.timezoneAnalysis = savedData.timezoneAnalysis;
    }
    
    if (savedData.testEmails && savedData.testEmails.length > 0) {
      this.testEmails = savedData.testEmails;
    }
    
    if (savedData.generatedSubjects && savedData.generatedSubjects.length > 0) {
      this.subjectsSubject.next(savedData.generatedSubjects);
    }
    
    if (savedData.testEmailSent) {
      this.testEmailSent = savedData.testEmailSent;
      this.testEmailSentAt = savedData.testEmailSentAt ? new Date(savedData.testEmailSentAt) : null;
    }
    
    // ✅ Restore template HTML if available
    if (savedData.templateHtml && !this.templateHtml) {
      this.templateHtml = savedData.templateHtml;
    }
    
    this.addNewMembersToAudience = savedData.addNewMembersToAudience || false;
    
    // ✅ Log final state after restoration for debugging
    // Force change detection to ensure UI updates
    this.cdr.markForCheck();
    
    // Double-check after a small delay (ensure all async operations complete)
    setTimeout(() => {
      this.cdr.markForCheck();
    }, 0);
  }

  /**
   * Save current state to localStorage
   */
  private saveCurrentState(): void {
    // ✅ Don't save during initial load/restoration
    if (!this.isInitialized) {
      return;
    }
    
    if (!this._templateId || !this._runId || !this._variantNo) {
      return;
    }
    
    const dataToSave = {
      selectedAudience: this.selectedAudience,
      masterData: this.masterData,
      uploadedFileName: this.uploadedFileName,
      reconciliation: this.reconciliation,
      addNewMembersToAudience: this.addNewMembersToAudience,
      scheduleGroups: this.scheduleGroups,
      timezoneAnalysis: this.timezoneAnalysis,
      subject: this.subjectControl.value,
      bodyAddition: this.bodyAdditionControl.value,
      generatedSubjects: this.subjectsSubject.value || [],
      testEmails: this.testEmails,
      testEmailSent: this.testEmailSent,
      testEmailSentAt: this.testEmailSentAt?.toISOString() || null,
      templateHtml: this.templateHtml,
      templateId: this._templateId,
      runId: this._runId,
      variantNo: this._variantNo,
      savedAt: new Date().toISOString()
    };
    this.storageService.saveCampaignData(
      this._templateId,
      this._runId,
      this._variantNo,
      dataToSave
    );
  }

  /**
   * Clear saved data (call after successful submission)
   */
  clearSavedData(): void {
    if (!this._templateId || !this._runId || !this._variantNo) return;
    
    this.storageService.clearCampaignData(
      this._templateId,
      this._runId,
      this._variantNo
    );
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
      
      // ✅ FIX: Set loading to false HERE, before updating subjects
      this.subjectsLoading = false;
      
      // Now update the subjects
      this.subjectsSubject.next(subjects);
      
      // Save generated subjects
      this.saveCurrentState();
      
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
    return;
  }
  
  // Get the index of the clicked subject
  const clickedIndex = subjects.indexOf(selectedSubject);
  
  if (clickedIndex === -1) {

    return;
  }
  
  // Create new subjects array
  const newSubjects = [...subjects];
  
  // If there's a current subject in the form, swap it back into the list
  if (currentFormValue) {
    newSubjects[clickedIndex] = currentFormValue;
  } else {
    // Remove the selected subject from the list (first selection)
    newSubjects.splice(clickedIndex, 1);
  }
  
  // ✅ Track the newly selected subject
  this.currentSelectedSubject = selectedSubject;
  
  // Update form control with selected subject
  this.subjectControl.setValue(selectedSubject);
  
  // Update subjects list
  this.subjectsSubject.next(newSubjects);
  
  // Save state after subject selection
  this.saveCurrentState();
  
  // Trigger change detection
  this.cdr.markForCheck();
  
  // Show success message
  this.showSuccess(`Subject line selected!`);
  
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
    this.audiencesLoadingSubject.next('loading');
    
    try {
      await firstValueFrom(this.campaignService.fetchMailchimpAudiences());
      this.audiencesLoadingSubject.next('success');
    } catch (error) {

      this.audiencesLoadingSubject.next('error');
      this.showError('Failed to load Mailchimp audiences');
    }
  }

  selectAudience(audience: MailchimpAudience): void {
    this.campaignService.selectAudience(audience);
  }

  // ============================================
  // FILE UPLOAD
  // ============================================

  async onFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    
    if (!file) return;

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

      this.showSuccess(`Uploaded ${data.length} rows successfully`);
      
      // Save state after upload
      this.saveCurrentState();

      // Auto-reconcile if audience selected
      if (this.selectedAudience) {
        await this.reconcileAudiences();
      }

    } catch (error) {

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

    this.reconcileLoadingSubject.next('loading');

    try {
      const emails = this.masterData.map(row => row.audiences_list?.trim()).filter(Boolean);

      const result = await firstValueFrom(
        this.campaignService.reconcileAudiences(this.selectedAudience.id, emails)
      );

      // ✅ Store the reconciliation result
      this.reconciliation = result;
      this.reconcileLoadingSubject.next('success');
      this.cdr.markForCheck(); // Trigger change detection
      
      // Save state after reconciliation
      this.saveCurrentState();
    } catch (error) {

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
      
      // Save test email state
      this.saveCurrentState();

      if (result.failed.length > 0) {
        this.showError(`Sent ${result.sent}, failed ${result.failed.length}`);
      } else {
        this.showSuccess(`Test email sent to ${result.sent} recipient(s)`);
      }

    } catch (error) {

      this.testEmailLoadingSubject.next('error');
      this.showError('Failed to send test emails');
    }
  }

  // ============================================
  // SUBMISSION SUMMARY
  // ============================================
  getSubmissionSummary(): { icon: string; text: string; type: 'immediate' | 'timezone' | 'member' | 'warning' }[] {
    // Don't check canSubmit - show summary even during loading
    if (!this.reconciliation || !this.subjectControl.valid || this.scheduleGroups.length === 0) {
      return [];
    }

    const summary: { icon: string; text: string; type: 'immediate' | 'timezone' | 'member' | 'warning' }[] = [];
    
    const hasImmediate = this.hasImmediateSends();
    const immediateCount = this.getImmediateSendCount();
    const hasTimezoneIssues = this.shouldShowTimezoneWarning();
    const hasNewMembers = this.reconciliation && this.reconciliation.summary.newCount > 0;

    // Immediate sends
    if (hasImmediate) {
      summary.push({
        icon: '⚡',
        text: `${immediateCount} email(s) will be sent IMMEDIATELY`,
        type: 'immediate'
      });
    }

    // Timezone warning
    if (hasTimezoneIssues) {
      summary.push({
        icon: '🌍',
        text: this.getTimezoneWarningMessage(),
        type: 'timezone'
      });
    }

    // New members handling
    if (hasNewMembers) {
      if (this.addNewMembersToAudience) {
        summary.push({
          icon: '📋',
          text: `${this.reconciliation!.summary.newCount} new member(s) will be archived after sending`,
          type: 'member'
        });
      } else {
        summary.push({
          icon: '📋',
          text: `${this.reconciliation!.summary.newCount} new member(s) will be archived after sending`,
          type: 'member'
        });
      }
    }

    return summary;
  }

  // ============================================
  // FINAL SUBMISSION
  // ============================================
  async onSubmit(): Promise<void> {
    if (!this.canSubmit) {
      this.showError('Complete all steps before submitting');
      return;
    }

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

    // Simple final confirmation
    const totalRecipients = this.reconciliation?.summary.existingCount || 0;
    if (!confirm(`🚀 Proceed with submission?\n\nThis will send to ${totalRecipients} recipient(s) and cannot be undone.`)) {
      return;
    }

    this.submitLoadingSubject.next('loading');

    try {
      // ✅ STEP 1: ALWAYS add new members (required to send emails)
      if (hasNewMembers && this.selectedAudience) {
        const addResult = await firstValueFrom(
          this.campaignService.addNewMembersToAudience(
            this.selectedAudience.id,
            this.reconciliation!.new
          )
        );
        
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
        await firstValueFrom(
          this.campaignService.cleanupTempMembers(
            this.selectedAudience.id,
            this.reconciliation!.new
          )
        );
        
      }

      this.submitLoadingSubject.next('success');
      
      // Clear saved data after successful submission
      this.clearSavedData();
      
      // Show appropriate success message
      let successMsg = '';
      if (result.message && result.message.includes('sent immediately')) {
        successMsg = `⚠️ Campaign sent immediately! (Scheduling not available on your Mailchimp plan)`;
      } else {
        successMsg = this.addNewMembersToAudience 
          ? `✅ Campaign submitted! ${result.campaignIds.length} campaign(s) scheduled.`
          : `✅ Campaign submitted! ${result.campaignIds.length} campaign(s) scheduled. New members will be archived.`;
      }

      this.showSuccess(successMsg);

      // Don't auto-close, let user stay on the page to see results
      // User can manually go back if needed

    } catch (error) {

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