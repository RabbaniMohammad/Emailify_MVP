import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  OnDestroy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { PreviewCacheService } from './preview-cache.service';

@Component({
  selector: 'app-template-preview',
  standalone: true,
  imports: [CommonModule, HttpClientModule], // HttpClient needed for prefetch
  templateUrl: './template-preview.component.html',
  styleUrls: ['./template-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatePreviewComponent implements OnChanges, OnDestroy {
  @Input() id?: string;
  @Input() name?: string;

  /** Emits when the iframe has finished loading for the current id. */
  @Output() ready = new EventEmitter<string>();

  // UI state
  mode: 'iframe' | 'empty' = 'empty';
  loading = false;
  error?: string;
  src: SafeResourceUrl | null = null;

  // internals
  private objectUrl: string | null = null;     // blob:url for cached HTML
  private prefetchSub?: Subscription;          // cancels background prefetch

  constructor(
    private sanitizer: DomSanitizer,
    private http: HttpClient,
    private cache: PreviewCacheService
  ) {}

  ngOnChanges(_: SimpleChanges) {
    // reset & cleanup
    this.error = undefined;
    this.loading = false;
    this.src = null;
    this.mode = 'empty';
    this.revokeObjectUrl();
    this.prefetchSub?.unsubscribe();

    if (!this.id) return;

    // 1) Serve from cache (iframe via Blob) if available
    const cached = this.cache.get(this.id) || this.cache.getPersisted(this.id);
    if (cached) {
      this.setIframeFromHtml(cached);
      return;
    }

    // 2) First time (or expired): show skeleton + live iframe
    this.mode = 'iframe';
    this.loading = true;
    this.src = this.sanitizer.bypassSecurityTrustResourceUrl(`/api/templates/${this.id}/raw`);

    // 3) Prefetch the HTML (text) in parallel and cache it for next time
    this.prefetchSub = this.http
      .get(`/api/templates/${this.id}/raw`, { responseType: 'text' })
      .subscribe({
        next: (text) => {
          if (this.id) this.cache.set(this.id, text || '');
        },
        error: () => {
          // ignore; live iframe still renders
        },
      });
  }

  onIframeLoad() {
    this.loading = false;
    if (this.id) this.ready.emit(this.id);
  }

  // Note: <iframe> has limited error signaling across browsers; hook left for completeness.
  onIframeError() {
    this.loading = false;
    this.error = 'Failed to load preview.';
  }

  ngOnDestroy(): void {
    this.prefetchSub?.unsubscribe();
    this.revokeObjectUrl();
  }

  // ---- helpers ----
  private setIframeFromHtml(html: string) {
    this.mode = 'iframe';
    this.loading = true; // full-cover skeleton hides until iframe paints
    const blob = new Blob([html], { type: 'text/html' });
    this.objectUrl = URL.createObjectURL(blob);
    this.src = this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl);
  }

  private revokeObjectUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
