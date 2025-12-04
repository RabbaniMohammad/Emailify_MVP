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
import { Router, ActivatedRoute } from '@angular/router';
import { 
  trigger, 
  state, 
  style, 
  transition, 
  animate 
} from '@angular/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject, Subscription, combineLatest, of, forkJoin, Observable } from 'rxjs';
import { takeUntil, map, distinctUntilChanged, switchMap, catchError } from 'rxjs/operators';
import { TemplatesService, TemplatesState } from '../../../../core/services/templates.service';
import { PreviewCacheService } from '../../components/template-preview/preview-cache.service';
import { TemplateStateService } from '../../../../core/services/template-state.service';
import { AuthService } from '../../../../core/services/auth.service';

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
  private route = inject(ActivatedRoute);
  private sanitizer = inject(DomSanitizer);
  private http = inject(HttpClient);
  private cache = inject(PreviewCacheService);
  private cdr = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);
  private templateState = inject(TemplateStateService);
  private authService = inject(AuthService);

  // ViewChild references
  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef<HTMLElement>;

  // Category filter subject for reactive filtering (must be declared before items$)
  private categorySubject = new BehaviorSubject<'all' | 'ai-generated' | 'ai-generated-images' | 'visual-editor' | 'esp'>('all');

  // Template service observables
  readonly state$ = this.svc.state$;

  // items$ now includes saved generated images when the category is 'ai-generated'.
  // For generated images we prefix the id with `genimg_` so we can detect them later.
  readonly items$ = combineLatest([this.state$, this.categorySubject]).pipe(
    switchMap(([state, category]) => {
      // Base set: templates filtered by category (except ai-generated where we also fetch saved images)
      let base = state.items;

      if (category !== 'all') {
        base = state.items.filter(item => {
          const itemData = item as any;
          const itemSource = (itemData.source || '').toLowerCase().trim();

          switch (category) {
            case 'ai-generated':
              // Keep templates that already have source ai-generated
              return itemSource === 'ai generated' || itemSource === 'ai-generated';

            case 'visual-editor':
              return itemSource === 'visual editor' || itemSource === 'visual-editor';

            case 'esp':
              return itemSource === 'mailchimp';

            default:
              return true;
          }
        });
      }

      // If category is ai-generated-images, fetch saved images from /api/images and show only them
      if (category === 'ai-generated-images') {
        return this.http.get<{ items: any[] }>('/api/images', { withCredentials: true }).pipe(
          map(resp => resp?.items || []),
          catchError(err => {
            console.error('Failed to load generated images', err);
            return of([] as any[]);
          }),
          map((images: any[]) => images.map(img => ({
              id: `genimg_${img.id}`,
              name: img.name || 'Generate Flyer',
            originalImageId: img.id,
            imageUrl: img.url,
            thumbnail: img.thumbnail,
            prompt: img.prompt,
            source: 'ai-generated-image'
          } as any)))
        );
      }

      // If category is ai-generated (templates flagged as AI-generated), also fetch saved images and merge
      if (category === 'ai-generated') {
        return this.http.get<{ items: any[] }>('/api/images', { withCredentials: true }).pipe(
          map(resp => resp?.items || []),
          catchError(err => {
            // On error, return empty array so UI still shows templates
            console.error('Failed to load generated images', err);
            return of([] as any[]);
          }),
          map((images: any[]) => {
            // Map images to template-like items
            const mapped = images.map(img => {
              return {
                id: `genimg_${img.id}`,
                name: img.name || 'Generate Flyer',
                // preserve original image id for backend calls
                originalImageId: img.id,
                imageUrl: img.url,
                thumbnail: img.thumbnail,
                prompt: img.prompt,
                source: 'ai-generated-image'
              } as any;
            });

            // Merge templates + saved images (saved images first)
            return [...mapped, ...base];
          })
        );
      }

      return of(base);
    })
  );
  readonly status$ = this.state$.pipe(map((s: TemplatesState) => s.status));
  readonly error$ = this.state$.pipe(map((s: TemplatesState) => s.error));
  readonly selectedId$ = this.state$.pipe(map((s: TemplatesState) => s.selectedId));
  readonly selectedName$ = this.state$.pipe(map((s: TemplatesState) => s.selectedName));
  readonly totalItems$ = this.state$.pipe(map((s: TemplatesState) => s.totalItems));
  readonly paginationLoading$ = this.state$.pipe(map((s: TemplatesState) => s.paginationLoading));

  // Component state
  searchQuery = '';
  runButtonItemId?: string;
  selectedCategory: 'all' | 'ai-generated' | 'ai-generated-images' | 'visual-editor' | 'esp' = 'all';
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
  // Edit modal state
  showEditModal = false;
  editMode: 'deterministic' | 'ai' = 'deterministic';
  // Deterministic edit inputs
  editOverlayText = '';
  editHexColor = '#E5893F';
  // AI remix inputs
  editRemixPrompt = '';
  isEditing = false;
  editPreviewDataUrl: string | null = null; // shows result of deterministic edit or ai remix

  // Private subjects and subscriptions
  private destroy$ = new Subject<void>();
  private fetchSub?: Subscription;
  private loadingTimer?: any;

  isDeleting = false;

  // Organization display (small badge on placeholder)
  public readonly orgName$: Observable<string | null> = this.authService.currentUser$.pipe(
    map((u: any) => {
      // organizationId may be a string or object
      const orgName = u?.organizationId && typeof u.organizationId === 'object' ? u.organizationId.name : (u?.organizationId || null);
      return orgName || null;
    })
  );
  
  // Track in-flight requests to prevent duplicate API calls
  private inflightRequests = new Map<string, Subscription>();

  // Pagination getters
  get hasPreviousPage(): boolean { return this.svc.snapshot.currentPage > 1; }
  get hasNextPage(): boolean { return this.svc.snapshot.currentPage < this.svc.snapshot.totalPages; }
  get startItem(): number {
    const state = this.svc.snapshot;
    return state.totalItems === 0 ? 0 : (state.currentPage - 1) * state.pageSize + 1;
  }
  get endItem(): number {
    const state = this.svc.snapshot;
    return Math.min(state.currentPage * state.pageSize, state.totalItems);
  }

  goToPreviousPage(): void {
    const state = this.svc.snapshot;
    if (state.currentPage > 1) {
      this.svc.search(state.searchQuery, state.currentPage - 1, state.pageSize, true);
      this.scrollToTop();
    }
  }

  goToNextPage(): void {
    const state = this.svc.snapshot;
    if (state.currentPage < state.totalPages) {
      this.svc.search(state.searchQuery, state.currentPage + 1, state.pageSize, true);
      this.scrollToTop();
    }
  }

  ngOnInit(): void {

// DEBUG: Watch every update from TemplatesService
this.svc.state$
.pipe(takeUntil(this.destroy$))
.subscribe(state => {
  console.log("%c COMPONENT RECEIVED STATE", "color: #4CAF50; font-weight: bold;");
  console.log("State count:", state.items.length);
  console.log("IDs:", state.items.map(i => i.id));
});


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
    console.log("%c COMPONENT INIT — triggering backend fetch", "color: #2196F3;");

    // Always load templates on init
    // ✅ ALWAYS call search to trigger reordering, even if items exist
    // This ensures the last-selected template appears first on navigation back
    this.svc.search(this.searchQuery);
    // If route contains category or id query param, respect it (e.g., after saving an image)
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(q => {
      const category = q.get('category');
      const itemId = q.get('id');
      if (category) {
        // Normalize and select (accept different separators)
        const normalized = category.replace(/_/g, '-').toLowerCase();
        let cat: any = normalized;
        if (normalized === 'ai-generated' || normalized === 'ai-generated') cat = 'ai-generated';
        if (normalized === 'ai-generated-images' || normalized === 'ai-generated-images') cat = 'ai-generated-images';
        this.selectCategory(cat as any);
      }
      if (itemId) {
        // If an item id is supplied (backend image id), select and scroll to it after short delay
          setTimeout(() => {
          const genId = `genimg_${itemId}`;
          try { this.svc.select(genId, 'Generate Flyer'); } catch (e) {}
          this.scrollToItem(genId);
        }, 300);
      }
    });
    
    // ✅ Scroll to top when component loads (shows selected template first)
    setTimeout(() => {
      this.scrollToTop();
      this.isInitialLoad = false;
    }, 100);

    // Listen for saved/generated image events so we can refresh the AI Generated list immediately
    this.onGeneratedImagesUpdatedBound = this.onGeneratedImagesUpdated.bind(this);
    window.addEventListener('generatedImages:updated', this.onGeneratedImagesUpdatedBound as EventListener);
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

    // Remove global listener
    try {
      window.removeEventListener('generatedImages:updated', this.onGeneratedImagesUpdatedBound as EventListener);
    } catch (e) {}
  }

  // Bound event handler set in ngOnInit
  private onGeneratedImagesUpdatedBound: ((e: any) => void) | null = null;

  // When a generated image is saved elsewhere, refresh the ai-generated view if active
  private onGeneratedImagesUpdated(e: any): void {
    // If user currently viewing AI Generated templates or AI Generated Images list, re-emit to force refresh
    if (this.selectedCategory === 'ai-generated' || this.selectedCategory === 'ai-generated-images') {
      // Emit same value to BehaviorSubject to retrigger items$ switchMap
      this.categorySubject.next(this.selectedCategory);
    }
  }

  // Category filter methods
  toggleCategoryDropdown(): void {
    this.categoryDropdownOpen = !this.categoryDropdownOpen;
  }

  selectCategory(category: 'all' | 'ai-generated' | 'ai-generated-images' | 'visual-editor' | 'esp'): void {
    this.selectedCategory = category;
    this.categorySubject.next(category); // Emit new category for reactive filtering
    this.categoryDropdownOpen = false;
    this.cdr.markForCheck();
  }

  getCategoryLabel(): string {
    switch (this.selectedCategory) {
      case 'all': return 'All';
      case 'ai-generated': return 'AI Generated';
      case 'ai-generated-images': return 'AI Generated Images';
      case 'visual-editor': return 'Visual Editor';
      case 'esp': return 'ESP';
      default: return 'All';
    }
  }

  getCategoryIcon(): string {
    switch (this.selectedCategory) {
      case 'all': return 'apps';
      case 'ai-generated': return 'auto_awesome';
      case 'ai-generated-images': return 'image';
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
          this.http.get(`/api/templates/${id}/raw`, { responseType: 'text', withCredentials: true })
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

  // Open the edit modal for the currently selected image/template
  openEditModal(): void {
    // Only allow editing when a generated image is selected
    const currentId = this.svc.snapshot.selectedId;
    if (!currentId || !currentId.startsWith('genimg_')) return;

    // Pre-fill inputs with existing metadata
    this.editMode = 'deterministic';
    this.editOverlayText = '';
    this.editHexColor = '#E5893F';
    this.editRemixPrompt = this.templateMetadata?.prompt || '';
    this.editPreviewDataUrl = null;
    this.showEditModal = true;
    this.cdr.markForCheck();
  }

  closeEditModal(): void {
    this.showEditModal = false;
    this.isEditing = false;
    this.editPreviewDataUrl = null;
    this.cdr.markForCheck();
  }

  // Deterministic client-side overlay: applies text or tint and shows a preview (does not auto-save)
  async applyDeterministicEdit(): Promise<void> {
    try {
      this.isEditing = true;
      const imageUrl = this.templateMetadata?.thumbnail || this.templateMetadata?.screenshotUrl || this.templateMetadata?.imageUrl;
      if (!imageUrl) throw new Error('No image available to edit');

      const dataUrl = await this.createDeterministicEdit(imageUrl, this.editOverlayText, this.editHexColor);
      this.editPreviewDataUrl = dataUrl;
      // Show preview in the main preview panel
      const imgHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;background:#fff;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${dataUrl}" alt="Edited image"></body></html>`;
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(imgHtml);
      this.isEditing = false;
      this.cdr.markForCheck();
    } catch (err: any) {
      this.isEditing = false;
      console.error('Deterministic edit failed', err);
      this.snackBar.open(err?.message || 'Failed to apply edit', 'Close', { duration: 4000, panelClass: ['error-snackbar'] });
    }
  }

  // Create deterministic edit by drawing on a canvas and returning data URL
  private createDeterministicEdit(imageUrl: string, overlayText: string, hex: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const attemptLoad = (src: string) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const w = img.naturalWidth || img.width || 1024;
            const h = img.naturalHeight || img.height || 1024;
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Canvas not available'));
            ctx.drawImage(img, 0, 0, w, h);

            // Apply tint overlay if hex provided (simple multiply)
            if (hex) {
              ctx.fillStyle = hex;
              ctx.globalAlpha = 0.15;
              ctx.fillRect(0, 0, w, h);
              ctx.globalAlpha = 1;
            }

            // If overlayText provided, draw a pill with text on top-right
            if (overlayText && overlayText.trim()) {
              const text = overlayText.trim();
              const fontSize = Math.floor(Math.min(w, h) * 0.07);
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';

              // Compute pill metrics
              const padding = Math.floor(fontSize * 0.6);
              const textWidth = Math.min(w * 0.5, ctx.measureText(text).width + padding * 2);
              const pillW = textWidth;
              const pillH = fontSize + padding;
              const x = Math.floor(w * 0.75);
              const y = Math.floor(h * 0.12);

              // Draw semi-opaque dark pill
              ctx.fillStyle = 'rgba(0,0,0,0.55)';
              const rx = 12;
              this.roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, rx, true, false);

              // Draw text
              ctx.fillStyle = '#ffffff';
              ctx.fillText(text, x, y);
            }

            const out = canvas.toDataURL('image/png');
            resolve(out);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = async () => {
          // If direct image load failed (often CORS), try fetching as a blob and load via object URL.
          try {
            const resp = await fetch(imageUrl, { mode: 'cors' });
            if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            // Try loading from object URL
            const img2 = new Image();
            img2.onload = () => {
              try {
                const w = img2.naturalWidth || img2.width || 1024;
                const h = img2.naturalHeight || img2.height || 1024;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Canvas not available'));
                ctx.drawImage(img2, 0, 0, w, h);

                if (hex) {
                  ctx.fillStyle = hex;
                  ctx.globalAlpha = 0.15;
                  ctx.fillRect(0, 0, w, h);
                  ctx.globalAlpha = 1;
                }

                if (overlayText && overlayText.trim()) {
                  const text = overlayText.trim();
                  const fontSize = Math.floor(Math.min(w, h) * 0.07);
                  ctx.font = `bold ${fontSize}px sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const padding = Math.floor(fontSize * 0.6);
                  const textWidth = Math.min(w * 0.5, ctx.measureText(text).width + padding * 2);
                  const pillW = textWidth;
                  const pillH = fontSize + padding;
                  const x = Math.floor(w * 0.75);
                  const y = Math.floor(h * 0.12);
                  ctx.fillStyle = 'rgba(0,0,0,0.55)';
                  this.roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, 12, true, false);
                  ctx.fillStyle = '#ffffff';
                  ctx.fillText(text, x, y);
                }

                const out2 = canvas.toDataURL('image/png');
                URL.revokeObjectURL(objUrl);
                resolve(out2);
              } catch (err) {
                URL.revokeObjectURL(objUrl);
                reject(err);
              }
            };
            img2.onerror = () => {
              URL.revokeObjectURL(objUrl);
              reject(new Error('Failed to load image for editing (CORS or network failure). If the image is hosted on a different domain, it may not allow cross-origin canvas access. Use AI Remix or save the image to your server and try again.'));
            };
            img2.src = objUrl;
          } catch (fetchErr: any) {
            reject(new Error('Failed to load image for editing (network/CORS). Try using AI Remix or save the image to your server and try again.'));
          }
        };
        img.src = src;
      };

      // If the image URL is already a data URL, attempt direct load
      if (imageUrl.startsWith('data:')) {
        attemptLoad(imageUrl);
      } else {
        // First try direct load; fallback handled inside onerror
        attemptLoad(imageUrl);
      }
    });
  }

  // Helper to draw rounded rect
  private roundRect(ctx: CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number, fill:boolean, stroke:boolean) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  // Call backend remix endpoint to ask Ideogram to edit the selected image
  async applyAiRemix(): Promise<void> {
    try {
      this.isEditing = true;
      const originalId = String(this.templateMetadata?.originalImageId || this.svc.snapshot.selectedId?.replace(/^genimg_/, ''));
      if (!originalId) throw new Error('No image selected');

      const imageResp = await this.http.get(`/api/images/${originalId}`, { withCredentials: true }).toPromise() as any;
      const imageUrl = imageResp?.item?.url;
      if (!imageUrl) throw new Error('Original image URL not found');

      const body = {
        image_request: {
          prompt: this.editRemixPrompt || 'Make this image photorealistic while preserving composition. Do not add text.',
          aspect_ratio: '1:1',
          style_type: 'PHOTOREALISTIC',
        },
        image_url: imageUrl
      };

      const resp: any = await this.http.post('/api/ideogram/remix', body, { withCredentials: true }).toPromise();
      // Resp format mirrors Ideogram: try to find a usable image URL
      let newImageUrl: string | null = null;
      if (resp && resp.data) {
        // Common shapes: resp.data[0].url or resp.data.images[0].url
        if (Array.isArray(resp.data) && resp.data[0]?.url) newImageUrl = resp.data[0].url;
        else if (resp.data?.images && resp.data.images[0]?.url) newImageUrl = resp.data.images[0].url;
        else if (resp.data?.url) newImageUrl = resp.data.url;
      }

      if (!newImageUrl) {
        throw new Error('Remix did not return an image');
      }

      // Show result in preview
      const imgHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;background:#fff;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${newImageUrl}" alt="Remixed image"></body></html>`;
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(imgHtml);
      this.editPreviewDataUrl = newImageUrl;
      this.isEditing = false;
      this.cdr.markForCheck();
    } catch (err: any) {
      this.isEditing = false;
      console.error('AI remix failed', err);
      this.snackBar.open(err?.message || 'Failed to remix image', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
    }
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

    // Special handling for saved generated images (ids prefixed with "genimg_")
    if (id.startsWith('genimg_')) {
      const originalId = id.replace(/^genimg_/, '');
      // Fetch the saved image record and render an image preview HTML
      this.loading = true;
      this.cdr.markForCheck();

      this.http.get(`/api/images/${originalId}`, { withCredentials: true }).subscribe({
        next: (resp: any) => {
          const item = resp?.item;
          if (!item) {
            this.loading = false;
            this.previewError = 'Image not found';
            this.cdr.markForCheck();
            return;
          }

          const imageUrl = item.url;
          // Build a minimal HTML document to display the image centered
          const imgHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{height:100%;margin:0;background:#fff;display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style></head><body><img src="${imageUrl}" alt="${this.escapeHtml(item.name || 'Generate Flyer')}"></body></html>`;

          this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(imgHtml);

          // Populate metadata for info panel
          this.templateMetadata = {
            type: 'ai-generated-image',
            templateType: 'AI Generated',
            thumbnail: item.thumbnail || item.url,
            dateCreated: item.createdAt,
            createdBy: item.createdBy || item.userId || null,
            source: item.source || 'ideogram',
            prompt: item.prompt || ''
          };

          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.loading = false;
          this.previewError = e?.message || 'Failed to load image';
          this.cdr.markForCheck();
        }
      });

      return;
    }

    // ✅ Show loading state IMMEDIATELY
    this.loading = true;
    this.cdr.markForCheck();

    // ✅ Check TemplatesService state first (for newly added templates)
    const currentState = this.svc.snapshot;
    const templateFromState = currentState.items.find(t => t.id === id);
    if (templateFromState?.content) {
      // Template content is in state (e.g., newly saved template)
      const wrapped = this.ensureDoc(templateFromState.content);
      const cleaned = this.stripDangerousBits(wrapped);
      this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
      
      // Cache it for future use
      this.cache.set(id, templateFromState.content);
      
      // Set fallback timeout
      this.loadingTimer = setTimeout(() => {
        if (this.svc.snapshot.selectedId === id) {
          this.loading = false;
          this.showRunButton(id);
          this.cdr.markForCheck();
        }
      }, 100);
      
      this.cdr.markForCheck();
      return;
    }

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
        this.http.get(`/api/templates/${id}`, { responseType: 'json', withCredentials: true })
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
      .get(`/api/templates/${id}`, { responseType: 'json', withCredentials: true })
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

  // Small utility to escape HTML used inside generated image alt text
  private escapeHtml(unsafe: string): string {
    return String(unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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