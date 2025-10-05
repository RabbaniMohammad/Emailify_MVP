import { 
  Component, 
  OnInit, 
  OnDestroy, 
  OnChanges,
  SimpleChanges,
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
import { Observable, BehaviorSubject, Subject, Subscription } from 'rxjs';
import { takeUntil, map } from 'rxjs/operators';
import { TemplatesService, TemplatesState } from '../../../../core/services/templates.service';
import { PreviewCacheService } from '../../components/template-preview/preview-cache.service';

// Interfaces
export interface TemplateItem {
  id: string;
  name: string;
  content?: string;
  // Add other properties as needed
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
      transition(':enter', [
        style({ opacity: 0 }),
        animate(300, style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate(300, style({ opacity: 0 }))
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
  private clickedThisSelection = false;

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

  ngOnInit(): void {
    // Subscribe to selected item changes to load content
    let previousId: string | null = null;
    
    this.selectedId$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      // Only load if the ID actually changed
      if (id && id !== previousId) {
        previousId = id;
        this.loadTemplateContent(id);
      }
    });

    // Restore last selection (button won't show until a fresh click)
    try {
      const id = localStorage.getItem('lastTemplateId');
      const name = localStorage.getItem('lastTemplateName') || '';
      if (id) this.svc.select(id, name);
    } catch {}

    if (!this.svc.snapshot.items.length) this.svc.search('');
    this.svc.refresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.fetchSub?.unsubscribe();
  }

  // Search functionality
  onSearch(query: string): void {
    this.searchQuery = query;

    // // Clear selection when searching using the service
    // if (query && query.trim()) {
    //   this.svc.select('', ''); // or however your service clears selection
    //   // OR if your service has a clear method:
    //   // this.svc.clearSelection();
    // }

    this.svc.search(query);
  }

  // Template list methods
  onSelect(item: TemplateItem): void {
    this.svc.select(item.id, item.name);
    this.runButtonItemId = undefined;   // hide until loaded
    this.clickedThisSelection = true;   // require a user click
    
    try {
      localStorage.setItem('lastTemplateId', item.id);
      localStorage.setItem('lastTemplateName', item.name || '');
    } catch {}
  }

  onRunTests(id: string): void {
    // TODO: integrate with your QA rail; placeholder action:
    this.router.navigate(['/qa', id]);
  }

  onClick(item: TemplateItem): void {
    this.onSelect(item);
  }

  onAction(item: TemplateItem, event: Event): void {
    event.stopPropagation();
    this.onRunTests(item.id);
  }

  trackById(index: number, item: TemplateItem): string {
    return item.id;
  }

  // Preview methods
  onPreviewReady(loadedId: string): void {
    const current = this.svc.snapshot.selectedId;
    if (this.clickedThisSelection && loadedId === current) {
      this.runButtonItemId = loadedId;  // show button on this row
      this.clickedThisSelection = false;
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

  onIframeLoad(): void {
    this.loading = false;
    this.cdr.markForCheck();
    const currentId = this.svc.snapshot.selectedId;
    if (currentId) {
      this.onPreviewReady(currentId);
    }
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

  // Debug method - remove after testing
  checkScrollStatus(): void {
    if (!this.scrollContainer) {
      console.log('❌ No scroll container found');
      return;
    }

    const container = this.scrollContainer.nativeElement;
    const computedStyle = window.getComputedStyle(container);
    
    console.log('🔍 Scroll Debug Info:', {
      overflowY: computedStyle.overflowY,
      overflowX: computedStyle.overflowX,
      height: computedStyle.height,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      isScrollable: container.scrollHeight > container.clientHeight,
      itemCount: this.items$.pipe(map(items => items.length))
    });
  }

  // Test method - remove after testing
  addTestItems(): void {
    // This would need to be implemented through your service
    // Can't directly manipulate items in this architecture
    console.log('Test items would be added through TemplatesService');
  }

  // Private methods for template loading
  private loadTemplateContent(id: string): void {
    this.previewError = undefined;
    this.loading = false;
    this.safeSrcdoc = null;
    this.fetchSub?.unsubscribe();

    if (!id) return;

    const cached = this.cache.get(id) || this.cache.getPersisted(id);
    if (cached) {
      this.setFromHtml(cached);
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.cdr.markForCheck();
    
    this.fetchSub = this.http
      .get(`/api/templates/${id}/raw`, { responseType: 'text' })
      .subscribe({
        next: (text) => {
          if (!id) return;
          const html = text || '';
          this.cache.set(id, html);
          this.setFromHtml(html);
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.loading = false;
          this.previewError = e?.message || 'Failed to load preview.';
          this.cdr.markForCheck();
        },
      });
  }

  private setFromHtml(rawHtml: string): void {
    const wrapped = this.ensureDoc(rawHtml);
    const cleaned = this.stripDangerousBits(wrapped);
    this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
    this.loading = true;
    
    // Fallback timeout in case iframe load event doesn't fire
    setTimeout(() => {
      if (this.loading) {
        this.loading = false;
        this.cdr.markForCheck();
      }
    }, 3000);
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