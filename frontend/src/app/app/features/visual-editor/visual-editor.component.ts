import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, AfterViewInit, ViewEncapsulation, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import grapesjs from 'grapesjs';
import grapesjsPresetNewsletter from 'grapesjs-preset-newsletter';
import { CacheService } from '../../core/services/cache.service';
import { AuthService } from '../../core/services/auth.service';
import { trigger, state, style, transition, animate } from '@angular/animations';

@Component({
  selector: 'app-visual-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule
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
  private longPressTimer: any;


  // ============================================
    // 🆕 NEW: FLOATING SUGGESTIONS WIDGET PROPERTIES
    // ============================================

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
    // private clickCount = 0; // 🆕 NEW: Count clicks for double-click detection
    // private clickTimer: any; // 🆕 NEW: Timer for click detection

    // Text Markers in Editor
    textMarkers: Array<{
    editIndex: number;
    find: string;
    replace: string;
    status: 'pending' | 'success' | 'failed';
    element?: HTMLElement;
    matchIndex?: number;
    totalMatches?: number;
    }> = [];

    // Selected Edit for Multi-Match Navigation
    selectedEditIndex: number | null = null;
    currentMatchIndex = 0;
    totalMatchesForSelected = 0;

    // Storage Keys
    private readonly WIDGET_POSITION_KEY = 'visual_editor_widget_position';
    private readonly WIDGET_STATE_KEY = 'visual_editor_widget_state';
    private readonly APPLIED_EDITS_KEY = 'visual_editor_applied_edits';
    private readonly PULSE_SHOWN_KEY = 'visual_editor_pulse_shown';
  
  private editor: any;
  loading = true;
  showImportModal = false;
  importHtmlCode = '';
  
  private readonly EDITOR_CACHE_KEY = 'visual-editor-content';

  templateId: string | null = null;
originalGoldenHtml: string = '';

ngOnInit(): void {
  console.log('🟢 [ngOnInit] Visual Editor initialized');
  
  // 🆕 NEW: Get template ID from route params
  this.route.paramMap.subscribe(params => {
    this.templateId = params.get('id');
    console.log('📋 [ngOnInit] Template ID from route:', this.templateId);
    
    if (this.templateId) {
      this.loadGoldenHtml(this.templateId);
      
      // 🆕 NEW: Load failed edits and initialize floating widget
      this.loadFailedEdits(this.templateId);
    } else {
      console.warn('⚠️ [ngOnInit] No template ID in route');
    }
  });
  
  // 🆕 NEW: Restore widget position on init
  this.restoreWidgetPosition();
}

  ngAfterViewInit(): void {
    console.log('🟢 [ngAfterViewInit] Called');
    const container = document.getElementById('gjs');
    console.log('🔍 [ngAfterViewInit] Container found:', !!container);
    
    if (container) {
      console.log('✅ [ngAfterViewInit] Container exists, initializing GrapesJS...');
      this.initGrapesJS();
    } else {
      console.error('❌ [ngAfterViewInit] Container #gjs not found!');
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    console.log('🔴 [ngOnDestroy] Cleaning up');
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
    
    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
    
    console.log('📱 [onTouchStart] Long press detected - drag enabled');
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
    console.log('📱 [onTouchEnd] Touch drag ended');
  }
}

  /**
 * Loads golden HTML from sessionStorage
 */
private loadGoldenHtml(templateId: string): void {
  console.log('🔍 [loadGoldenHtml] Loading golden HTML from sessionStorage');
  console.log('📋 [loadGoldenHtml] Template ID:', templateId);
  
  const goldenKey = `visual_editor_${templateId}_golden_html`;
  const goldenHtml = sessionStorage.getItem(goldenKey);
  
  if (!goldenHtml) {
    console.error('❌ [loadGoldenHtml] No golden HTML found in sessionStorage');
    console.error('❌ [loadGoldenHtml] Expected key:', goldenKey);
    alert('No template data found. Please generate golden template first.');
    this.router.navigate(['/qa', templateId]);
    return;
  }
  
  console.log('✅ [loadGoldenHtml] Golden HTML loaded from sessionStorage');
  console.log('📊 [loadGoldenHtml] HTML length:', goldenHtml.length);
  
  this.originalGoldenHtml = goldenHtml;
  
  // HTML will be loaded into editor when editor initializes (in initGrapesJS -> 'load' event)
  console.log('💾 [loadGoldenHtml] Golden HTML stored in component property');
}

  private initGrapesJS(): void {
    console.log('🟢 [initGrapesJS] Starting initialization');
    
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

      console.log('✅ [initGrapesJS] GrapesJS instance created');
      console.log('🔍 [initGrapesJS] Editor object:', this.editor);
      
this.editor.on('load', () => {
  console.log('🟢 [Editor Event] LOAD event fired');
  console.log('🔍 [Editor Event] Editor ready state:', this.editor);
  
  this.setupCodeEditor();
  
  // 🆕 NEW: Load golden HTML if available (from QA page)
  if (this.originalGoldenHtml) {
    console.log('📥 [Editor Event] Loading golden HTML into editor');
    console.log('📊 [Editor Event] HTML length:', this.originalGoldenHtml.length);
    
    try {
      this.editor.setComponents(this.originalGoldenHtml);
      console.log('✅ [Editor Event] Golden HTML loaded successfully');
    } catch (error) {
      console.error('❌ [Editor Event] Failed to load golden HTML:', error);
      // Fall back to restore progress if loading fails
      this.restoreProgress();
    }
  } else {
    // ✅ EXISTING: Restore progress from cache if no golden HTML
    console.log('ℹ️ [Editor Event] No golden HTML, restoring from cache');
    this.restoreProgress();
  }
  
  this.loading = false;
  console.log('✅ [Editor Event] Loading complete');
});
      
      this.editor.on('update', () => {
        console.log('📝 [Editor Event] UPDATE event fired');
        this.autoSave();
      });
      
    } catch (error) {
      console.error('❌ [initGrapesJS] Failed to initialize:', error);
      this.loading = false;
    }
  }


  /**
 * Saves edited HTML and navigates back to QA page for preview
 */
onCheckPreview(): void {
  console.log('👀 [onCheckPreview] Check preview clicked');
  
  if (!this.editor) {
    console.error('❌ [onCheckPreview] No editor instance');
    alert('Editor not initialized');
    return;
  }
  
  if (!this.templateId) {
    console.error('❌ [onCheckPreview] No template ID');
    alert('Template ID not found');
    return;
  }
  
  console.log('📤 [onCheckPreview] Getting edited HTML from editor');
  
  // Get edited HTML + CSS
  const html = this.editor.getHtml();
  const css = this.editor.getCss();
  const fullHtml = `<style>${css}</style>${html}`;
  
  console.log('✅ [onCheckPreview] Edited HTML extracted');
  console.log('📊 [onCheckPreview] Edited HTML length:', fullHtml.length);
  console.log('📊 [onCheckPreview] Original HTML length:', this.originalGoldenHtml.length);
  console.log('📊 [onCheckPreview] Difference:', fullHtml.length - this.originalGoldenHtml.length, 'characters');
  
  // Store edited HTML in sessionStorage
  const editedKey = `visual_editor_${this.templateId}_edited_html`;
  sessionStorage.setItem(editedKey, fullHtml);
  console.log(`✅ [onCheckPreview] Stored edited HTML: ${editedKey}`);
  
  // Set return flag
  const returnKey = `visual_editor_${this.templateId}_return_flag`;
  sessionStorage.setItem(returnKey, 'true');
  console.log(`✅ [onCheckPreview] Set return flag: ${returnKey}`);
  
  // Auto-save current state (in case user comes back)
  this.autoSave();
  console.log('✅ [onCheckPreview] Auto-saved current editor state');
  
  // Navigate back to QA page
  console.log(`🧭 [onCheckPreview] Navigating to /qa/${this.templateId}`);
  this.router.navigate(['/qa', this.templateId]);
}

  private setupCodeEditor(): void {
    console.log('🟢 [setupCodeEditor] Starting setup');
    
    try {
      const panels = this.editor.Panels;
      console.log('🔍 [setupCodeEditor] Panels object:', panels);
      
      // Register command
      console.log('📝 [setupCodeEditor] Registering command: custom-edit-code');
      
this.editor.Commands.add('custom-edit-code', {
  run: (editor: any) => {
    console.log('🚀🚀🚀 [COMMAND RUN] custom-edit-code TRIGGERED!!!');
    console.log('🔍 [COMMAND RUN] Editor passed:', editor);
    this.openCodeEditor(editor);
  },
  stop: (editor: any) => {
    console.log('⏹️ [COMMAND STOP] custom-edit-code stopped');
    // Allow command to be re-run
  }
});
      
      console.log('✅ [setupCodeEditor] Command registered');
      
      // Add button
      console.log('📝 [setupCodeEditor] Adding button to options panel');
      
const button = panels.addButton('options', {
  id: 'custom-code-edit',
  className: 'fa fa-code',
  command: (editor: any) => {
    console.log('🎯 [BUTTON CLICK] Direct button click handler');
    this.openCodeEditor(editor);
  },
  attributes: { 
    title: 'Edit HTML/CSS Code',
    'data-tooltip': 'Edit Code'
  }
});
      
      console.log('✅ [setupCodeEditor] Button added:', button);
      console.log('🔍 [setupCodeEditor] Button details:', {
        id: 'custom-code-edit',
        command: 'custom-edit-code'
      });
      
      // Verify button exists
      const optionsPanel = panels.getPanel('options');
      console.log('🔍 [setupCodeEditor] Options panel:', optionsPanel);
      
      if (optionsPanel) {
        const buttons = optionsPanel.get('buttons');
        console.log('🔍 [setupCodeEditor] Panel buttons:', buttons);
        console.log('🔍 [setupCodeEditor] Number of buttons:', buttons ? buttons.length : 0);
      }
      
      console.log('✅ [setupCodeEditor] Setup complete');
      
    } catch (error) {
      console.error('❌ [setupCodeEditor] Setup failed:', error);
      console.error('❌ [setupCodeEditor] Error stack:', error instanceof Error ? error.stack : 'No stack');
    }
  }

  private openCodeEditor(editor: any): void {
    console.log('🟢 [openCodeEditor] Function called');
    console.log('🔍 [openCodeEditor] Editor:', editor);
    
    try {
      const modal = editor.Modal;
      console.log('🔍 [openCodeEditor] Modal object:', modal);
      
      const html = editor.getHtml();
      const css = editor.getCss();
      console.log('🔍 [openCodeEditor] HTML length:', html?.length || 0);
      console.log('🔍 [openCodeEditor] CSS length:', css?.length || 0);
      
      const fullCode = `<style>\n${css}\n</style>\n\n${html}`;
      console.log('🔍 [openCodeEditor] Full code length:', fullCode.length);

      console.log('📝 [openCodeEditor] Setting modal title');
      modal.setTitle('Edit HTML & CSS Code');
      
      console.log('📝 [openCodeEditor] Setting modal content');
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
      
      console.log('✅ [openCodeEditor] Content set');
      
      console.log('📝 [openCodeEditor] Opening modal');
      modal.open();
      console.log('✅ [openCodeEditor] Modal.open() called');

      console.log('⏰ [openCodeEditor] Setting 100ms timeout for button setup');
      setTimeout(() => {
        console.log('🟢 [Timeout] Button setup starting');
        
        const applyBtn = document.getElementById('apply-code-btn');
        const cancelBtn = document.getElementById('cancel-code-btn');
        const textarea = document.getElementById('gjs-code-editor') as HTMLTextAreaElement;
        
        console.log('🔍 [Timeout] Apply button found:', !!applyBtn);
        console.log('🔍 [Timeout] Cancel button found:', !!cancelBtn);
        console.log('🔍 [Timeout] Textarea found:', !!textarea);
        
        if (applyBtn) {
          console.log('✅ [Timeout] Apply button exists, attaching handler');
          applyBtn.onclick = () => {
            console.log('🎯🎯🎯 [APPLY CLICKED] Button clicked!!!');
            
            if (textarea) {
              const newCode = textarea.value;
              console.log('📝 [APPLY CLICKED] New code length:', newCode.length);
              console.log('📝 [APPLY CLICKED] Calling setComponents...');
              
              editor.setComponents(newCode);
              
              console.log('✅ [APPLY CLICKED] Components set');
              
              applyBtn.textContent = '✓ Applied!';
              applyBtn.style.background = '#6d28d9';
              
              setTimeout(() => {
                applyBtn.textContent = '✓ Apply Changes';
                applyBtn.style.background = '#10b981';
              }, 1500);
            } else {
              console.error('❌ [APPLY CLICKED] Textarea not found!');
            }
          };
          console.log('✅ [Timeout] Apply handler attached');
        } else {
          console.error('❌ [Timeout] Apply button NOT found in DOM!');
        }
        
        if (cancelBtn) {
          console.log('✅ [Timeout] Cancel button exists, attaching handler');
          cancelBtn.onclick = () => {
            console.log('🎯 [CANCEL CLICKED] Button clicked');
            modal.close();
            console.log('✅ [CANCEL CLICKED] Modal closed');
          };
          console.log('✅ [Timeout] Cancel handler attached');
        } else {
          console.error('❌ [Timeout] Cancel button NOT found in DOM!');
        }
        
        console.log('✅ [Timeout] Button setup complete');
      }, 100);
      
    } catch (error) {
      console.error('❌ [openCodeEditor] Error:', error);
      console.error('❌ [openCodeEditor] Stack:', error instanceof Error ? error.stack : 'No stack');
    }
  }

  openImportModal(): void {
    console.log('🟢 [openImportModal] Opening import modal');
    this.showImportModal = true;
    this.importHtmlCode = '';
  }

  closeImportModal(): void {
    console.log('🔴 [closeImportModal] Closing import modal');
    this.showImportModal = false;
    this.importHtmlCode = '';
  }

  importHTML(): void {
    console.log('🟢 [importHTML] Importing HTML');
    
    if (!this.editor || !this.importHtmlCode.trim()) {
      console.warn('⚠️ [importHTML] No editor or empty code');
      return;
    }
    
    console.log('📝 [importHTML] Code length:', this.importHtmlCode.length);
    this.editor.setComponents(this.importHtmlCode);
    console.log('✅ [importHTML] HTML imported successfully');
    this.closeImportModal();
  }

  goBack(): void {
    console.log('🔙 [goBack] Navigating to home');
    this.router.navigate(['/']);
  }

  saveTemplate(): void {
    console.log('💾 [saveTemplate] Saving template');
    
    if (!this.editor) {
      console.warn('⚠️ [saveTemplate] No editor');
      return;
    }
    
    const html = this.editor.getHtml();
    const css = this.editor.getCss();
    const fullHtml = `<style>${css}</style>${html}`;
    
    console.log('📝 [saveTemplate] HTML length:', fullHtml.length);
    // alert('Template saved! (Backend integration pending)');
  }

  exportHTML(): void {
    console.log('📤 [exportHTML] Exporting HTML');
    
    if (!this.editor) {
      console.warn('⚠️ [exportHTML] No editor');
      return;
    }
    
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

    console.log('📝 [exportHTML] Full HTML length:', fullHtml.length);
    
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'email-template.html';
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log('✅ [exportHTML] File downloaded');
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
      
      console.log('💾 [autoSave] Saved at', editorState.savedAt);
    } catch (error) {
      console.error('❌ [autoSave] Failed:', error);
    }
  }

  private restoreProgress(): void {
    console.log('🟢 [restoreProgress] Attempting restore');
    
    try {
      const savedState = this.cacheService.get<any>(this.EDITOR_CACHE_KEY);
      console.log('🔍 [restoreProgress] Saved state:', savedState);
      
      if (savedState && this.editor) {
        console.log('📦 [restoreProgress] Restoring from:', savedState.savedAt);
        
        if (savedState.html) {
          this.editor.setComponents(savedState.html);
          console.log('✅ [restoreProgress] HTML restored');
        }
        
        if (savedState.css) {
          this.editor.setStyle(savedState.css);
          console.log('✅ [restoreProgress] CSS restored');
        }
        
        console.log('✅ [restoreProgress] Restore complete');
      } else {
        console.log('ℹ️ [restoreProgress] No saved state');
      }
    } catch (error) {
      console.error('❌ [restoreProgress] Failed:', error);
    }
  }

  clearProgress(): void {
    console.log('🗑️ [clearProgress] Clearing progress');
    this.cacheService.invalidate(this.EDITOR_CACHE_KEY);
  }
  // ============================================
// 🆕 NEW: FLOATING SUGGESTIONS WIDGET FUNCTIONS
// ============================================

/**
 * Loads failed edits from sessionStorage
 */
private loadFailedEdits(templateId: string): void {
  console.log('📥 [loadFailedEdits] Loading failed edits from sessionStorage');
  
  const failedKey = `visual_editor_${templateId}_failed_edits`;
  const failedEditsJson = sessionStorage.getItem(failedKey);
  
  if (!failedEditsJson) {
    console.log('ℹ️ [loadFailedEdits] No failed edits found');
    this.showFloatingWidget = false;
    return;
  }
  
  try {
    this.failedEdits = JSON.parse(failedEditsJson);
    console.log('✅ [loadFailedEdits] Loaded', this.failedEdits.length, 'failed edits');
    
    if (this.failedEdits.length > 0) {
      this.showFloatingWidget = true;
      
      // Check if pulse was already shown
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
    console.error('❌ [loadFailedEdits] Failed to parse:', error);
    this.showFloatingWidget = false;
  }
}

/**
 * Restores widget position from localStorage
 */
private restoreWidgetPosition(): void {
  const savedPosition = localStorage.getItem(this.WIDGET_POSITION_KEY);
  
  if (savedPosition) {
    try {
      const position = JSON.parse(savedPosition);
      this.widgetPosition = position;
      console.log('✅ [restoreWidgetPosition] Restored position:', position);
    } catch (error) {
      console.error('❌ [restoreWidgetPosition] Failed to parse:', error);
    }
  } else {
    // Default position: left-middle (10% from left, 50% from top)
    this.widgetPosition = { x: 5, y: 50 };
  }
}

/**
 * Saves widget position to localStorage
 */
private saveWidgetPosition(): void {
  localStorage.setItem(this.WIDGET_POSITION_KEY, JSON.stringify(this.widgetPosition));
  console.log('💾 [saveWidgetPosition] Saved position:', this.widgetPosition);
}

/**
 * Toggles widget open/close state
 */
/**
 * Toggles widget open/close state (only on single click)
 */
/**
 * Toggles widget open/close state (only on single click)
 */
/**
 * Handles button clicks (detects single vs double click)
 */
/**
 * Handles button clicks (detects single vs double click)
 */
/**
 * Handles button clicks with SHIFT modifier for drag mode
 */
/**
 * Handles single click - toggles widget
 */
onButtonClick(event: MouseEvent): void {
  console.log('🔵 [onButtonClick] Single click detected');
  
  if (this.isDragging || this.dragEnabled) {
    console.log('❌ [onButtonClick] BLOCKED - drag mode active');
    return;
  }
  
  this.isWidgetOpen = !this.isWidgetOpen;
  
  if (this.isWidgetOpen && !this.hasShownPulseAnimation) {
    this.hasShownPulseAnimation = true;
  }
}

/**
 * Handles double click - enables drag mode
 */
/**
 * Handles double click - enables drag mode and starts dragging
 */
/**
 * Handles double click - enables drag mode and starts dragging
 */
/**
 * Handles double click - enables drag mode and starts dragging
 */
onButtonDoubleClick(event: MouseEvent): void {
  console.log('🔵🔵 [onButtonDoubleClick] DOUBLE CLICK DETECTED!!!');
  
  event.stopPropagation();
  event.preventDefault();
  
  this.dragEnabled = true;
  this.isDragging = true;
  
  // Close widget if open
  if (this.isWidgetOpen) {
    this.isWidgetOpen = false;
  }
  
  // Calculate drag offset NOW
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  
  this.dragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  
  console.log('📍 [onButtonDoubleClick] Drag offset:', this.dragOffset);
  console.log('🔓 DRAG MODE ACTIVE - Move mouse to drag!');
}
/**
 * Shows temporary "Drag Mode Enabled" message
 */
private showDragEnabledMessage(): void {
  // This will be handled via CSS - add a class to show visual feedback
  console.log('💬 [showDragEnabledMessage] Showing drag mode message');
}

/**
 * Closes widget manually
 */
closeWidget(): void {
  this.isWidgetOpen = false;
}


/**
 * Handles drag start for floating button
 */
/**
 * Enables drag mode on double-click
 */
/**
 * Enables drag mode on double-click
 */
// onDoubleClick(event: MouseEvent): void {
//   console.log('🔵🔵 [onDoubleClick] DOUBLE CLICK DETECTED!');
//   console.log('   Event:', event);
  
//   event.stopPropagation();
//   event.preventDefault();
  
//   this.dragEnabled = true;
//   console.log('✅ [onDoubleClick] dragEnabled set to TRUE');
//   console.log('   dragEnabled:', this.dragEnabled);
//   console.log('   isDragging:', this.isDragging);
  
//   // Auto-disable after 5 seconds if not dragging
//   setTimeout(() => {
//     if (!this.isDragging) {
//       this.dragEnabled = false;
//       console.log('⏰ [onDoubleClick] Auto-disabled drag mode (5s timeout)');
//     }
//   }, 5000);
// }

/**
 * Handles drag start for floating button (only if double-clicked first)
 */
/**
 * Handles drag start for floating button (only if double-clicked first)
 */
/**
 * Handles drag start for floating button (only if double-clicked first)
 */
/**
 * Handles drag start
 */
/**
 * Handles drag start (now only for single click detection)
 */
onDragStart(event: MouseEvent): void {
  if (this.isDragging) {
    console.log('🟢 [onDragStart] Already dragging...');
    event.preventDefault();
    event.stopPropagation();
  }
}
/**
 * Handles drag move for floating button
 */
/**
 * Handles drag move for floating button
 */
/**
 * Handles drag move for floating button
 */
/**
 * Handles drag move
 */
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

/**
 * Handles drag end for floating button
 */
/**
 * Handles drag end for floating button
 */
/**
 * Handles drag end for floating button
 */
/**
 * Handles drag end
 */
onDragEnd(event: MouseEvent): void {
  if (this.isDragging) {
    console.log('🔴 [onDragEnd] Drag ended');
    
    event.stopPropagation();
    event.preventDefault();
    
    this.isDragging = false;
    this.dragEnabled = false;
    
    this.saveWidgetPosition();
    console.log('💾 [onDragEnd] Position saved:', this.widgetPosition);
  }
}

/**
 * Global mouse move listener for dragging
 */
@HostListener('document:mousemove', ['$event'])
onDocumentMouseMove(event: MouseEvent): void {
  if (this.isDragging && this.dragEnabled) {
    this.onDragMove(event);
  }
}

/**
 * Global mouse up listener for drag end
 */
@HostListener('document:mouseup', ['$event'])
onDocumentMouseUp(event: MouseEvent): void {
  if (this.isDragging) {
    this.onDragEnd(event);
  }
}
/**
 * Applies a suggestion (replaces find with replace text)
 */
applySuggestion(editIndex: number): void {
  console.log('🔧 [applySuggestion] Applying edit:', editIndex);
  
  if (!this.editor) {
    console.error('❌ [applySuggestion] No editor instance');
    return;
  }
  
  const edit = this.failedEdits[editIndex];
  if (!edit) {
    console.error('❌ [applySuggestion] Edit not found:', editIndex);
    return;
  }
  
  // Get current HTML
  const html = this.editor.getHtml();
  
  // Find text
  const findText = edit.find;
  const replaceText = edit.replace;
  
  // Count occurrences
  const regex = new RegExp(this.escapeRegex(findText), 'gi');
  const matches = html.match(regex);
  const matchCount = matches ? matches.length : 0;
  
  console.log('🔍 [applySuggestion] Found', matchCount, 'match(es)');
  
  if (matchCount === 0) {
    alert('❌ Text not found in editor. It may have been edited manually.');
    this.updateMarkerStatus(editIndex, 'failed');
    return;
  }
  
  if (matchCount === 1) {
    // Single match - apply directly
    const newHtml = html.replace(regex, replaceText);
    this.editor.setComponents(newHtml);
    
    console.log('✅ [applySuggestion] Applied successfully');
    this.updateMarkerStatus(editIndex, 'success');
    
    // Mark as applied in storage
    this.markEditAsApplied(editIndex);
  } else {
    // Multiple matches - show navigation
    this.selectedEditIndex = editIndex;
    this.currentMatchIndex = 0;
    this.totalMatchesForSelected = matchCount;
    
    console.log('🔢 [applySuggestion] Multiple matches found:', matchCount);
    alert(`⚠️ Found ${matchCount} matches. Use arrows to navigate and apply to specific instance.`);
  }
}

/**
 * Navigates to next match (for multi-match scenarios)
 */
navigateToNextMatch(): void {
  if (this.selectedEditIndex === null) return;
  
  this.currentMatchIndex = (this.currentMatchIndex + 1) % this.totalMatchesForSelected;
  console.log('➡️ [navigateToNextMatch] Match', this.currentMatchIndex + 1, 'of', this.totalMatchesForSelected);
  
  // TODO: Highlight current match in editor
}

/**
 * Navigates to previous match (for multi-match scenarios)
 */
navigateToPreviousMatch(): void {
  if (this.selectedEditIndex === null) return;
  
  this.currentMatchIndex = (this.currentMatchIndex - 1 + this.totalMatchesForSelected) % this.totalMatchesForSelected;
  console.log('⬅️ [navigateToPreviousMatch] Match', this.currentMatchIndex + 1, 'of', this.totalMatchesForSelected);
  
  // TODO: Highlight current match in editor
}

/**
 * Applies edit to current match (for multi-match scenarios)
 */
applyToCurrentMatch(): void {
  if (this.selectedEditIndex === null) return;
  
  const edit = this.failedEdits[this.selectedEditIndex];
  if (!edit) return;
  
  const html = this.editor.getHtml();
  const findText = edit.find;
  const replaceText = edit.replace;
  
  // Replace only the current match
  let matchCount = 0;
  const newHtml = html.replace(new RegExp(this.escapeRegex(findText), 'gi'), (match: string) => {
    if (matchCount === this.currentMatchIndex) {
      matchCount++;
      return replaceText;
    }
    matchCount++;
    return match;
  });
  
  this.editor.setComponents(newHtml);
  console.log('✅ [applyToCurrentMatch] Applied to match', this.currentMatchIndex + 1);
  
  // Update marker status
  this.updateMarkerStatus(this.selectedEditIndex, 'success');
  
  // Mark as applied
  this.markEditAsApplied(this.selectedEditIndex);
  
  // Clear selection
  this.selectedEditIndex = null;
  this.currentMatchIndex = 0;
  this.totalMatchesForSelected = 0;
}

/**
 * Updates marker status (pending/success/failed)
 */
private updateMarkerStatus(editIndex: number, status: 'pending' | 'success' | 'failed'): void {
  const marker = this.textMarkers.find(m => m.editIndex === editIndex);
  if (marker) {
    marker.status = status;
    console.log('🎨 [updateMarkerStatus] Updated marker', editIndex, 'to', status);
  }
}

/**
 * Marks edit as applied in storage
 */
private markEditAsApplied(editIndex: number): void {
  if (!this.templateId) return;
  
  const appliedKey = `${this.APPLIED_EDITS_KEY}_${this.templateId}`;
  const appliedEditsJson = sessionStorage.getItem(appliedKey);
  
  let appliedEdits: number[] = [];
  if (appliedEditsJson) {
    try {
      appliedEdits = JSON.parse(appliedEditsJson);
    } catch (error) {
      console.error('❌ [markEditAsApplied] Failed to parse:', error);
    }
  }
  
  if (!appliedEdits.includes(editIndex)) {
    appliedEdits.push(editIndex);
    sessionStorage.setItem(appliedKey, JSON.stringify(appliedEdits));
    console.log('💾 [markEditAsApplied] Marked edit', editIndex, 'as applied');
  }
}

/**
 * Checks if edit was already applied
 */
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

/**
 * Escapes special regex characters
 */
private escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gets count of pending (not applied) edits
 */
getPendingEditsCount(): number {
  return this.failedEdits.filter((_, index) => !this.isEditApplied(index)).length;
}
/**
 * Selects all text when double-clicked (for easy copy)
 */
selectText(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  
  if (window.getSelection && document.createRange) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection?.removeAllRanges();
    selection?.addRange(range);
    
    console.log('✅ [selectText] Text selected');
  }
}
}