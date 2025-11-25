import { 
  Component, 
  Input, 
  Output, 
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy, 
  inject, 
  ChangeDetectorRef,
  ContentChild,
  TemplateRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { trigger, state, style, transition, animate } from '@angular/animations';

import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { MatMenuModule } from '@angular/material/menu'; // ✅ ADD THIS
import { MatDividerModule } from '@angular/material/divider';

export type ViewMode = 'desktop' | 'tablet' | 'mobile';

@Component({
  selector: 'app-template-preview-panel',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    FormsModule,           
    MatFormFieldModule,    
    MatInputModule,
    MatMenuModule,
    MatDividerModule          
  ],
  templateUrl: './template-preview-panel.component.html',
  styleUrls: ['./template-preview-panel.component.scss'],
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
        style({ opacity: 0, transform: 'scale(0.3)' }),
        animate('300ms ease-in', style({ opacity: 1, transform: 'scale(1.05)' })),
        animate('100ms ease-out', style({ transform: 'scale(1)' }))
      ])
    ])
  ]
})
export class TemplatePreviewPanelComponent implements OnChanges {
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);

  // Inputs
  @Input() html: string = '';
  @Input() templateName?: string;
  @Input() templateId?: string;
  @Input() showHeader = true;
  @Input() loading = false; // ✅ Parent controls loading state (e.g., isGenerating$)
  @Input() hideHeader: boolean = false;
  @Input() allowRefresh = true;
  @Input() allowFullscreen = true;
  @Input() allowViewModes = true;
  @Input() showGenerateActions = false;  
  @Input() isGeneratePage = false;
  @Input() headerTitle?: string; // Optional custom header title
  @Input() saveActionLabel?: string; // Optional custom save action label (defaults to "Save Template")
  
  // Internal loading state (only used when parent doesn't control loading)
  private internalLoading = false; 

  @Output() saveTemplate = new EventEmitter<void>();
  @Output() runTests = new EventEmitter<void>();
  @Output() templateNameChange = new EventEmitter<string>();

  // Outputs
  @Output() refresh = new EventEmitter<void>();

  // ⭐ NEW: Accept custom header template
  @ContentChild('customHeader') customHeaderTemplate?: TemplateRef<any>;

  // Component state
  viewMode: ViewMode = 'desktop';
  isFullscreen = false;
  safeSrcdoc: SafeHtml | null = null;
  previewError?: string;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['html'] && this.html) {
      this.setFromHtml(this.html);
    }
  }

  changeViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.cdr.markForCheck();
  }

  onSaveTemplate(): void {
    this.saveTemplate.emit();
  }
  onTemplateNameChange(newName: string): void {
  this.templateNameChange.emit(newName);
}
  
  onRunTests(): void {
    this.runTests.emit();
  }

toggleFullscreen(): void {
  const element = document.querySelector('.preview-root') as HTMLElement;
  
  if (!element) {

    return;
  }

  if (!this.isFullscreen) {
    if (element.requestFullscreen) {
      element.requestFullscreen().then(() => {
        this.isFullscreen = true;
        this.cdr.markForCheck();
        
        // 🔧 FIX: Move overlay container inside fullscreen element
        setTimeout(() => {
          const overlayContainer = document.querySelector('.cdk-overlay-container');
          if (overlayContainer && document.fullscreenElement) {
            document.fullscreenElement.appendChild(overlayContainer);
          }
        }, 100);
      });
    }
  } else {
    // 🔧 FIX: Restore overlay container to body before exiting
    const overlayContainer = document.querySelector('.cdk-overlay-container');
    if (overlayContainer && overlayContainer.parentElement !== document.body) {
      document.body.appendChild(overlayContainer);
    }
    
    if (document.exitFullscreen) {
      document.exitFullscreen().then(() => {
        this.isFullscreen = false;
        this.cdr.markForCheck();
      });
    }
  }
}
  onRefresh(): void {
    if (this.html) {
      this.setFromHtml(this.html);
    }
    this.refresh.emit();
    this.cdr.markForCheck();
  }

  onIframeLoad(): void {
    // ✅ Only update internal loading, don't override parent's loading input
    this.internalLoading = false;
    this.cdr.markForCheck();
  }

  private setFromHtml(rawHtml: string): void {
    const wrapped = this.ensureDoc(rawHtml);
    const cleaned = this.stripDangerousBits(wrapped);
    this.safeSrcdoc = this.sanitizer.bypassSecurityTrustHtml(cleaned);
    
    // ✅ Set internal loading only (parent's @Input loading takes precedence in template)
    this.internalLoading = true;
    
    // ✅ Fallback timeout for internal loading only
    setTimeout(() => {
      if (this.internalLoading) {
        this.internalLoading = false;
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