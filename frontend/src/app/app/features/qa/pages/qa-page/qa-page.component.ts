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
import { TemplateStateService } from '../../../../core/services/template-state.service';

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
        style({ opacity: 0 }),
        animate('0.3s ease-out', style({ opacity: 1 }))
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
        style({ opacity: 0 }),
        animate('0.3s ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('0.15s ease-in', style({ opacity: 0 }))
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
  private templateState = inject(TemplateStateService);

  private readonly GOLDEN_TIMEOUT = 120000;
  private readonly SUBJECTS_TIMEOUT = 60000;
  private readonly SUGGESTIONS_TIMEOUT = 90000;
  private readonly VARIANTS_START_TIMEOUT = 60000;
  private readonly VARIANTS_NEXT_TIMEOUT = 120000;
  private readonly VARIANTS_TOTAL_TIMEOUT = 600000;

  private goldenTimeoutId?: number;
  private suggestionsTimeoutId?: number;
  private variantsTimeoutId?: number;
  private variantsTotalTimeoutId?: number;

  templateId: string | null = null;

  private goldenAborted = false;
  private suggestionsAborted = false;
  private variantsAborted = false;

  private goldenSub?: Subscription;
  private suggestionsSub?: Subscription;
  
  private subscriptions: Subscription[] = [];

  templateHtml = '';
  templateLoading = true;

  readonly id$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));

  private goldenSubject = new BehaviorSubject<GoldenResult | null>(null);
  readonly golden$ = this.goldenSubject.asObservable();
  goldenLoading = false;

  // ✅ Removed skippedEdits - no longer tracking

  showVisualEditorModal = false;
  visualEditorButtonColor: 'orange' | 'red' | 'green' = 'orange';
  shouldShake = false;
  private readonly SHAKE_FLAG_KEY = 'qa_shake_animation';

  private suggestionsSubject = new BehaviorSubject<SuggestionResult | null>(null);
  readonly suggestions$ = this.suggestionsSubject.asObservable();
  suggestionsLoading = false;

  private variantsRunId: string | null = null;
  private variantsSubject = new BehaviorSubject<VariantsRun | null>(null);
  readonly variants$ = this.variantsSubject.asObservable();
  variantsGenerating = false;

  showDebugInfo = false;

  constructor() {
    const idSub = this.id$.subscribe(async id => {
      this.templateId = id;

      // Fetch from IndexedDB (async)
      const cachedGolden = await this.qa.getGoldenCached(id);
      const cachedSuggestions = await this.qa.getSuggestionsCached(id);
      const prevRun = await this.qa.getVariantsRunCached(id);
      this.goldenSubject.next(cachedGolden);
      this.suggestionsSubject.next(cachedSuggestions);
      
      // ✅ Process cached variants
      let variantsToLoad = prevRun;
      if (prevRun) {
        // ✅ LOG: Check what variants data we have from cache/backend
        prevRun.items?.forEach((variant, index) => {
        });
        
        // ✅ CRITICAL FIX: If generation was interrupted, update target to match actual items
        // This prevents skeleton loaders from showing forever (e.g., target=5 but only 1 item received)
        const actualCount = prevRun.items?.length || 0;
        if (actualCount > 0 && actualCount < prevRun.target) {
          variantsToLoad = { ...prevRun, target: actualCount };
        }
        
        this.variantsSubject.next(variantsToLoad);
        // ✅ FIX: If we have cached variants, generation must be complete
        // This fixes skeleton loaders stuck after navigating away during generation
        this.variantsGenerating = false;
      }
      this.variantsRunId = variantsToLoad?.runId || null;

      if (cachedGolden?.html) {
        this.goldenLoading = false;
        this.updateVisualEditorButtonColor(cachedGolden.failedEdits);
      }
      if (cachedSuggestions) {
        this.suggestionsLoading = false;
      }

      // ✅ FIX: Reset variant generation flag if not actively generating
      // This prevents skeleton loaders from showing forever after page navigation
      // If we're here in ngOnInit, any previous generation is no longer active
      if (this.variantsGenerating) {
        this.variantsGenerating = false;
      }

      // ============================================
      // ✅ TEMPLATE DISPLAY LOGIC
      // ============================================
      this.templateState.debugState(id);
      
      const returnKey = `visual_editor_${id}_return_flag`;
      const returnFlag = localStorage.getItem(returnKey);
      // CRITICAL LOGIC: ONLY load the edited version if the return flag is explicitly set.
      // This prevents navigation from accidentally showing the edited template.
      if (returnFlag === 'true' && this.templateState.hasEdits(id)) {
        const editingContext = this.templateState.getEditingContext(id);
        const editedTemplate = this.templateState.getCurrentTemplate(id);
        if (editingContext?.type === 'variant' && editedTemplate) {
            // CRITICAL FIX: For variants, we need to load the TRUE ORIGINAL template first
            // because this.templateHtml should always show the REAL original (temp_1), not the variant
            const originalTemplate = this.templateState.getTrueOriginalTemplate(id);
            
            if (originalTemplate) {
              this.templateHtml = originalTemplate;
              this.templateLoading = false;
              
              // ✅ FIX: Just restore the HTML for display, DON'T call initializeOriginalTemplate
              // That would overwrite the variant editing context!
              // Just save to ORIGINAL_KEY directly to restore display
              localStorage.setItem(`template_state_${id}_original`, originalTemplate);
            } else {
              await this.loadOriginalTemplate(id);
            }
            // Now update the variant in the variants list
            this.updateVariantInUI(editingContext.runId, editingContext.variantNo, editedTemplate);
            localStorage.removeItem(returnKey);
            this.cdr.markForCheck();
        } 
        else if (editingContext?.type === 'original' && editedTemplate) {
            this.templateHtml = editedTemplate;
            this.templateLoading = false;
            // Call handleVisualEditorReturn ONLY for original template editing
            await this.handleVisualEditorReturn(id, editedTemplate);
            localStorage.removeItem(returnKey);
            this.cdr.markForCheck();
        }
        else if (editingContext?.type === 'golden' && editedTemplate) {
            // Handle golden template editing (update goldenSubject)
            await this.handleVisualEditorReturn(id, editedTemplate);
            // ✅ FIX: Do NOT clear editing context (matches original template behavior)
            // This allows user to navigate back to visual editor and continue editing
            // Restore the TRUE original template back to display
            const trueOriginal = this.templateState.getTrueOriginalTemplate(id);
            if (trueOriginal) {
              this.templateHtml = trueOriginal;
              this.templateLoading = false;
              // DO NOT call initializeOriginalTemplate here - it will overwrite the golden editing context!
              // Just restore the original HTML to the ORIGINAL_KEY for display
              localStorage.setItem(`template_state_${id}_original`, trueOriginal);
            } else {
              await this.loadOriginalTemplate(id);
            }
            
            localStorage.removeItem(returnKey);
            this.cdr.markForCheck();
        }
        else {
             this.loadOriginalTemplate(id);
        }

      } else {
        // Check what was being edited last time
        const editingContext = this.templateState.getEditingContext(id);
        // ✅ CRITICAL FIX: Always load the TRUE ORIGINAL template when no return flag
        // This matches the behavior of Golden and Variants templates
        // Edits should ONLY be applied when user clicks "Check Preview"
        const originalTemplate = this.templateState.getOriginalTemplate(id);
        if (originalTemplate) {
          this.templateHtml = originalTemplate;
          this.templateLoading = false;
          this.cdr.markForCheck();
        } else {
          this.loadOriginalTemplate(id);
        }
      }
      
      this.cdr.markForCheck();
    });
    
    this.subscriptions.push(idSub);
  }

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
    return this.goldenLoading || this.variantsGenerating;
  }

  private getLoadingStateMessage(): string {
    if (!this.isGenerating()) {
      return '';
    }
    return '⚠️ Generation is in progress and will be lost if you leave.';
  }

  private cleanupOnExit(): void {
    if (this.goldenLoading) {
      this.goldenAborted = true;
      this.goldenLoading = false;
      if (this.goldenSub) {
        this.goldenSub.unsubscribe();
        this.goldenSub = undefined;
      }
    }

    // if (this.subjectsLoading) {
    //   this.subjectsAborted = true;
    //   this.subjectsLoading = false;
    //   if (this.subjectsSub) {
    //     this.subjectsSub.unsubscribe();
    //     this.subjectsSub = undefined;
    //   }
    // }

    if (this.variantsGenerating) {
      this.variantsAborted = true;
      this.variantsGenerating = false;
    }

    this.clearAllTimeouts();
    
    // ✅ NEW: Clean up visual editor return flags when leaving QA page
    if (this.templateId) {
      this.cleanupVisualEditorFlags(this.templateId);
    }
  }
  
  /**
   * ✅ Clean up visual editor localStorage flags
   * Called when user leaves QA page (navigates away)
   */
  private cleanupVisualEditorFlags(templateId: string): void {
    const snapshotKey = `visual_editor_${templateId}_snapshot_html`;
    const editingModeKey = `visual_editor_${templateId}_editing_mode`;
    const variantMetaKey = `visual_editor_${templateId}_variant_meta`;
    const editedHtmlKey = `visual_editor_${templateId}_edited_html`;
    const returnFlagKey = `visual_editor_${templateId}_return_flag`;
    
    // ✅ Clean up ONLY temporary flags, NOT the actual edited HTML content
    localStorage.removeItem(snapshotKey);
    localStorage.removeItem(editingModeKey);
    localStorage.removeItem(variantMetaKey);
    // ❌ DO NOT DELETE edited_html - this is the actual template content!
    // localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(returnFlagKey);
    
    sessionStorage.removeItem(snapshotKey);
    sessionStorage.removeItem(editingModeKey);
    sessionStorage.removeItem(variantMetaKey);
  }

  ngOnDestroy(): void {
    this.cleanupOnExit();
    
    if (this.goldenSub) this.goldenSub.unsubscribe();
    // if (this.subjectsSub) this.subjectsSub.unsubscribe();
    if (this.suggestionsSub) this.suggestionsSub.unsubscribe();
    
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private clearAllTimeouts(): void {
    if (this.goldenTimeoutId) clearTimeout(this.goldenTimeoutId);
    // if (this.subjectsTimeoutId) clearTimeout(this.subjectsTimeoutId);
    if (this.suggestionsTimeoutId) clearTimeout(this.suggestionsTimeoutId);
    if (this.variantsTimeoutId) clearTimeout(this.variantsTimeoutId);
    if (this.variantsTotalTimeoutId) clearTimeout(this.variantsTotalTimeoutId);
  }

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

    // Clear data for this run (force re-finalization)
    this.qa.clearChatForRun(syntheticRun.runId, 1);
    this.qa.clearSnapsForRun(syntheticRun.runId);
    this.qa.clearValidLinks(syntheticRun.runId);
    this.qa.clearGrammarCheck(syntheticRun.runId, 1);
    
    try {
      // ✅ Save to sessionStorage for immediate navigation
      sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
      
      // ✅ PERSIST to localStorage so it survives refresh/navigation
      const intro = {
        role: 'assistant' as const,
        text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n• Please use editor if replacement didn't happen\n\nWhat would you like to improve?",
        json: null,
        ts: Date.now(),
      };
      const thread = { html: golden.html, messages: [intro] };
      this.qa.saveChat(syntheticRun.runId, 1, thread);
    } catch (e) {
      console.error('Failed to store synthetic run:', e);
    }

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

    // Clear data for this run (force re-finalization)
    this.qa.clearChatForRun(syntheticRun.runId, 1);
    this.qa.clearSnapsForRun(syntheticRun.runId);
    this.qa.clearValidLinks(syntheticRun.runId);
    this.qa.clearGrammarCheck(syntheticRun.runId, 1);
    
    try {
      // ✅ Save to sessionStorage for immediate navigation
      sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
      
      // ✅ PERSIST to localStorage so it survives refresh/navigation
      const intro = {
        role: 'assistant' as const,
        text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n• Please use editor if replacement didn't happen\n\nWhat would you like to improve?",
        json: null,
        ts: Date.now(),
      };
      const thread = { html: this.templateHtml, messages: [intro] };
      this.qa.saveChat(syntheticRun.runId, 1, thread);
    } catch (e) {
      console.error('Failed to store synthetic run:', e);
    }

    this.router.navigate(['/qa', this.templateId, 'use', syntheticRun.runId, 1]);
  }

  onGenerateGolden(id: string) {
    if (this.goldenLoading) return;
    
    // ✅ CRITICAL: Clear visual editor golden keys (fresh cycle)
    // When regenerating golden, we want to start fresh and discard any previous edits
    localStorage.removeItem(`visual_editor_${id}_golden_html`);
    localStorage.removeItem(`visual_editor_${id}_snapshot_html`);
    localStorage.removeItem(`visual_editor_${id}_editing_mode`);
    localStorage.removeItem(`visual_editor_${id}_failed_edits`);
    localStorage.removeItem(`visual_editor_${id}_original_stats`);
    this.goldenLoading = true;
    this.goldenAborted = false;
    this.cdr.markForCheck();

    const shakeKey = `${this.SHAKE_FLAG_KEY}_${id}`;
    sessionStorage.removeItem(shakeKey);

    this.goldenTimeoutId = window.setTimeout(() => {
      this.handleGoldenTimeout();
    }, this.GOLDEN_TIMEOUT);

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
        
        if (this.goldenTimeoutId) {
          clearTimeout(this.goldenTimeoutId);
          this.goldenTimeoutId = undefined;
        }
        
        this.goldenSubject.next(res);
        
        // ✅ Removed skipped edits extraction - no longer needed
        
        this.updateVisualEditorButtonColor(res.failedEdits);
        
        if (res.failedEdits && res.failedEdits.length > 0) {
          this.triggerShakeAnimationOnce(id);
        }
        
        this.cdr.markForCheck();
      },
      error: (e) => {
        if (this.goldenAborted) return;
        
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
        this.cdr.markForCheck();
      }
    });
  }

  private handleGoldenTimeout(): void {
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
  // this is comment because of subject
  // onGenerateSubjects(id: string) {
  //   if (this.subjectsLoading) return;
    
  //   this.subjectsLoading = true;
  //   this.subjectsAborted = false;
  //   this.cdr.markForCheck();

  //   this.subjectsTimeoutId = window.setTimeout(() => {
  //     this.handleSubjectsTimeout();
  //   }, this.SUBJECTS_TIMEOUT);

  //   this.subjectsSub = this.qa.generateSubjects(id, true).pipe(
  //     timeout(this.SUBJECTS_TIMEOUT),
  //     retry({ count: 2, delay: 2000, resetOnSuccess: true }),
  //     catchError(error => {
  //       if (error.name === 'TimeoutError') {
  //         throw new Error('Subject generation timed out. Please try again.');
  //       }
  //       throw error;
  //     })
  //   ).subscribe({
  //     next: (list) => {
  //       if (this.subjectsAborted) return;
        
  //       if (this.subjectsTimeoutId) {
  //         clearTimeout(this.subjectsTimeoutId);
  //         this.subjectsTimeoutId = undefined;
  //       }
        
  //       this.subjectsSubject.next(list);
  //       this.showSuccess(`Generated ${list.length} subject idea(s)!`);
  //     },
  //     error: (e) => {
  //       if (this.subjectsAborted) return;
        
  //       if (this.subjectsTimeoutId) {
  //         clearTimeout(this.subjectsTimeoutId);
  //         this.subjectsTimeoutId = undefined;
  //       }
        
  //       this.subjectsLoading = false;
  //       this.subjectsAborted = true;
        
  //       const errorMessage = this.getErrorMessage(e, 'subject generation');
  //       this.showError(errorMessage);
        
  //       this.cdr.markForCheck();
  //     },
  //     complete: () => {
  //       if (this.subjectsAborted) return;
  //       this.subjectsLoading = false;
  //       this.cdr.markForCheck();
  //     }
  //   });
  // }

  // private handleSubjectsTimeout(): void {
  //   this.subjectsLoading = false;
  //   this.subjectsAborted = true;
    
  //   this.showError('Subject generation is taking longer than expected. Please try again.');
  //   this.cdr.markForCheck();
  // }

  // cancelSubjects(): void {
  //   if (!this.subjectsLoading) return;
    
  //   this.subjectsAborted = true;
  //   this.subjectsLoading = false;
    
  //   if (this.subjectsSub) {
  //     this.subjectsSub.unsubscribe();
  //     this.subjectsSub = undefined;
  //   }
    
  //   if (this.subjectsTimeoutId) {
  //     clearTimeout(this.subjectsTimeoutId);
  //     this.subjectsTimeoutId = undefined;
  //   }
    
  //   this.cdr.markForCheck();
  // }

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

          // ✅ LOG: Check what data comes from backend
          run = { ...run, items: [...run.items, item as VariantItem] };
          this.variantsSubject.next(run);
          this.qa.saveVariantsRun(templateId, run);
          // Removed markForCheck() from loop - batch at end for better performance

        } catch (variantError) {
          this.showWarning(`Variant ${i + 1} failed, continuing with others...`);
          continue;
        }
      }

      if (this.variantsTotalTimeoutId) {
        clearTimeout(this.variantsTotalTimeoutId);
        this.variantsTotalTimeoutId = undefined;
      }

      // Single change detection after all variants generated (performance optimization)
      this.cdr.markForCheck();

      const finalCount = run.items.length;
      this.showSuccess(`Successfully generated ${finalCount} variant(s)!`);

    } catch (e) {
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
    this.templateLoading = true;
    this.templateHtml = '';
    
    // ✅ Check cache first (faster than API)
    const cachedHtml = this.previewCache.get(templateId) || this.previewCache.getPersisted(templateId);
    
    if (cachedHtml) {
      this.templateHtml = cachedHtml;
      this.templateLoading = false;
      
      // ✅ Save to state service as original template
      this.templateState.initializeOriginalTemplate(templateId, cachedHtml);
      
      this.cdr.markForCheck();
      return;
    }
    const currentState = this.templatesService.snapshot;
    const template = currentState.items.find(item => item.id === templateId);
    
    if (template?.content) {
      this.templateHtml = template.content;
      this.templateLoading = false;
      
      // ✅ Save to state service as original template
      this.templateState.initializeOriginalTemplate(templateId, template.content);
      
      this.cdr.markForCheck();
      return;
    }
    this.http.get(`/api/templates/${templateId}/raw`, { responseType: 'text' })
      .subscribe({
        next: (html) => {
          this.templateHtml = html;
          this.templateLoading = false;
          
          // ✅ Save to state service as original template
          this.templateState.initializeOriginalTemplate(templateId, html);
          
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.templateHtml = 'Failed to load template';
          this.templateLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  async onUseVariant(templateId: string, runId: string, no: number) {
    // ✅ CRITICAL FIX: Pre-save variant to localStorage BEFORE navigation (same as Golden/Original)
    // ✅ Clear existing data for this variant (screenshots, link matrix, grammar check, etc.) - force re-finalization
    this.qa.clearChatForRun(runId, no);
    this.qa.clearSnapsForRun(runId);
    this.qa.clearValidLinks(runId);
    this.qa.clearGrammarCheck(runId, no);
    try {
      // Get the variant run from memory cache
      const run = await this.qa.getVariantsRunById(runId);
      const variant = run?.items?.find(it => it.no === no);
      
      if (variant?.html) {
        // Create intro message (same as Golden/Original)
        const intro = {
          role: 'assistant' as const,
          text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n• Please use editor if replacement didn't happen\n\nWhat would you like to improve?",
          json: null,
          ts: Date.now(),
        };
        
        // ✅ SAVE to localStorage BEFORE navigation (CRITICAL!)
        const thread = { html: variant.html, messages: [intro] };
        this.qa.saveChat(runId, no, thread);
      } else {
      }
    } catch (error) {
      console.error('❌ [onUseVariant] Error pre-saving variant:', error);
      // Continue with navigation anyway - use-variant-page will try to load from API
    }
    
    // Navigate (data is now in localStorage, guaranteed to load)
    this.router.navigate(['/qa', templateId, 'use', runId, no]);
  }

  toggleDebugInfo(): void {
    this.showDebugInfo = !this.showDebugInfo;
  }

  getStatusIcon(status: EditStatus): string {
    const icons: Record<EditStatus, string> = {
      'applied': 'check_circle',
      'not_found': 'search_off',
      'blocked': 'block',
      // ✅ Removed 'skipped'
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
      // ✅ Removed 'skipped'
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
      // ✅ Removed 'skipped'
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

  /**
   * Extract visible text from HTML (excluding tags, attributes, scripts, styles)
   * This is used for accurate failed edit detection
   */
  private extractVisibleText(html: string): string {
    try {
      // Create a temporary DOM element to parse HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // Remove script and style tags
      const scripts = tempDiv.querySelectorAll('script, style');
      scripts.forEach(el => el.remove());
      
      // Get only the text content (visible text)
      const text = tempDiv.textContent || tempDiv.innerText || '';
      return text;
    } catch (error) {
      console.error('❌ [extractVisibleText] Failed to extract text:', error);
      // Fallback to original HTML if extraction fails
      return html;
    }
  }

  private updateVisualEditorButtonColor(failedEdits: any[] | undefined): void {
    if (!failedEdits || failedEdits.length === 0) {
      this.visualEditorButtonColor = 'green';
    } else {
      this.visualEditorButtonColor = 'red';
    }
    
    this.cdr.markForCheck();
  }

  private triggerShakeAnimationOnce(templateId: string): void {
    const shakeKey = `${this.SHAKE_FLAG_KEY}_${templateId}`;
    const alreadyShown = sessionStorage.getItem(shakeKey);
    
    if (alreadyShown === 'true') {
      return;
    }
    
    sessionStorage.setItem(shakeKey, 'true');
    this.triggerShakeAnimation();
  }

  private triggerShakeAnimation(): void {
    this.shouldShake = true;
    this.cdr.markForCheck();
    
    setTimeout(() => {
      this.shouldShake = false;
      this.cdr.markForCheck();
    }, 1000);
  }

  onGoldenTemplateClick(): void {
    // Section click - no shake animation needed here
  }

  openVisualEditorModal(): void {
    this.showVisualEditorModal = true;
    this.cdr.markForCheck();
  }

  closeVisualEditorModal(): void {
    this.showVisualEditorModal = false;
    this.cdr.markForCheck();
  }

navigateToVisualEditor(): void {
  if (!this.templateId) {
    console.error('❌ [GOLDEN EDIT] No templateId found');
    this.showError('Template ID not found');
    return;
  }
  const golden = this.goldenSubject.value;
  if (!golden?.html) {
    console.error('❌ [GOLDEN EDIT] No golden HTML found in goldenSubject');
    this.showError('Golden template not found. Please generate golden template first.');
    return;
  }
  
  // ✅ PERSIST: Save to localStorage (survives refresh)
  const goldenKey = `visual_editor_${this.templateId}_golden_html`;
  localStorage.setItem(goldenKey, golden.html);
  // ✅ NEW: Save a SNAPSHOT of golden HTML BEFORE editing (for comparison)
  const snapshotKey = `visual_editor_${this.templateId}_snapshot_html`;
  localStorage.setItem(snapshotKey, golden.html);
  // ✅ CRITICAL: Clear old flags and progress to prevent contamination
  localStorage.removeItem(`visual_editor_${this.templateId}_return_flag`);
  localStorage.removeItem(`visual_editor_${this.templateId}_edited_html`);
  localStorage.removeItem(`visual_editor_${this.templateId}_progress`);
  localStorage.removeItem(`template_state_${this.templateId}_editor_progress`); // ✅ Clear original template progress!
  // ✅ CRITICAL: Set flag to indicate we're editing GOLDEN template
  const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
  localStorage.setItem(editingModeKey, 'golden');
  
  // ✅ VERIFICATION: Confirm it was saved
  const verifyEditingMode = localStorage.getItem(editingModeKey);
  // ✅ CRITICAL: Initialize golden editing context (sets editing context + clears old edits)
  this.templateState.initializeGoldenForEditing(this.templateId, golden.html);
  
  // Save failed edits
  if (golden.failedEdits && golden.failedEdits.length > 0) {
    const failedKey = `visual_editor_${this.templateId}_failed_edits`;
    localStorage.setItem(failedKey, JSON.stringify(golden.failedEdits));
  }
  
  // Save original stats
  if (golden.stats) {
    const statsKey = `visual_editor_${this.templateId}_original_stats`;
    localStorage.setItem(statsKey, JSON.stringify(golden.stats));
  }
  
  // ✅ CRITICAL FIX: Clear use-variant metadata to prevent wrong navigation on Check Preview
  const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
  sessionStorage.removeItem(metaKey);
  this.closeVisualEditorModal();
  this.router.navigate(['/visual-editor', this.templateId]);
}

  /**
   * ✅ SOLID COMPARISON: Handles return from visual editor
   * 
   * Logic:
   * 1. Get failed edits list (e.g., "legant" → "elegant")
   * 2. Extract visible text from ORIGINAL golden HTML
   * 3. Extract visible text from EDITED HTML (from visual editor)
   * 4. For each failed edit:
   *    - Check if "find" text exists in original
   *    - Check if "find" text exists in edited
   *    - If "find" is GONE from edited → FIXED ✅
   * 5. Update stats and remaining failed edits
   * 6. Update golden template with edited HTML
   * 7. Update button color based on remaining failed edits
   */
private async handleVisualEditorReturn(
  templateId: string,
  editedHtml: string
): Promise<void> {
  // ✅ CRITICAL: Check editing CONTEXT (not editing mode) to determine if this is golden editing
  const editingContext = this.templateState.getEditingContext(templateId);
  // Also check editing mode flag for backwards compatibility
  const editingModeKey = `visual_editor_${templateId}_editing_mode`;
  let editingMode = localStorage.getItem(editingModeKey) || sessionStorage.getItem(editingModeKey);
  // Extract original golden HTML from localStorage
  const goldenKey = `visual_editor_${templateId}_golden_html`;
  const originalGoldenHtml = localStorage.getItem(goldenKey) || '';
  // Extract snapshot HTML (pre-editing) from localStorage
  const snapshotKey = `visual_editor_${templateId}_snapshot_html`;
  const snapshotHtml = localStorage.getItem(snapshotKey) || '';
  // Extract failed edits from localStorage
  const failedEditsKey = `visual_editor_${templateId}_failed_edits`;
  const failedEditsJson = localStorage.getItem(failedEditsKey);
  let failedEdits: Array<{ find: string, replace: string }> = [];
  
  if (failedEditsJson) {
    try {
      failedEdits = JSON.parse(failedEditsJson);
    } catch (e) {
      console.error('Failed to parse failedEdits JSON:', e);
    }
  }
  
  // Extract original stats from localStorage
  const statsKey = `visual_editor_${templateId}_original_stats`;
  const originalStatsJson = localStorage.getItem(statsKey);
  let originalStats: any = null;
  
  if (originalStatsJson) {
    try {
      originalStats = JSON.parse(originalStatsJson);
    } catch (e) {
      console.error('Failed to parse originalStats JSON:', e);
    }
  }
  
  // 🔴 CRITICAL CHECK: Only update golden if editing mode is 'golden' OR editing context type is 'golden'
  const isGoldenEditing = editingMode === 'golden' || editingContext?.type === 'golden';
  
  if (isGoldenEditing) {
    // ✅ Get the current golden to preserve all fields (edits, changes, etc.)
    const currentGolden = this.goldenSubject.value;
    
    // ✅ CRITICAL FIX: Extract VISIBLE TEXT ONLY (not HTML tags/attributes)
    const originalVisibleText = this.extractVisibleText(originalGoldenHtml);
    const editedVisibleText = this.extractVisibleText(editedHtml);
    // 4. For each failed edit, check if it's fixed
    const fixedEdits = failedEdits.filter(edit => {
      const { find, replace } = edit;
      // ✅ IMPROVED: Search in VISIBLE TEXT only (case-insensitive with word boundaries)
      // This prevents false matches in HTML tags, attributes, class names, etc.
      const findLower = find.toLowerCase();
      const originalTextLower = originalVisibleText.toLowerCase();
      const editedTextLower = editedVisibleText.toLowerCase();
      
      // Check if "find" text exists in original visible text
      const isInOriginal = originalTextLower.includes(findLower);
      
      // Check if "find" text is GONE from edited visible text
      const isGoneFromEdited = !editedTextLower.includes(findLower);
      
      const isFixed = isGoneFromEdited && isInOriginal;
      // Consider it FIXED if it's gone from edited and was in original
      return isFixed;
    });
    
    // 5. Calculate remaining failed edits after manual fixes
    const remainingFailedEdits = failedEdits.filter(edit => !fixedEdits.includes(edit));
    const manuallyFixedCount = fixedEdits.length;
    // ✅ CORRECT CALCULATION: Recalculate stats based on remaining failed edits
    let updatedStats;
    if (originalStats && originalStats.total) {
      // We have original stats - use total to calculate correctly
      updatedStats = {
        total: originalStats.total,
        applied: originalStats.total - remainingFailedEdits.length,
        failed: remainingFailedEdits.length,
        blocked: originalStats.blocked || 0,
        // ✅ Removed skipped
      };
    } else {
      // Fallback if no original stats
      updatedStats = {
        total: failedEdits.length,
        applied: manuallyFixedCount,
        failed: remainingFailedEdits.length,
        blocked: 0,
        // ✅ Removed skipped
      };
    }
    // Update the stats in localStorage
    localStorage.setItem(statsKey, JSON.stringify(updatedStats));
    
    // 6. Update golden template with edited HTML
    // ✅ CRITICAL: Preserve all original golden fields (edits, changes, atomicResults, etc.)
    const updatedGolden: GoldenResult = {
      ...currentGolden,  // Spread all existing fields
      html: editedHtml,  // Update HTML
      failedEdits: remainingFailedEdits,  // Update failed edits
      stats: updatedStats,  // Update stats
    };
    this.goldenSubject.next(updatedGolden);
    this.qa.saveGoldenToCache(templateId, updatedGolden);
    // 7. Update button color based on remaining failed edits
    this.updateVisualEditorButtonColor(updatedGolden.failedEdits);
  } else {
  }
  
  this.cdr.markForCheck();
}

/**
   * Updates a specific variant in the variants$ subject.
   * This triggers the UI to re-render the updated variant.
   */
  private updateVariantInUI(runId: string, variantNo: number, newHtml: string): void {
    const currentRun = this.variantsSubject.value;
    if (currentRun && currentRun.runId === runId) {
      const variantIndex = currentRun.items.findIndex(v => v.no === variantNo);
      
      if (variantIndex !== -1) {
        const updatedItems = [...currentRun.items];
        updatedItems[variantIndex] = {
          ...updatedItems[variantIndex],
          html: newHtml,
          // Optionally, mark it as edited
          // edited: true 
        };
        
        const updatedRun: VariantsRun = { ...currentRun, items: updatedItems };
        
        this.variantsSubject.next(updatedRun);
        this.qa.saveVariantsRun(this.templateId!, updatedRun); // Persist the change
        this.cdr.markForCheck();
      } else {
        console.error(`❌ [qa-page] Could not find variant number ${variantNo} in the current run to update.`);
      }
    } else {
            console.error(`❌ [qa-page] Could not find matching run ID ${runId} to update variant.`);
    }
  }

  /**
   * Navigate to Visual Editor with ORIGINAL template
   * Opens visual editor for editing the original template (not golden)
   */
  onEditOriginalTemplate(): void {
    if (!this.templateId || !this.templateHtml || this.templateLoading) {
      console.error('❌ [EDIT] Cannot start editing, missing data.');
      return;
    }

    // CRITICAL FIX: Clear all old localStorage flags before starting.
    // This prevents the QA page from thinking we are "returning" from the editor.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;
    const failedEditsKey = `visual_editor_${this.templateId}_failed_edits`;
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);
    
    // ✅ CRITICAL: Clear failed edits from Golden template - they don't apply to Original
    localStorage.removeItem(failedEditsKey);
    sessionStorage.removeItem(failedEditsKey);
    // ✅ CRITICAL: Set editing mode to 'original' so auto-save routes correctly
    const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
    localStorage.setItem(editingModeKey, 'original');
    // Initialize the state with the current template on the screen.
    this.templateState.initializeOriginalTemplate(this.templateId, this.templateHtml);
    
    // ✅ CRITICAL FIX: Clear use-variant metadata to prevent wrong navigation on Check Preview
    const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
    sessionStorage.removeItem(metaKey);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Edit a specific variant in the visual editor
   */
  onEditVariant(runId: string, variantNo: number, variant: any): void {
    if (!this.templateId || !variant?.html) {
      console.error('❌ [EDIT VARIANT] Aborted - missing templateId or variant HTML.');
      return;
    }

    // CRITICAL FIX: Clear all old localStorage AND sessionStorage flags before starting.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;
    const failedKey = `visual_editor_${this.templateId}_failed_edits`;
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);
    localStorage.removeItem(failedKey);
    sessionStorage.removeItem(failedKey);

    // ✅ CRITICAL: Set editing mode to 'variant' so auto-save routes correctly
    const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
    localStorage.setItem(editingModeKey, 'variant');
    // Initialize the state service for editing this specific variant.
    // ⚠️ CRITICAL: This MUST be called BEFORE saving failed edits because it clears them!
    this.templateState.initializeVariantForEditing(this.templateId, runId, variantNo, variant.html);
    
    // ✅ CRITICAL: Save failed edits AFTER initialization (which clears them)
    // The backend sends both:
    // - changes: edits that were successfully applied
    // - failedEdits: edits that failed to apply (these need manual fixing)
    if (variant.failedEdits && variant.failedEdits.length > 0) {
      localStorage.setItem(failedKey, JSON.stringify(variant.failedEdits));
      
      // Verify it was saved
      const verify = localStorage.getItem(failedKey);
    } else {
    }
    
    // ✅ FINAL VERIFICATION: Check if failed edits are still in localStorage before navigation
    const finalCheck = localStorage.getItem(failedKey);
    // ✅ CRITICAL FIX: Clear use-variant metadata for VARIANT editing from QA page
    // This ensures the metadata is fresh and accurate when navigating from use-variants page
    const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
    sessionStorage.removeItem(metaKey);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Edit the golden template in the visual editor
   */
  onEditGoldenTemplate(): void {
    const goldenHtml = this.goldenSubject.value?.html;
    
    if (!this.templateId || !goldenHtml) {
      console.error('❌ [EDIT GOLDEN] Aborted - missing templateId or golden HTML.');
      return;
    }

    // CRITICAL: Clear all old localStorage flags before starting.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);

    // Initialize the state service for editing golden template.
    this.templateState.initializeGoldenForEditing(this.templateId, goldenHtml);
    
    // ✅ CRITICAL FIX: Clear use-variant metadata to prevent wrong navigation on Check Preview
    const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
    sessionStorage.removeItem(metaKey);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Check if a variant has failed edits
   */
  hasFailedEdits(variant: any): boolean {
    return variant?.failedEdits && variant.failedEdits.length > 0;
  }

  /**
   * Get the count of failed edits for a variant
   */
  getFailedEditsCount(variant: any): number {
    return variant?.failedEdits?.length || 0;
  }

  /**
   * Get tooltip text for variant edit button
   */
  getEditTooltip(variant: any): string {
    const count = this.getFailedEditsCount(variant);
    return count > 0
      ? `${count} failed edit${count > 1 ? 's' : ''} detected - open editor` 
      : 'Edit in Visual Editor';
  }

}