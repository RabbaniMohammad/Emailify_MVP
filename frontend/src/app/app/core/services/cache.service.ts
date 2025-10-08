import { Injectable } from '@angular/core';

/**
 * Cached data with expiration
 */
interface CachedData<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

/**
 * Cache storage options
 */
type StorageType = 'memory' | 'session' | 'local';

/**
 * Production-grade caching service with multiple storage tiers
 * 
 * Features:
 * - Memory cache (fastest, cleared on page refresh)
 * - SessionStorage (survives refresh, cleared on tab close)
 * - LocalStorage (persistent, survives browser close)
 * - Automatic expiration (TTL)
 * - Type-safe
 */
@Injectable({
  providedIn: 'root'
})
export class CacheService {
  private memoryCache = new Map<string, CachedData<any>>();

  /**
   * Set data in cache with TTL
   * @param key Cache key
   * @param data Data to cache
   * @param ttl Time to live in milliseconds
   * @param storage Storage type (memory, session, local)
   */
  set<T>(
    key: string, 
    data: T, 
    ttl: number = 5 * 60 * 1000, // Default 5 minutes
    storage: StorageType = 'memory'
  ): void {
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
      ttl
    };

    // Always store in memory for fastest access
    this.memoryCache.set(key, cached);

    // Also store in session/local storage if requested
    if (storage === 'session' || storage === 'local') {
      try {
        const storageObj = storage === 'session' ? sessionStorage : localStorage;
        storageObj.setItem(key, JSON.stringify(cached));
      } catch (error) {
        console.warn(`Failed to store ${key} in ${storage}Storage:`, error);
      }
    }
  }

  /**
   * Get data from cache if not expired
   * @param key Cache key
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string): T | null {
    // 1. Try memory cache first (fastest)
    let cached: CachedData<T> | null = this.memoryCache.get(key) as CachedData<T> | undefined || null;

    // 2. If not in memory, try sessionStorage
    if (!cached) {
      cached = this.getFromStorage<T>(key, sessionStorage);
      if (cached) {
        // Restore to memory for faster future access
        this.memoryCache.set(key, cached);
      }
    }

    // 3. If still not found, try localStorage
    if (!cached) {
      cached = this.getFromStorage<T>(key, localStorage);
      if (cached) {
        // Restore to memory for faster future access
        this.memoryCache.set(key, cached);
      }
    }

    // 4. Check if data is still fresh
    if (cached && this.isFresh(cached)) {
      return cached.data;
    }

    // Data not found or expired
    if (cached) {
      this.invalidate(key); // Clean up expired data
    }
    
    return null;
  }

  /**
   * Check if cache has fresh data for a key
   * @param key Cache key
   * @returns true if cache exists and is fresh
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get cached data even if expired (for stale-while-revalidate pattern)
   * @param key Cache key
   * @returns Cached data or null if not found
   */
  getStale<T>(key: string): T | null {
    let cached: CachedData<T> | null = this.memoryCache.get(key) as CachedData<T> | undefined || null;
    
    if (!cached) {
      cached = this.getFromStorage<T>(key, sessionStorage);
    }
    
    if (!cached) {
      cached = this.getFromStorage<T>(key, localStorage);
    }

    return cached ? cached.data : null;
  }

  /**
   * Invalidate (remove) a specific cache entry
   * @param key Cache key
   */
  invalidate(key: string): void {
    this.memoryCache.delete(key);
    
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Failed to remove ${key} from storage:`, error);
    }
  }

  /**
   * Clear all cache entries matching a prefix
   * @param prefix Key prefix (e.g., 'template-')
   */
  invalidatePrefix(prefix: string): void {
    // Clear from memory
    const keysToDelete: string[] = [];
    this.memoryCache.forEach((_, key) => {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.memoryCache.delete(key));

    // Clear from sessionStorage
    this.clearStorageByPrefix(prefix, sessionStorage);
    
    // Clear from localStorage
    this.clearStorageByPrefix(prefix, localStorage);
  }

  /**
   * Clear all caches (use on logout)
   * @param keepLocalStorage If true, keeps localStorage (for user preferences)
   */
  clearAll(keepLocalStorage: boolean = false): void {
    // Clear memory cache
    this.memoryCache.clear();

    // Clear sessionStorage
    try {
      sessionStorage.clear();
    } catch (error) {
      console.warn('Failed to clear sessionStorage:', error);
    }

    // Clear localStorage if requested
    if (!keepLocalStorage) {
      try {
        localStorage.clear();
      } catch (error) {
        console.warn('Failed to clear localStorage:', error);
      }
    }
  }

  /**
   * Clear only user-specific data (use on logout, keep preferences)
   * @param userSpecificPrefixes Array of prefixes for user-specific data
   */
  clearUserData(userSpecificPrefixes: string[] = ['template-', 'user-', 'last-']): void {
    // Clear memory cache
    this.memoryCache.clear();

    // Clear sessionStorage completely
    try {
      sessionStorage.clear();
    } catch (error) {
      console.warn('Failed to clear sessionStorage:', error);
    }

    // Clear only user-specific items from localStorage
    userSpecificPrefixes.forEach(prefix => {
      this.clearStorageByPrefix(prefix, localStorage);
    });
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats(): {
    memorySize: number;
    sessionSize: number;
    localSize: number;
  } {
    return {
      memorySize: this.memoryCache.size,
      sessionSize: this.getStorageSize(sessionStorage),
      localSize: this.getStorageSize(localStorage)
    };
  }

  // ========== Private Helper Methods ==========

  /**
   * Check if cached data is still fresh
   */
  private isFresh<T>(cached: CachedData<T>): boolean {
    return Date.now() - cached.timestamp < cached.ttl;
  }

  /**
   * Get data from storage (sessionStorage or localStorage)
   */
  private getFromStorage<T>(key: string, storage: Storage): CachedData<T> | null {
    try {
      const item = storage.getItem(key);
      if (!item) return null;

      return JSON.parse(item) as CachedData<T>;
    } catch (error) {
      console.warn(`Failed to parse ${key} from storage:`, error);
      // Clean up corrupted data
      try {
        storage.removeItem(key);
      } catch {}
      return null;
    }
  }

  /**
   * Clear storage entries by prefix
   */
  private clearStorageByPrefix(prefix: string, storage: Storage): void {
    try {
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => storage.removeItem(key));
    } catch (error) {
      console.warn(`Failed to clear storage by prefix ${prefix}:`, error);
    }
  }

  /**
   * Get storage size (number of items)
   */
  private getStorageSize(storage: Storage): number {
    try {
      return storage.length;
    } catch {
      return 0;
    }
  }
}