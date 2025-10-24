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

  // ✅ Store skipped edits separately for display in modal
  skippedEdits: Array<{
    find?: string;
    replace?: string;
    reason?: string;
    status?: string;
  }> = [];

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
    console.log('');
    console.log('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦');
    console.log('🟦 [qa-page] ====== CONSTRUCTOR CALLED ======');
    console.log('🟦 [qa-page] Timestamp:', new Date().toISOString());
    console.log('🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦');
    console.log('');
    
    const idSub = this.id$.subscribe(async id => {
      console.log('🟦 [qa-page] ID SUBSCRIPTION triggered, id:', id);
      this.templateId = id;

      // Fetch from IndexedDB (async)
      console.log('🟦 [qa-page] Fetching from IndexedDB...');
      const cachedGolden = await this.qa.getGoldenCached(id);
      const cachedSuggestions = await this.qa.getSuggestionsCached(id);
      const prevRun = await this.qa.getVariantsRunCached(id);
      console.log('🟦 [qa-page] IndexedDB results:', {
        hasGolden: !!cachedGolden,
        hasSuggestions: !!cachedSuggestions,
        hasPrevRun: !!prevRun,
        goldenHtml: cachedGolden?.html?.length || 0
      });
      
      this.goldenSubject.next(cachedGolden);
      this.suggestionsSubject.next(cachedSuggestions);
      if (prevRun) {
        // ✅ LOG: Check what variants data we have from cache/backend
        console.log(`🔍 [VARIANTS CACHE] Found ${prevRun.items?.length || 0} variants`);
        prevRun.items?.forEach((variant, index) => {
          console.log(`🔍 [VARIANT ${index + 1}] From cache - has changes:`, !!variant?.changes);
          console.log(`🔍 [VARIANT ${index + 1}] From cache - changes count:`, variant?.changes?.length || 0);
          console.log(`🔍 [VARIANT ${index + 1}] From cache - changes:`, variant?.changes);
        });
        
        this.variantsSubject.next(prevRun);
        this.variantsGenerating = false;
      }
      this.variantsRunId = prevRun?.runId || null;

      if (cachedGolden?.html) {
        this.goldenLoading = false;
        this.updateVisualEditorButtonColor(cachedGolden.failedEdits);
      }
      if (cachedSuggestions) {
        this.suggestionsLoading = false;
      }

      // ============================================
      // ✅ TEMPLATE DISPLAY LOGIC
      // ============================================
      console.log('🔍 [qa-page] Checking template state...');
      this.templateState.debugState(id);
      
      const returnKey = `visual_editor_${id}_return_flag`;
      const returnFlag = localStorage.getItem(returnKey);
      
      console.log('🔍🔍🔍 [qa-page] returnFlag from localStorage:', returnFlag);
      console.log('🔍 [qa-page] returnKey:', returnKey);
      console.log('🔍 [qa-page] hasEdits:', this.templateState.hasEdits(id));

      // CRITICAL LOGIC: ONLY load the edited version if the return flag is explicitly set.
      // This prevents navigation from accidentally showing the edited template.
      if (returnFlag === 'true' && this.templateState.hasEdits(id)) {
        console.log('🔍🔍🔍 [qa-page] CHECK PREVIEW DETECTED - Processing return from editor');
        
        const editingContext = this.templateState.getEditingContext(id);
        const editedTemplate = this.templateState.getCurrentTemplate(id);
        
        console.log('🔍🔍🔍 [qa-page] Editing context:', JSON.stringify(editingContext));
        console.log('🔍 [qa-page] Edited template length:', editedTemplate?.length || 0);
        console.log('🔍 [qa-page] Edited template preview (first 200 chars):', editedTemplate?.substring(0, 200));
        console.log('🔍 [qa-page] BEFORE processing - this.templateHtml length:', this.templateHtml?.length || 0);

        if (editingContext?.type === 'variant' && editedTemplate) {
            console.log(`✅✅✅ [qa-page] VARIANT EDITING - Variant ${editingContext.variantNo}`);
            
            // CRITICAL FIX: For variants, we need to load the TRUE ORIGINAL template first
            // because this.templateHtml should always show the REAL original (temp_1), not the variant
            const originalTemplate = this.templateState.getTrueOriginalTemplate(id);
            
            if (originalTemplate) {
              console.log('🔍 [qa-page] Loading TRUE ORIGINAL template (temp_1) for display, length:', originalTemplate.length);
              this.templateHtml = originalTemplate;
              this.templateLoading = false;
              
              // ✅ FIX: Just restore the HTML for display, DON'T call initializeOriginalTemplate
              // That would overwrite the variant editing context!
              // Just save to ORIGINAL_KEY directly to restore display
              localStorage.setItem(`template_state_${id}_original`, originalTemplate);
              console.log('✅ [qa-page] Restored original template for display without overwriting variant context');
            } else {
              console.log('⚠️ [qa-page] No TRUE original template found, loading from database');
              await this.loadOriginalTemplate(id);
            }
            
            console.log('🔍 [qa-page] this.templateHtml BEFORE updateVariantInUI:', this.templateHtml?.substring(0, 100));
            
            // Now update the variant in the variants list
            this.updateVariantInUI(editingContext.runId, editingContext.variantNo, editedTemplate);
            
            console.log('🔍 [qa-page] this.templateHtml AFTER updateVariantInUI:', this.templateHtml?.substring(0, 100));
            console.log('✅ [qa-page] Variant updated. Original template restored. Done!');
            
            localStorage.removeItem(returnKey);
            console.log(`✅ [qa-page] Processed and removed return flag: ${returnKey}`);
            this.cdr.markForCheck();
        } 
        else if (editingContext?.type === 'original' && editedTemplate) {
            console.log('✅✅✅ [qa-page] ORIGINAL TEMPLATE EDITING');
            console.log('🔍 [qa-page] Updating this.templateHtml with edited template');
            
            this.templateHtml = editedTemplate;
            this.templateLoading = false;
            
            console.log('🔍 [qa-page] this.templateHtml AFTER update:', this.templateHtml?.substring(0, 100));
            
            // Call handleVisualEditorReturn ONLY for original template editing
            await this.handleVisualEditorReturn(id, editedTemplate);
            localStorage.removeItem(returnKey);
            console.log(`✅ [qa-page] Processed and removed return flag: ${returnKey}`);
            this.cdr.markForCheck();
        }
        else if (editingContext?.type === 'golden' && editedTemplate) {
            console.log('✅✅✅ [qa-page] GOLDEN TEMPLATE EDITING - CHECK PREVIEW CLICKED');
            console.log('🔍 [qa-page] editingContext:', editingContext);
            console.log('🔍 [qa-page] editedTemplate length:', editedTemplate?.length || 0);
            console.log('🔍 [qa-page] editedTemplate preview (first 200 chars):', editedTemplate?.substring(0, 200));
            console.log('🔍 [qa-page] Current goldenSubject value:', this.goldenSubject.value);
            
            // Handle golden template editing (update goldenSubject)
            console.log('🔍 [qa-page] Calling handleVisualEditorReturn with edited template');
            await this.handleVisualEditorReturn(id, editedTemplate);
            
            console.log('🔍 [qa-page] After handleVisualEditorReturn, goldenSubject value:', this.goldenSubject.value);
            
            // ✅ FIX: Do NOT clear editing context (matches original template behavior)
            // This allows user to navigate back to visual editor and continue editing
            console.log('✅ [qa-page] Keeping golden editing context for continued editing (matches original template flow)');
            
            // Restore the TRUE original template back to display
            const trueOriginal = this.templateState.getTrueOriginalTemplate(id);
            if (trueOriginal) {
              console.log('🔍 [qa-page] Restoring TRUE original template for display, length:', trueOriginal.length);
              this.templateHtml = trueOriginal;
              this.templateLoading = false;
              // DO NOT call initializeOriginalTemplate here - it will overwrite the golden editing context!
              // Just restore the original HTML to the ORIGINAL_KEY for display
              localStorage.setItem(`template_state_${id}_original`, trueOriginal);
            } else {
              console.log('⚠️ [qa-page] No TRUE original found, loading from database');
              await this.loadOriginalTemplate(id);
            }
            
            localStorage.removeItem(returnKey);
            console.log(`✅ [qa-page] Processed and removed return flag: ${returnKey}`);
            console.log('✅ [qa-page] GOLDEN TEMPLATE EDITING COMPLETE');
            this.cdr.markForCheck();
        }
        else {
             console.log('⚠️ [qa-page] Return flag found, but context is unclear or no edited template. Loading original.');
             this.loadOriginalTemplate(id);
        }

      } else {
        console.log('🔍 [qa-page] No return flag - checking for existing edits or loading original');
        
        // Check what was being edited last time
        const editingContext = this.templateState.getEditingContext(id);
        console.log('🔍 [qa-page] Editing context:', editingContext);
        
        if (editingContext?.type === 'original') {
          // User was editing original template - check if there are saved edits
          const editedTemplateKey = `template_state_${id}_edited`;
          const editedOriginalTemplate = localStorage.getItem(editedTemplateKey);
          
          console.log('🔍 [qa-page] Checking for edited original template:', editedTemplateKey);
          console.log('🔍 [qa-page] Edited original exists:', !!editedOriginalTemplate);
          
          if (editedOriginalTemplate) {
            console.log('✅ [qa-page] Loading EDITED original template (persisted from previous Check Preview)');
            this.templateHtml = editedOriginalTemplate;
            this.templateLoading = false;
            this.cdr.markForCheck();
          } else {
            // No edits, load original
            const originalTemplate = this.templateState.getOriginalTemplate(id);
            if (originalTemplate) {
              console.log('✅ [qa-page] Loading ORIGINAL template (no edits exist)');
              this.templateHtml = originalTemplate;
              this.templateLoading = false;
              this.cdr.markForCheck();
            } else {
              this.loadOriginalTemplate(id);
            }
          }
        } else {
          // No editing context or different context - load original
          const originalTemplate = this.templateState.getOriginalTemplate(id);
          
          console.log('🔍 [qa-page] Original template from state exists:', !!originalTemplate);
          console.log('🔍 [qa-page] Original template length:', originalTemplate?.length || 0);
          
          if (originalTemplate) {
            console.log('✅ [qa-page] Loading ORIGINAL template from state (temp_1).');
            this.templateHtml = originalTemplate;
            this.templateLoading = false;
            
            console.log('🔍 [qa-page] Set this.templateHtml to original, length:', this.templateHtml?.length || 0);
            this.cdr.markForCheck();
          } else {
            console.log('✅ [qa-page] No state found. Loading original from database for the first time.');
            this.loadOriginalTemplate(id);
          }
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
    
    console.log('🧹 [qa-page] Cleaned up visual editor flags for template:', templateId);
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
    console.log('🧹 [onGenerateGolden] Clearing visual editor golden keys for fresh cycle');
    localStorage.removeItem(`visual_editor_${id}_golden_html`);
    localStorage.removeItem(`visual_editor_${id}_snapshot_html`);
    localStorage.removeItem(`visual_editor_${id}_editing_mode`);
    localStorage.removeItem(`visual_editor_${id}_failed_edits`);
    localStorage.removeItem(`visual_editor_${id}_original_stats`);
    console.log('✅ [onGenerateGolden] Visual editor keys cleared. Starting fresh golden generation.');
    
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
        
        // ✅ Extract skipped edits from atomicResults
        if (res.atomicResults && Array.isArray(res.atomicResults)) {
          this.skippedEdits = res.atomicResults
            .filter((r: any) => r.status === 'skipped')
            .map((r: any) => ({
              find: r.edit?.find,
              replace: r.edit?.replace,
              reason: r.reason,
              status: r.status
            }));
          console.log('⏭️ [GOLDEN] Extracted skipped edits:', this.skippedEdits.length);
        } else {
          this.skippedEdits = [];
        }
        
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
          console.log(`🔍 [VARIANT ${i + 1}] Received from backend:`, item);
          console.log(`🔍 [VARIANT ${i + 1}] Has changes:`, !!(item as VariantItem)?.changes);
          console.log(`🔍 [VARIANT ${i + 1}] Changes count:`, (item as VariantItem)?.changes?.length || 0);
          console.log(`🔍 [VARIANT ${i + 1}] Changes data:`, (item as VariantItem)?.changes);

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
    console.log('🟦 [qa-page] loadOriginalTemplate() called, templateId:', templateId);
    console.log('🟦 [qa-page] Loading ORIGINAL master template from database/cache');
    this.templateLoading = true;
    this.templateHtml = '';
    
    // ✅ Check cache first (faster than API)
    const cachedHtml = this.previewCache.get(templateId) || this.previewCache.getPersisted(templateId);
    
    if (cachedHtml) {
      console.log('✅ [qa-page] Found in cache! Length:', cachedHtml.length);
      this.templateHtml = cachedHtml;
      this.templateLoading = false;
      
      // ✅ Save to state service as original template
      this.templateState.initializeOriginalTemplate(templateId, cachedHtml);
      
      this.cdr.markForCheck();
      return;
    }
    console.log('⚠️ [qa-page] NOT in cache, checking templatesService...');
    
    const currentState = this.templatesService.snapshot;
    const template = currentState.items.find(item => item.id === templateId);
    
    if (template?.content) {
      console.log('✅ [qa-page] Found in templatesService! Length:', template.content.length);
      this.templateHtml = template.content;
      this.templateLoading = false;
      
      // ✅ Save to state service as original template
      this.templateState.initializeOriginalTemplate(templateId, template.content);
      
      this.cdr.markForCheck();
      return;
    }
    
    console.log('⚠️ [qa-page] NOT in templatesService, fetching from API...');
    this.http.get(`/api/templates/${templateId}/raw`, { responseType: 'text' })
      .subscribe({
        next: (html) => {
          console.log('✅ [qa-page] Loaded from API! Length:', html.length);
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
    console.log('🎯 [onUseVariant] Preparing variant for navigation - runId:', runId, 'no:', no);
    
    try {
      // Get the variant run from memory cache
      const run = await this.qa.getVariantsRunById(runId);
      const variant = run?.items?.find(it => it.no === no);
      
      if (variant?.html) {
        console.log('✅ [onUseVariant] Found variant HTML, length:', variant.html.length);
        
        // Check if already cached
        const cached = this.qa.getChatCached(runId, no);
        
        if (!cached?.html) {
          console.log('💾 [onUseVariant] Pre-saving variant to localStorage for seamless navigation');
          
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
          console.log('✅ [onUseVariant] Variant saved to localStorage successfully');
        } else {
          console.log('✅ [onUseVariant] Variant already cached in localStorage');
        }
      } else {
        console.warn('⚠️ [onUseVariant] Variant HTML not found in memory cache');
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
    const golden = this.goldenSubject.value;
    const failedCount = golden?.failedEdits?.length || 0;
    
    if (failedCount > 0) {
      this.triggerShakeAnimation();
    }
    
    this.showVisualEditorModal = true;
    this.cdr.markForCheck();
  }

  closeVisualEditorModal(): void {
    this.showVisualEditorModal = false;
    this.cdr.markForCheck();
  }

navigateToVisualEditor(): void {
  console.log('🟦🟦🟦 [GOLDEN EDIT] "Open Visual Editor" button clicked');
  
  if (!this.templateId) {
    console.error('❌ [GOLDEN EDIT] No templateId found');
    this.showError('Template ID not found');
    return;
  }
  
  console.log('🟦 [GOLDEN EDIT] Template ID:', this.templateId);
  
  const golden = this.goldenSubject.value;
  
  console.log('🟦 [GOLDEN EDIT] Golden from goldenSubject.value:', golden);
  console.log('🟦 [GOLDEN EDIT] Golden HTML exists?', !!golden?.html);
  console.log('🟦 [GOLDEN EDIT] Golden HTML length:', golden?.html?.length || 0);
  console.log('🟦 [GOLDEN EDIT] Golden HTML preview (first 200 chars):', golden?.html?.substring(0, 200));
  
  if (!golden?.html) {
    console.error('❌ [GOLDEN EDIT] No golden HTML found in goldenSubject');
    this.showError('Golden template not found. Please generate golden template first.');
    return;
  }
  
  // ✅ PERSIST: Save to localStorage (survives refresh)
  const goldenKey = `visual_editor_${this.templateId}_golden_html`;
  console.log('🟦 [GOLDEN EDIT] Saving golden HTML to localStorage key:', goldenKey);
  localStorage.setItem(goldenKey, golden.html);
  console.log('✅ [GOLDEN EDIT] Golden HTML saved to localStorage');
  
  // ✅ NEW: Save a SNAPSHOT of golden HTML BEFORE editing (for comparison)
  const snapshotKey = `visual_editor_${this.templateId}_snapshot_html`;
  console.log('🟦 [GOLDEN EDIT] Saving snapshot to localStorage key:', snapshotKey);
  localStorage.setItem(snapshotKey, golden.html);
  console.log('✅ [GOLDEN EDIT] Snapshot saved to localStorage');
  
  // ✅ CRITICAL: Clear old flags and progress to prevent contamination
  console.log('🧹 [GOLDEN EDIT] Clearing old editor state before opening...');
  localStorage.removeItem(`visual_editor_${this.templateId}_return_flag`);
  localStorage.removeItem(`visual_editor_${this.templateId}_edited_html`);
  localStorage.removeItem(`visual_editor_${this.templateId}_progress`);
  localStorage.removeItem(`template_state_${this.templateId}_editor_progress`); // ✅ Clear original template progress!
  console.log('✅ [GOLDEN EDIT] Old state cleared');
  
  // ✅ CRITICAL: Set flag to indicate we're editing GOLDEN template
  const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
  console.log('🟦 [GOLDEN EDIT] Setting editing mode to "golden"');
  localStorage.setItem(editingModeKey, 'golden');
  
  // ✅ VERIFICATION: Confirm it was saved
  const verifyEditingMode = localStorage.getItem(editingModeKey);
  console.log('✅ [GOLDEN EDIT] Editing mode set and verified:', verifyEditingMode);
  console.log('🟦 [GOLDEN EDIT] localStorage key:', editingModeKey);
  console.log('🟦 [GOLDEN EDIT] Verification result:', verifyEditingMode === 'golden' ? 'SUCCESS ✅' : 'FAILED ❌');
  
  // ✅ CRITICAL: Initialize golden editing context (sets editing context + clears old edits)
  this.templateState.initializeGoldenForEditing(this.templateId, golden.html);
  
  // Save failed edits
  if (golden.failedEdits && golden.failedEdits.length > 0) {
    const failedKey = `visual_editor_${this.templateId}_failed_edits`;
    console.log('🟦 [GOLDEN EDIT] Saving', golden.failedEdits.length, 'failed edits');
    localStorage.setItem(failedKey, JSON.stringify(golden.failedEdits));
  }
  
  // Save original stats
  if (golden.stats) {
    const statsKey = `visual_editor_${this.templateId}_original_stats`;
    console.log('🟦 [GOLDEN EDIT] Saving original stats:', golden.stats);
    localStorage.setItem(statsKey, JSON.stringify(golden.stats));
  }
  
  console.log('🟦🟦🟦 [GOLDEN EDIT] All localStorage keys saved. Closing modal and navigating to visual editor...');
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
  
  console.log('🔍 [handleVisualEditorReturn] START');
  console.log('🔍 [handleVisualEditorReturn] templateId:', templateId);
  console.log('🔍 [handleVisualEditorReturn] editedHtml length:', editedHtml.length);
  
  // ✅ CRITICAL: Check editing CONTEXT (not editing mode) to determine if this is golden editing
  const editingContext = this.templateState.getEditingContext(templateId);
  console.log('🔍 [handleVisualEditorReturn] editingContext:', editingContext);
  
  // Also check editing mode flag for backwards compatibility
  const editingModeKey = `visual_editor_${templateId}_editing_mode`;
  let editingMode = localStorage.getItem(editingModeKey) || sessionStorage.getItem(editingModeKey);
  
  console.log('🔍 [handleVisualEditorReturn] editingMode:', editingMode);
  
  // Extract original golden HTML from localStorage
  const goldenKey = `visual_editor_${templateId}_golden_html`;
  const originalGoldenHtml = localStorage.getItem(goldenKey) || '';
  
  console.log('🔍 [handleVisualEditorReturn] originalGoldenHtml length:', originalGoldenHtml.length);
  
  // Extract snapshot HTML (pre-editing) from localStorage
  const snapshotKey = `visual_editor_${templateId}_snapshot_html`;
  const snapshotHtml = localStorage.getItem(snapshotKey) || '';
  
  console.log('🔍 [handleVisualEditorReturn] snapshotHtml length:', snapshotHtml.length);
  
  // Extract failed edits from localStorage
  const failedEditsKey = `visual_editor_${templateId}_failed_edits`;
  const failedEditsJson = localStorage.getItem(failedEditsKey);
  let failedEdits: Array<{ find: string, replace: string }> = [];
  
  if (failedEditsJson) {
    try {
      failedEdits = JSON.parse(failedEditsJson);
      console.log('🔍 [handleVisualEditorReturn] failedEdits:', failedEdits);
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
      console.log('🔍 [handleVisualEditorReturn] originalStats:', originalStats);
    } catch (e) {
      console.error('Failed to parse originalStats JSON:', e);
    }
  }
  
  // 🔴 CRITICAL CHECK: Only update golden if editing mode is 'golden' OR editing context type is 'golden'
  const isGoldenEditing = editingMode === 'golden' || editingContext?.type === 'golden';
  
  if (isGoldenEditing) {
    console.log('✅✅✅ [handleVisualEditorReturn] Editing mode/context is GOLDEN - updating golden template');
    console.log('🔍 [handleVisualEditorReturn] editingMode:', editingMode);
    console.log('🔍 [handleVisualEditorReturn] editingContext:', editingContext);
    console.log('🔍 [handleVisualEditorReturn] originalGoldenHtml length:', originalGoldenHtml.length);
    console.log('🔍 [handleVisualEditorReturn] editedHtml length:', editedHtml.length);
    console.log('🔍 [handleVisualEditorReturn] failedEdits:', failedEdits);
    console.log('🔍 [handleVisualEditorReturn] originalStats:', originalStats);
    
    // ✅ Get the current golden to preserve all fields (edits, changes, etc.)
    const currentGolden = this.goldenSubject.value;
    
    // 4. For each failed edit, check if it's fixed
    const fixedEdits = failedEdits.filter(edit => {
      const { find } = edit;
      
      // Check if "find" text is GONE from edited HTML
      const isGoneFromEdited = !editedHtml.includes(find);
      
      // Check if "find" text still exists in original golden HTML
      const isStillInOriginal = originalGoldenHtml.includes(find);
      
      // Consider it FIXED if it's gone from edited and still in original
      return isGoneFromEdited && isStillInOriginal;
    });
    
    // 5. Calculate remaining failed edits after manual fixes
    const remainingFailedEdits = failedEdits.filter(edit => !fixedEdits.includes(edit));
    const manuallyFixedCount = fixedEdits.length;
    
    console.log('🔍 [handleVisualEditorReturn] Manually fixed count:', manuallyFixedCount);
    console.log('🔍 [handleVisualEditorReturn] Remaining failed count:', remainingFailedEdits.length);
    console.log('🔍 [handleVisualEditorReturn] fixedEdits:', fixedEdits);
    
    // ✅ CORRECT CALCULATION: Recalculate stats based on remaining failed edits
    let updatedStats;
    if (originalStats && originalStats.total) {
      // We have original stats - use total to calculate correctly
      updatedStats = {
        total: originalStats.total,
        applied: originalStats.total - remainingFailedEdits.length,
        failed: remainingFailedEdits.length,
        blocked: originalStats.blocked || 0,
        skipped: originalStats.skipped || 0
      };
    } else {
      // Fallback if no original stats
      updatedStats = {
        total: failedEdits.length,
        applied: manuallyFixedCount,
        failed: remainingFailedEdits.length,
        blocked: 0,
        skipped: 0
      };
    }
    
    console.log('🔍 [handleVisualEditorReturn] updatedStats:', updatedStats);
    
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
    
    console.log('🔍 [handleVisualEditorReturn] updatedGolden:', {
      htmlLength: updatedGolden.html.length,
      failedEditsCount: updatedGolden.failedEdits?.length || 0,
      stats: updatedGolden.stats
    });
    console.log('🔍 [handleVisualEditorReturn] Calling goldenSubject.next() with updatedGolden');
    
    this.goldenSubject.next(updatedGolden);
    
    console.log('🔍 [handleVisualEditorReturn] After goldenSubject.next(), current value:', this.goldenSubject.value);
    console.log('🔍 [handleVisualEditorReturn] Saving to cache');
    
    this.qa.saveGoldenToCache(templateId, updatedGolden);
    
    console.log('🔍 [handleVisualEditorReturn] Updating button color');
    
    // 7. Update button color based on remaining failed edits
    this.updateVisualEditorButtonColor(updatedGolden.failedEdits);
    
    console.log('✅✅✅ [handleVisualEditorReturn] Golden template updated and persisted.');
  } else {
    console.log('⚠️⚠️⚠️ [handleVisualEditorReturn] Editing mode is NOT golden:', editingMode);
    console.log('⚠️ [handleVisualEditorReturn] Editing mode is NOT golden - skipping golden template update');
    console.log('⚠️ [handleVisualEditorReturn] Original template was edited, golden template remains unchanged');
  }
  
  this.cdr.markForCheck();
  
  console.log('🔍 [handleVisualEditorReturn] END');
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
        console.log(`✅ [qa-page] Found variant ${variantNo} at index ${variantIndex}. Updating its HTML.`);
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
        console.log(`✅ [qa-page] Variant ${variantNo} UI updated and persisted.`);

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
    console.log('🎯 [EDIT] Button clicked! Starting fresh editing session.');
    if (!this.templateId || !this.templateHtml || this.templateLoading) {
      console.error('❌ [EDIT] Cannot start editing, missing data.');
      return;
    }

    // CRITICAL FIX: Clear all old localStorage flags before starting.
    // This prevents the QA page from thinking we are "returning" from the editor.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;

    console.log(`🧹 [EDIT] Clearing old flags: ${returnKey}, ${editedHtmlKey}, and ${progressKey}`);
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);

    // ✅ CRITICAL: Set editing mode to 'original' so auto-save routes correctly
    const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
    console.log('🟦 [EDIT ORIGINAL] Setting editing mode to "original"');
    localStorage.setItem(editingModeKey, 'original');
    console.log('✅ [EDIT ORIGINAL] Editing mode set to "original"');

    // Initialize the state with the current template on the screen.
    this.templateState.initializeOriginalTemplate(this.templateId, this.templateHtml);
    
    console.log('🚀 [EDIT] Navigating to visual editor for ID:', this.templateId);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Edit a specific variant in the visual editor
   */
  onEditVariant(runId: string, variantNo: number, variant: any): void {
    console.log(`🎯🎯🎯 [EDIT VARIANT] Button clicked for variant ${variantNo}`);
    console.log('🔍 [EDIT VARIANT] Full variant data:', variant);
    console.log('🔍 [EDIT VARIANT] Variant.changes (applied edits):', variant?.changes);
    console.log('🔍 [EDIT VARIANT] Variant.failedEdits (needs manual fixing):', variant?.failedEdits);
    console.log('🔍 [EDIT VARIANT] Changes count:', variant?.changes?.length);
    console.log('🔍 [EDIT VARIANT] Failed edits count:', variant?.failedEdits?.length);
    
    if (!this.templateId || !variant?.html) {
      console.error('❌ [EDIT VARIANT] Aborted - missing templateId or variant HTML.');
      return;
    }

    // CRITICAL FIX: Clear all old localStorage AND sessionStorage flags before starting.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;
    const failedKey = `visual_editor_${this.templateId}_failed_edits`;

    console.log(`🧹 [EDIT VARIANT] Clearing old flags from localStorage and sessionStorage`);
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);
    localStorage.removeItem(failedKey);
    sessionStorage.removeItem(failedKey);

    // ✅ CRITICAL: Set editing mode to 'variant' so auto-save routes correctly
    const editingModeKey = `visual_editor_${this.templateId}_editing_mode`;
    console.log('🟦 [EDIT VARIANT] Setting editing mode to "variant"');
    localStorage.setItem(editingModeKey, 'variant');
    console.log('✅ [EDIT VARIANT] Editing mode set to "variant"');

    // Initialize the state service for editing this specific variant.
    // ⚠️ CRITICAL: This MUST be called BEFORE saving failed edits because it clears them!
    this.templateState.initializeVariantForEditing(this.templateId, runId, variantNo, variant.html);
    
    // ✅ CRITICAL: Save failed edits AFTER initialization (which clears them)
    // The backend sends both:
    // - changes: edits that were successfully applied
    // - failedEdits: edits that failed to apply (these need manual fixing)
    if (variant.failedEdits && variant.failedEdits.length > 0) {
      console.log(`✅ [EDIT VARIANT] Variant has ${variant.failedEdits.length} failed edits from backend`);
      console.log('🔍 [EDIT VARIANT] Failed edits:', variant.failedEdits);
      console.log('🔍 [EDIT VARIANT] Saving to localStorage key:', failedKey);
      
      localStorage.setItem(failedKey, JSON.stringify(variant.failedEdits));
      
      // Verify it was saved
      const verify = localStorage.getItem(failedKey);
      console.log('✅ [EDIT VARIANT] Verification - saved successfully:', !!verify);
      console.log('🔍 [EDIT VARIANT] Verification - data length:', verify?.length);
    } else {
      console.log(`🧹 [EDIT VARIANT] No failed edits in variant ${variantNo}`);
      console.log(`ℹ️  [EDIT VARIANT] This variant has ${variant.changes?.length || 0} applied changes (successfully applied)`);
      console.log(`ℹ️  [EDIT VARIANT] Failed edits would show edits that couldn't be applied automatically`);
    }
    
    // ✅ FINAL VERIFICATION: Check if failed edits are still in localStorage before navigation
    const finalCheck = localStorage.getItem(failedKey);
    console.log('🔍🔍🔍 [EDIT VARIANT] FINAL CHECK before navigation:');
    console.log('   - Failed edits key:', failedKey);
    console.log('   - Still in localStorage:', !!finalCheck);
    console.log('   - Data length:', finalCheck?.length || 0);
    
    console.log(`🚀 [EDIT VARIANT] Navigating to visual editor for ID: ${this.templateId}`);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Edit the golden template in the visual editor
   */
  onEditGoldenTemplate(): void {
    console.log('🎯 [EDIT GOLDEN] Button clicked for golden template');
    
    const goldenHtml = this.goldenSubject.value?.html;
    
    if (!this.templateId || !goldenHtml) {
      console.error('❌ [EDIT GOLDEN] Aborted - missing templateId or golden HTML.');
      return;
    }

    // CRITICAL: Clear all old localStorage flags before starting.
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    const editedHtmlKey = `visual_editor_${this.templateId}_edited_html`;
    const progressKey = `visual_editor_${this.templateId}_progress`;

    console.log(`🧹 [EDIT GOLDEN] Clearing old flags: ${returnKey}, ${editedHtmlKey}, and ${progressKey}`);
    localStorage.removeItem(returnKey);
    localStorage.removeItem(editedHtmlKey);
    localStorage.removeItem(progressKey);

    // Initialize the state service for editing golden template.
    this.templateState.initializeGoldenForEditing(this.templateId, goldenHtml);
    
    console.log(`🚀 [EDIT GOLDEN] Navigating to visual editor for ID: ${this.templateId}`);
    this.router.navigate(['/visual-editor', this.templateId]);
  }

  /**
   * Check if a variant has failed edits
   */
  hasFailedEdits(variant: any): boolean {
    return variant?.failedEdits && variant.failedEdits.length > 0;
  }

  /**
   * Get tooltip text for variant edit button
   */
  getEditTooltip(variant: any): string {
    return this.hasFailedEdits(variant) 
      ? 'Failed edits detected - open editor' 
      : 'Edit in Visual Editor';
  }

}