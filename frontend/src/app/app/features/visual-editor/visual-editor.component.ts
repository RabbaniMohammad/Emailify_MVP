import { Component, OnInit, OnDestroy, ViewChild, ElementRef, inject, AfterViewInit, ViewEncapsulation } from '@angular/core';
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
  encapsulation: ViewEncapsulation.None
})
export class VisualEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('editorContainer', { static: false }) editorContainer!: ElementRef;
  
  private router = inject(Router);
  private cacheService = inject(CacheService);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  
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
    } else {
      console.warn('⚠️ [ngOnInit] No template ID in route');
    }
  });
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
}