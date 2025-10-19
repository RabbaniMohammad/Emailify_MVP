import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import loader from '@monaco-editor/loader';
import type * as Monaco from 'monaco-editor';

type IStandaloneCodeEditor = Monaco.editor.IStandaloneCodeEditor;

@Component({
  selector: 'app-html-editor',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './html-editor.component.html',
  styleUrls: ['./html-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HtmlEditorComponent implements AfterViewInit, OnDestroy, OnChanges {
  // Use setter to initialize immediately when container becomes available
  @ViewChild('editorContainer', { static: false }) 
  set editorContainer(element: ElementRef<HTMLDivElement>) {
    if (element && !this._editorContainer) {
      this._editorContainer = element;
      // Initialize as soon as container is available
      setTimeout(() => this.initializeEditor(), 0);
    }
  }
  get editorContainer(): ElementRef<HTMLDivElement> | undefined {
    return this._editorContainer;
  }
  private _editorContainer?: ElementRef<HTMLDivElement>;

  @Input() initialHtml = '';
  @Output() htmlChanged = new EventEmitter<string>();
  @Output() editorClosed = new EventEmitter<void>();

  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  private editor: IStandaloneCodeEditor | null = null;
  private monaco: typeof Monaco | null = null;
  private originalHtml = '';
  private autoSaveInterval: any = null;
  private resizeObserver: ResizeObserver | null = null;

  isLoading = true;
  hasUnsavedChanges = false;
  currentLineCount = 0;
  isDarkTheme = true;
  
  // NEW: Flags to prevent re-initialization and suppress notifications
  private isInitializing = true;
  private isEditorReady = false;

  ngAfterViewInit(): void {
    // Initialization is handled by the ViewChild setter
    // This lifecycle hook is kept for Angular compatibility
  }

  // NEW: Handle input changes without re-initializing
  ngOnChanges(changes: SimpleChanges): void {
    // Only update editor content if it's already initialized and HTML changed
    if (changes['initialHtml'] && !changes['initialHtml'].firstChange && this.isEditorReady) {
      const newHtml = changes['initialHtml'].currentValue;
      if (this.editor && newHtml !== this.editor.getValue()) {
        this.editor.setValue(newHtml);
        this.originalHtml = newHtml;
        this.hasUnsavedChanges = false;
        this.cdr.markForCheck();
      }
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async initializeEditor(): Promise<void> {
    // UPDATED: Prevent multiple initializations
    if (this.editor || this.isLoading === false || this.isEditorReady) {
      return;
    }

    this.isInitializing = true;

    try {
      // Check if container exists
      if (!this._editorContainer?.nativeElement) {
        console.error('Editor container not found');
        this.isLoading = false;
        this.showError('Editor container not ready');
        this.cdr.markForCheck();
        return;
      }

      // Configure Monaco loader to use CDN
      loader.config({
        paths: {
          vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs',
        },
      });

      // Load Monaco
      this.monaco = await loader.init();

      // Restore auto-saved content if exists
      const autoSaved = this.checkForAutoSave();
      const initialValue = autoSaved || this.initialHtml;

      // Create editor instance
      this.editor = this.monaco.editor.create(this._editorContainer.nativeElement, {
        value: initialValue,
        language: 'html',
        theme: this.isDarkTheme ? 'vs-dark' : 'vs',
        automaticLayout: true,
        minimap: {
          enabled: window.innerWidth > 768,
        },
        fontSize: 14,
        lineNumbers: 'on',
        wordWrap: 'on',
        formatOnPaste: true,
        formatOnType: false, // CHANGED: Disable to prevent unwanted format triggers
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        renderWhitespace: 'selection',
        folding: true,
        bracketPairColorization: {
          enabled: true,
        },
        suggest: {
          snippetsPreventQuickSuggestions: false,
        },
        quickSuggestions: {
          other: true,
          strings: true,
        },
      });

      this.originalHtml = initialValue;
      this.updateLineCount();

      this.setupEventListeners();
      this.setupKeyboardShortcuts();
      this.setupAutoSave();
      this.setupResizeObserver();

      // UPDATED: Format silently on initialization
      setTimeout(() => {
        if (this.editor) {
          // Format without showing notification
          this.editor.getAction('editor.action.formatDocument')?.run();
        }
        this.isInitializing = false;
        this.isEditorReady = true;
      }, 500);

      this.isLoading = false;
      this.cdr.markForCheck();

      if (autoSaved) {
        this.showInfo('Restored auto-saved changes');
      }
    } catch (error) {
      console.error('Failed to initialize Monaco Editor:', error);
      this.showError('Failed to load editor. Please refresh the page.');
      this.isLoading = false;
      this.isInitializing = false;
      this.cdr.markForCheck();
    }
  }

  private setupEventListeners(): void {
    if (!this.editor) return;

    this.editor.onDidChangeModelContent(() => {
      const currentValue = this.editor?.getValue() || '';
      this.hasUnsavedChanges = currentValue !== this.originalHtml;
      this.updateLineCount();
      this.cdr.markForCheck();
    });

    this.editor.onDidChangeCursorPosition(() => {
      this.cdr.markForCheck();
    });
  }

  private setupKeyboardShortcuts(): void {
    if (!this.editor || !this.monaco) return;

    this.editor.addCommand(
      this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyS,
      () => {
        this.onSave();
      }
    );

    this.editor.addCommand(
      this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.KeyF,
      () => {
        this.formatDocument();
      }
    );

    this.editor.addCommand(this.monaco.KeyCode.Escape, () => {
      this.onClose();
    });
  }

  private setupAutoSave(): void {
    this.autoSaveInterval = setInterval(() => {
      if (this.hasUnsavedChanges && this.editor) {
        const content = this.editor.getValue();
        this.autoSave(content);
      }
    }, 30000);
  }

  private setupResizeObserver(): void {
    if (!this._editorContainer?.nativeElement) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.editor?.layout();
    });

    this.resizeObserver.observe(this._editorContainer.nativeElement);
  }

  private updateLineCount(): void {
    if (!this.editor) return;
    const model = this.editor.getModel();
    this.currentLineCount = model ? model.getLineCount() : 0;
  }

  private autoSave(html: string): void {
    try {
      localStorage.setItem('html_editor_autosave', html);
      localStorage.setItem('html_editor_autosave_time', Date.now().toString());
    } catch (error) {
    }
  }

  private checkForAutoSave(): string | null {
    try {
      const saved = localStorage.getItem('html_editor_autosave');
      const savedTime = localStorage.getItem('html_editor_autosave_time');
      
      if (!saved || !savedTime) return null;

      const timeDiff = Date.now() - parseInt(savedTime, 10);
      const oneHour = 60 * 60 * 1000;

      if (timeDiff > oneHour) {
        this.clearAutoSave();
        return null;
      }

      return saved;
    } catch {
      return null;
    }
  }

  private clearAutoSave(): void {
    try {
      localStorage.removeItem('html_editor_autosave');
      localStorage.removeItem('html_editor_autosave_time');
    } catch {
      // Ignore
    }
  }

  // UPDATED: Only show notification when manually formatting
  formatDocument(): void {
    if (!this.editor) return;

    this.editor.getAction('editor.action.formatDocument')?.run();
    
    // Only show notification if not initializing
    if (!this.isInitializing) {
      this.showInfo('Document formatted');
    }
  }

  toggleTheme(): void {
    if (!this.monaco || !this.editor) return;

    this.isDarkTheme = !this.isDarkTheme;
    this.monaco.editor.setTheme(this.isDarkTheme ? 'vs-dark' : 'vs');
    this.cdr.markForCheck();
  }

  onSave(): void {
    if (!this.editor || !this.hasUnsavedChanges) return;

    const newHtml = this.editor.getValue();

    if (!this.isValidHtml(newHtml)) {
      this.showError('Invalid HTML detected. Please fix errors before saving.');
      return;
    }

    if (this.containsDangerousCode(newHtml)) {
      if (!confirm('This HTML contains potentially dangerous code (scripts). Continue?')) {
        return;
      }
    }

    this.htmlChanged.emit(newHtml);
    this.originalHtml = newHtml;
    this.hasUnsavedChanges = false;
    this.clearAutoSave();
    this.cdr.markForCheck();

    this.showSuccess('Changes saved successfully!');
  }

  onRevert(): void {
    if (!this.editor || !this.hasUnsavedChanges) return;

    // if (confirm('Discard all changes and revert to original?')) {
      this.editor.setValue(this.originalHtml);
      this.hasUnsavedChanges = false;
      this.clearAutoSave();
      this.cdr.markForCheck();
      this.showInfo('Changes reverted');
    // }
  }

  onClose(): void {
    if (this.hasUnsavedChanges) {
      if (confirm('You have unsaved changes. Close editor anyway?')) {
        this.clearAutoSave();
        this.editorClosed.emit();
      }
    } else {
      this.clearAutoSave();
      this.editorClosed.emit();
    }
  }

  private isValidHtml(html: string): boolean {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const parserErrors = doc.querySelectorAll('parsererror');
      return parserErrors.length === 0;
    } catch {
      return false;
    }
  }

  private containsDangerousCode(html: string): boolean {
    const dangerous = /<script|javascript:|onerror=|onload=/i;
    return dangerous.test(html);
  }

  // UPDATED: Reset flags on cleanup
  private cleanup(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }

    this.isEditorReady = false;
    this.isInitializing = true;
  }

  getCursorInfo(): string {
    if (!this.editor) return '';

    const position = this.editor.getPosition();
    if (!position) return '';

    return `Ln ${position.lineNumber}, Col ${position.column}`;
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

  private showInfo(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 2000,
      panelClass: ['info-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}