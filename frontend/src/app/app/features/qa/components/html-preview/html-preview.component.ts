import { Component, Input, OnChanges, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-html-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="preview-wrap">
      <div class="skeleton-cover" *ngIf="loading || internalLoading" aria-hidden="true"></div>
      <iframe class="preview-frame" [src]="src" (load)="internalLoading=false"></iframe>
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
export class HtmlPreviewComponent implements OnChanges, OnDestroy {
  @Input() html = '';
  @Input() loading = false;

  src: SafeResourceUrl | null = null;
  internalLoading = false;
  private objectUrl: string | null = null;

  constructor(private s: DomSanitizer) {}

  ngOnChanges() {
    // reset overlay each time html changes
    this.internalLoading = !!this.html;
    this.revoke();
    if (!this.html) { this.src = null; return; }
    const blob = new Blob([this.html], { type: 'text/html' });
    this.objectUrl = URL.createObjectURL(blob);
    this.src = this.s.bypassSecurityTrustResourceUrl(this.objectUrl);
  }

  ngOnDestroy() {
    this.revoke();
  }

  private revoke() {
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
  }
}
