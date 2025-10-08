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

  // Private subjects and subscriptions
  private destroy$ = new Subject<void>();
  private fetchSub?: Subscription;
  private loadingTimer?: any;
  
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

    // Always load templates on init
    console.log('Component init - loading templates');
    
    // Check if we have items already loaded
    if (this.svc.snapshot.items.length === 0) {
      console.log('No items in state, calling search');
      this.svc.search(''); // Will use cache or fetch fresh
    } else {
      console.log('Items already in state:', this.svc.snapshot.items.length);
    }
    
    // After initial setup, mark as no longer initial load
    setTimeout(() => {
      this.isInitialLoad = false;
    }, 0);
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

  // Preview methods - OPTIMIZED FOR NO FLICKERING
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
        behavior: 'smooth'
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

  // ✅ FIXED: Optimized template loading - NO MORE FLICKERING + NO DUPLICATE API CALLS
  private loadTemplateContent(id: string): void {
    console.log('🔄 START loadTemplateContent, id:', id);
    
    // Clear previous state
    this.previewError = undefined;
    this.runButtonItemId = undefined;
    
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
      
      // ✅ Process content immediately
      const wrapped = this.ensureDoc(cached);
      const cleaned = this.stripDangerousBits(wrapped);
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
      
      // Show loading very briefly for smooth UX (optional - you can set to 0)
      this.loading = true;
      this.cdr.markForCheck();
      
      // Hide loading after iframe renders
      // Note: You can reduce this to 0 if you want instant switching
      this.loadingTimer = setTimeout(() => {
        if (this.svc.snapshot.selectedId === id) {
          this.loading = false;
          this.showRunButton(id);
          console.log('✅ Cached template loaded successfully');
          this.cdr.markForCheck();
        }
      }, 0); // Changed to 0 for instant loading (was 50ms)
      
      return;
    }

    // ✅ Check if we already have an in-flight request for this template
    if (this.inflightRequests.has(id)) {
      console.log('⏳ Request already in-flight for template:', id, '- reusing existing request');
      this.loading = true;
      this.cdr.markForCheck();
      return; // Just show loading, the existing request will complete
    }

    // Fresh content path - fetch from API
    console.log('📡 Fetching fresh content from API...');
    this.loading = true;
    this.safeSrcdoc = null;
    this.cdr.markForCheck();

    const subscription = this.http
      .get(`/api/templates/${id}/raw`, { responseType: 'text' })
      .subscribe({
        next: (text) => {
          console.log('📥 API response received for:', id);
          
          // Remove from in-flight requests
          this.inflightRequests.delete(id);
          
          const currentId = this.svc.snapshot.selectedId;
          
          // Check if user switched templates during fetch
          if (currentId !== id) {
            console.log('⚠️ User switched during fetch, aborting');
            return;
          }
          
          const html = text || '';
          this.cache.set(id, html);
          
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
          // Ensure cleanup on completion
          this.inflightRequests.delete(id);
        }
      });
    
    // Store the subscription to prevent duplicate requests
    this.inflightRequests.set(id, subscription);
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