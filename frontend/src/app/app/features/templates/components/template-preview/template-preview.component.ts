import { Component, ChangeDetectionStrategy, ChangeDetectorRef, Input, OnDestroy, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { PreviewCacheService } from './preview-cache.service';

type ViewMode = 'desktop' | 'tablet' | 'mobile';

@Component({
  selector: 'app-template-preview',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './template-preview.component.html',
  styleUrls: ['./template-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePreviewComponent implements OnChanges, OnDestroy {
  @Input() id?: string;
  @Input() name?: string;
  @Input() allowScripts = false;
  @Input() hideHeader: boolean = false;

  @Output() ready = new EventEmitter<string>();

  loading = false;
  error?: string;
  safeSrcdoc: SafeHtml | null = null;
  viewMode: ViewMode = 'desktop';
  isFullscreen = false;

  private fetchSub?: Subscription;

  constructor(
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    private cache: PreviewCacheService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(_: SimpleChanges) {
    this.error = undefined;
    this.loading = false;
    this.safeSrcdoc = null;
    this.fetchSub?.unsubscribe();

    if (!this.id) return;

    const cached = this.cache.get(this.id) || this.cache.getPersisted(this.id);
    if (cached) {
      this.setFromHtml(cached);
      this.cdr.markForCheck();
      return;
    }

    this.loading = true;
    this.cdr.markForCheck();
    this.fetchSub = this.http
      .get(`/api/templates/${this.id}/raw`, { responseType: 'text' })
      .subscribe({
        next: (text) => {
          if (!this.id) return;
          const html = text || '';
          this.cache.set(this.id, html);
          this.setFromHtml(html);
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.loading = false;
          this.error = e?.message || 'Failed to load preview.';
          this.cdr.markForCheck();
        },
      });
  }

  onIframeLoad() {
    this.loading = false;
    this.cdr.markForCheck();
    if (this.id) this.ready.emit(this.id);
  }

  changeViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.cdr.markForCheck();
  }

  refresh() {
    if (!this.id) return;
    this.cache.clear(this.id);
    this.ngOnChanges({});
  }

  toggleFullscreen() {
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

  ngOnDestroy(): void {
    this.fetchSub?.unsubscribe();
  }

  private setFromHtml(rawHtml: string) {
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