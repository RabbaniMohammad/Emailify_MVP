import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class PreviewCacheService {
  private cache = new Map<string, string>();
  private readonly STORAGE_KEY = 'template_preview_cache';
  private readonly MAX_CACHE_SIZE = 50;
  private readonly CACHE_EXPIRY = 3600000; // 1 hour in milliseconds
  
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  constructor() {
    if (this.isBrowser) {
      this.loadFromStorage();
    }
  }

  /**
   * Get cached HTML for a template ID
   */
  get(id: string): string | null {
    return this.cache.get(id) || null;
  }

  /**
   * Set cached HTML for a template ID
   */
  set(id: string, html: string): void {
    // Implement LRU cache - remove oldest if at capacity
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(id)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(id, html);
    if (this.isBrowser) {
      this.persistToStorage();
    }
  }

  /**
   * Clear cache for a specific template ID
   */
  clear(id: string): void {
    this.cache.delete(id);
    if (this.isBrowser) {
      this.persistToStorage();
    }
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
    if (this.isBrowser) {
      this.removeFromStorage();
    }
  }

  /**
   * Get cached item from persisted storage
   */
  getPersisted(id: string): string | null {
    if (!this.isBrowser) return null;
    
    try {
      const stored = localStorage.getItem(`${this.STORAGE_KEY}_${id}`);
      if (!stored) return null;

      const parsed = JSON.parse(stored);
      const now = Date.now();

      // Check if cache has expired
      if (now - parsed.timestamp > this.CACHE_EXPIRY) {
        localStorage.removeItem(`${this.STORAGE_KEY}_${id}`);
        return null;
      }

      return parsed.html;
    } catch (error) {
      console.warn('Error reading from localStorage:', error);
      return null;
    }
  }

  /**
   * Persist current cache to localStorage
   */
  private persistToStorage(): void {
    if (!this.isBrowser) return;
    
    try {
      const timestamp = Date.now();
      this.cache.forEach((html, id) => {
        const data = JSON.stringify({ html, timestamp });
        localStorage.setItem(`${this.STORAGE_KEY}_${id}`, data);
      });
    } catch (error) {
      console.warn('Error writing to localStorage:', error);
      // If localStorage is full, clear old cache
      this.cleanupOldCache();
    }
  }

  /**
   * Load cache from localStorage on initialization
   */
  private loadFromStorage(): void {
    if (!this.isBrowser) return;
    
    try {
      const now = Date.now();
      const keys = Object.keys(localStorage);
      
      keys.forEach(key => {
        if (key.startsWith(this.STORAGE_KEY)) {
          try {
            const stored = localStorage.getItem(key);
            if (!stored) return;

            const parsed = JSON.parse(stored);
            
            // Check if cache has expired
            if (now - parsed.timestamp > this.CACHE_EXPIRY) {
              localStorage.removeItem(key);
              return;
            }

            const id = key.replace(`${this.STORAGE_KEY}_`, '');
            this.cache.set(id, parsed.html);
          } catch (error) {
            // Remove corrupted cache entry
            localStorage.removeItem(key);
          }
        }
      });
    } catch (error) {
      console.warn('Error loading cache from localStorage:', error);
    }
  }

  /**
   * Remove all persisted cache from localStorage
   */
  private removeFromStorage(): void {
    if (!this.isBrowser) return;
    
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.STORAGE_KEY)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Error removing cache from localStorage:', error);
    }
  }

  /**
   * Clean up old cache entries from localStorage
   */
  private cleanupOldCache(): void {
    if (!this.isBrowser) return;
    
    try {
      const now = Date.now();
      const keys = Object.keys(localStorage);
      
      keys.forEach(key => {
        if (key.startsWith(this.STORAGE_KEY)) {
          try {
            const stored = localStorage.getItem(key);
            if (!stored) return;

            const parsed = JSON.parse(stored);
            
            // Remove if older than expiry time
            if (now - parsed.timestamp > this.CACHE_EXPIRY) {
              localStorage.removeItem(key);
            }
          } catch (error) {
            // Remove corrupted entry
            localStorage.removeItem(key);
          }
        }
      });
    } catch (error) {
      console.warn('Error cleaning up cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number; keys: string[] } {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      keys: Array.from(this.cache.keys())
    };
  }
}