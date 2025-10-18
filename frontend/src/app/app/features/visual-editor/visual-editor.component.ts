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
  private longPressTimer: any;

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

  // Widget Position (draggable)
  widgetPosition = { x: 50, y: 50 };
  isDragging = false;
  dragEnabled = false;
  private dragOffset = { x: 0, y: 0 };

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
      
      if (this.templateId) {
        this.loadGoldenHtml(this.templateId);
        this.loadFailedEdits(this.templateId);
      }
    });
    
    this.restoreWidgetPosition();
  }

  ngAfterViewInit(): void {
    const container = document.getElementById('gjs');
    
    if (container) {
      this.initGrapesJS();
    } else {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.autoSave();
    
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
    
    let x = touch.clientX - this.dragOffset.x;
    let y = touch.clientY - this.dragOffset.y;
    
    x = Math.max(0, Math.min(x, viewportWidth - buttonSize));
    y = Math.max(0, Math.min(y, viewportHeight - buttonSize));
    
    this.widgetPosition = {
      x: (x / viewportWidth) * 100,
      y: (y / viewportHeight) * 100
    };
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
      console.warn('Could not get user info, using default:', error);
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
    
    console.log('💾 Saving new template to MongoDB:', payload);
    
    const response: any = await firstValueFrom(
      this.http.post('/api/templates', payload)
    );
    
    console.log('✅ Template saved successfully:', response);
    
    this.showToast('✅ Template saved successfully!', 'success');
    
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
    // Try to get golden HTML from sessionStorage (set by QA page)
    const goldenKey = `visual_editor_${templateId}_golden_html`;
    const goldenHtml = sessionStorage.getItem(goldenKey);
    
    if (goldenHtml) {
      // ✅ SCENARIO 1: Coming from QA page
      console.log('✅ Loaded golden HTML from sessionStorage (QA page flow)');
      this.originalGoldenHtml = goldenHtml;
    } else {
      // ✅ SCENARIO 2: Direct access from navbar
      console.log('🆕 Starting fresh editor (direct access from navbar)');
      this.originalGoldenHtml = '';
    }
  }

  private initGrapesJS(): void {
    try {
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
        this.setupCodeEditor();
        
        // ✅ CASE 1: From QA page with golden HTML
        if (this.originalGoldenHtml) {
          try {
            console.log('✅ Loading golden HTML from QA page');
            this.editor.setComponents(this.originalGoldenHtml);
          } catch (error) {
            console.error('Failed to load golden HTML:', error);
          }
        } 
        // ✅ CASE 2: Has template ID but no golden HTML - restore progress
        else if (this.templateId) {
          console.log('🔄 Restoring progress for template:', this.templateId);
          this.restoreProgress();
        }
        // ✅ CASE 3: No template ID - FRESH EDITOR (do nothing)
        else {
          console.log('🆕 Starting fresh editor - no content loaded');
        }
        
        this.loading = false;
      });
      
      this.editor.on('update', () => {
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
    this.router.navigate(['/']);
  }

  saveTemplate(): void {
    if (!this.editor) return;
    const html = this.editor.getHtml();
    const css = this.editor.getCss();
    const fullHtml = `<style>${css}</style>${html}`;
  }

  exportHTML(): void {
    if (!this.editor) return;
    
    const html = this.editor.getHtml();
    const css = this.editor.getCss();
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

  private autoSave(): void {
    if (!this.editor) return;
    
    try {
      const html = this.editor.getHtml();
      const css = this.editor.getCss();
      
      const editorState = {
        html,
        css,
        savedAt: new Date().toISOString()
      };
      
      this.cacheService.set(
        this.EDITOR_CACHE_KEY,
        editorState,
        24 * 60 * 60 * 1000,
        'session'
      );
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }

  private restoreProgress(): void {
    try {
      const savedState = this.cacheService.get<any>(this.EDITOR_CACHE_KEY);
      
      if (savedState && this.editor) {
        if (savedState.html) {
          this.editor.setComponents(savedState.html);
        }
        
        if (savedState.css) {
          this.editor.setStyle(savedState.css);
        }
      }
    } catch (error) {
      console.error('Restore progress failed:', error);
    }
  }

  clearProgress(): void {
    this.cacheService.invalidate(this.EDITOR_CACHE_KEY);
  }

  private loadFailedEdits(templateId: string): void {
    const failedKey = `visual_editor_${templateId}_failed_edits`;
    const failedEditsJson = sessionStorage.getItem(failedKey);
    
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
      } else {
        this.showFloatingWidget = false;
      }
    } catch (error) {
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
        console.error('Failed to restore widget position');
      }
    } else {
      this.widgetPosition = { x: 5, y: 50 };
    }
  }

  private saveWidgetPosition(): void {
    localStorage.setItem(this.WIDGET_POSITION_KEY, JSON.stringify(this.widgetPosition));
  }

  onButtonClick(event: MouseEvent): void {
    if (this.isDragging || this.dragEnabled) return;
    
    this.isWidgetOpen = !this.isWidgetOpen;
    
    if (this.isWidgetOpen && !this.hasShownPulseAnimation) {
      this.hasShownPulseAnimation = true;
    }
  }

  onButtonDoubleClick(event: MouseEvent): void {
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
    if (!this.isDragging || !this.dragEnabled) return;
    
    event.preventDefault();
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const buttonSize = 60;
    
    let x = event.clientX - this.dragOffset.x;
    let y = event.clientY - this.dragOffset.y;
    
    x = Math.max(0, Math.min(x, viewportWidth - buttonSize));
    y = Math.max(0, Math.min(y, viewportHeight - buttonSize));
    
    this.widgetPosition = {
      x: (x / viewportWidth) * 100,
      y: (y / viewportHeight) * 100
    };
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
    if (this.isDragging && this.dragEnabled) {
      this.onDragMove(event);
    }
  }

  @HostListener('document:mouseup', ['$event'])
  onDocumentMouseUp(event: MouseEvent): void {
    if (this.isDragging) {
      this.onDragEnd(event);
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
// ============================================
// ✅ UPDATED: CHECK PREVIEW WITH CONTENT VALIDATION
// ============================================
async onCheckPreview(): Promise<void> {
  if (!this.editor) {
    alert('Editor not initialized');
    return;
  }
  
  const html = this.editor.getHtml();
  const css = this.editor.getCss();
  const fullHtml = `<style>${css}</style>${html}`;
  
  // ============================================
  // ✅ CHECK IF EDITOR IS EMPTY (ALWAYS)
  // ============================================
  console.log('🔍 [CHECK PREVIEW] Raw HTML from editor:', html);
  console.log('🔍 [CHECK PREVIEW] HTML length:', html?.length);
  
  // Remove all whitespace, newlines, and common empty tags
  const cleanedHtml = html
    .replace(/\s+/g, '')
    .replace(/<div><\/div>/gi, '')
    .replace(/<p><\/p>/gi, '')
    .replace(/<span><\/span>/gi, '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<!--.*?-->/g, '')
    .replace(/<body[^>]*><\/body>/gi, '')
    .replace(/<section[^>]*><\/section>/gi, '')
    .replace(/<article[^>]*><\/article>/gi, '');
  
  console.log('🔍 [CHECK PREVIEW] Cleaned HTML:', cleanedHtml);
  console.log('🔍 [CHECK PREVIEW] Cleaned length:', cleanedHtml?.length);
  
  const hasContent = cleanedHtml && cleanedHtml.trim().length > 0;
  
  console.log('🔍 [CHECK PREVIEW] Has content?', hasContent);
  
  if (!hasContent) {
    this.showToast('⚠️ Visual editor is empty. Please add some content to your template first.', 'warning');
    return;
  }
  
  // ============================================
  // 🆕 SCENARIO 1: DIRECT ACCESS (No templateId)
  // ============================================
  if (!this.templateId) {
    console.log('🆕 Direct access detected');
    
    console.log('✅ Content detected - prompting for template name');
    
    // Prompt for template name
    const templateName = await this.promptTemplateName();
    
    if (!templateName) {
      console.log('❌ User cancelled template naming');
      return;
    }
    
    console.log('✅ Template name provided:', templateName);
    
    // Save to MongoDB
    const savedTemplateId = await this.saveNewTemplate(templateName, fullHtml);
    
    if (!savedTemplateId) {
      console.error('❌ Failed to save template');
      return;
    }
    
    console.log('✅ Template saved with ID:', savedTemplateId);
    
    // Set templateId for navigation
    this.templateId = savedTemplateId;
    
    // Save to session for QA page
    const goldenKey = `visual_editor_${savedTemplateId}_golden_html`;
    sessionStorage.setItem(goldenKey, fullHtml);
    
    // Navigate to QA page
    console.log('🎯 Navigating to QA page:', `/qa/${savedTemplateId}`);
    this.router.navigate(['/qa', savedTemplateId]);
    
    return;
  }
  
  // ============================================
  // ✅ SCENARIO 2: USE-VARIANT MODE
  // ============================================
  const modeKey = `visual_editor_${this.templateId}_editing_mode`;
  const editingMode = sessionStorage.getItem(modeKey);
  
  console.log('🎯 Check Preview - Mode:', editingMode);
  
  if (editingMode === 'use-variant') {
    const metaKey = `visual_editor_${this.templateId}_use_variant_meta`;
    const metaJson = sessionStorage.getItem(metaKey);
    
    if (!metaJson) {
      alert('Use-variant metadata not found');
      return;
    }
    
    const meta = JSON.parse(metaJson);
    const { runId, no } = meta;
    
    const editedKey = `visual_editor_edited_html`;
    sessionStorage.setItem(editedKey, fullHtml);
    
    const returnKey = `visual_editor_return_use_variant`;
    sessionStorage.setItem(returnKey, 'true');
    
    sessionStorage.removeItem(modeKey);
    sessionStorage.removeItem(metaKey);
    
    this.autoSave();
    this.router.navigate(['/qa', this.templateId, 'use', runId, no]);
    
  } else {
    // ============================================
    // ✅ SCENARIO 3: GOLDEN TEMPLATE FLOW
    // ============================================
    const editedKey = `visual_editor_${this.templateId}_edited_html`;
    sessionStorage.setItem(editedKey, fullHtml);
    
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    sessionStorage.setItem(returnKey, 'true');
    
    this.autoSave();
    this.router.navigate(['/qa', this.templateId]);
  }
}

  /**
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
      align-items: flex-start;
      gap: 10px;
    `;
    
    toast.innerHTML = `
      <span style="font-size: 18px; margin-top: 2px;">${icon}</span>
      <span>${message}</span>
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