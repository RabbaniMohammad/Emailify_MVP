import { Injectable, inject } from '@angular/core';
import { CacheService } from '../../../../core/services/cache.service';


const CACHE_PREFIX = 'template-preview-';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes for template HTML content

/**
 * Service for caching template preview HTML
 * Uses the generic CacheService with sessionStorage
 */
@Injectable({
  providedIn: 'root'
})
export class PreviewCacheService {
  private cache = inject(CacheService);

  /**
   * Store template HTML in cache
   * @param templateId Template ID
   * @param html Template HTML content
   */
  set(templateId: string, html: string): void {
    const key = this.getCacheKey(templateId);
    // Store in sessionStorage (survives refresh, cleared on logout/tab close)
    this.cache.set(key, html, CACHE_TTL, 'session');
  }

  /**
   * Get cached template HTML
   * @param templateId Template ID
   * @returns Cached HTML or null if not found/expired
   */
  get(templateId: string): string | null {
    const key = this.getCacheKey(templateId);
    return this.cache.get<string>(key);
  }

  /**
   * Get cached template HTML even if expired (for offline fallback)
   * @param templateId Template ID
   * @returns Cached HTML or null if not found
   */
  getPersisted(templateId: string): string | null {
    const key = this.getCacheKey(templateId);
    return this.cache.getStale<string>(key);
  }

  /**
   * Check if template has cached HTML
   * @param templateId Template ID
   * @returns true if cache exists and is fresh
   */
  has(templateId: string): boolean {
    const key = this.getCacheKey(templateId);
    return this.cache.has(key);
  }

  /**
   * Clear cache for a specific template
   * @param templateId Template ID
   */
  clear(templateId: string): void {
    const key = this.getCacheKey(templateId);
    this.cache.invalidate(key);
  }

  /**
   * Clear all template preview caches
   */
  clearAll(): void {
    this.cache.invalidatePrefix(CACHE_PREFIX);
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats() {
    return this.cache.getStats();
  }

  // ========== Private Methods ==========

  /**
   * Generate cache key for template
   */
  private getCacheKey(templateId: string): string {
    return `${CACHE_PREFIX}${templateId}`;
  }
}