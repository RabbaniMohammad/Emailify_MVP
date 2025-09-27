import { Injectable } from '@angular/core';

type CacheEntry = { html: string; at: number };
const TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable({ providedIn: 'root' })
export class PreviewCacheService {
  private mem = new Map<string, CacheEntry>();

  get(id: string): string | null {
    const hit = this.mem.get(id);
    if (!hit) return null;
    if (Date.now() - hit.at > TTL_MS) {
      this.mem.delete(id);
      return null;
    }
    return hit.html;
  }

  set(id: string, html: string): void {
    this.mem.set(id, { html, at: Date.now() });
    // persist a small LRU-ish snapshot so it survives route changes / refresh
    try {
      localStorage.setItem('previewCache:' + id, html);
      localStorage.setItem('previewCache:' + id + ':at', String(Date.now()));
    } catch {}
  }

  getPersisted(id: string): string | null {
    try {
      const at = Number(localStorage.getItem('previewCache:' + id + ':at') || 0);
      const html = localStorage.getItem('previewCache:' + id) || '';
      if (!at || !html) return null;
      if (Date.now() - at > TTL_MS) return null;
      return html;
    } catch {
      return null;
    }
  }
}
