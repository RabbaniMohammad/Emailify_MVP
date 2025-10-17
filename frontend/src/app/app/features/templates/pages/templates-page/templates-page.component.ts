import { 
  Component, 
  OnInit, 
  OnDestroy, 
  ViewChild, 
  ElementRef,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
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
import { Subject, Subscription } from 'rxjs';
import { takeUntil, map, distinctUntilChanged } from 'rxjs/operators';
import { TemplatesService, TemplatesState } from '../../../../core/services/templates.service';
import { PreviewCacheService } from '../../components/template-preview/preview-cache.service';

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

  // ViewChild references
  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef<HTMLElement>;

  // Template service observables
  readonly state$ = this.svc.state$;
  readonly items$ = this.state$.pipe(map((s: TemplatesState) => s.items));
  readonly status$ = this.state$.pipe(map((s: TemplatesState) => s.status));
  readonly error$ = this.state$.pipe(map((s: TemplatesState) => s.error));
  readonly selectedId$ = this.state$.pipe(map((s: TemplatesState) => s.selectedId));
  readonly selectedName$ = this.state$.pipe(map((s: TemplatesState) => s.selectedName));

  // Component state
  searchQuery = '';
  runButtonItemId?: string;
  
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
      console.log('✅ Restoring search query:', currentState.searchQuery);
      this.searchQuery = currentState.searchQuery;
    }

    // Always load templates on init
    console.log('Component init - loading templates with query:', this.searchQuery);
    
    // ✅ ALWAYS call search to trigger reordering, even if items exist
    // This ensures the last-selected template appears first on navigation back
    console.log('Calling search to ensure proper ordering');
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
    }
    
    this.router.navigate(['/qa', id]);
  }

  onClick(item: TemplateItem): void {
    const now = Date.now();
    
    // Prevent rapid double-clicks on the same item
    if (this.lastClickedId === item.id && (now - this.lastClickTime) < 500) {
      console.log('Double-click prevented for:', item.id);
      return;
    }
    
    // Prevent any clicks that are too rapid (global debounce)
    if ((now - this.lastClickTime) < 200) {
      console.log('Rapid click prevented');
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
      console.log('⏳ Delete already in progress');
      return;
    }

    const currentId = this.svc.snapshot.selectedId;
    const currentName = this.svc.snapshot.selectedName;
    
    if (!currentId) {
      console.warn('No template selected');
      return;
    }
    
    const confirmed = confirm(
      `Are you sure you want to delete "${currentName}"?\n\nThis action cannot be undone and will permanently remove the template from Mailchimp.`
    );
    
    if (!confirmed) {
      console.log('Delete cancelled by user');
      return;
    }
    
    console.log('🗑️ Deleting template:', currentId);
    
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
        console.log('✅ Template deleted successfully');
        
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
        console.error('❌ Failed to delete template:', error);
        
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
    console.log('📄 START loadTemplateContent, id:', id);
    
    // Clear previous state
    this.previewError = undefined;
    this.runButtonItemId = undefined;
    this.templateMetadata = null;
    
    // Clear any pending loading timer
    if (this.loadingTimer) {
      clearTimeout(this.loadingTimer);
      this.loadingTimer = undefined;
    }

    if (!id) {
      this.loading = false;
      this.safeSrcdoc = null;
      console.log('❌ No ID - loading set to FALSE');
      this.cdr.markForCheck();
      return;
    }

    // Check cache first
    const cached = this.cache.get(id) || this.cache.getPersisted(id);
    console.log('💾 Cache check:', cached ? 'HIT' : 'MISS');
    
    if (cached) {
      console.log('✅ Using cached content - loading instantly');
      
      // Check if metadata is already cached
      const cachedMetadata = sessionStorage.getItem(`metadata-${id}`);
      if (cachedMetadata) {
        this.templateMetadata = JSON.parse(cachedMetadata);
        console.log('✅ Using cached metadata');
        this.cdr.markForCheck();
      } else {
        // Fetch metadata from API and cache it
        console.log('📡 Fetching metadata from API for cached content...');
        this.http.get(`/api/templates/${id}`, { responseType: 'json' })
          .subscribe({
            next: (response: any) => {
              console.log('✅ API response received for metadata');
              
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
              console.log('✅ Fetched and cached metadata');
              
              this.cdr.markForCheck();
            },
            error: (e) => {
              console.warn('⚠️ Failed to load metadata:', e);
            }
          });
      }
      
      // Process content immediately
      const wrapped = this.ensureDoc(cached);
      const cleaned = this.stripDangerousBits(wrapped);
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
      
      // Show loading very briefly for smooth UX
      this.loading = true;
      this.cdr.markForCheck();
      
      // Hide loading after iframe renders
      this.loadingTimer = setTimeout(() => {
        if (this.svc.snapshot.selectedId === id) {
          this.loading = false;
          this.showRunButton(id);
          console.log('✅ Cached template loaded successfully');
          this.cdr.markForCheck();
        }
      }, 0);
      
      return;
    }

    // Check if we already have an in-flight request for this template
    if (this.inflightRequests.has(id)) {
      console.log('⏳ Request already in-flight for template:', id, '- reusing existing request');
      this.loading = true;
      this.cdr.markForCheck();
      return;
    }

    // Fresh content path - fetch from API
    console.log('📡 Fetching fresh content from API...');
    this.loading = true;
    this.safeSrcdoc = null;
    this.cdr.markForCheck();

    const subscription = this.http
      .get(`/api/templates/${id}`, { responseType: 'json' })
      .subscribe({
        next: (response: any) => {
          console.log('✅ Fresh API response received');
          
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
          console.log('✅ Fetched and cached metadata');
          
          // Remove from in-flight requests
          this.inflightRequests.delete(id);
          
          const currentId = this.svc.snapshot.selectedId;
          
          // Check if user switched templates during fetch
          if (currentId !== id) {
            console.log('⚠️ User switched during fetch, aborting');
            return;
          }
          
          const html = response.html || '';
          console.log('📄 HTML content length:', html.length);
          
          this.cache.set(id, html);
          console.log('💾 HTML cached in memory');
          
          const wrapped = this.ensureDoc(html);
          const cleaned = this.stripDangerousBits(wrapped);
          this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
          console.log('✅ Fresh HTML set, waiting for iframe load event');
          this.cdr.markForCheck();
        },
        error: (e) => {
          console.error('❌ API error for:', id, e);
          
          // Remove from in-flight requests
          this.inflightRequests.delete(id);
          
          this.loading = false;
          this.previewError = e?.message || 'Failed to load preview.';
          this.cdr.markForCheck();
        },
        complete: () => {
          console.log('✅ HTTP request completed');
          // Ensure cleanup on completion
          this.inflightRequests.delete(id);
        }
      });
    
    // Store the subscription to prevent duplicate requests
    this.inflightRequests.set(id, subscription);
    console.log('📡 HTTP request initiated and stored');
  }

  onIframeLoad(): void {
    console.log('🖼️ onIframeLoad called');
    
    // Only clear loading if we actually have content to show
    if (!this.safeSrcdoc) {
      console.log('⚠️ Iframe loaded but no content yet - ignoring');
      return;
    }
    
    console.log('✅ Iframe loaded with content - setting loading to FALSE');
    this.loading = false;
    const currentId = this.svc.snapshot.selectedId;
    if (currentId) {
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