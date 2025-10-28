import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, AfterViewInit, ViewEncapsulation, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import grapesjs from 'grapesjs';
import grapesjsPresetNewsletter from 'grapesjs-preset-newsletter';
import { CacheService } from '../../core/services/cache.service';
import { AuthService } from '../../core/services/auth.service';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { TemplateStateService } from '../../core/services/template-state.service';

interface MatchOverlay {
  id: string;
  range: Range;
  rect: DOMRect;
  overlayElement: HTMLElement;
  badgeElement: HTMLElement;
  matchNumber: number;
  searchText: string;
  replaceText: string;
}

@Component({
  selector: 'app-visual-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './visual-editor.component.html',
  styleUrls: ['./visual-editor.component.scss'],
  encapsulation: ViewEncapsulation.None,
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ 
          opacity: 0, 
          transform: 'translateY(-20px) scale(0.95)' 
        }),
        animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ 
            opacity: 1, 
            transform: 'translateY(0) scale(1)' 
          }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ 
            opacity: 0, 
            transform: 'translateY(-20px) scale(0.95)' 
          }))
      ])
    ])
  ]
})
export class VisualEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: false }) editorContainer!: ElementRef;
  
  private router = inject(Router);
  private cacheService = inject(CacheService);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);
  private templateState = inject(TemplateStateService);
  private longPressTimer: any;

  // Auto-save throttling
  private autoSaveTimer: any;
  private readonly AUTO_SAVE_DELAY = 300; // 300ms debounce - saves quickly but prevents spam
  private periodicSaveInterval: any;

  // Simple overlay tracking
  private overlays: MatchOverlay[] = [];
  private overlayContainer: HTMLElement | null = null;

  // ============================================
  // 🆕 TEMPLATE NAME DIALOG STATE
  // ============================================
  showNameDialog = false;
  newTemplateName = '';
  isSavingTemplate = false;

  // Failed Edits Data
  failedEdits: Array<{
    find: string;
    replace: string;
    before_context?: string;
    after_context?: string;
    reason?: string;
    status?: string;
    diagnostics?: any;
  }> = [];

  // Widget State
  showFloatingWidget = false;
  isWidgetOpen = false;
  hasShownPulseAnimation = false;

  // Widget Position (draggable) - now in pixels
  widgetPosition = { x: 20, y: 100 };
  isDragging = false;
  dragEnabled = false;
  private dragOffset = { x: 0, y: 0 };

  // Modal Dragging State - now in pixels
  isModalDragging = false;
  modalDragEnabled = false;
  modalPosition = { x: 0, y: 0 }; // Will be calculated when modal opens
  private modalDragOffset = { x: 0, y: 0 };
  
  // Double-click tracking for "click, then click-hold-drag"
  private lastButtonClickTime = 0;
  private lastModalClickTime = 0;
  private readonly DOUBLE_CLICK_THRESHOLD = 500; // ms

  // Storage Keys
  private readonly WIDGET_POSITION_KEY = 'visual_editor_widget_position';
  private readonly APPLIED_EDITS_KEY = 'visual_editor_applied_edits';
  private readonly PULSE_SHOWN_KEY = 'visual_editor_pulse_shown';
  
  private editor: any;
  loading = true;
  showImportModal = false;
  importHtmlCode = '';
  importMethod: 'paste' | 'file' = 'paste'; // Track which import method is selected
  
  private readonly EDITOR_CACHE_KEY = 'visual-editor-content';

  templateId: string | null = null;
  originalGoldenHtml: string = '';

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.templateId = params.get('id');
      // ✅ NEW: If no templateId in URL, generate a temporary one for direct access
      if (!this.templateId) {
        // Check if we already have a temp ID in localStorage
        const tempIdKey = 'visual_editor_temp_id';
        let tempId = localStorage.getItem(tempIdKey);
        
        if (!tempId) {
          // Generate new temporary ID
          tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
          localStorage.setItem(tempIdKey, tempId);
        } else {
        }
        
        this.templateId = tempId;
      }
      if (this.templateId) {
        this.loadGoldenHtml(this.templateId);
        this.loadFailedEdits(this.templateId);
        
        // ✅ Re-check after a short delay in case data was just saved
        setTimeout(() => {
          this.loadFailedEdits(this.templateId!);
          this.cdr.markForCheck();
        }, 100);
      }
    });
    
    this.restoreWidgetPosition();
  }

  ngAfterViewInit(): void {
    const container = document.getElementById('gjs');
    
    if (container) {
      this.initGrapesJS();
      
      // Clean up any leftover highlights after editor loads
      setTimeout(() => {
        console.log('🧹 Running cleanup of highlights...');
        this.removeAllHighlights();
      }, 3000); // Increased to 3 seconds to ensure editor is fully loaded
      
      // ✅ CRITICAL: Periodic auto-save every 10 seconds as backup
      this.periodicSaveInterval = setInterval(() => {
        if (this.editor && this.templateId) {
          this.autoSave();
        }
      }, 10000); // 10 seconds
      
      // ✅ Save when user switches tabs or minimizes browser
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.editor && this.templateId) {
          this.autoSave();
        }
      });
      
      // ✅ Save before page unload (browser close, navigation)
      window.addEventListener('beforeunload', () => {
        if (this.editor && this.templateId) {
          this.autoSave();
        }
      });
    } else {
      console.error('❌ [visual-editor] GJS container NOT FOUND!');
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    // ✅ Final save before leaving - IMMEDIATE (no delay)
    this.autoSave(true);
    
    // ✅ Clear intervals and timers
    if (this.periodicSaveInterval) {
      clearInterval(this.periodicSaveInterval);
    }
    
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    
    // ✅ CLEANUP: Remove validation-modal-open class to restore navbar
    // This class may have been added by use-variant page before navigation
    document.body.classList.remove('validation-modal-open');
    document.body.style.overflow = 'auto';
    
    if (this.editor) {
      this.editor.destroy();
    }
  }

  onTouchStart(event: TouchEvent): void {
    this.longPressTimer = setTimeout(() => {
      this.dragEnabled = true;
      this.isDragging = true;
      
      const touch = event.touches[0];
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      
      this.dragOffset = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
      
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    }, 500);
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.isDragging) {
      clearTimeout(this.longPressTimer);
      return;
    }
    
    event.preventDefault();
    
    const touch = event.touches[0];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buttonSize = 60;
    
    // Calculate position in pixels
    let x = touch.clientX - this.dragOffset.x;
    let y = touch.clientY - this.dragOffset.y;
    
    // Constrain to viewport
    x = Math.max(0, Math.min(x, viewportWidth - buttonSize));
    y = Math.max(0, Math.min(y, viewportHeight - buttonSize));
    
    this.widgetPosition = { x, y };
    this.cdr.markForCheck();
  }

  onTouchEnd(event: TouchEvent): void {
    clearTimeout(this.longPressTimer);
    
    if (this.isDragging) {
      this.isDragging = false;
      this.dragEnabled = false;
      this.saveWidgetPosition();
    }
  }

  // ============================================
  // 🆕 PROMPT FOR TEMPLATE NAME
  // ============================================
  private promptTemplateName(): Promise<string | null> {
    return new Promise((resolve) => {
      this.newTemplateName = '';
      this.showNameDialog = true;
      this.cdr.markForCheck();
      
      // Store resolve function for later use
      (window as any).__templateNameResolve = resolve;
    });
  }

  // ============================================
  // 🆕 CANCEL NAME DIALOG
  // ============================================
  cancelNameDialog(): void {
    this.showNameDialog = false;
    this.newTemplateName = '';
    
    if ((window as any).__templateNameResolve) {
      (window as any).__templateNameResolve(null);
      delete (window as any).__templateNameResolve;
    }
  }

  // ============================================
  // 🆕 CONFIRM TEMPLATE NAME
  // ============================================
  confirmTemplateName(): void {
    const name = this.newTemplateName.trim();
    
    if (!this.isValidName()) {
      this.showToast('Please enter a valid template name (3-100 characters)', 'error');
      return;
    }
    
    this.showNameDialog = false;
    
    if ((window as any).__templateNameResolve) {
      (window as any).__templateNameResolve(name);
      delete (window as any).__templateNameResolve;
    }
  }

  // ============================================
  // 🆕 VALIDATE TEMPLATE NAME
  // ============================================
  isValidName(): boolean {
    const name = this.newTemplateName?.trim();
    return !!(name && name.length >= 3 && name.length <= 100);
  }


// ============================================
// 🆕 SAVE NEW TEMPLATE TO MONGODB
// ============================================
private async saveNewTemplate(templateName: string, html: string): Promise<string | null> {
  this.isSavingTemplate = true;
  
  try {
    // Get current user info from AuthService
    let userName = 'Unknown User';
    
    // Try multiple ways to get user info
    try {
      // Method 1: Try user$ observable if it exists
      if ('user$' in this.authService) {
        const user: any = await firstValueFrom((this.authService as any).user$);
        userName = user?.displayName || user?.name || user?.email || 'Unknown User';
      }
      // Method 2: Try currentUser property if it exists
      else if ('currentUser' in this.authService) {
        const user: any = (this.authService as any).currentUser;
        userName = user?.displayName || user?.name || user?.email || 'Unknown User';
      }
      // Method 3: Try getting from localStorage
      else {
        const storedUser = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          userName = user?.displayName || user?.name || user?.email || 'Unknown User';
        }
      }
    } catch (error) {
    }
    
    const payload = {
      name: templateName,
      content: html,
      type: 'Visual editor',
      category: 'N/A',
      createdBy: userName,
      createdDate: new Date().toISOString(),
      lastEdited: new Date().toISOString(),
      active: true,
      dragDrop: true,
      responsive: 'N/A',
      folderId: 'N/A',
      source: 'Visual Editor'
    };
    
    const response: any = await firstValueFrom(
      this.http.post('/api/templates', payload)
    );
    
    this.showToast('Template saved successfully!', 'success');
    
    return response.id || response.templateId || response._id;
    
  } catch (error) {
    console.error('❌ Failed to save template:', error);
    this.showToast('Failed to save template. Please try again.', 'error');
    return null;
  } finally {
    this.isSavingTemplate = false;
  }
}

  private loadGoldenHtml(templateId: string): void {
    // ✅ PRIORITY 1: Check if editing a VARIANT (from use-variant page)
    const editingMode = localStorage.getItem(`visual_editor_${templateId}_editing_mode`);
    const variantMeta = localStorage.getItem(`visual_editor_${templateId}_variant_meta`);
    
    if (editingMode === 'variant' && variantMeta) {
      try {
        const meta = JSON.parse(variantMeta);
        const { runId, no } = meta;
        
        // Load variant HTML from variant-specific key
        const variantHtmlKey = `visual_editor_variant_${runId}_${no}_html`;
        const variantHtml = localStorage.getItem(variantHtmlKey);
        
        if (variantHtml) {
          console.log('✅ [Visual Editor] Loading VARIANT HTML for variant', no);
          this.originalGoldenHtml = variantHtml;
          return;
        } else {
          console.warn('⚠️ [Visual Editor] Variant HTML not found, falling back to template state');
        }
      } catch (error) {
        console.error('❌ [Visual Editor] Error loading variant HTML:', error);
      }
    }
    
    // ✅ PRIORITY 2: Get template from state service (golden/original templates)
    const templateForEditor = this.templateState.getTemplateForEditor(templateId);
    
    if (templateForEditor) {
      this.originalGoldenHtml = templateForEditor;
    } else {
      this.originalGoldenHtml = '';
    }
  }

  private initGrapesJS(): void {
    try {
      // ✅ SAFETY: Set timeout to prevent infinite loading
      const loadingTimeout = setTimeout(() => {
        if (this.loading) {
          this.loading = false;
          this.cdr.markForCheck();
        }
      }, 5000); // 5 seconds max
      
      this.editor = grapesjs.init({
        container: '#gjs',
        fromElement: false,
        height: 'calc(100vh - 80px)',
        width: '100%',
        storageManager: false,
        plugins: [grapesjsPresetNewsletter],
        pluginsOpts: {
          'grapesjs-preset-newsletter': {
            modalLabelImport: 'Paste HTML',
            modalLabelExport: 'Copy HTML',
            codeViewerTheme: 'material',
            importPlaceholder: '<table>...</table>'
          }
        }
      });

      this.editor.on('load', () => {
        // ✅ Clear the timeout since editor loaded successfully
        clearTimeout(loadingTimeout);
        
        // Remove the default GrapeJS "view code" button (first </> icon)
        try {
          const panels = this.editor.Panels;
          // Try to remove common default code buttons
          panels.removeButton('options', 'export-template');
          panels.removeButton('options', 'gjs-open-import-webpage');
          panels.removeButton('views', 'open-code');
        } catch (e) {
        }
        
        this.setupCodeEditor();
        
        // ✅ PRIORITY 1: Check if there's saved progress (edited state)
        const progressKey = `visual_editor_${this.templateId}_progress`;
        const hasSavedProgress = localStorage.getItem(progressKey);
        if (hasSavedProgress) {
          // ✅ CASE 1: Restore from saved progress (highest priority - user's edits!)
          this.restoreProgress();
          setTimeout(() => {
            this.autoSave();
          }, 500);
        }
        else if (this.originalGoldenHtml) {
          // ✅ CASE 2: Load golden HTML from QA page (first time editing)
          try {
            this.editor.setComponents(this.originalGoldenHtml);
            // ✅ CRITICAL: Save immediately after loading from QA page
            setTimeout(() => {
              this.autoSave();
            }, 500);
          } catch (error) {
            console.error('Failed to load golden HTML:', error);
          }
        } 
        // ✅ CASE 3: Has template ID but no golden HTML and no progress - empty editor
        else if (this.templateId) {
          this.restoreProgress(); // Try anyway, might have something
          // ✅ If restoration happened, save again to update timestamp
          setTimeout(() => {
            this.autoSave();
          }, 500);
        }
        // ✅ CASE 3: No template ID - FRESH EDITOR (do nothing)
        else {
        }
        
        this.loading = false;
      });
      
      // ✅ CRITICAL: Save on EVERY change (component added, moved, edited, deleted)
      this.editor.on('update', () => {
        this.autoSave();
      });
      
      // ✅ Additional save triggers for component changes
      this.editor.on('component:add', () => {
        this.autoSave();
      });
      
      this.editor.on('component:remove', () => {
        this.autoSave();
      });
      
      this.editor.on('component:update', () => {
        this.autoSave();
      });
      
      this.editor.on('style:update', () => {
        this.autoSave();
      });
      
    } catch (error) {
      console.error('Failed to initialize GrapesJS:', error);
      this.loading = false;
    }
  }

  private setupCodeEditor(): void {
    try {
      const panels = this.editor.Panels;
      
      this.editor.Commands.add('custom-edit-code', {
        run: (editor: any) => {
          this.openCodeEditor(editor);
        },
        stop: (editor: any) => {}
      });
      
      panels.addButton('options', {
        id: 'custom-code-edit',
        className: 'fa fa-code',
        command: (editor: any) => {
          this.openCodeEditor(editor);
        },
        attributes: { 
          title: 'Edit HTML/CSS Code',
          'data-tooltip': 'Edit Code'
        }
      });
    } catch (error) {
      console.error('Setup code editor failed:', error);
    }
  }

  private openCodeEditor(editor: any): void {
    try {
      const modal = editor.Modal;
      const html = editor.getHtml();
      const css = editor.getCss();
      const fullCode = `<style>\n${css}\n</style>\n\n${html}`;

      modal.setTitle('Edit HTML & CSS Code');
      modal.setContent(`
        <div style="padding: 20px; display: flex; flex-direction: column; height: 600px;">
          <div style="margin-bottom: 15px; color: #64748b; font-size: 14px; font-weight: 500;">
            ✏️ Edit your template code below
          </div>
          <textarea id="gjs-code-editor" style="flex: 1; width: 100%; font-family: 'Courier New', Consolas, monospace; font-size: 14px; line-height: 1.6; padding: 20px; border: 2px solid #e2e8f0; border-radius: 10px; resize: none; background: #0f172a; color: #e2e8f0; outline: none;">${fullCode}</textarea>
          <div style="margin-top: 20px; display: flex; gap: 12px; justify-content: flex-end;">
            <button id="apply-code-btn" style="background: #10b981; color: white; border: none; padding: 14px 28px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(16,185,129,0.3);">
              ✓ Apply Changes
            </button>
            <button id="cancel-code-btn" style="background: #ef4444; color: white; border: none; padding: 14px 28px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 15px; box-shadow: 0 2px 8px rgba(239,68,68,0.3);">
              ✕ Close
            </button>
          </div>
        </div>
      `);
      
      modal.open();

      setTimeout(() => {
        const applyBtn = document.getElementById('apply-code-btn');
        const cancelBtn = document.getElementById('cancel-code-btn');
        const textarea = document.getElementById('gjs-code-editor') as HTMLTextAreaElement;
        
        if (applyBtn) {
          applyBtn.onclick = () => {
            if (textarea) {
              editor.setComponents(textarea.value);
              applyBtn.textContent = '✓ Applied!';
              applyBtn.style.background = '#6d28d9';
              setTimeout(() => {
                applyBtn.textContent = '✓ Apply Changes';
                applyBtn.style.background = '#10b981';
              }, 1500);
            }
          };
        }
        
        if (cancelBtn) {
          cancelBtn.onclick = () => modal.close();
        }
      }, 100);
      
    } catch (error) {
      console.error('Open code editor error:', error);
    }
  }

  openImportModal(): void {
    this.showImportModal = true;
    this.importHtmlCode = '';
  }

  closeImportModal(): void {
    this.showImportModal = false;
    this.importHtmlCode = '';
  }

  importHTML(): void {
    if (!this.editor || !this.importHtmlCode.trim()) return;
    this.editor.setComponents(this.importHtmlCode);
    this.closeImportModal();
  }

  // Handle file selection
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    
    // Validate file type
    if (!file.name.endsWith('.html') && !file.name.endsWith('.htm')) {
      this.showToast('⚠️ Please select a valid HTML file (.html or .htm)');
      return;
    }

    // Read file content
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content && this.editor) {
        this.editor.setComponents(content);
        this.closeImportModal();
        this.showToast('✅ HTML file imported successfully!');
      }
    };
    reader.onerror = () => {
      this.showToast('❌ Failed to read file. Please try again.');
    };
    reader.readAsText(file);
  }

  // Switch between import methods
  setImportMethod(method: 'paste' | 'file'): void {
    this.importMethod = method;
    this.importHtmlCode = '';
  }

  goBack(): void {
    // ✅ Check if we're editing a VARIANT
    const editingMode = localStorage.getItem(`visual_editor_${this.templateId}_editing_mode`);
    const variantMeta = localStorage.getItem(`visual_editor_${this.templateId}_variant_meta`);
    
    if (editingMode === 'variant' && variantMeta) {
      try {
        const meta = JSON.parse(variantMeta);
        const { runId, no } = meta;
        
        // Get edited HTML from editor
        const html = this.editor?.getHtml() || '';
        const css = this.editor?.getCss() || '';
        const fullHtml = `<style>${css}</style>${html}`;
        
        // Save edited HTML to sessionStorage for use-variant page to pickup
        sessionStorage.setItem('visual_editor_edited_html', fullHtml);
        sessionStorage.setItem('visual_editor_return_use_variant', 'true');
        
        // Clean up variant-specific keys
        localStorage.removeItem(`visual_editor_variant_${runId}_${no}_html`);
        localStorage.removeItem(`visual_editor_variant_${runId}_${no}_snapshot`);
        localStorage.removeItem(`visual_editor_${this.templateId}_editing_mode`);
        localStorage.removeItem(`visual_editor_${this.templateId}_variant_meta`);
        localStorage.removeItem(`visual_editor_${this.templateId}_failed_edits`);
        
        console.log('✅ [Visual Editor] Returning to variant page with edited HTML');
        
        // Navigate back to use-variant page
        const templateId = this.templateId;
        this.router.navigate(['/qa', templateId, 'use', runId, no]);
        return;
      } catch (error) {
        console.error('❌ [Visual Editor] Error returning to variant page:', error);
      }
    }
    
    // ✅ Default: Navigate to dashboard (for golden/original templates)
    this.router.navigate(['/']);
  }

  async saveTemplate(): Promise<void> {
    if (!this.editor) return;
    
    // Remove all AI highlights before saving
    this.removeAllHighlights();
    
    // Wait for DOM to update
    await new Promise(resolve => setTimeout(resolve, 100));
    
    let html = this.editor.getHtml();
    const css = this.editor.getCss();
    
    // ✅ CRITICAL: Clean HTML from any overlay artifacts
    html = this.cleanHtmlFromOverlays(html);
    
    const fullHtml = `<style>${css}</style>${html}`;
  }

  async exportHTML(): Promise<void> {
    if (!this.editor) return;
    
    // Remove all AI highlights before exporting
    this.removeAllHighlights();
    
    // Wait for DOM to update
    await new Promise(resolve => setTimeout(resolve, 100));
    
    let html = this.editor.getHtml();
    const css = this.editor.getCss();
    
    // ✅ CRITICAL: Clean HTML from any overlay artifacts
    html = this.cleanHtmlFromOverlays(html);
    
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>${css}</style>
</head>
<body>
  ${html}
</body>
</html>`;

    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'email-template.html';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  private autoSave(immediate: boolean = false): void {
    // console.log('🔄 [autoSave] Called - editor:', !!this.editor, 'templateId:', this.templateId, 'immediate:', immediate);
    
    if (!this.editor || !this.templateId) {
      return;
    }
    
    // console.log('🔄 [autoSave] Triggered for templateId:', this.templateId);
    
    // ✅ NEW: If immediate mode, save RIGHT NOW without delay
    if (immediate) {
      // console.log('⚡ [autoSave] ========================================');
      // console.log('⚡ [autoSave] IMMEDIATE MODE - SYNCHRONOUS SAVE');
      // console.log('⚡ [autoSave] ========================================');
      try {
        if (!this.editor || typeof this.editor.getHtml !== 'function') {
          // console.log('❌ [autoSave] Editor destroyed or invalid, skipping save');
          return;
        }
        
        // ✅ ADDITIONAL CHECK: Make sure editor wrapper is accessible
        if (typeof this.editor.getWrapper !== 'function') {
          // console.log('❌ [autoSave] getWrapper function not available, skipping save');
          return;
        }
        
        try {
          const wrapper = this.editor.getWrapper();
          if (!wrapper) {
            // console.log('❌ [autoSave] Editor wrapper not available, skipping save');
            return;
          }
        } catch (e) {
          // console.log('❌ [autoSave] Error getting wrapper, skipping save');
          return;
        }
        
        let html = this.editor.getHtml();
        const css = this.editor.getCss();
        
        if (!html || html.trim() === '') {
          // console.log('❌ [autoSave] Skipping save - empty HTML');
          return;
        }
        
        // ✅ CRITICAL FIX: Clean HTML from any highlight overlays before saving
        html = this.cleanHtmlFromOverlays(html);
        
        // ✅ Save using TemplateStateService
        this.templateState.saveEditorProgress(this.templateId, html, css);
        
        // ✅ Also save to old key for backwards compatibility (temporary)
        const editorState = {
          html,
          css,
          templateId: this.templateId,
          savedAt: new Date().toISOString()
        };
        
        const persistKey = `visual_editor_${this.templateId}_progress`;
        localStorage.setItem(persistKey, JSON.stringify(editorState));
        
      } catch (error) {
        console.error('❌ [autoSave] IMMEDIATE save FAILED:', error);
      }
      // console.log('⚡ [autoSave] ========================================');
      return;
    }
    
    // ✅ Normal debounced save
    // Clear previous timer and set new one
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    
    this.autoSaveTimer = setTimeout(() => {
      try {
        // ✅ CRITICAL: Check if editor still exists and is valid
        if (!this.editor || typeof this.editor.getHtml !== 'function') {
          // console.log('⚠️ [autoSave] Editor destroyed or invalid, skipping save');
          return;
        }
        
        // ✅ ADDITIONAL CHECK: Make sure editor wrapper is accessible
        if (typeof this.editor.getWrapper !== 'function') {
          // console.log('⚠️ [autoSave] getWrapper function not available, skipping save');
          return;
        }
        
        try {
          const wrapper = this.editor.getWrapper();
          if (!wrapper) {
            // console.log('⚠️ [autoSave] Editor wrapper not available, skipping save');
            return;
          }
        } catch (e) {
          // console.log('⚠️ [autoSave] Error getting wrapper, skipping save');
          return;
        }
        
        let html = this.editor.getHtml();
        const css = this.editor.getCss();
        
        if (!html || html.trim() === '') {
          // console.log('⚠️ [autoSave] Skipping save - empty HTML');
          return;
        }
        
        // ✅ CRITICAL FIX: Clean HTML from any highlight overlays before saving
        html = this.cleanHtmlFromOverlays(html);
        
        // ✅ Save using TemplateStateService
        this.templateState.saveEditorProgress(this.templateId!, html, css);
        
        // ✅ Also save to old key for backwards compatibility (temporary)
        const editorState = {
          html,
          css,
          templateId: this.templateId,
          savedAt: new Date().toISOString()
        };
        
        // ✅ PERSIST to localStorage so it survives refresh
        const persistKey = `visual_editor_${this.templateId}_progress`;
        localStorage.setItem(persistKey, JSON.stringify(editorState));
        // console.log('✅ [autoSave] Saved to localStorage:', persistKey);
        // console.log('✅ [autoSave] HTML length:', html.length);
      } catch (error) {
        console.error('❌ [autoSave] Failed:', error);
      }
    }, this.AUTO_SAVE_DELAY);
  }

  private restoreProgress(): void {
    if (!this.templateId) {
      return;
    }
    try {
      // ✅ Try localStorage first (persists on refresh)
      const persistKey = `visual_editor_${this.templateId}_progress`;
      const savedJson = localStorage.getItem(persistKey);
      // 🔍 DEBUG: Log ALL localStorage keys for this templateId
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes(this.templateId)) {
          const value = localStorage.getItem(key);
        }
      }
      
      if (savedJson) {
        const savedState = JSON.parse(savedJson);
        if (savedState && this.editor) {
          if (savedState.html) {
            this.editor.setComponents(savedState.html);
          }
          
          if (savedState.css) {
            this.editor.setStyle(savedState.css);
          }
        } else {
        }
      } else {
      }
    } catch (error) {
      console.error('❌ [restoreProgress] FAILED with error:', error);
    }
  }

  clearProgress(): void {
    if (!this.templateId) return;
    const persistKey = `visual_editor_${this.templateId}_progress`;
    localStorage.removeItem(persistKey);
  }

  private loadFailedEdits(templateId: string): void {
    // ✅ CRITICAL DEFENSE: Check if editing mode is 'original' - if so, NEVER show failed edits
    const editingModeKey = `visual_editor_${templateId}_editing_mode`;
    const editingMode = localStorage.getItem(editingModeKey);
    if (editingMode === 'original') {
      this.showFloatingWidget = false;
      this.failedEdits = [];
      return;
    }
    
    const failedKey = `visual_editor_${templateId}_failed_edits`;
    
    // ✅ Check BOTH localStorage and sessionStorage (QA page uses localStorage, variants use sessionStorage)
    let failedEditsJson = localStorage.getItem(failedKey) || sessionStorage.getItem(failedKey);
    if (!failedEditsJson) {
      this.showFloatingWidget = false;
      return;
    }
    
    try {
      this.failedEdits = JSON.parse(failedEditsJson);
      if (this.failedEdits.length > 0) {
        this.showFloatingWidget = true;
        const pulseKey = `${this.PULSE_SHOWN_KEY}_${templateId}`;
        const pulseShown = sessionStorage.getItem(pulseKey);
        
        if (!pulseShown) {
          this.hasShownPulseAnimation = false;
          sessionStorage.setItem(pulseKey, 'true');
        } else {
          this.hasShownPulseAnimation = true;
        }
        
        // ✅ Force change detection to show the widget
        this.cdr.markForCheck();
      } else {
        this.showFloatingWidget = false;
      }
    } catch (error) {
      console.error('❌ [loadFailedEdits] Error parsing failed edits:', error);
      this.showFloatingWidget = false;
    }
  }

  private restoreWidgetPosition(): void {
    const savedPosition = localStorage.getItem(this.WIDGET_POSITION_KEY);
    
    if (savedPosition) {
      try {
        const position = JSON.parse(savedPosition);
        this.widgetPosition = position;
      } catch (error) {
        console.error('❌ [RESTORE] Failed to restore widget position');
        this.widgetPosition = { x: 20, y: 100 }; // Default pixel position
      }
    } else {
      this.widgetPosition = { x: 20, y: 100 }; // Default pixel position
    }
  }

  private saveWidgetPosition(): void {
    localStorage.setItem(this.WIDGET_POSITION_KEY, JSON.stringify(this.widgetPosition));
  }

  onButtonMouseDown(event: MouseEvent): void {
    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - this.lastButtonClickTime;
    // If this is the SECOND mousedown within threshold, START DRAGGING
    if (timeSinceLastClick < this.DOUBLE_CLICK_THRESHOLD && timeSinceLastClick > 0) {
      event.stopPropagation();
      event.preventDefault();
      
      this.dragEnabled = true;
      this.isDragging = true;
      
      if (this.isWidgetOpen) {
        this.isWidgetOpen = false;
      }
      
      const button = event.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();
      
      this.dragOffset = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      // Reset timer so third click won't trigger
      this.lastButtonClickTime = 0;
    } else {
      // This is the FIRST click, just record the time
      this.lastButtonClickTime = currentTime;
    }
  }

  onButtonClick(event: MouseEvent): void {
    if (this.isDragging || this.dragEnabled) return;
    
    const currentTime = Date.now();
    const timeSinceMouseDown = currentTime - this.lastButtonClickTime;
    // Only toggle if this is a complete first click (not the start of second click)
    if (timeSinceMouseDown < this.DOUBLE_CLICK_THRESHOLD && this.lastButtonClickTime > 0) {
      this.isWidgetOpen = !this.isWidgetOpen;
      
      // Initialize modal position when opening
      if (this.isWidgetOpen) {
        this.modalPosition = {
          x: this.widgetPosition.x,
          y: this.widgetPosition.y + 70  // Position modal below button
        };
      }
      
      if (this.isWidgetOpen && !this.hasShownPulseAnimation) {
        this.hasShownPulseAnimation = true;
      }
      
      this.cdr.markForCheck();
    } else {
      // Old click (timeout expired), just toggle immediately
      this.isWidgetOpen = !this.isWidgetOpen;
      
      // Initialize modal position when opening
      if (this.isWidgetOpen) {
        this.modalPosition = {
          x: this.widgetPosition.x,
          y: this.widgetPosition.y + 70  // Position modal below button
        };
      }
      
      if (this.isWidgetOpen && !this.hasShownPulseAnimation) {
        this.hasShownPulseAnimation = true;
      }
    }
  }

  closeWidget(): void {
    this.isWidgetOpen = false;
  }

  onDragStart(event: MouseEvent): void {
    if (this.isDragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onDragMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragEnabled) {
      return;
    }
    
    event.preventDefault();
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buttonSize = 60;
    
    // Calculate new position in pixels
    let x = event.clientX - this.dragOffset.x;
    let y = event.clientY - this.dragOffset.y;
    
    // Constrain to viewport
    x = Math.max(0, Math.min(x, viewportWidth - buttonSize));
    y = Math.max(0, Math.min(y, viewportHeight - buttonSize));
    
    const newPosition = { x, y };
    this.widgetPosition = newPosition;
    
    // 🆕 ALSO move the modal to follow the button
    if (this.isWidgetOpen) {
      this.modalPosition = {
        x: x,
        y: y + 70  // Offset so modal appears below button
      };
    }
    
    this.cdr.markForCheck();
  }

  onDragEnd(event: MouseEvent): void {
    if (this.isDragging) {
      event.stopPropagation();
      event.preventDefault();
      
      this.isDragging = false;
      this.dragEnabled = false;
      
      this.saveWidgetPosition();
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    // Check button dragging
    if (this.isDragging && this.dragEnabled) {
      this.onDragMove(event);
    }
    
    // Check modal dragging
    if (this.isModalDragging && this.modalDragEnabled) {
      this.onModalDragMove(event);
    }
  }

  @HostListener('document:mouseup', ['$event'])
  onDocumentMouseUp(event: MouseEvent): void {
    if (this.isDragging) {
      this.onDragEnd(event);
    }
    if (this.isModalDragging) {
      this.onModalDragEnd(event);
    }
  }

  // ============================================
  // MODAL DRAGGING LOGIC
  // ============================================

  onModalHeaderMouseDown(event: MouseEvent): void {
    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - this.lastModalClickTime;
    // If this is the SECOND mousedown within threshold, START DRAGGING
    if (timeSinceLastClick < this.DOUBLE_CLICK_THRESHOLD && timeSinceLastClick > 0) {
      event.stopPropagation();
      event.preventDefault();
      
      this.modalDragEnabled = true;
      this.isModalDragging = true;
      
      const modalElement = (event.target as HTMLElement).closest('.widget-dropdown') as HTMLElement;
      
      if (!modalElement) {
        console.error('❌ Modal element not found!');
        return;
      }
      
      const rect = modalElement.getBoundingClientRect();
      
      this.modalDragOffset = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      
      this.modalPosition = {
        x: rect.left,
        y: rect.top
      };
      // Reset timer so third click won't trigger
      this.lastModalClickTime = 0;
      
      this.cdr.markForCheck();
    } else {
      // This is the FIRST click, just record the time
      this.lastModalClickTime = currentTime;
    }
  }

  onModalDragStart(event: MouseEvent): void {
    // This is just for single clicks - double-click handled by onModalHeaderDoubleClick
  }

  onModalDragMove(event: MouseEvent): void {
    if (!this.isModalDragging || !this.modalDragEnabled) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate new position in pixels
    let x = event.clientX - this.modalDragOffset.x;
    let y = event.clientY - this.modalDragOffset.y;
    // Constrain to viewport (modal is approximately 400px wide and 500px tall)
    x = Math.max(0, Math.min(x, viewportWidth - 400));
    y = Math.max(0, Math.min(y, viewportHeight - 500));
    
    const newPosition = { x, y };
    this.modalPosition = newPosition;
    
    // 🆕 ALSO move the container (blue circle) to follow the modal
    this.widgetPosition = {
      x: x,
      y: y - 70  // Offset so button appears above modal
    };
    
    this.cdr.markForCheck();
  }

  onModalDragEnd(event: MouseEvent): void {
    if (this.isModalDragging) {
      event.stopPropagation();
      event.preventDefault();
      
      this.isModalDragging = false;
      // Keep modalDragEnabled true so modal stays draggable
      // Save the button position too
      this.saveWidgetPosition();
    }
  }

  // ============================================
  // ✅ SIMPLE HIGHLIGHTING ONLY (No interactions!)
  // ============================================

  /**
   * Apply suggestion - Just highlights, NO clicking, NO hover
   */
  applySuggestion(editIndex: number): void {
    if (!this.editor) {
      this.showToast('Editor not initialized', 'error');
      return;
    }
    
    const edit = this.failedEdits[editIndex];
    if (!edit || !edit.find) {
      this.showToast('Invalid edit data', 'error');
      return;
    }
    
    const iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
    if (!iframe || !iframe.contentDocument) {
      this.showToast('Editor iframe not found', 'error');
      return;
    }
    
    // Clear previous highlights
    this.clearHighlights(iframe.contentDocument);
    
    // Find and highlight (no interactions)
    this.highlightMatches(iframe.contentDocument, edit.find, edit.replace);
  }

  /**
   * Highlight all matches - SIMPLE, NO INTERACTIONS
   */
  private highlightMatches(
    doc: Document,
    searchText: string,
    replaceText: string
  ): void {
    const body = doc.body;
    
    // Create overlay container
    this.overlayContainer = doc.createElement('div');
    this.overlayContainer.id = 'ai-overlay-container';
    // ✅ CRITICAL: Mark this element to be ignored by GrapesJS
    this.overlayContainer.setAttribute('data-gjs-type', 'temporary-overlay');
    this.overlayContainer.setAttribute('data-gjs-removable', 'false');
    this.overlayContainer.setAttribute('data-gjs-draggable', 'false');
    this.overlayContainer.setAttribute('data-gjs-editable', 'false');
    this.overlayContainer.setAttribute('data-gjs-selectable', 'false');
    this.overlayContainer.setAttribute('data-gjs-hoverable', 'false');
    this.overlayContainer.setAttribute('data-gjs-copyable', 'false');
    this.overlayContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    `;
    body.appendChild(this.overlayContainer);
    
    // Find all matches
    const matches = this.findAllTextMatches(body, searchText);
    
    if (matches.length === 0) {
      this.showToast(`❌ "${searchText}" not found`, 'error');
      this.clearHighlights(doc);
      return;
    }
    
    // Create SIMPLE overlays (no hover, no click)
    matches.forEach((range, index) => {
      this.createSimpleOverlay(doc, range, index + 1);
    });
    
    // Show info
    this.showToast(
      `🔍 Found ${matches.length} match(es)\n\n` +
      `Find: "${this.truncateText(searchText, 30)}"\n` +
      `Replace with: "${this.truncateText(replaceText, 30)}"\n\n` +
      `Use Ctrl+F to find and replace manually`,
      'info'
    );
    
    // Scroll to first match
    if (this.overlays.length > 0) {
      this.overlays[0].overlayElement.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
    }
  }

  /**
   * Create simple overlay - NO hover, NO click
   */
  private createSimpleOverlay(
    doc: Document,
    range: Range,
    matchNumber: number
  ): void {
    if (!this.overlayContainer) return;
    
    const rect = range.getBoundingClientRect();
    const bodyRect = doc.body.getBoundingClientRect();
    const scrollTop = doc.documentElement.scrollTop || doc.body.scrollTop;
    
    // Simple yellow highlight (NO hover effects)
    const overlay = doc.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      left: ${rect.left - bodyRect.left}px;
      top: ${rect.top - bodyRect.top + scrollTop}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(255, 235, 59, 0.4);
      border: 2px solid #ffd700;
      border-radius: 4px;
      pointer-events: none;
      box-sizing: border-box;
    `;
    
    // Simple badge (NO animations)
    const badge = doc.createElement('div');
    badge.textContent = matchNumber.toString();
    badge.style.cssText = `
      position: absolute;
      left: ${rect.left - bodyRect.left + rect.width + 4}px;
      top: ${rect.top - bodyRect.top + scrollTop - 12}px;
      background: #667eea;
      color: white;
      font-size: 11px;
      font-weight: bold;
      padding: 3px 7px;
      border-radius: 12px;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 10000;
    `;
    
    this.overlayContainer.appendChild(overlay);
    this.overlayContainer.appendChild(badge);
    
    this.overlays.push({
      id: `overlay-${matchNumber}`,
      range: range.cloneRange(),
      rect,
      overlayElement: overlay,
      badgeElement: badge,
      matchNumber,
      searchText: '',
      replaceText: ''
    });
  }

  /**
   * Find all text matches
   */
  private findAllTextMatches(root: HTMLElement, searchText: string): Range[] {
    const ranges: Range[] = [];
    const searchLower = searchText.toLowerCase();
    
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tagName = parent.tagName.toLowerCase();
          if (tagName === 'script' || tagName === 'style' || tagName === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          
          if (parent.id === 'ai-overlay-container') {
            return NodeFilter.FILTER_REJECT;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    
    let node: Node | null;
    while (node = walker.nextNode()) {
      const text = node.textContent || '';
      const textLower = text.toLowerCase();
      
      let startIndex = 0;
      let foundIndex: number;
      
      while ((foundIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
        const range = document.createRange();
        range.setStart(node, foundIndex);
        range.setEnd(node, foundIndex + searchText.length);
        ranges.push(range);
        
        startIndex = foundIndex + searchText.length;
      }
    }
    
    return ranges;}

  /**
   * Clear all highlights
   */
  private clearHighlights(doc: Document): void {
    const existingContainer = doc.getElementById('ai-overlay-container');
    if (existingContainer) {
      existingContainer.remove();
    }
    
    this.overlays = [];
    this.overlayContainer = null;
  }

// ============================================
// ✅ UPDATED: CHECK PREVIEW WITH AUTO-SAVE
// ============================================
async onCheckPreview(): Promise<void> {
  if (!this.editor || !this.templateId) {
    console.error('❌ [Check Preview] Aborted - no editor or templateId');
    return;
  }

  // ✅ CRITICAL: Remove all AI highlights before saving/preview
  this.removeAllHighlights();
  
  // ✅ CRITICAL FIX: Force GrapesJS to refresh from the cleaned DOM
  // This ensures the editor picks up the highlight-free HTML
  const iframe = this.editor.Canvas.getFrameEl();
  if (iframe && iframe.contentDocument) {
    // Trigger a repaint/reflow to ensure DOM is updated
    void iframe.contentDocument.body.offsetHeight;
  }
  
  // Wait longer for DOM to fully update and repaint
  await new Promise(resolve => setTimeout(resolve, 300));

  // ✅ CRITICAL FIX: If temp ID, prompt for name and save to database first
  if (this.templateId.startsWith('temp_')) {
    // Get current HTML and clean it
    let html = this.editor.getHtml();
    const css = this.editor.getCss();
    
    // ✅ CRITICAL: Clean HTML from any overlay artifacts
    html = this.cleanHtmlFromOverlays(html);
    
    const fullHtml = `<style>${css}</style>${html}`;
    
    // Prompt for template name
    const templateName = await this.promptTemplateName();
    
    if (!templateName) {
      return;
    }
    
    // Save to database
    const newTemplateId = await this.saveNewTemplate(templateName, fullHtml);
    
    if (!newTemplateId) {
      console.error('❌ [Check Preview] Failed to save template');
      return;
    }
    // Update templateId to the real database ID
    this.templateId = newTemplateId;
    
    // Clear temp ID from localStorage
    localStorage.removeItem('visual_editor_temp_id');
    
    // Continue with normal flow using the new template ID
  }
  
  // ✅ CRITICAL: Double-check highlights are removed before getting HTML
  this.removeAllHighlights();
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // ✅ CRITICAL: Perform SYNCHRONOUS save to ensure data is written BEFORE navigation
  try {
    let html = this.editor.getHtml();
    const css = this.editor.getCss();
    
    console.log('🔍 [Check Preview] HTML BEFORE cleanHtmlFromOverlays:', {
      length: html.length,
      hasOverlayContainer: html.includes('ai-overlay-container'),
      hasHighlightSpan: html.includes('data-ai-highlight'),
      first500: html.substring(0, 500)
    });
    
    // ✅ CRITICAL: Clean HTML from any overlay artifacts
    html = this.cleanHtmlFromOverlays(html);
    
    console.log('🔍 [Check Preview] HTML AFTER cleanHtmlFromOverlays:', {
      length: html.length,
      hasOverlayContainer: html.includes('ai-overlay-container'),
      hasHighlightSpan: html.includes('data-ai-highlight'),
      first500: html.substring(0, 500)
    });
    
    if (html && html.trim()) {
      // Save immediately (synchronous)
      this.templateState.saveEditorProgress(this.templateId, html, css);
      console.log('✅ [Check Preview] Saved cleaned HTML to localStorage');
      // Also save to visual_editor progress key
      const editorState = {
        html,
        css,
        templateId: this.templateId,
        savedAt: new Date().toISOString()
      };
      localStorage.setItem(`visual_editor_${this.templateId}_progress`, JSON.stringify(editorState));
    } else {
    }
  } catch (error) {
    console.error('❌ [Check Preview] Save failed:', error);
  }

  // 2. ✅ SMART NAVIGATION: Check where user came from and set correct return flags
  // ✅ CRITICAL FIX: Check editing mode to determine if this is a variant
  const editingMode = localStorage.getItem(`visual_editor_${this.templateId}_editing_mode`);
  const variantMetaKey = `visual_editor_${this.templateId}_variant_meta`;
  const variantMeta = localStorage.getItem(variantMetaKey);
  
  if (editingMode === 'variant' && variantMeta) {
    // ✅ User came from Use Variants page - return to use-variant page
    try {
      const meta = JSON.parse(variantMeta);
      const { runId, no } = meta;
      
      // ✅ CRITICAL: Get HTML and CSS, clean them, then combine into full HTML document
      let html = this.editor.getHtml();
      const css = this.editor.getCss();
      
      // ✅ CRITICAL: Clean HTML from any overlay artifacts
      html = this.cleanHtmlFromOverlays(html);
      
      const fullHtml = `<style>${css}</style>${html}`;
      
      // ✅ Save FULL HTML (with embedded CSS) to the key Use Variants page expects
      sessionStorage.setItem('visual_editor_edited_html', fullHtml);
      // ✅ CRITICAL: Set return flag Use Variants page expects
      sessionStorage.setItem('visual_editor_return_use_variant', 'true');
      
      console.log('✅ [Check Preview] Returning to use-variant page:', { runId, no, templateId: this.templateId });
      
      // Navigate back to use-variant page with proper state management
      await this.router.navigate(['/qa', this.templateId, 'use', runId, no], {
        replaceUrl: false,
        skipLocationChange: false
      });
    } catch (error) {
      console.error('❌ [Check Preview] Failed to parse variant metadata, falling back to QA page:', error);
      
      // Fallback to QA page if parsing fails
      const returnKey = `visual_editor_${this.templateId}_return_flag`;
      localStorage.setItem(returnKey, 'true');
      this.router.navigate(['/qa', this.templateId]);
    }
  } else {
    // ✅ User came from QA page (golden/original templates) - use QA page keys
    
    // ✅ CRITICAL FIX: Get cleaned HTML and save it (just like for variants)
    let html = this.editor.getHtml();
    const css = this.editor.getCss();
    
    // ✅ CRITICAL: Clean HTML from any overlay artifacts (removes highlights)
    html = this.cleanHtmlFromOverlays(html);
    
    const fullHtml = `<style>${css}</style>${html}`;
    
    // ✅ Check editing context to determine the correct save key
    const editingContext = localStorage.getItem(`template_state_${this.templateId}_editing_context`);
    
    if (editingContext) {
      try {
        const context = JSON.parse(editingContext);
        
        if (context.type === 'golden') {
          // ✅ Save to golden template key
          localStorage.setItem(`visual_editor_${this.templateId}_golden_html`, fullHtml);
        } else if (context.type === 'original') {
          // ✅ Save to edited key for original template
          localStorage.setItem(`template_state_${this.templateId}_edited`, fullHtml);
        }
      } catch (e) {
        console.error('❌ Failed to parse editing context:', e);
      }
    }
    
    // ✅ Set return flag for QA page to detect
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    localStorage.setItem(returnKey, 'true');
    
    this.router.navigate(['/qa', this.templateId]);
  }
}  /**
   * Copy text as plain text (no formatting)
   */
  copyTextToClipboard(text: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    
    // ✅ Copy as plain text only
    navigator.clipboard.writeText(text).then(() => {
      this.showToast(`Copied: "${this.truncateText(text, 30)}"`, 'success');
    }).catch(err => {
      console.error('Copy failed:', err);
      this.showToast('Copy failed. Please try again.', 'error');
    });
  }

  /**
   * Trigger browser's native find (Ctrl+F) and show helpful message
   */
  /**
   * Remove all AI highlights from the editor
   */
  private removeAllHighlights(): void {
    try {
      let iframe = document.querySelector('iframe#gjs') as HTMLIFrameElement;
      
      if (!iframe) {
        iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
      }
      
      if (!iframe) {
        iframe = document.querySelector('iframe') as HTMLIFrameElement;
      }
      
      if (iframe && iframe.contentDocument) {
        const doc = iframe.contentDocument;
        
        // ✅ CRITICAL FIX: Remove overlay container FIRST (yellow boxes with borders)
        const existingOverlayContainer = doc.getElementById('ai-overlay-container');
        if (existingOverlayContainer) {
          console.log('🧹 Removing overlay container with', existingOverlayContainer.children.length, 'children');
          existingOverlayContainer.remove();
        }
        
        // ✅ Remove inline text highlights (span elements)
        const existingHighlights = doc.querySelectorAll('span[data-ai-highlight="true"]');
        if (existingHighlights.length > 0) {
          console.log('🧹 Removing', existingHighlights.length, 'inline highlight spans');
          existingHighlights.forEach(highlight => {
            const textNode = doc.createTextNode(highlight.textContent || '');
            highlight.parentNode?.replaceChild(textNode, highlight);
          });
          
          // ✅ CRITICAL: Normalize text nodes to merge adjacent text nodes
          doc.body.normalize();
        }
        
        // ✅ Clear overlay references
        this.overlays = [];
        this.overlayContainer = null;
        
        console.log('✅ All highlights removed successfully');
      }
    } catch (error) {
      console.error('Error removing highlights:', error);
    }
  }

  /**
   * Clean HTML string by removing any AI overlay artifacts
   */
  private cleanHtmlFromOverlays(html: string): string {
    if (!html) return html;
    
    // Remove any ai-overlay-container divs and their children
    let cleanHtml = html.replace(/<div[^>]*id=["']ai-overlay-container["'][^>]*>[\s\S]*?<\/div>/gi, '');
    
    // Remove any span elements with data-ai-highlight attribute
    cleanHtml = cleanHtml.replace(/<span[^>]*data-ai-highlight=["']true["'][^>]*>(.*?)<\/span>/gi, '$1');
    
    // Remove any inline styles with yellow background (rgba(255, 235, 59, 0.4))
    cleanHtml = cleanHtml.replace(/background:\s*rgba\(255,\s*235,\s*59,\s*0\.4\);?/gi, '');
    cleanHtml = cleanHtml.replace(/background-color:\s*rgba\(255,\s*235,\s*59,\s*0\.4\);?/gi, '');
    
    // Remove any elements with data-gjs-type="temporary-overlay"
    cleanHtml = cleanHtml.replace(/<[^>]*data-gjs-type=["']temporary-overlay["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    
    return cleanHtml;
  }


  searchAndReplaceText(findText: string, replaceText: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    
    try {
      let iframe = document.querySelector('iframe#gjs') as HTMLIFrameElement;
      
      if (!iframe) {
        iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
      }
      
      if (!iframe) {
        iframe = document.querySelector('iframe') as HTMLIFrameElement;
      }
      
      if (!iframe || !iframe.contentDocument) {
        this.showToast('Editor not ready', 'warning');
        return;
      }
      
      const doc = iframe.contentDocument;
      const body = doc.body;
      
      // Remove any existing highlights
      const existingHighlights = doc.querySelectorAll('span[data-ai-highlight="true"]');
      existingHighlights.forEach(highlight => {
        const textNode = doc.createTextNode(highlight.textContent || '');
        highlight.parentNode?.replaceChild(textNode, highlight);
      });
      
      // Search for text
      const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
      
      let node;
      let found = false;
      
      while (node = walker.nextNode()) {
        const nodeText = node.textContent || '';
        const searchLower = findText.toLowerCase();
        
        if (nodeText.toLowerCase().includes(searchLower)) {
          const parent = node.parentElement;
          if (parent) {
            // Scroll to it
            parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight it
            const range = doc.createRange();
            const startIndex = nodeText.toLowerCase().indexOf(searchLower);
            range.setStart(node, startIndex);
            range.setEnd(node, startIndex + findText.length);
            
            const highlight = doc.createElement('span');
            highlight.setAttribute('data-ai-highlight', 'true');
            highlight.style.cssText = 'background-color: yellow !important; color: black !important; padding: 2px;';
            
            try {
              range.surroundContents(highlight);
              found = true;
              this.showToast(`Found "${this.truncateText(findText, 25)}"`, 'success');
              break;
            } catch (e) {
              // Can't highlight - just scroll
            }
          }
        }
      }
      
      if (!found) {
        this.showToast('Not found', 'warning');
      }
      
    } catch (error) {
      console.error('[SEARCH] Error:', error);
    }
  }

  searchTextInPage(text: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    
    try {
      let iframe = document.querySelector('iframe#gjs') as HTMLIFrameElement;
      
      if (!iframe) {
        iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
      }
      
      if (!iframe) {
        iframe = document.querySelector('iframe') as HTMLIFrameElement;
      }
      
      if (!iframe || !iframe.contentWindow || !iframe.contentDocument) {
        this.showToast('Editor not ready', 'warning');
        return;
      }
      
      const doc = iframe.contentDocument;
      const body = doc.body;
      
      // Search for text in the body
      const textContent = body.innerText || body.textContent || '';
      const lowerText = textContent.toLowerCase();
      const searchLower = text.toLowerCase();
      
      if (lowerText.includes(searchLower)) {
        // Found! Now find the actual element
        const walker = doc.createTreeWalker(
          body,
          NodeFilter.SHOW_TEXT,
          null
        );
        
        let node;
        let found = false;
        
        while (node = walker.nextNode()) {
          const nodeText = node.textContent || '';
          if (nodeText.toLowerCase().includes(searchLower)) {
            // Found the text node! Scroll its parent into view
            const parent = node.parentElement;
            if (parent) {
              parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
              
              // Create a highlight element instead of just selecting
              const range = doc.createRange();
              const startIndex = nodeText.toLowerCase().indexOf(searchLower);
              range.setStart(node, startIndex);
              range.setEnd(node, startIndex + text.length);
              
              // Create a bright highlight span
              const highlight = doc.createElement('span');
              highlight.style.cssText = `
                background-color: yellow !important;
                color: black !important;
                padding: 2px 4px;
                border-radius: 3px;
                box-shadow: 0 0 0 3px rgba(255, 235, 59, 0.5);
                font-weight: bold;
              `;
              
              try {
                range.surroundContents(highlight);
                
                // Remove highlight after 5 seconds
                setTimeout(() => {
                  if (highlight.parentNode) {
                    const textNode = doc.createTextNode(highlight.textContent || '');
                    highlight.parentNode.replaceChild(textNode, highlight);
                  }
                }, 5000);
              } catch (e) {
                // If surroundContents fails, just select the text
                const selection = doc.getSelection();
                if (selection) {
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              }
              
              found = true;
              this.showToast(`Found "${this.truncateText(text, 30)}"`, 'success');
              break;
            }
          }
        }
        
        if (!found) {
          this.showToast('Found in content but could not highlight', 'warning');
        }
      } else {
        // Not found - copy to clipboard
        navigator.clipboard.writeText(text).then(() => {
          this.showToast(`Not found. Copied - try Ctrl+F`, 'warning');
        }).catch(() => {
          this.showToast('Not found', 'warning');
        });
      }
    } catch (error) {
      console.error('[SEARCH] Error:', error);
      this.showToast('Press Ctrl+F to search', 'info');
    }
  }

  /**
   * Make text selectable and copyable
   */
  makeTextCopyable(element: HTMLElement, text: string): void {
    element.style.cursor = 'pointer';
    element.title = 'Click to copy';
    
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyTextToClipboard(text);
    });
  }

  /**
   * Simple toast (NO animations)
   */
  private showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
    const toast = document.createElement('div');
    
    let icon = '';
    let bgColor = '';
    
    switch (type) {
      case 'success':
        icon = '✓';
        bgColor = '#10b981';
        break;
      case 'error':
        icon = '✕';
        bgColor = '#ef4444';
        break;
      case 'warning':
        icon = '⚠';
        bgColor = '#f59e0b';
        break;
      case 'info':
        icon = 'ℹ';
        bgColor = '#3b82f6';
        break;
    }
    
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${bgColor};
      color: white;
      padding: 16px 20px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      font-weight: 600;
      font-size: 14px;
      max-width: 400px;
      white-space: pre-line;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    
    toast.innerHTML = `
      <span style="font-size: 18px; line-height: 1; display: flex; align-items: center; flex-shrink: 0;">${icon}</span>
      <span style="line-height: 1.4;">${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    const duration = type === 'info' ? 10000 : 3000;
    
    setTimeout(() => {
      toast.remove();
    }, duration);
  }

  /**
   * Truncate text
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  isEditApplied(editIndex: number): boolean {
    if (!this.templateId) return false;
    
    const appliedKey = `${this.APPLIED_EDITS_KEY}_${this.templateId}`;
    const appliedEditsJson = sessionStorage.getItem(appliedKey);
    
    if (!appliedEditsJson) return false;
    
    try {
      const appliedEdits: number[] = JSON.parse(appliedEditsJson);
      return appliedEdits.includes(editIndex);
    } catch (error) {
      return false;
    }
  }

  getPendingEditsCount(): number {
    return this.failedEdits.filter((_, index) => !this.isEditApplied(index)).length;
  }

  selectText(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    
    if (window.getSelection && document.createRange) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
}