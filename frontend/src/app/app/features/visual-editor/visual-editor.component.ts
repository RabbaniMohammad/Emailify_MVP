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

// ✅ Fixed: Import Mark.js properly for Angular
declare const Mark: any;

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

  // ✅ Mark.js instance for highlighting
  private markInstance: any = null;
  private currentHighlightedElements: HTMLElement[] = [];

  // ============================================
  // FLOATING SUGGESTIONS WIDGET PROPERTIES
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
    this.route.paramMap.subscribe(params => {
      this.templateId = params.get('id');
      
      if (this.templateId) {
        this.loadGoldenHtml(this.templateId);
        this.loadFailedEdits(this.templateId);
      }
    });
    
    this.restoreWidgetPosition();
    
    // ✅ Load Mark.js dynamically
    this.loadMarkJS();
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

  /**
   * ✅ Load Mark.js library dynamically
   */
  private loadMarkJS(): void {
    if (typeof Mark !== 'undefined') {
      return; // Already loaded
    }
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mark.js@8.11.1/dist/mark.min.js';
    script.onload = () => {
      console.log('✅ Mark.js loaded successfully');
    };
    script.onerror = () => {
      console.error('❌ Failed to load Mark.js');
    };
    document.head.appendChild(script);
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

  private loadGoldenHtml(templateId: string): void {
    const goldenKey = `visual_editor_${templateId}_golden_html`;
    const goldenHtml = sessionStorage.getItem(goldenKey);
    
    if (!goldenHtml) {
      alert('No template data found. Please generate golden template first.');
      this.router.navigate(['/qa', templateId]);
      return;
    }
    
    this.originalGoldenHtml = goldenHtml;
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
        
        if (this.originalGoldenHtml) {
          try {
            this.editor.setComponents(this.originalGoldenHtml);
          } catch (error) {
            this.restoreProgress();
          }
        } else {
          this.restoreProgress();
        }
        
        this.loading = false;
      });
      
      this.editor.on('update', () => {
        this.autoSave();
      });
      
    } catch (error) {
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

  // ============================================
  // FLOATING SUGGESTIONS WIDGET FUNCTIONS
  // ============================================

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
  // ✅ MARK.JS FIND & HIGHLIGHT SYSTEM
  // ============================================

  /**
   * ✅ CORRECTED: Apply suggestion with Mark.js highlighting
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
  
  if (typeof Mark === 'undefined') {
    this.showToast('Highlight library loading... Please try again', 'warning');
    return;
  }
  
  const iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
  if (!iframe || !iframe.contentDocument) {
    this.showToast('Editor iframe not found', 'error');
    return;
  }
  
  const iframeBody = iframe.contentDocument.body;
  
  this.clearHighlights();
  this.markInstance = new Mark(iframeBody);
  
  const searchText = edit.find;
  const replaceText = edit.replace;
  let matchCount = 0;
  const matchElements: HTMLElement[] = [];
  
  this.markInstance.mark(searchText, {
    separateWordSearch: false,
    accuracy: 'exactly',
    caseSensitive: false,
    className: 'ai-highlight',
    each: (element: HTMLElement) => {
      matchCount++;
      matchElements.push(element);
      
      const badge = document.createElement('span');
      badge.className = 'match-number-badge';
      badge.textContent = matchCount.toString();
      element.appendChild(badge);
      
      element.style.cursor = 'pointer';
      element.title = `Click to replace with: "${replaceText}"`;
      
      // ✅ FIX: Pass only THIS element, not all
      element.onclick = (e) => {
        e.stopPropagation();
        this.handleHighlightClick(element, replaceText, editIndex);
      };
    },
    done: () => {
      if (matchCount === 0) {
        this.showToast('❌ Text not found - May have been already edited', 'error');
        this.updateMarkerStatus(editIndex, 'failed');
      } else if (matchCount === 1) {
        this.showToast(`🔍 Found 1 match - Click to replace`, 'info');
        matchElements[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        this.showToast(`🔍 Found ${matchCount} matches - Click any to replace`, 'info');
        matchElements[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      this.currentHighlightedElements = matchElements;
    }
  });
}

  /**
   * ✅ NEW: Handle click on highlighted text
   */
/**
 * ✅ FIXED: Handle click on highlighted text - PRESERVES LAYOUT & CSS
 */
private handleHighlightClick(
  clickedElement: HTMLElement, 
  replaceText: string,
  editIndex: number
): void {
  // ✅ FIX: Check if THIS SINGLE element is cross-boundary
  if (this.isSingleElementCrossBoundary(clickedElement)) {
    this.showToast('⚠️ This text spans multiple elements - Please edit manually', 'warning');
    return;
  }
  
  // Remove badge from clicked element
  const badge = clickedElement.querySelector('.match-number-badge');
  if (badge) badge.remove();
  
  const originalText = clickedElement.textContent || '';
  
  // Replace in the text node
  const textNode = this.findTextNode(clickedElement, originalText);
  
  if (textNode) {
    textNode.textContent = replaceText;
    
    const iframe = document.querySelector('.gjs-frame') as HTMLIFrameElement;
    if (iframe && iframe.contentDocument) {
      const updatedHtml = iframe.contentDocument.body.innerHTML;
      this.editor.setComponents(updatedHtml);
    }
  } else {
    // Fallback: Replace in HTML
    const html = this.editor.getHtml();
    const escapedOriginal = originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const newHtml = html.replace(new RegExp(escapedOriginal, 'g'), replaceText);
    this.editor.setComponents(newHtml);
  }
  
  // ✅ Visual feedback - green flash
  clickedElement.style.background = '#4ade80';
  clickedElement.style.transition = 'all 0.3s';
  
  
  setTimeout(() => {
    // Unwrap only THIS mark element
    const parent = clickedElement.parentNode;
    if (parent) {
      while (clickedElement.firstChild) {
        parent.insertBefore(clickedElement.firstChild, clickedElement);
      }
      parent.removeChild(clickedElement);
    }
    
    // ✅ FIX: Don't clear all highlights, let user replace others
    // this.clearHighlights(); // ❌ REMOVED
  }, 1000);
  
  this.updateMarkerStatus(editIndex, 'success');
  this.markEditAsApplied(editIndex);
  
  this.showToast(`✅ Replaced with "${this.truncateText(replaceText, 30)}"`, 'success');
}

private isSingleElementCrossBoundary(element: HTMLElement): boolean {
  // Check if the highlighted text spans multiple parent elements
  // by checking if there are multiple text nodes or child elements
  
  const children = Array.from(element.childNodes);
  
  // If there are element nodes (not just text), it might be cross-boundary
  const hasElementChildren = children.some(child => {
    // ✅ FIX: Properly check if it's an HTMLElement before accessing classList
    if (child.nodeType === Node.ELEMENT_NODE) {
      const elementChild = child as HTMLElement;
      return !elementChild.classList?.contains('match-number-badge');
    }
    return false;
  });
  
  // If text is split across multiple nodes, it's cross-boundary
  const textNodes = children.filter(child => child.nodeType === Node.TEXT_NODE);
  
  return hasElementChildren || textNodes.length > 1;
}

/**
 * ✅ NEW HELPER: Find the actual text node within the marked element
 */
private findTextNode(element: HTMLElement, searchText: string): Text | null {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let node: Node | null;
  while (node = walker.nextNode()) {
    if (node.textContent?.includes(searchText)) {
      return node as Text;
    }
  }
  
  return null;
}

  /**
   * ✅ NEW: Check if highlighted elements are cross-boundary
   */
  // private isCrossBoundary(elements: HTMLElement[]): boolean {
  //   if (elements.length <= 1) return false;
    
  //   // Check if elements have different parents (cross-boundary indicator)
  //   const firstParent = elements[0].parentElement;
  //   return elements.some(el => el.parentElement !== firstParent);
  // }

  /**
   * ✅ NEW: Clear all highlights
   */
  private clearHighlights(): void {
    if (this.markInstance) {
      this.markInstance.unmark();
    }
    this.currentHighlightedElements = [];
  }

  /**
   * ✅ NEW: Show toast notification
   */
  private showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;
    
    let icon = '';
    let bgGradient = '';
    
    switch (type) {
      case 'success':
        icon = '✓';
        bgGradient = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        break;
      case 'error':
        icon = '✕';
        bgGradient = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        break;
      case 'warning':
        icon = '⚠';
        bgGradient = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        break;
      case 'info':
        icon = 'ℹ';
        bgGradient = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
        break;
    }
    
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${bgGradient};
      color: white;
      padding: 14px 20px;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      font-weight: 600;
      font-size: 14px;
      max-width: 400px;
      animation: slideInRight 0.3s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    
    toast.innerHTML = `
      <span style="font-size: 18px;">${icon}</span>
      <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    const duration = type === 'warning' ? 5000 : 3000;
    
    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * ✅ NEW: Truncate text for display
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * Navigate to next match
   */
  navigateToNextMatch(): void {
    if (this.currentHighlightedElements.length === 0) return;
    
    this.currentMatchIndex = (this.currentMatchIndex + 1) % this.currentHighlightedElements.length;
    const element = this.currentHighlightedElements[this.currentMatchIndex];
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    this.showToast(`Match ${this.currentMatchIndex + 1} of ${this.currentHighlightedElements.length}`, 'info');
  }

  /**
   * Navigate to previous match
   */
  navigateToPreviousMatch(): void {
    if (this.currentHighlightedElements.length === 0) return;
    
    this.currentMatchIndex = (this.currentMatchIndex - 1 + this.currentHighlightedElements.length) % this.currentHighlightedElements.length;
    const element = this.currentHighlightedElements[this.currentMatchIndex];
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    this.showToast(`Match ${this.currentMatchIndex + 1} of ${this.currentHighlightedElements.length}`, 'info');
  }

  /**
   * ✅ FIXED: Saves edited HTML and navigates back to QA page for preview
   */
  onCheckPreview(): void {
    if (!this.editor) {
      alert('Editor not initialized');
      return;
    }
    
    if (!this.templateId) {
      alert('Template ID not found');
      return;
    }
    
    const html = this.editor.getHtml();
    const css = this.editor.getCss();
    const fullHtml = `<style>${css}</style>${html}`;
    
    const editedKey = `visual_editor_${this.templateId}_edited_html`;
    sessionStorage.setItem(editedKey, fullHtml);
    
    const returnKey = `visual_editor_${this.templateId}_return_flag`;
    sessionStorage.setItem(returnKey, 'true');
    
    this.autoSave();
    this.router.navigate(['/qa', this.templateId]);
  }

  /**
   * Apply to current match (legacy support for multi-match navigation)
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
    
    // ✅ Update editor (preserves CSS)
    this.editor.setComponents(newHtml);
    
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
   * Helper: Escape special regex characters
   */
private escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  private storeEditorStateForUndo(): void {
    try {
      const html = this.editor.getHtml();
      const css = this.editor.getCss();
      
      const undoKey = `${this.EDITOR_CACHE_KEY}_undo`;
      sessionStorage.setItem(undoKey, JSON.stringify({ html, css, timestamp: Date.now() }));
    } catch (error) {
      console.error('Store undo state failed:', error);
    }
  }

  private updateMarkerStatus(editIndex: number, status: 'pending' | 'success' | 'failed'): void {
    const marker = this.textMarkers.find(m => m.editIndex === editIndex);
    if (marker) {
      marker.status = status;
    }
  }

  private markEditAsApplied(editIndex: number): void {
    if (!this.templateId) return;
    
    const appliedKey = `${this.APPLIED_EDITS_KEY}_${this.templateId}`;
    const appliedEditsJson = sessionStorage.getItem(appliedKey);
    
    let appliedEdits: number[] = [];
    if (appliedEditsJson) {
      try {
        appliedEdits = JSON.parse(appliedEditsJson);
      } catch (error) {}
    }
    
    if (!appliedEdits.includes(editIndex)) {
      appliedEdits.push(editIndex);
      sessionStorage.setItem(appliedKey, JSON.stringify(appliedEdits));
    }
  }

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