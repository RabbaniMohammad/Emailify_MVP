import { 
  Component, 
  OnInit, 
  OnDestroy, 
  ViewChild, 
  ElementRef,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  HostListener,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Router } from '@angular/router';
import { 
  trigger, 
  state, 
  style, 
  transition, 
  animate 
} from '@angular/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, Subscription, combineLatest } from 'rxjs';
import { takeUntil, map, distinctUntilChanged } from 'rxjs/operators';
import { TemplatesService, TemplatesState } from '../../../../core/services/templates.service';
import { PreviewCacheService } from '../../components/template-preview/preview-cache.service';
import { TemplateStateService } from '../../../../core/services/template-state.service';

// Interfaces
export interface TemplateItem {
  id: string;
  name: string;
  content?: string;
}

export type ViewMode = 'desktop' | 'tablet' | 'mobile';
export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

@Component({
  selector: 'app-templates-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HttpClientModule
  ],
  templateUrl: './templates-page.component.html',
  styleUrls: ['./templates-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInOut', [
      state('in', style({ opacity: 1 })),
      state('out', style({ opacity: 0 })),
      transition('* => in', [
        style({ opacity: 0 }),
        animate('300ms ease-in', style({ opacity: 1 }))
      ]),
      transition('in => out', [
        animate('300ms ease-out', style({ opacity: 0 }))
      ])
    ]),
    trigger('bounceIn', [
      transition(':enter', [
        style({ 
          opacity: 0, 
          transform: 'scale(0.3)' 
        }),
        animate('300ms ease-in', style({ 
          opacity: 1, 
          transform: 'scale(1.05)' 
        })),
        animate('100ms ease-out', style({ 
          transform: 'scale(1)' 
        }))
      ])
    ])
  ]
})
export class TemplatesPageComponent implements OnInit, OnDestroy {
  // Services
  private svc = inject(TemplatesService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private http = inject(HttpClient);
  private cache = inject(PreviewCacheService);
  private cdr = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);
  private templateState = inject(TemplateStateService);

  // ViewChild references
  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef<HTMLElement>;

  // Category filter subject for reactive filtering (must be declared before items$)
  private categorySubject = new BehaviorSubject<'all' | 'ai-generated' | 'visual-editor' | 'esp'>('all');

  // Template service observables
  readonly state$ = this.svc.state$;
  readonly items$ = combineLatest([this.state$, this.categorySubject]).pipe(
    map(([state, category]) => {
      // Apply category filter
      let filtered = state.items;
      
      if (category !== 'all') {
        filtered = state.items.filter(item => {
          const itemData = item as any;
          const itemSource = (itemData.source || '').toLowerCase().trim();
          
          switch (category) {
            case 'ai-generated':
              return itemSource === 'ai generated' || itemSource === 'ai-generated';
              
            case 'visual-editor':
              return itemSource === 'visual editor' || itemSource === 'visual-editor';
              
            case 'esp':
              // ESP templates have source === 'mailchimp'
              return itemSource === 'mailchimp';
              
            default:
              return true;
          }
        });
      }
      
      return filtered;
    })
  );
  readonly status$ = this.state$.pipe(map((s: TemplatesState) => s.status));
  readonly error$ = this.state$.pipe(map((s: TemplatesState) => s.error));
  readonly selectedId$ = this.state$.pipe(map((s: TemplatesState) => s.selectedId));
  readonly selectedName$ = this.state$.pipe(map((s: TemplatesState) => s.selectedName));

  // Component state
  searchQuery = '';
  runButtonItemId?: string;
  selectedCategory: 'all' | 'ai-generated' | 'visual-editor' | 'esp' = 'all';
  categoryDropdownOpen = false;
  
  // Double-click prevention
  private lastClickTime = 0;
  private lastClickedId = '';
  
  // Track if current selection was user-initiated or auto-restored
  private userInitiatedSelection = false;
  private isInitialLoad = true;

  // Preview state
  isFullscreen = false;
  hideHeader = false;
  viewMode: ViewMode = 'desktop';
  loading = false;
  allowScripts = false;
  safeSrcdoc: SafeHtml | null = null;
  previewError?: string;
  
  // Info banner & metadata
  showInfoBanner = false;
  templateMetadata: any = null;

  // Private subjects and subscriptions
  private destroy$ = new Subject<void>();
  private fetchSub?: Subscription;
  private loadingTimer?: any;

  isDeleting = false;
  
  // Track in-flight requests to prevent duplicate API calls
  private inflightRequests = new Map<string, Subscription>();

  ngOnInit(): void {

    // Subscribe to selected item changes to load content
    this.selectedId$
      .pipe(
        takeUntil(this.destroy$),
        distinctUntilChanged()
      )
      .subscribe(id => {

        if (id) {
          this.loadTemplateContent(id);
        } else {
          // Clear preview when nothing selected
          this.safeSrcdoc = null;
          this.runButtonItemId = undefined;
          this.cdr.markForCheck();
        }
      });

    // ✅ RESTORE SEARCH QUERY FROM SERVICE STATE
    const currentState = this.svc.snapshot;
    if (currentState.searchQuery) {
      this.searchQuery = currentState.searchQuery;
    }

    // Always load templates on init
    // ✅ ALWAYS call search to trigger reordering, even if items exist
    // This ensures the last-selected template appears first on navigation back
    this.svc.search(this.searchQuery);
    
    // ✅ Scroll to top when component loads (shows selected template first)
    setTimeout(() => {
      this.scrollToTop();
      this.isInitialLoad = false;
    }, 100);
  }

  ngOnDestroy(): void {

    this.destroy$.next();
    this.destroy$.complete();
    this.fetchSub?.unsubscribe();
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
    }
    // Clean up all in-flight requests
    this.inflightRequests.forEach(sub => sub.unsubscribe());
    this.inflightRequests.clear();
  }

  // Category filter methods
  toggleCategoryDropdown(): void {
    this.categoryDropdownOpen = !this.categoryDropdownOpen;
  }

  selectCategory(category: 'all' | 'ai-generated' | 'visual-editor' | 'esp'): void {
    this.selectedCategory = category;
    this.categorySubject.next(category); // Emit new category for reactive filtering
    this.categoryDropdownOpen = false;
    this.cdr.markForCheck();
  }

  getCategoryLabel(): string {
    switch (this.selectedCategory) {
      case 'all': return 'All';
      case 'ai-generated': return 'AI Generated';
      case 'visual-editor': return 'Visual Editor';
      case 'esp': return 'ESP';
      default: return 'All';
    }
  }

  getCategoryIcon(): string {
    switch (this.selectedCategory) {
      case 'all': return 'apps';
      case 'ai-generated': return 'auto_awesome';
      case 'visual-editor': return 'design_services';
      case 'esp': return 'email';
      default: return 'apps';
    }
  }

  // Close dropdown when clicking outside
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const clickedInside = target.closest('.category-filter-wrapper');
    
    if (!clickedInside && this.categoryDropdownOpen) {
      this.categoryDropdownOpen = false;
      this.cdr.markForCheck();
    }
  }

  // Search functionality
  onSearch(query: string): void {
    this.searchQuery = query;
    this.svc.search(query);
    
    // ✅ Scroll to top after search to show results from beginning
    setTimeout(() => this.scrollToTop(), 100);
  }

  // Template list methods with double-click prevention
  onSelect(item: TemplateItem): void {

    // Only hide button if switching to a different template
    const currentSelected = this.svc.snapshot.selectedId;
    if (currentSelected && currentSelected !== item.id) {
      this.runButtonItemId = undefined;
    }
    
    this.svc.select(item.id, item.name);
    this.userInitiatedSelection = true;
    
    // ⚠️ DEPRECATED: These legacy keys are cleared on logout but not used anywhere
    // Keeping for backward compatibility but prefer using TemplatesService cache
    try {
      localStorage.setItem('lastTemplateId', item.id);
      localStorage.setItem('lastTemplateName', item.name || '');
    } catch {}
    
    this.cdr.markForCheck();
  }

  onRunTests(id: string): void {
    // ✅ Before navigating, ensure this template is marked as last selected
    const item = this.svc.snapshot.items.find(t => t.id === id);
    if (item) {
      this.svc.select(id, item.name);
      
      // ✅ CRITICAL: Reset template state to original (temp_1)
      // This clears any edited state (temp_edit) and ensures fresh start
      if (item.content) {
        this.templateState.initializeOriginalTemplate(id, item.content);
        // Navigate immediately if we have content
        this.router.navigate(['/qa', id]);
      } else {
        // ✅ FETCH CONTENT: If template content not loaded, fetch it first
        // Check cache first
        const cachedHtml = this.cache.get(id) || this.cache.getPersisted(id);
        
        if (cachedHtml) {
          this.templateState.initializeOriginalTemplate(id, cachedHtml);
          this.router.navigate(['/qa', id]);
        } else {
          // Fetch from API
          this.http.get(`/api/templates/${id}/raw`, { responseType: 'text' })
            .subscribe({
              next: (html) => {
                this.templateState.initializeOriginalTemplate(id, html);
                this.router.navigate(['/qa', id]);
              },
              error: (error) => {

                this.snackBar.open('Failed to load template', 'Close', {
                  duration: 3000,
                  panelClass: ['error-snackbar'],
                });
              }
            });
        }
      }
    } else {
      // If item not found, just navigate (QA page will handle loading)
      this.router.navigate(['/qa', id]);
    }
  }

  onClick(item: TemplateItem): void {
    const now = Date.now();
    
    // Prevent rapid double-clicks on the same item
    if (this.lastClickedId === item.id && (now - this.lastClickTime) < 500) {
      return;
    }
    
    // Prevent any clicks that are too rapid (global debounce)
    if ((now - this.lastClickTime) < 200) {
      return;
    }
    
    this.lastClickTime = now;
    this.lastClickedId = item.id;
    
    this.onSelect(item);
  }

  onAction(item: TemplateItem, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.onRunTests(item.id);
  }

  trackById(index: number, item: TemplateItem): string {
    return item.id;
  }

  // Preview methods
  private showRunButton(templateId: string): void {
    const current = this.svc.snapshot.selectedId;
    if (templateId === current) {
      this.runButtonItemId = templateId;
      this.cdr.markForCheck();
    }
  }

  refresh(): void {
    const currentId = this.svc.snapshot.selectedId;
    if (currentId) {
      this.cache.clear(currentId);
      sessionStorage.removeItem(`metadata-${currentId}`);
      this.loadTemplateContent(currentId);
    }
  }

  toggleFullscreen(): void {
    const element = document.querySelector('.preview-root') as HTMLElement;
    if (!element) return;

    if (!this.isFullscreen) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
    this.isFullscreen = !this.isFullscreen;
    this.cdr.markForCheck();
  }

  changeViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.cdr.markForCheck();
  }

  toggleInfoBanner(): void {
    this.showInfoBanner = !this.showInfoBanner;
    this.cdr.markForCheck();
  }

  deleteTemplate(): void {
    // Prevent concurrent deletions
    if (this.isDeleting) {
      return;
    }

    const currentId = this.svc.snapshot.selectedId;
    const currentName = this.svc.snapshot.selectedName;
    
    if (!currentId) {
      return;
    }
    
    const confirmed = confirm(
      `Are you sure you want to delete "${currentName}"?\n\nThis action cannot be undone and will permanently remove the template from Mailchimp.`
    );
    
    if (!confirmed) {
      return;
    }
    
    // Set deleting flag
    this.isDeleting = true;
    
    // Optimistic UI update
    this.safeSrcdoc = null;
    this.templateMetadata = null;
    this.runButtonItemId = undefined;
    this.loading = false;
    this.cdr.markForCheck();
    
    // Clear all caches
    this.cache.clearTemplate(currentId);
    
    // Delete from backend
    this.svc.deleteTemplate(currentId).subscribe({
      next: (response) => {
        this.isDeleting = false;
        
        this.snackBar.open(
          `"${currentName}" deleted successfully`,
          'Close',
          {
            duration: 4000,
            panelClass: ['success-snackbar'],
            horizontalPosition: 'center',
            verticalPosition: 'bottom'
          }
        );
      },
      error: (error) => {

        this.isDeleting = false;
        
        this.snackBar.open(
          `Failed to delete template: ${error?.error?.message || error?.message || 'Unknown error'}`,
          'Close',
          {
            duration: 6000,
            panelClass: ['error-snackbar'],
            horizontalPosition: 'center',
            verticalPosition: 'bottom'
          }
        );
        
        // Reload to sync state
        this.svc.search(this.searchQuery);
      }
    });
  }

  // Utility methods for scrolling
  scrollToItem(itemId: string): void {
    if (!this.scrollContainer) return;
    
    const container = this.scrollContainer.nativeElement;
    const itemElement = container.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement;
    
    if (itemElement) {
      itemElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }

  scrollToTop(): void {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTo({
        top: 0,
        behavior: 'instant' // ✅ Changed to 'instant' for immediate scroll
      });
    }
  }

  scrollToBottom(): void {
    if (this.scrollContainer) {
      const container = this.scrollContainer.nativeElement;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  // Optimized template loading with metadata caching
  private loadTemplateContent(id: string): void {

    // Clear previous state
    this.previewError = undefined;
    this.runButtonItemId = undefined;
    this.templateMetadata = null;
    
    // ✅ IMMEDIATELY clear old preview to prevent flash
    this.safeSrcdoc = null;
    
    // ✅ Clear any pending loading timer to prevent conflicts
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = undefined;
    }

    if (!id) {
      this.loading = false;
      this.cdr.markForCheck();
      return;
    }

    // ✅ Show loading state IMMEDIATELY
    this.loading = true;
    this.cdr.markForCheck();

    // Check cache first
    const cached = this.cache.get(id) || this.cache.getPersisted(id);
    if (cached) {
      // Check if metadata is already cached
      const cachedMetadata = sessionStorage.getItem(`metadata-${id}`);
      if (cachedMetadata) {
        this.templateMetadata = JSON.parse(cachedMetadata);
        this.cdr.markForCheck();
      } else {
        // Fetch metadata from API and cache it
        this.http.get(`/api/templates/${id}`, { responseType: 'json' })
          .subscribe({
            next: (response: any) => {
              this.templateMetadata = {
                type: response.type,
                templateType: response.templateType,
                category: response.category || 'N/A',
                thumbnail: response.thumbnail,
                dateCreated: response.dateCreated,
                dateEdited: response.dateEdited,
                createdBy: response.createdBy,
                active: response.active,
                dragAndDrop: response.dragAndDrop,
                responsive: response.responsive,
                folderId: response.folderId || 'N/A',
                screenshotUrl: response.screenshotUrl,
                source: response.source
              };
              
              // Cache the metadata
              sessionStorage.setItem(`metadata-${id}`, JSON.stringify(this.templateMetadata));
              this.cdr.markForCheck();
            },
            error: (e) => {
            }
          });
      }
      
      // Process content immediately
      const wrapped = this.ensureDoc(cached);
      const cleaned = this.stripDangerousBits(wrapped);
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
      this.cdr.markForCheck();
      
      // ✅ Set a fallback timeout in case iframe load event doesn't fire
      this.loadingTimer = setTimeout(() => {
        if (this.svc.snapshot.selectedId === id) {
          this.loading = false;
          this.showRunButton(id);
          this.cdr.markForCheck();
        }
      }, 100); // ⚡ Increased to 100ms for more reliable display
      
      return;
    }

    // Check if we already have an in-flight request for this template
    if (this.inflightRequests.has(id)) {
      // ✅ Don't start duplicate request, but ensure loading is shown
      this.loading = true;
      this.cdr.markForCheck();
      return;
    }

    // Fresh content path - fetch from API
    this.loading = true;
    this.safeSrcdoc = null;
    this.cdr.markForCheck();

    const subscription = this.http
      .get(`/api/templates/${id}`, { responseType: 'json' })
      .subscribe({
        next: (response: any) => {
          // Store metadata
          this.templateMetadata = {
            type: response.type,
            templateType: response.templateType,
            category: response.category || 'N/A',
            thumbnail: response.thumbnail,
            dateCreated: response.dateCreated,
            dateEdited: response.dateEdited,
            createdBy: response.createdBy,
            active: response.active,
            dragAndDrop: response.dragAndDrop,
            responsive: response.responsive,
            folderId: response.folderId || 'N/A',
            screenshotUrl: response.screenshotUrl,
            source: response.source
          };
          
          // Cache the metadata
          sessionStorage.setItem(`metadata-${id}`, JSON.stringify(this.templateMetadata));
          // Remove from in-flight requests
          this.inflightRequests.delete(id);
          
          const currentId = this.svc.snapshot.selectedId;
          
          // Check if user switched templates during fetch
          if (currentId !== id) {
            // User switched - clear loading state
            this.loading = false;
            this.cdr.markForCheck();
            return;
          }
          
          const html = response.html || '';
          this.cache.set(id, html);
          const wrapped = this.ensureDoc(html);
          const cleaned = this.stripDangerousBits(wrapped);
          this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
          
          // ✅ Set fallback timeout in case iframe doesn't load
          this.loadingTimer = setTimeout(() => {
            if (this.svc.snapshot.selectedId === id) {
              this.loading = false;
              this.showRunButton(id);
              this.cdr.markForCheck();
            }
          }, 100);
          
          this.cdr.markForCheck();
        },
        error: (e) => {

          // Remove from in-flight requests
          this.inflightRequests.delete(id);
          
          this.loading = false;
          this.previewError = e?.message || 'Failed to load preview.';
          this.cdr.markForCheck();
        },
        complete: () => {
          // Ensure cleanup on completion
          this.inflightRequests.delete(id);
        }
      });
    
    // Store the subscription to prevent duplicate requests
    this.inflightRequests.set(id, subscription);
  }

  onIframeLoad(): void {
    // ✅ ALWAYS clear loading on iframe load (even if safeSrcdoc is null)
    // This prevents infinite loading when templates switch quickly
    this.loading = false;
    
    // Clear any pending timer
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = undefined;
    }
    
    const currentId = this.svc.snapshot.selectedId;
    if (currentId && this.safeSrcdoc) {
      this.showRunButton(currentId);
    }
    this.cdr.markForCheck();
  }

  private ensureDoc(bodyOrDoc: string): string {
    const html = String(bodyOrDoc || '');
    const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
    if (hasDoc) return html;
    return [
      '<!doctype html><html><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>html,body{margin:0;padding:0}</style>',
      '</head><body>',
      html,
      '</body></html>',
    ].join('');
  }

  private stripDangerousBits(docHtml: string): string {
    try {
      const doc = new DOMParser().parseFromString(docHtml, 'text/html');
      doc.querySelectorAll('script, iframe, base').forEach(n => n.remove());
      doc.querySelectorAll<HTMLElement>('*').forEach(el => {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
          const attr = el.attributes.item(i);
          if (attr && /^on/i.test(attr.name)) {
            el.removeAttribute(attr.name);
          }
        }
      });
      return '<!doctype html>\n' + doc.documentElement.outerHTML;
    } catch {
      return docHtml
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<base[\s\S]*?>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    }
  }
}