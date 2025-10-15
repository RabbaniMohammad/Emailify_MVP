import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay, of, Subscription, Observable } from 'rxjs';
import { timeout, catchError, retry } from 'rxjs/operators';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';
import { QaService, VariantItem, VariantsRun, GoldenResult, EditStatus, EditDiagnostics } from '../../services/qa.service';
import { HtmlPreviewComponent } from '../../components/html-preview/html-preview.component';
import { TemplatesPageComponent } from '../../../templates/pages/templates-page/templates-page.component';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { HttpClient } from '@angular/common/http';
import { TemplatesService } from '../../../../core/services/templates.service';
import { PreviewCacheService } from '../../../templates/components/template-preview/preview-cache.service';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';

/* ------------------------------------------------------------------ */
/*              ✅ NEW: Atomic Verification Types                     */
/* ------------------------------------------------------------------ */

// interface EditDiagnostics {
//   normalizedFind?: string;
//   rawOccurrences?: number;
//   normalizedOccurrences?: number;
//   contextMatched?: boolean;
//   crossesBoundary?: boolean;
//   locations?: Array<{
//     tag: string;
//     line?: number;
//     actualContext: string;
//     confidence: number;
//   }>;
//   timings?: {
//     search: number;
//     apply: number;
//     verify: number;
//   };
// }

// interface EditResult {
//   index: number;
//   edit: {
//     find: string;
//     replace: string;
//     before_context: string;
//     after_context: string;
//     reason?: string;
//   };
//   status: EditStatus;
//   reason?: string;
//   change?: {
//     before: string;
//     after: string;
//     parent: string;
//     reason?: string;
//   };
//   diagnostics?: EditDiagnostics;
// }

// interface AtomicStats {
//   total: number;
//   applied: number;
//   failed: number;
//   blocked: number;
//   skipped: number;
// }

// interface AtomicTimings {
//   total: number;
//   parsing: number;
//   processing: number;
//   verification: number;
// }

// ✅ UPDATED: GoldenResult interface
// export interface GoldenResult {
//   html: string;
//   edits?: Array<{ find: string; replace: string; reason?: string }>;
//   changes?: Array<{ before: string; after: string; parent: string; reason?: string }>;
  
//   // ✅ NEW: Atomic verification data (all optional for backward compatibility)
//   atomicResults?: EditResult[];
//   failedEdits?: Array<{
//     find?: string;
//     replace?: string;
//     before_context?: string;
//     after_context?: string;
//     reason?: string;
//     status?: EditStatus;
//     diagnostics?: EditDiagnostics;
//   }>;
//   stats: {
//     total: number;
//     applied: number;
//     failed: number;
//     blocked: number;
//     skipped: number;
//   };
//   timings: {
//     total: number;
//     parsing: number;
//     processing: number;
//     verification: number;
//   };
// }

type SuggestionResult = {
  gibberish: Array<{ text: string; reason: string }>;
  suggestions: string[];
};

@Component({
  selector: 'app-qa-page',
  standalone: true,
  imports: [
    CommonModule,
    HtmlPreviewComponent,
    TemplatesPageComponent,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
  ],
  templateUrl: './qa-page.component.html',
  styleUrls: ['./qa-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInUp', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(30px)' }),
        animate('0.5s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ]),
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.3s ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('0.3s ease-in', style({ opacity: 0 }))
      ])
    ]),
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.4s ease-out', style({ opacity: 1 }))
      ])
    ]),
    trigger('slideIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-20px)' }),
        animate('0.4s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, transform: 'translateX(0)' }))
      ])
    ]),
    trigger('expandIn', [
      transition(':enter', [
        style({ opacity: 0, height: 0, overflow: 'hidden' }),
        animate('0.5s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, height: '*' }))
      ])
    ]),
    trigger('pulse', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('0.3s ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ])
    ]),
    trigger('chipAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.8) translateY(10px)' }),
        animate('0.3s cubic-bezier(0.34, 1.56, 0.64, 1)', 
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }))
      ])
    ]),
    trigger('listAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-10px)' }),
        animate('0.3s ease-out', 
          style({ opacity: 1, transform: 'translateX(0)' }))
      ])
    ]),
    trigger('variantAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(30px) scale(0.95)' }),
        animate('0.5s cubic-bezier(0.34, 1.56, 0.64, 1)', 
          style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ])
    ]),
    trigger('modalContentAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))
      ])
    ])
  ]
})




export class QaPageComponent implements OnDestroy {
  private ar = inject(ActivatedRoute);
  private qa = inject(QaService);
  private router = inject(Router);
  private http = inject(HttpClient);
  private templatesService = inject(TemplatesService);
  private previewCache = inject(PreviewCacheService);
  private cdr = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);

  // Timeout configurations
  private readonly GOLDEN_TIMEOUT = 120000;
  private readonly SUBJECTS_TIMEOUT = 60000;
  private readonly SUGGESTIONS_TIMEOUT = 90000;
  private readonly VARIANTS_START_TIMEOUT = 60000;
  private readonly VARIANTS_NEXT_TIMEOUT = 120000;
  private readonly VARIANTS_TOTAL_TIMEOUT = 600000;

  private goldenTimeoutId?: number;
  private subjectsTimeoutId?: number;
  private suggestionsTimeoutId?: number;
  private variantsTimeoutId?: number;
  private variantsTotalTimeoutId?: number;

  templateId: string | null = null;

  // Abort flags
  private goldenAborted = false;
  private subjectsAborted = false;
  private suggestionsAborted = false;
  private variantsAborted = false;

  // Active subscriptions for each operation
  private goldenSub?: Subscription;
  private subjectsSub?: Subscription;
  private suggestionsSub?: Subscription;
  
  // Subscriptions for cleanup
  private subscriptions: Subscription[] = [];

  templateHtml = '';
  templateLoading = true;

  readonly id$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));

  private goldenSubject = new BehaviorSubject<GoldenResult | null>(null);
  readonly golden$ = this.goldenSubject.asObservable();
  goldenLoading = false;

  private subjectsSubject = new BehaviorSubject<string[] | null>(null);
  readonly subjects$ = this.subjectsSubject.asObservable();
  subjectsLoading = false;

    // ============================================
  // 🆕 NEW: Visual Editor Properties
  // ============================================

  // Visual Editor Modal state
  showVisualEditorModal = false;

  // Visual Editor button color state
  visualEditorButtonColor: 'orange' | 'red' | 'green' = 'orange';

  // Shake animation flag
  shouldShake = false;

  // SessionStorage keys
  private readonly SHAKE_FLAG_KEY = 'qa_shake_animation';

  private suggestionsSubject = new BehaviorSubject<SuggestionResult | null>(null);
  readonly suggestions$ = this.suggestionsSubject.asObservable();
  suggestionsLoading = false;

  private variantsRunId: string | null = null;
  private variantsSubject = new BehaviorSubject<VariantsRun | null>(null);
  readonly variants$ = this.variantsSubject.asObservable();
  variantsGenerating = false;

  // ✅ NEW: Debug mode toggle
  showDebugInfo = false;

constructor() {
  const idSub = this.id$.subscribe(id => {
    this.templateId = id;

    const cachedGolden = this.qa.getGoldenCached(id);
    const cachedSubjects = this.qa.getSubjectsCached(id);
    const cachedSuggestions = this.qa.getSuggestionsCached(id);
    
    this.goldenSubject.next(cachedGolden);
    this.subjectsSubject.next(cachedSubjects);
    this.suggestionsSubject.next(cachedSuggestions);
    
    if (cachedGolden?.html) {
      this.goldenLoading = false;
      console.log('✅ Restored cached golden');
      
      // 🆕 NEW: Update button color based on cached golden
      this.updateVisualEditorButtonColor(cachedGolden.failedEdits);
    }
    
    if (cachedSubjects?.length) {
      this.subjectsLoading = false;
      console.log('✅ Restored cached subjects');
    }
    
    if (cachedSuggestions) {
      this.suggestionsLoading = false;
      console.log('✅ Restored cached suggestions');
    }

    const prevRun = this.qa.getVariantsRunCached(id);
    if (prevRun) {
      this.variantsSubject.next(prevRun);
      this.variantsGenerating = false;
      console.log('✅ Restored cached variants');
    }
    this.variantsRunId = prevRun?.runId || null;
    
    this.loadOriginalTemplate(id);
    
    // 🆕 MOVED HERE: Check for return from visual editor AFTER everything is loaded
    this.checkForVisualEditorReturn();
    
    this.cdr.markForCheck();
  });
  
  this.subscriptions.push(idSub);
}
  // ============================================
  // NAVIGATION & REFRESH GUARDS
  // ============================================

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isGenerating()) {
      const message = this.getLoadingStateMessage();
      event.preventDefault();
      event.returnValue = message;
      return;
    }
  }

  canDeactivate(): boolean | Observable<boolean> {
    if (!this.isGenerating()) {
      return true;
    }

    const message = this.getLoadingStateMessage();
    const confirmed = confirm(
      `${message}\n\nAre you sure you want to leave? All progress will be lost.`
    );

    if (confirmed) {
      this.cleanupOnExit();
    }

    return confirmed;
  }

  private isGenerating(): boolean {
    return this.goldenLoading || this.subjectsLoading || this.variantsGenerating;
  }

  private getLoadingStateMessage(): string {
    if (!this.isGenerating()) {
      return '';
    }
    return '⚠️ Generation is in progress and will be lost if you leave.';
  }

  private cleanupOnExit(): void {
    console.log('🧹 Cleaning up on exit...');

    if (this.goldenLoading) {
      this.goldenAborted = true;
      this.goldenLoading = false;
      if (this.goldenSub) {
        this.goldenSub.unsubscribe();
        this.goldenSub = undefined;
      }
    }

    if (this.subjectsLoading) {
      this.subjectsAborted = true;
      this.subjectsLoading = false;
      if (this.subjectsSub) {
        this.subjectsSub.unsubscribe();
        this.subjectsSub = undefined;
      }
    }

    if (this.variantsGenerating) {
      this.variantsAborted = true;
      this.variantsGenerating = false;
    }

    this.clearAllTimeouts();
    console.log('✅ Cleanup complete');
  }

  ngOnDestroy(): void {
    console.log('🔴 Component destroying...');
    this.cleanupOnExit();
    
    if (this.goldenSub) this.goldenSub.unsubscribe();
    if (this.subjectsSub) this.subjectsSub.unsubscribe();
    if (this.suggestionsSub) this.suggestionsSub.unsubscribe();
    
    this.subscriptions.forEach(sub => sub.unsubscribe());
    console.log('✅ Component destroyed');
  }

  private clearAllTimeouts(): void {
    if (this.goldenTimeoutId) clearTimeout(this.goldenTimeoutId);
    if (this.subjectsTimeoutId) clearTimeout(this.subjectsTimeoutId);
    if (this.suggestionsTimeoutId) clearTimeout(this.suggestionsTimeoutId);
    if (this.variantsTimeoutId) clearTimeout(this.variantsTimeoutId);
    if (this.variantsTotalTimeoutId) clearTimeout(this.variantsTotalTimeoutId);
  }

  // ============================================
  // MAIN METHODS
  // ============================================

  getSkeletonArray(target: number, currentCount: number): number[] {
    const remaining = target - currentCount;
    return Array(Math.max(0, remaining)).fill(0);
  }

  onBypassVariants(): void {
    if (!this.templateId) {
      this.showWarning('Template ID not found');
      return;
    }

    const golden = this.goldenSubject.value;
    
    if (!golden?.html) {
      this.showWarning('No golden template available to bypass with');
      return;
    }

    const syntheticRun: VariantsRun = {
      runId: `bypass-${this.templateId}`,
      target: 1,
      items: [{
        no: 1,
        html: golden.html,
        changes: [],
        why: ['Using Golden Template directly - variants generation bypassed'],
        artifacts: { usedIdeas: [] }
      }]
    };

    this.qa.clearChatForRun(syntheticRun.runId, 1);
    this.qa.clearSnapsForRun(syntheticRun.runId);
    
    try {
      sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
    } catch (e) {
      console.error('Failed to store synthetic run:', e);
    }

    this.showSuccess('Bypassing variants - using Golden Template directly...');
    this.router.navigate(['/qa', this.templateId, 'use', syntheticRun.runId, 1]);
  }

  onSkipToChat(): void {
    if (!this.templateId) {
      this.showWarning('Template ID not found');
      return;
    }

    if (!this.templateHtml || this.templateLoading) {
      this.showWarning('Template is still loading. Please wait...');
      return;
    }

    const syntheticRun: VariantsRun = {
      runId: `skip-${this.templateId}`,
      target: 1,
      items: [{
        no: 1,
        html: this.templateHtml,
        changes: [],
        why: ['Original template - skipped generation'],
        artifacts: { usedIdeas: [] }
      }]
    };

    this.qa.clearChatForRun(syntheticRun.runId, 1);
    this.qa.clearSnapsForRun(syntheticRun.runId);
    
    try {
      sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
    } catch (e) {
      console.error('Failed to store synthetic run:', e);
    }

    this.showSuccess('Skipping to chat interface with original template...');
    this.router.navigate(['/qa', this.templateId, 'use', syntheticRun.runId, 1]);
  }

  // ============================================
  // ✅ UPDATED: GOLDEN GENERATION
  // ============================================

onGenerateGolden(id: string) {
  if (this.goldenLoading) return;
  
  console.log('\n🌟 ============ GENERATE GOLDEN (Frontend) ============');
  console.log('📋 Template ID:', id);
  
  this.goldenLoading = true;
  this.goldenAborted = false;
  this.cdr.markForCheck();

   // 🆕 NEW: Clear shake animation flag for new generation
  const shakeKey = `${this.SHAKE_FLAG_KEY}_${id}`;
  sessionStorage.removeItem(shakeKey);
  console.log('🗑️ [onGenerateGolden] Cleared shake flag for new generation:', shakeKey);

  this.goldenTimeoutId = window.setTimeout(() => {
    this.handleGoldenTimeout();
  }, this.GOLDEN_TIMEOUT);

  const startTime = Date.now();

  this.goldenSub = this.qa.generateGolden(id, true).pipe(
    timeout(this.GOLDEN_TIMEOUT),
    retry({ count: 2, delay: 3000, resetOnSuccess: true }),
    catchError(error => {
      if (error.name === 'TimeoutError') {
        throw new Error('Golden template generation timed out. Please try again.');
      }
      throw error;
    })
  ).subscribe({
    next: (res) => {
      if (this.goldenAborted) return;
      
      const responseTime = Date.now() - startTime;
      console.log('\n✅ Golden response received in', responseTime, 'ms');
      
      if (this.goldenTimeoutId) {
        clearTimeout(this.goldenTimeoutId);
        this.goldenTimeoutId = undefined;
      }
      
      // ✅ Log atomic verification results
      if (res.stats) {
        console.log('📊 STATS:');
        console.log('  Total:', res.stats.total);
        console.log('  ✅ Applied:', res.stats.applied);
        console.log('  ❌ Failed:', res.stats.failed);
        console.log('  🚫 Blocked:', res.stats.blocked);
        console.log('  ⏭️ Skipped:', res.stats.skipped);
      }
      
      if (res.timings) {
        console.log('⏱️ TIMINGS:');
        console.log('  Total:', res.timings.total, 'ms');
        console.log('  Parsing:', res.timings.parsing, 'ms');
        console.log('  Processing:', res.timings.processing, 'ms');
        console.log('  Verification:', res.timings.verification, 'ms');
      }
      
      if (res.failedEdits && res.failedEdits.length > 0) {
        console.log('\n⚠️ FAILED EDITS:', res.failedEdits.length);
        res.failedEdits.forEach((edit, idx) => {
          console.log(`\n  [${idx + 1}] Status: ${edit.status ?? 'unknown'}`);
          console.log(`      Find: "${edit.find?.substring(0, 50) ?? ''}"`);
          console.log(`      Reason: ${edit.reason ?? 'No reason provided'}`);
          if (edit.diagnostics) {
            console.log(`      Raw occurrences: ${edit.diagnostics.rawOccurrences ?? 0}`);
            console.log(`      Normalized occurrences: ${edit.diagnostics.normalizedOccurrences ?? 0}`);
          }
        });
      }
      
      console.log('==========================================\n');
      
      this.goldenSubject.next(res);
      
      // 🆕 NEW: Update visual editor button color
      console.log('🎨 [onGenerateGolden] Updating visual editor button color');
      this.updateVisualEditorButtonColor(res.failedEdits);
      
      // 🆕 NEW: Trigger shake animation if failed edits exist
      if (res.failedEdits && res.failedEdits.length > 0) {
        console.log('🔔 [onGenerateGolden] Failed edits detected, triggering shake animation');
        this.triggerShakeAnimationOnce(id);
      } else {
        console.log('✅ [onGenerateGolden] No failed edits, no shake animation needed');
      }
      
      // ✅ Show appropriate success message
      const appliedCount = res.stats?.applied ?? res.changes?.length ?? 0;
      const failedCount = res.stats?.failed ?? 0;
      
      if (failedCount > 0) {
        this.showWarning(
          `Golden template generated! Applied ${appliedCount} change(s), but ${failedCount} edit(s) could not be applied. Check diagnostics below.`
        );
      } else {
        this.showSuccess(`Golden template generated successfully! Applied ${appliedCount} change(s).`);
      }
      
      this.cdr.markForCheck();
    },
    error: (e) => {
      if (this.goldenAborted) return;
      
      console.error('❌ GOLDEN ERROR:', e);
      
      if (this.goldenTimeoutId) {
        clearTimeout(this.goldenTimeoutId);
        this.goldenTimeoutId = undefined;
      }
      
      this.goldenLoading = false;
      this.goldenAborted = true;
      
      const errorMessage = this.getErrorMessage(e, 'golden template generation');
      this.showError(errorMessage);
      
      this.cdr.markForCheck();
    },
    complete: () => {
      if (this.goldenAborted) return;
      this.goldenLoading = false;
      console.log('✅ Golden generation complete');
      this.cdr.markForCheck();
    }
  });
}

  private handleGoldenTimeout(): void {
    console.error('Golden template generation timed out');
    this.goldenLoading = false;
    this.goldenAborted = true;
    
    this.showError(
      'Golden template generation is taking longer than expected. The server might be busy. Please try again.'
    );
    
    this.cdr.markForCheck();
  }

  cancelGolden(): void {
    if (!this.goldenLoading) return;
    
    this.goldenAborted = true;
    this.goldenLoading = false;
    
    if (this.goldenSub) {
      this.goldenSub.unsubscribe();
      this.goldenSub = undefined;
    }
    
    if (this.goldenTimeoutId) {
      clearTimeout(this.goldenTimeoutId);
      this.goldenTimeoutId = undefined;
    }
    
    this.cdr.markForCheck();
  }

  // ============================================
  // SUBJECTS
  // ============================================

  onGenerateSubjects(id: string) {
    if (this.subjectsLoading) return;
    
    this.subjectsLoading = true;
    this.subjectsAborted = false;
    this.cdr.markForCheck();

    this.subjectsTimeoutId = window.setTimeout(() => {
      this.handleSubjectsTimeout();
    }, this.SUBJECTS_TIMEOUT);

    this.subjectsSub = this.qa.generateSubjects(id, true).pipe(
      timeout(this.SUBJECTS_TIMEOUT),
      retry({ count: 2, delay: 2000, resetOnSuccess: true }),
      catchError(error => {
        if (error.name === 'TimeoutError') {
          throw new Error('Subject generation timed out. Please try again.');
        }
        throw error;
      })
    ).subscribe({
      next: (list) => {
        if (this.subjectsAborted) return;
        
        if (this.subjectsTimeoutId) {
          clearTimeout(this.subjectsTimeoutId);
          this.subjectsTimeoutId = undefined;
        }
        
        this.subjectsSubject.next(list);
        this.showSuccess(`Generated ${list.length} subject idea(s)!`);
      },
      error: (e) => {
        if (this.subjectsAborted) return;
        
        if (this.subjectsTimeoutId) {
          clearTimeout(this.subjectsTimeoutId);
          this.subjectsTimeoutId = undefined;
        }
        
        this.subjectsLoading = false;
        this.subjectsAborted = true;
        
        const errorMessage = this.getErrorMessage(e, 'subject generation');
        this.showError(errorMessage);
        
        this.cdr.markForCheck();
      },
      complete: () => {
        if (this.subjectsAborted) return;
        this.subjectsLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private handleSubjectsTimeout(): void {
    console.error('Subject generation timed out');
    this.subjectsLoading = false;
    this.subjectsAborted = true;
    
    this.showError('Subject generation is taking longer than expected. Please try again.');
    this.cdr.markForCheck();
  }

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
    
    this.cdr.markForCheck();
  }

  // ============================================
  // SUGGESTIONS
  // ============================================

  onAnalyzeSuggestions(id: string) {
    if (this.suggestionsLoading) return;
    
    this.suggestionsLoading = true;
    this.suggestionsAborted = false;
    this.cdr.markForCheck();

    this.suggestionsTimeoutId = window.setTimeout(() => {
      this.handleSuggestionsTimeout();
    }, this.SUGGESTIONS_TIMEOUT);

    this.suggestionsSub = this.qa.generateSuggestions(id, true).pipe(
      timeout(this.SUGGESTIONS_TIMEOUT),
      retry({ count: 2, delay: 3000, resetOnSuccess: true }),
      catchError(error => {
        if (error.name === 'TimeoutError') {
          throw new Error('Suggestions analysis timed out. Please try again.');
        }
        throw error;
      })
    ).subscribe({
      next: (res) => {
        if (this.suggestionsAborted) return;
        
        if (this.suggestionsTimeoutId) {
          clearTimeout(this.suggestionsTimeoutId);
          this.suggestionsTimeoutId = undefined;
        }
        
        this.suggestionsSubject.next(res);
        this.showSuccess('Suggestions analysis complete!');
        
        setTimeout(() => {
          const scrollableContent = document.querySelector('.col-2 .scrollable-content');
          const suggestionsPanel = document.querySelector('.suggestions-panel');
          
          if (scrollableContent && suggestionsPanel) {
            const containerRect = scrollableContent.getBoundingClientRect();
            const suggestionRect = suggestionsPanel.getBoundingClientRect();
            const scrollTop = suggestionRect.top - containerRect.top + scrollableContent.scrollTop;
            
            scrollableContent.scrollTo({
              top: scrollTop - 20,
              behavior: 'smooth'
            });
          }
        }, 300);
      },
      error: (e) => {
        if (this.suggestionsAborted) return;
        
        if (this.suggestionsTimeoutId) {
          clearTimeout(this.suggestionsTimeoutId);
          this.suggestionsTimeoutId = undefined;
        }
        
        this.suggestionsLoading = false;
        this.suggestionsAborted = true;
        
        const errorMessage = this.getErrorMessage(e, 'suggestions analysis');
        this.showError(errorMessage);
        
        this.cdr.markForCheck();
      },
      complete: () => {
        if (this.suggestionsAborted) return;
        this.suggestionsLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private handleSuggestionsTimeout(): void {
    console.error('Suggestions analysis timed out');
    this.suggestionsLoading = false;
    this.suggestionsAborted = true;
    
    this.showError('Suggestions analysis is taking longer than expected. Please try again.');
    this.cdr.markForCheck();
  }

  cancelSuggestions(): void {
    if (!this.suggestionsLoading) return;
    
    this.suggestionsAborted = true;
    this.suggestionsLoading = false;
    
    if (this.suggestionsSub) {
      this.suggestionsSub.unsubscribe();
      this.suggestionsSub = undefined;
    }
    
    if (this.suggestionsTimeoutId) {
      clearTimeout(this.suggestionsTimeoutId);
      this.suggestionsTimeoutId = undefined;
    }
    
    this.showWarning('Suggestions analysis cancelled.');
    this.cdr.markForCheck();
  }

  // ============================================
  // VARIANTS
  // ============================================

  async onGenerateVariants(templateId: string) {
    if (this.variantsGenerating) return;

    const golden = this.goldenSubject.value;
    const goldenHtml = golden?.html || '';
    if (!goldenHtml) {
      this.showWarning('Please generate a golden template first.');
      return;
    }

    this.variantsGenerating = true;
    this.variantsAborted = false;
    this.variantsSubject.next({ 
      runId: 'initializing', 
      target: 5, 
      items: [] 
    });
    this.cdr.markForCheck();

    this.variantsTotalTimeoutId = window.setTimeout(() => {
      this.handleVariantsTotalTimeout();
    }, this.VARIANTS_TOTAL_TIMEOUT);

    let variantAttempt = 0;
    let hasShownSlowWarning = false;

    try {
      const start = await firstValueFrom(
        this.qa.startVariants(templateId, goldenHtml, 5).pipe(
          timeout(this.VARIANTS_START_TIMEOUT),
          catchError(error => {
            if (error.name === 'TimeoutError') {
              throw new Error('Failed to start variant generation. Please try again.');
            }
            throw error;
          })
        )
      );

      if (this.variantsAborted) {
        this.cleanupVariants();
        return;
      }

      this.variantsRunId = start.runId;
      let run: VariantsRun = { runId: start.runId, target: start.target, items: [] };
      this.variantsSubject.next(run);
      this.qa.saveVariantsRun(templateId, run);

      this.showSuccess('Variant generation started!');

      setTimeout(() => {
        const variantsSection = document.querySelector('.variants-section');
        if (variantsSection) {
          variantsSection.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 300);

      for (let i = 0; i < start.target; i++) {
        if (this.variantsAborted) {
          const current = this.variantsSubject.value;
          if (current) {
            current.target = current.items.length;
            this.qa.saveVariantsRun(templateId, current);
          }
          this.cleanupVariants();
          return;
        }

        variantAttempt++;

        try {
          const item = await firstValueFrom(
            this.qa.nextVariant(start.runId).pipe(
              timeout(this.VARIANTS_NEXT_TIMEOUT),
              retry({ count: 1, delay: 2000 }),
              catchError(error => {
                console.warn(`Variant ${i + 1} generation failed:`, error);
                
                if (!hasShownSlowWarning) {
                  hasShownSlowWarning = true;
                  this.showWarning(
                    'Connection issue detected. Retrying... This is taking longer than usual.'
                  );
                }
                
                if (error.name === 'TimeoutError') {
                  throw new Error(`Variant ${i + 1} generation timed out.`);
                }
                throw error;
              })
            )
          );

          if ((item as any)?.done) break;

          run = { ...run, items: [...run.items, item] };
          this.variantsSubject.next(run);
          this.qa.saveVariantsRun(templateId, run);
          this.cdr.markForCheck();

        } catch (variantError) {
          console.error(`Failed to generate variant ${i + 1}:`, variantError);
          this.showWarning(`Variant ${i + 1} failed, continuing with others...`);
          continue;
        }
      }

      if (this.variantsTotalTimeoutId) {
        clearTimeout(this.variantsTotalTimeoutId);
        this.variantsTotalTimeoutId = undefined;
      }

      const finalCount = run.items.length;
      this.showSuccess(`Successfully generated ${finalCount} variant(s)!`);

    } catch (e) {
      console.error('Variants generation error:', e);
      this.variantsAborted = true;
      const errorMessage = this.getErrorMessage(e, 'variant generation');
      this.showError(errorMessage);
      
    } finally {
      this.variantsGenerating = false;
      this.cleanupVariants();
      this.cdr.markForCheck();
    }
  }

  private handleVariantsTotalTimeout(): void {
    console.error('Total variants generation timed out');
    
    const current = this.variantsSubject.value;
    if (current && this.templateId) {
      current.target = current.items.length;
      this.variantsSubject.next(current);
      this.qa.saveVariantsRun(this.templateId, current);
    }
    
    this.variantsGenerating = false;
    this.variantsAborted = true;
    
    this.showError(
      'Variant generation timed out. Partial results have been saved and are available to use.'
    );
    
    this.cleanupVariants();
    this.cdr.markForCheck();
  }

  private cleanupVariants(): void {
    if (this.variantsTimeoutId) {
      clearTimeout(this.variantsTimeoutId);
      this.variantsTimeoutId = undefined;
    }
    if (this.variantsTotalTimeoutId) {
      clearTimeout(this.variantsTotalTimeoutId);
      this.variantsTotalTimeoutId = undefined;
    }
  }

  cancelVariants(): void {
    if (!this.variantsGenerating) return;
    
    this.variantsAborted = true;
    this.variantsGenerating = false;
    
    const current = this.variantsSubject.value;
    if (current && this.templateId) {
      current.target = current.items.length;
      this.variantsSubject.next(current);
      this.qa.saveVariantsRun(this.templateId, current);
    }
    
    this.cleanupVariants();
    
    const count = current?.items?.length || 0;
    if (count > 0) {
      this.showWarning(`Variant generation cancelled. ${count} variant(s) generated and available to use.`);
    } else {
      this.showWarning('Variant generation cancelled.');
    }
    
    this.cdr.markForCheck();
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

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

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 8000,
      panelClass: ['error-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private showWarning(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['warning-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 6000,
      panelClass: ['info-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  private loadOriginalTemplate(templateId: string) {
    console.log('Loading template from cache/service:', templateId);
    this.templateLoading = true;
    this.templateHtml = '';
    
    const cachedHtml = this.previewCache.get(templateId) || this.previewCache.getPersisted(templateId);
    
    if (cachedHtml) {
      console.log('Found template in cache');
      this.templateHtml = cachedHtml;
      this.templateLoading = false;
      this.cdr.markForCheck();
      return;
    }
    
    const currentState = this.templatesService.snapshot;
    const template = currentState.items.find(item => item.id === templateId);
    
    if (template?.content) {
      console.log('Found template in service');
      this.templateHtml = template.content;
      this.templateLoading = false;
      this.cdr.markForCheck();
      return;
    }
    
    console.log('Template not found in cache or service, fetching from API');
    this.http.get(`/api/templates/${templateId}/raw`, { responseType: 'text' })
      .subscribe({
        next: (html) => {
          console.log('Template loaded from API');
          this.templateHtml = html;
          this.templateLoading = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          console.error('Failed to load template:', error);
          this.templateHtml = 'Failed to load template';
          this.templateLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  onUseVariant(templateId: string, runId: string, no: number) {
    this.router.navigate(['/qa', templateId, 'use', runId, no]);
  }

  // ============================================
  // ✅ NEW: Helper Functions for Diagnostics
  // ============================================

  toggleDebugInfo(): void {
    this.showDebugInfo = !this.showDebugInfo;
    console.log('🐛 Debug mode:', this.showDebugInfo ? 'ON' : 'OFF');
  }

getStatusIcon(status: EditStatus): string {
  const icons: Record<EditStatus, string> = {
    'applied': 'check_circle',
    'not_found': 'search_off',
    'blocked': 'block',
    'skipped': 'skip_next',
    'context_mismatch': 'find_in_page',
    'boundary_issue': 'link_off',
    'already_correct': 'done_all',
  };
  return icons[status] || 'error';
}

getStatusColor(status: EditStatus): string {
  const colors: Record<EditStatus, string> = {
    'applied': 'success',
    'not_found': 'error',
    'blocked': 'warn',
    'skipped': 'disabled',
    'context_mismatch': 'warn',
    'boundary_issue': 'warn',
    'already_correct': 'info',
  };
  return colors[status] || 'error';
}

getStatusLabel(status: EditStatus): string {
  const labels: Record<EditStatus, string> = {
    'applied': 'Applied',
    'not_found': 'Not Found',
    'blocked': 'Blocked',
    'skipped': 'Skipped',
    'context_mismatch': 'Context Mismatch',
    'boundary_issue': 'Boundary Issue',
    'already_correct': 'Already Correct',
  };
  return labels[status] || 'Unknown';
}

  getFailureRecommendation(edit: any): string {
    if (!edit?.status) return 'No diagnostic information available.';
    
    switch (edit.status) {
      case 'not_found':
        return 'The text may have been already corrected, or GPT hallucinated this error.';
      case 'context_mismatch':
        return 'The text exists but the surrounding context doesn\'t match. Manual review recommended.';
      case 'boundary_issue':
        return 'The text spans across interactive elements (links/buttons). Cannot be edited safely.';
      case 'blocked':
        return 'Blocked for safety reasons (contains URLs or merge tags).';
      default:
        return 'Unknown issue. Please report this to developers.';
    }
  }

  trackByIndex = (i: number) => i;
  trackByEdit = (i: number, e: any) => e.before + '|' + e.after + '|' + (e.parent || '');
  trackByFailedEdit = (index: number, edit: any) => `${edit.find}_${edit.replace}_${index}`;

    // ============================================
  // 🆕 NEW: Visual Editor Functions
  // ============================================

  /**
   * Updates the visual editor button color based on failed edits
   */
  private updateVisualEditorButtonColor(failedEdits: any[] | undefined): void {
    console.log('🎨 [updateVisualEditorButtonColor] Updating button color');
    console.log('📊 [updateVisualEditorButtonColor] Failed edits count:', failedEdits?.length || 0);
    
    if (!failedEdits || failedEdits.length === 0) {
      this.visualEditorButtonColor = 'green';
      console.log('✅ [updateVisualEditorButtonColor] No failed edits → GREEN');
    } else {
      this.visualEditorButtonColor = 'red';
      console.log('🔴 [updateVisualEditorButtonColor] Failed edits exist → RED');
    }
    
    this.cdr.markForCheck();
}

/**
 * Triggers shake animation once per session when failed edits are detected
 */
/**
 * Triggers shake animation once per session when failed edits are detected (AUTO)
 */
private triggerShakeAnimationOnce(templateId: string): void {
  console.log('🔔 [triggerShakeAnimationOnce] Checking shake animation');
  
  const shakeKey = `${this.SHAKE_FLAG_KEY}_${templateId}`;
  const alreadyShown = sessionStorage.getItem(shakeKey);
  
  if (alreadyShown === 'true') {
    console.log('⏭️ [triggerShakeAnimationOnce] Already shown this session, skipping');
    return;
  }
  
  console.log('🎯 [triggerShakeAnimationOnce] Triggering shake animation NOW');
  
  // Set flag to prevent repeat AUTO-trigger
  sessionStorage.setItem(shakeKey, 'true');
  console.log('💾 [triggerShakeAnimationOnce] Saved flag:', shakeKey);
  
  // Trigger animation
  this.triggerShakeAnimation();
}

/**
 * Triggers shake animation (MANUAL - no session check)
 */
private triggerShakeAnimation(): void {
  console.log('🎯 [triggerShakeAnimation] Triggering shake animation');
  
  // Trigger animation via property
  this.shouldShake = true;
  this.cdr.markForCheck();
  
  // Remove animation class after 1 second
  setTimeout(() => {
    this.shouldShake = false;
    this.cdr.markForCheck();
    console.log('✅ [triggerShakeAnimation] Shake animation complete');
  }, 1000);
}

/**
 * Handles click on golden template preview - triggers shake if failed edits exist
 */
/**
 * Handles click on golden template preview - triggers shake if failed edits exist
 */
onGoldenTemplateClick(): void {
  console.log('🖱️ [onGoldenTemplateClick] Golden template clicked');
  
  const golden = this.goldenSubject.value;
  const failedCount = golden?.failedEdits?.length || 0;
  
  console.log('📊 [onGoldenTemplateClick] Failed edits count:', failedCount);
  
  if (failedCount > 0) {
    console.log('🔔 [onGoldenTemplateClick] Failed edits exist - triggering shake');
    this.triggerShakeAnimation(); // ✅ NEW - no session check, shakes every time
  } else {
    console.log('ℹ️ [onGoldenTemplateClick] No failed edits, no shake needed');
  }
}

/**
 * Opens the Visual Editor modal
 */
openVisualEditorModal(): void {
  console.log('🚪 [openVisualEditorModal] Opening modal');
  
  const golden = this.goldenSubject.value;
  const failedCount = golden?.failedEdits?.length || 0;
  console.log('📊 [openVisualEditorModal] Failed edits count:', failedCount);
  
  this.showVisualEditorModal = true;
  this.cdr.markForCheck();
  
  console.log('✅ [openVisualEditorModal] Modal opened');
}

/**
 * Closes the Visual Editor modal
 */
closeVisualEditorModal(): void {
  console.log('🚪 [closeVisualEditorModal] Closing modal');
  
  this.showVisualEditorModal = false;
  this.cdr.markForCheck();
  
  console.log('✅ [closeVisualEditorModal] Modal closed');
}

/**
 * Navigates to Visual Editor with golden HTML
 */
navigateToVisualEditor(): void {
  console.log('🚀 [navigateToVisualEditor] Starting navigation to visual editor');
  
  if (!this.templateId) {
    console.error('❌ [navigateToVisualEditor] No template ID found');
    this.showError('Template ID not found');
    return;
  }
  
  const golden = this.goldenSubject.value;
  
  if (!golden?.html) {
    console.error('❌ [navigateToVisualEditor] No golden HTML found');
    this.showError('Golden template not found. Please generate golden template first.');
    return;
  }
  
  console.log('💾 [navigateToVisualEditor] Storing data in sessionStorage');
  console.log('📊 [navigateToVisualEditor] Golden HTML length:', golden.html.length);
  console.log('📊 [navigateToVisualEditor] Failed edits count:', golden.failedEdits?.length || 0);
  
  // Store golden HTML
  const goldenKey = `visual_editor_${this.templateId}_golden_html`;
  sessionStorage.setItem(goldenKey, golden.html);
  console.log(`✅ [navigateToVisualEditor] Stored golden HTML: ${goldenKey}`);
  
  // Store failed edits (for reference in editor)
  if (golden.failedEdits && golden.failedEdits.length > 0) {
    const failedKey = `visual_editor_${this.templateId}_failed_edits`;
    sessionStorage.setItem(failedKey, JSON.stringify(golden.failedEdits));
    console.log(`✅ [navigateToVisualEditor] Stored failed edits: ${failedKey} (${golden.failedEdits.length} edits)`);
  }
  
  // Store current stats (to calculate delta later)
  if (golden.stats) {
    const statsKey = `visual_editor_${this.templateId}_original_stats`;
    sessionStorage.setItem(statsKey, JSON.stringify(golden.stats));
    console.log(`✅ [navigateToVisualEditor] Stored original stats: ${statsKey}`);
  }
  
  // Close modal
  this.closeVisualEditorModal();
  
  // Navigate
  console.log(`🧭 [navigateToVisualEditor] Navigating to /visual-editor/${this.templateId}`);
  this.router.navigate(['/visual-editor', this.templateId]);
}
/**
 * Checks if user is returning from visual editor and processes changes
 */
private checkForVisualEditorReturn(): void {
  console.log('🔍 [checkForVisualEditorReturn] Checking for return from visual editor');
  
  const idSub = this.id$.subscribe(async (templateId) => {
    if (!templateId) {
      console.log('⏭️ [checkForVisualEditorReturn] No template ID, skipping');
      return;
    }
    
    const returnKey = `visual_editor_${templateId}_return_flag`;
    const editedKey = `visual_editor_${templateId}_edited_html`;
    
    const returnFlag = sessionStorage.getItem(returnKey);
    const editedHtml = sessionStorage.getItem(editedKey);
    
    console.log('🔍 [checkForVisualEditorReturn] Return flag:', returnFlag);
    console.log('🔍 [checkForVisualEditorReturn] Edited HTML exists:', !!editedHtml);
    console.log('🔍 [checkForVisualEditorReturn] Edited HTML length:', editedHtml?.length || 0);
    
    if (returnFlag === 'true' && editedHtml) {
      console.log('✅ [checkForVisualEditorReturn] User returned from visual editor - processing changes');
      
      // Process the return
      await this.handleVisualEditorReturn(templateId, editedHtml);
      
      // Clear return flag (prevent re-processing on refresh)
      sessionStorage.removeItem(returnKey);
      console.log('🗑️ [checkForVisualEditorReturn] Cleared return flag');
      
      // Optionally clear edited HTML (keep for now for debugging)
      // sessionStorage.removeItem(editedKey);
    } else {
      console.log('ℹ️ [checkForVisualEditorReturn] Normal page load (not returning from editor)');
    }
  });
  
  this.subscriptions.push(idSub);
}
/**
 * Handles return from visual editor - updates golden template and statistics
 */
private async handleVisualEditorReturn(
  templateId: string,
  editedHtml: string
): Promise<void> {
  console.log('🔄 [handleVisualEditorReturn] Processing return from visual editor');
  console.log('📊 [handleVisualEditorReturn] Template ID:', templateId);
  console.log('📊 [handleVisualEditorReturn] Edited HTML length:', editedHtml.length);
  
  const golden = this.goldenSubject.value;
  
  if (!golden || !golden.html) {
    console.error('❌ [handleVisualEditorReturn] No golden template found');
    this.showError('Original golden template not found');
    return;
  }
  
  console.log('📊 [handleVisualEditorReturn] Original golden HTML length:', golden.html.length);
  
  // Step 1: Compare and calculate newly applied edits
  const failedEdits = golden.failedEdits || [];
  console.log('📊 [handleVisualEditorReturn] Failed edits count:', failedEdits.length);
  
  let newlyAppliedCount = 0;
  
  if (failedEdits.length > 0) {
    console.log('🔍 [handleVisualEditorReturn] Comparing edited HTML with failed edits');
    newlyAppliedCount = this.compareAndUpdateStats(
      golden.html,
      editedHtml,
      failedEdits
    );
    console.log('✅ [handleVisualEditorReturn] Newly applied edits:', newlyAppliedCount);
  } else {
    console.log('ℹ️ [handleVisualEditorReturn] No failed edits to check');
  }
  
  // Step 2: Update statistics
  const currentStats = golden.stats || {
    total: 0,
    applied: 0,
    failed: 0,
    blocked: 0,
    skipped: 0
  };
  
  const updatedStats = {
    ...currentStats,
    applied: currentStats.applied + newlyAppliedCount,
    failed: Math.max(0, currentStats.failed - newlyAppliedCount) // Prevent negative
  };
  
  console.log('📊 [handleVisualEditorReturn] Stats BEFORE:', JSON.stringify(currentStats));
  console.log('📊 [handleVisualEditorReturn] Stats AFTER:', JSON.stringify(updatedStats));
  
  // Step 3: Update golden template
  const updatedGolden: GoldenResult = {
    ...golden,
    html: editedHtml,
    stats: updatedStats,
    failedEdits: [] // Clear failed edits (no longer tracking)
  };
  
  this.goldenSubject.next(updatedGolden);
  console.log('✅ [handleVisualEditorReturn] Golden template updated in BehaviorSubject');
  
  // Step 4: Update button color to green (no failed edits)
  this.updateVisualEditorButtonColor([]);
  console.log('✅ [handleVisualEditorReturn] Button color updated to GREEN');
  
  // Step 5: Show success message
  if (newlyAppliedCount > 0) {
    this.showSuccess(
      `Template updated! ${newlyAppliedCount} additional edit(s) applied. New total: ${updatedStats.applied}`
    );
    console.log('✅ [handleVisualEditorReturn] Success message shown (with count)');
  } else {
    this.showInfo('Template updated with your changes.');
    console.log('✅ [handleVisualEditorReturn] Info message shown (no new fixes detected)');
  }
  
  // Step 6: Scroll to golden template preview
  setTimeout(() => {
    const goldenPreview = document.querySelector('.col-3');
    if (goldenPreview) {
      goldenPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
      console.log('✅ [handleVisualEditorReturn] Scrolled to golden preview');
    } else {
      console.warn('⚠️ [handleVisualEditorReturn] Golden preview element not found');
    }
  }, 300);
  
  this.cdr.markForCheck();
  console.log('✅ [handleVisualEditorReturn] Return processing complete');
}

/**
 * Compares edited HTML with original and detects which failed edits were fixed
 * Returns count of newly applied edits
 */
private compareAndUpdateStats(
  originalHtml: string,
  editedHtml: string,
  failedEdits: any[]
): number {
  console.log('🔍 [compareAndUpdateStats] Starting comparison');
  console.log('📊 [compareAndUpdateStats] Original HTML length:', originalHtml.length);
  console.log('📊 [compareAndUpdateStats] Edited HTML length:', editedHtml.length);
  console.log('📊 [compareAndUpdateStats] Failed edits to check:', failedEdits.length);
  
  let fixedCount = 0;
  
  // Extract visible text from both HTMLs
  const originalText = this.extractVisibleText(originalHtml);
  const editedText = this.extractVisibleText(editedHtml);
  
  console.log('📊 [compareAndUpdateStats] Original text length:', originalText.length);
  console.log('📊 [compareAndUpdateStats] Edited text length:', editedText.length);
  
  // Loop through each failed edit
  failedEdits.forEach((failedEdit, index) => {
    const findText = failedEdit.find;
    
    if (!findText) {
      console.warn(`⚠️ [compareAndUpdateStats] Edit ${index + 1}: No find text, skipping`);
      return;
    }
    
    console.log(`\n🔍 [compareAndUpdateStats] Edit ${index + 1}/${failedEdits.length}`);
    console.log(`   Find: "${findText.substring(0, 50)}${findText.length > 50 ? '...' : ''}"`);
    
    // Case-insensitive comparison
    const findNormalized = findText.toLowerCase();
    const originalNormalized = originalText.toLowerCase();
    const editedNormalized = editedText.toLowerCase();
    
    // Check if text exists in original
    const existsInOriginal = originalNormalized.includes(findNormalized);
    
    if (!existsInOriginal) {
      console.log(`   ❌ Text not found in original HTML, skipping`);
      return;
    }
    
    console.log(`   ✅ Text found in original HTML`);
    
    // Check if text still exists unchanged in edited
    const stillExistsInEdited = editedNormalized.includes(findNormalized);
    
    if (stillExistsInEdited) {
      console.log(`   ❌ Text still exists unchanged in edited HTML`);
      return;
    }
    
    // Text was in original, but changed/removed in edited
    console.log(`   ✅ Text was CHANGED! Counting as fixed`);
    fixedCount++;
  });
  
  console.log(`\n✅ [compareAndUpdateStats] Comparison complete`);
  console.log(`📊 [compareAndUpdateStats] Total fixed: ${fixedCount}/${failedEdits.length}`);
  
  return fixedCount;
}
/**
 * Extracts visible text content from HTML (removes scripts, styles, etc.)
 */
private extractVisibleText(html: string): string {
  console.log('📄 [extractVisibleText] Extracting visible text from HTML');
  
  // Create temporary DOM element
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  
  // Remove non-visible elements
  const nonVisible = tempDiv.querySelectorAll('script, style, noscript, head');
  nonVisible.forEach(el => el.remove());
  
  // Get text content
  const text = tempDiv.textContent || tempDiv.innerText || '';
  
  // Clean up whitespace (but preserve spaces between words)
  const cleaned = text.replace(/\s+/g, ' ').trim();
  
  console.log('✅ [extractVisibleText] Extracted text length:', cleaned.length);
  console.log('📄 [extractVisibleText] Preview:', cleaned.substring(0, 100) + '...');
  
  return cleaned;
}

}
