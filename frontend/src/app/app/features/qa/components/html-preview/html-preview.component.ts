import { Component, Input, OnChanges, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-html-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="preview-wrap">
      <div class="skeleton-cover" *ngIf="loading" aria-hidden="true"></div>

      <!-- NG0910 fix: two static iframes -->
      <iframe
        *ngIf="allowScripts; else safeIframe"
        class="preview-frame"
        [attr.srcdoc]="safeSrcdoc"
        sandbox="allow-same-origin allow-scripts"
        referrerpolicy="no-referrer"
        (load)="loading=false">
      </iframe>

      <ng-template #safeIframe>
        <iframe
          class="preview-frame"
          [attr.srcdoc]="safeSrcdoc"
          sandbox="allow-same-origin"
          referrerpolicy="no-referrer"
          (load)="loading=false">
        </iframe>
      </ng-template>
    </div>
  `,
  styles: [`
    .preview-wrap{position:relative;border-radius:.5rem;overflow:hidden}
    .preview-frame{width:100%;height:calc(100vh - 180px);min-height:480px;border:1px solid rgba(0,0,0,.1);border-radius:.5rem;background:#fff;display:block}
    .skeleton-cover{position:absolute;inset:0;z-index:10;pointer-events:none;background:linear-gradient(90deg,rgba(238,238,238,.95) 25%,rgba(250,250,250,.95) 50%,rgba(238,238,238,.95) 75%);background-size:400% 100%;animation:shimmer 1.2s infinite linear}
    @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HtmlPreviewComponent implements OnChanges {
  @Input() html = '';
  @Input() loading = false;

  /** Optional: turn on to silence the console message locally. */
  @Input() allowScripts = false;

  safeSrcdoc: SafeHtml | null = null;

  constructor(private s: DomSanitizer) {}

  ngOnChanges() {
    this.loading = !!this.html;
    const doc = this.ensureDoc(this.html || '');
    const cleaned = this.stripDangerousBits(doc);
    this.safeSrcdoc = this.s.bypassSecurityTrustHtml(cleaned);
  }

  private ensureDoc(bodyOrDoc: string): string {
    const html = String(bodyOrDoc || '');
    const hasDoc = /<body[\s>]/i.test(html) || /<\/html>/i.test(html);
    if (hasDoc) return html;
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>';
  }

  private stripDangerousBits(docHtml: string): string {
    try {
      const doc = new DOMParser().parseFromString(docHtml, 'text/html');
      doc.querySelectorAll('script, iframe, base').forEach(n => n.remove());
      doc.querySelectorAll<HTMLElement>('*').forEach(el => {
        for (let i = el.attributes.length - 1; i >= 0; i--) {
          const a = el.attributes.item(i);
          if (a && /^on/i.test(a.name)) el.removeAttribute(a.name);
        }
      });
      return '<!doctype html>\n' + doc.documentElement.outerHTML;
    } catch {
      return docHtml
        .replace(/<script[\s\S]*?<\/script>/gi,'')
        .replace(/<base[\s\S]*?>/gi,'')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi,'');
    }
  }
}
