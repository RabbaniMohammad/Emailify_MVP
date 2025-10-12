import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, OnDestroy  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay, of, Subscription } from 'rxjs';
import { timeout, catchError, retry } from 'rxjs/operators';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';
import { QaService, GoldenResult, VariantItem, VariantsRun } from '../../services/qa.service';
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
    // trigger('modalAnimation', [
    //   transition(':enter', [
    //     style({ opacity: 0 }),
    //     animate('200ms ease-out', style({ opacity: 1 }))
    //   ]),
    //   transition(':leave', [
    //     animate('150ms ease-in', style({ opacity: 0 }))
    //   ])
    // ]),
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

  // Modal state
  // isEditModalOpen = false;
  // isEditMode = false;
  // editableHtml = '';
  // originalGoldenHtml = '';

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

  private suggestionsSubject = new BehaviorSubject<SuggestionResult | null>(null);
  readonly suggestions$ = this.suggestionsSubject.asObservable();
  suggestionsLoading = false;

  private variantsRunId: string | null = null;
  private variantsSubject = new BehaviorSubject<VariantsRun | null>(null);
  readonly variants$ = this.variantsSubject.asObservable();
  variantsGenerating = false;

constructor() {
  const idSub = this.id$.subscribe(id => {
    this.templateId = id;

    // ✅ Load cached data
    const cachedGolden = this.qa.getGoldenCached(id);
    const cachedSubjects = this.qa.getSubjectsCached(id);
    const cachedSuggestions = this.qa.getSuggestionsCached(id);
    
    // ✅ Set to subjects
    this.goldenSubject.next(cachedGolden);
    this.subjectsSubject.next(cachedSubjects);
    this.suggestionsSubject.next(cachedSuggestions);
    
    // ✅ Set loading states only if cache exists
    if (cachedGolden?.html) {
      this.goldenLoading = false;
      console.log('✅ Restored cached golden');
    }
    
    if (cachedSubjects?.length) {
      this.subjectsLoading = false;
      console.log('✅ Restored cached subjects');
    }
    
    if (cachedSuggestions) {
      this.suggestionsLoading = false;
      console.log('✅ Restored cached suggestions');
    }

    // ✅ Load variants
    const prevRun = this.qa.getVariantsRunCached(id);
    if (prevRun) {
      this.variantsSubject.next(prevRun);
      this.variantsGenerating = false;
      console.log('✅ Restored cached variants');
    }
    this.variantsRunId = prevRun?.runId || null;
    
    this.loadOriginalTemplate(id);
    
    // ✅ Restore modal state
    // const savedModalTemplateId = localStorage.getItem('editModalOpen');
    // if (savedModalTemplateId === id) {
    //   this.openEditModal();
    // }

    
    // ✅ Force change detection
    this.cdr.markForCheck();
  });
  
  this.subscriptions.push(idSub);
}

  ngOnDestroy(): void {
    this.clearAllTimeouts();
    
    // Unsubscribe from active operations
    // if (this.goldenSub) this.goldenSub.unsubscribe();
    // if (this.subjectsSub) this.subjectsSub.unsubscribe();
    // if (this.suggestionsSub) this.suggestionsSub.unsubscribe();
    
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private clearAllTimeouts(): void {
    if (this.goldenTimeoutId) clearTimeout(this.goldenTimeoutId);
    if (this.subjectsTimeoutId) clearTimeout(this.subjectsTimeoutId);
    if (this.suggestionsTimeoutId) clearTimeout(this.suggestionsTimeoutId);
    if (this.variantsTimeoutId) clearTimeout(this.variantsTimeoutId);
    if (this.variantsTotalTimeoutId) clearTimeout(this.variantsTotalTimeoutId);
  }

  getSkeletonArray(target: number, currentCount: number): number[] {
    const remaining = target - currentCount;
    return Array(Math.max(0, remaining)).fill(0);
  }

  // ============================================
  // MODAL METHODS - WYSIWYG EDITING
  // ============================================
//   openEditModal(): void {
//   const golden = this.goldenSubject.value;
//   if (!golden?.html) return;
  
//   this.originalGoldenHtml = golden.html;
//   this.editableHtml = golden.html;
//   this.isEditModalOpen = true;
//   this.isEditMode = false;
//   document.body.style.overflow = 'hidden';
  
//   // ✅ ADD THIS - Save to localStorage
//   if (this.templateId) {
//     localStorage.setItem('editModalOpen', this.templateId);
//   }
  
//   this.cdr.markForCheck();

//   setTimeout(() => {
//     this.enableInlineEditing();
//   }, 100);
// }

//   closeEditModal(): void {
//   this.isEditModalOpen = false;
//   this.isEditMode = false;
//   document.body.style.overflow = '';
//   this.editableHtml = '';
//   this.originalGoldenHtml = '';
  
//   // ✅ ADD THIS - Remove from localStorage
//   localStorage.removeItem('editModalOpen');
  
//   this.cdr.markForCheck();
// }

//   onModalBackdropClick(event: MouseEvent): void {
//     if (event.target === event.currentTarget) {
//       this.closeEditModal();
//     }
//   }

//   /**
//    * Enable inline editing for all text elements in the preview
//    */
// private enableInlineEditing(): void {
//   const container = document.querySelector('.editable-preview-container');
//   if (!container) return;

//   // Target elements that typically contain user-visible text
//   const editableSelectors = 'p, h1, h2, h3, h4, h5, h6, span:not(.no-edit), div:not(.no-edit), a, button, li, td, th, label';
//   const elements = container.querySelectorAll(editableSelectors);

//   elements.forEach((element: Element) => {
//     const htmlElement = element as HTMLElement;
    
//     // Skip elements that are containers with complex children
//     if (htmlElement.children.length > 3) return;
    
//     // Get direct text content
//     const hasDirectText = Array.from(htmlElement.childNodes).some(
//       node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
//     );

//     if (hasDirectText || (htmlElement.children.length <= 1 && htmlElement.textContent?.trim())) {
//       // Make element editable
//       htmlElement.setAttribute('contenteditable', 'true');
//       htmlElement.classList.add('editable-element');
      
//       // Store original value
//       htmlElement.dataset['originalText'] = htmlElement.textContent || '';

//       // ✅ Add click handler with proper binding
//       const clickHandler = (e: Event) => {
//         e.stopPropagation();
//         this.onElementClick(htmlElement);
//       };
//       htmlElement.addEventListener('click', clickHandler);

//       // ✅ Track changes
//       const inputHandler = () => {
//         this.onElementEdit(htmlElement);
//       };
//       htmlElement.addEventListener('input', inputHandler);

//       // ✅ Handle Enter key
//       const keydownHandler = (e: KeyboardEvent) => {
//         if (e.key === 'Enter' && !e.shiftKey) {
//           e.preventDefault();
//           htmlElement.blur();
//         }
//       };
//       htmlElement.addEventListener('keydown', keydownHandler);
//     }
//   });

//   this.isEditMode = true;
//   this.cdr.markForCheck();
// }

//   /**
//    * Handle element click
//    */
// private onElementClick(element: HTMLElement): void {
//   // Remove focus from other elements
//   document.querySelectorAll('.editable-element.editing').forEach(el => {
//     el.classList.remove('editing');
//   });

//   // Add editing class
//   element.classList.add('editing');
  
//   // ✅ Just focus - don't select all text
//   element.focus();
  
//   // ✅ Place cursor at click position (natural behavior)
//   // Browser handles cursor placement automatically
// }

//   /**
//    * Handle element edit
//    */
//   private onElementEdit(element: HTMLElement): void {
//     const originalText = element.dataset['originalText'] || '';
//     const currentText = element.textContent || '';

//     if (originalText !== currentText) {
//       element.classList.add('edited');
//     } else {
//       element.classList.remove('edited');
//     }
//   }

//   /**
//    * Save edited template
//    */
// saveEditedTemplate(): void {
//   const container = document.querySelector('.editable-preview-container');
//   if (!container) return;

//   const parser = new DOMParser();
//   const originalDoc = parser.parseFromString(this.originalGoldenHtml, 'text/html');
//   const editedElements = container.querySelectorAll('.edited');
  
//   console.log(`✏️ Processing ${editedElements.length} edited elements`);

//   editedElements.forEach((element: Element) => {
//     const htmlElement = element as HTMLElement;
//     const originalText = htmlElement.dataset['originalText'] || '';
//     const newText = htmlElement.textContent || ''; // ✅ Just text, no HTML
    
//     if (!originalText || originalText === newText) return;

//     // Find matching element in original doc
//     const tagName = htmlElement.tagName.toLowerCase();
//     const candidates = Array.from(originalDoc.querySelectorAll(tagName));
    
//     const match = candidates.find(candidate => 
//       candidate.textContent?.trim() === originalText.trim()
//     );
    
//     if (match) {
//       // ✅ Replace ONLY textContent - preserves original HTML structure!
//       match.textContent = newText;
//       console.log('✅ Replaced text in:', tagName);
//     }
//   });

//   // Get updated HTML
//   let updatedHtml: string;
//   if (this.originalGoldenHtml.trim().startsWith('<!DOCTYPE') || 
//       this.originalGoldenHtml.trim().startsWith('<html')) {
//     updatedHtml = '<!DOCTYPE html>\n' + originalDoc.documentElement.outerHTML;
//   } else if (this.originalGoldenHtml.trim().startsWith('<body')) {
//     updatedHtml = originalDoc.body.outerHTML;
//   } else {
//     updatedHtml = originalDoc.body.innerHTML;
//   }

//   // Save
//   const currentGolden = this.goldenSubject.value;
//   if (currentGolden) {
//     const updatedGolden = { ...currentGolden, html: updatedHtml };
//     this.goldenSubject.next(updatedGolden);
//     if (this.templateId) {
//       this.qa.saveGoldenToCache(this.templateId, updatedGolden);
//     }
//   }

//   this.showSuccess('Golden template updated successfully!');
//   this.closeEditModal();
// }

// // Check if element only has simple inline children (like <strong>, <em>, <a>)
// private hasOnlySimpleChildren(element: Element): boolean {
//   const simpleInlineTags = ['strong', 'em', 'b', 'i', 'u', 'a', 'span', 'sup', 'sub'];
  
//   for (const child of Array.from(element.children)) {
//     if (!simpleInlineTags.includes(child.tagName.toLowerCase())) {
//       return false;
//     }
//   }
  
//   return true;
// }

// // DELETE the old replaceTextInElement method - not needed anymore

// // Helper method to replace text while preserving child elements
// private replaceTextInElement(element: Element, oldText: string, newText: string): void {
//   const oldWords = oldText.split(/(\s+)/); // Keep whitespace
//   const newWords = newText.split(/(\s+)/);
  
//   // Walk through child nodes
//   const walker = document.createTreeWalker(
//     element,
//     NodeFilter.SHOW_TEXT,
//     null
//   );
  
//   let node: Node | null;
//   let wordIndex = 0;
  
//   while ((node = walker.nextNode()) && wordIndex < oldWords.length) {
//     const textContent = node.textContent || '';
//     const trimmed = textContent.trim();
    
//     if (!trimmed) continue; // Skip empty text nodes
    
//     // Find matching word
//     for (let i = wordIndex; i < oldWords.length; i++) {
//       const oldWord = oldWords[i].trim();
//       if (oldWord && trimmed.includes(oldWord)) {
//         const newWord = newWords[i] || oldWord;
//         node.textContent = textContent.replace(oldWord, newWord);
//         wordIndex = i + 1;
//         break;
//       }
//     }
//   }
// }





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

  // Create a synthetic variant run with the golden template
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

  // ✅ Store in sessionStorage with special prefix
  try {
    sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
  } catch (e) {
    console.error('Failed to store synthetic run:', e);
  }

  // Show success message
  this.showSuccess('Bypassing variants - using Golden Template directly...');

  // Navigate to use-variant page
  this.router.navigate(['/qa', this.templateId, 'use', syntheticRun.runId, 1]);
}
  // ============================================
  // SKIP TO CHAT METHOD
  // ============================================
onSkipToChat(): void {
  if (!this.templateId) {
    this.showWarning('Template ID not found');
    return;
  }

  if (!this.templateHtml || this.templateLoading) {
    this.showWarning('Template is still loading. Please wait...');
    return;
  }

  // Create a synthetic variant run with the original template
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

  // ✅ Store in sessionStorage with special prefix
  try {
    sessionStorage.setItem(`synthetic_run_${syntheticRun.runId}`, JSON.stringify(syntheticRun));
  } catch (e) {
    console.error('Failed to store synthetic run:', e);
  }

  // Show success message
  this.showSuccess('Skipping to chat interface with original template...');

  // Navigate to use-variant page
  this.router.navigate(['/qa', this.templateId, 'use', syntheticRun.runId, 1]);
}

  // ============================================
  // GENERATE GOLDEN TEMPLATE
  // ============================================
onGenerateGolden(id: string) {
  if (this.goldenLoading) return;
  
  this.goldenLoading = true;
  this.goldenAborted = false;
  
  console.log('🔵 Golden loading started:', this.goldenLoading);
  
  this.cdr.markForCheck();

  this.goldenTimeoutId = window.setTimeout(() => {
    this.handleGoldenTimeout();
  }, this.GOLDEN_TIMEOUT);

  this.goldenSub = this.qa.generateGolden(id, true).pipe( // ✅ ADD true HERE
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
        console.log('✅ Golden received:', res);
        
        if (this.goldenTimeoutId) {
          clearTimeout(this.goldenTimeoutId);
          this.goldenTimeoutId = undefined;
        }
        
        this.goldenSubject.next(res);
        this.showSuccess('Golden template generated successfully!');
        this.cdr.markForCheck();
      },
      error: (e) => {
        if (this.goldenAborted) return;
        console.error('❌ Golden error:', e);
        
        console.error('Golden generation error:', e);
        
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
        console.log('🟢 Golden complete, loading:', this.goldenLoading); 
        
        this.goldenLoading = false;

        console.log('🟢 Golden loading set to false:', this.goldenLoading);
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
  // GENERATE SUBJECTS
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
        
        console.error('Subjects generation error:', e);
        
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
  // ANALYZE SUGGESTIONS
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
        
        console.error('Suggestions generation error:', e);
        
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
  // GENERATE VARIANTS
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
      // ✅ ADD JUST THIS - Initialize with empty state to show the progress bar
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

          // if ((i + 1) % 2 === 0) {
          //   this.showInfo(`Generated ${i + 1} of ${start.target} variants...`);
          // }

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
    this.cdr.markForCheck(); // ✅ ADD THIS
    return;
  }
  
  const currentState = this.templatesService.snapshot;
  const template = currentState.items.find(item => item.id === templateId);
  
  if (template?.content) {
    console.log('Found template in service');
    this.templateHtml = template.content;
    this.templateLoading = false;
    this.cdr.markForCheck(); // ✅ ADD THIS
    return;
  }
  
  console.log('Template not found in cache or service, fetching from API');
  this.http.get(`/api/templates/${templateId}/raw`, { responseType: 'text' })
    .subscribe({
      next: (html) => {
        console.log('Template loaded from API');
        this.templateHtml = html;
        this.templateLoading = false;
        this.cdr.markForCheck(); // ✅ ADD THIS
      },
      error: (error) => {
        console.error('Failed to load template:', error);
        this.templateHtml = 'Failed to load template';
        this.templateLoading = false;
        this.cdr.markForCheck(); // ✅ ADD THIS
      }
    });
}

  onUseVariant(templateId: string, runId: string, no: number) {
    this.router.navigate(['/qa', templateId, 'use', runId, no]);
  }

    trackByIndex = (i: number) => i;
    trackByEdit = (i: number, e: any) => e.before + '|' + e.after + '|' + (e.parent || '');
}

