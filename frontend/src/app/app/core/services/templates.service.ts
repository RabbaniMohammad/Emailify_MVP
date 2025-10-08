import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { CacheService } from './cache.service';

// Interfaces
export interface TemplateItem {
  id: string;
  name: string;
  content?: string;
}

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

export interface TemplatesState {
  items: TemplateItem[];
  status: LoadingStatus;
  error: string | null;
  selectedId: string | null;
  selectedName: string | null;
}

const INITIAL_STATE: TemplatesState = {
  items: [],
  status: 'idle',
  error: null,
  selectedId: null,
  selectedName: null,
};

// Cache configuration
const CACHE_KEYS = {
  TEMPLATES_LIST: 'templates-list',
  SEARCH_PREFIX: 'templates-search-',
  SELECTED: 'templates-selected',
};

const CACHE_TTL = {
  LIST: 2 * 60 * 1000,      // 2 minutes for template list
  SEARCH: 5 * 60 * 1000,    // 5 minutes for search results
  SELECTED: 30 * 60 * 1000, // 30 minutes for selected template
};

@Injectable({
  providedIn: 'root',
})
export class TemplatesService {
  private http = inject(HttpClient);
  private cache = inject(CacheService);

  private state = new BehaviorSubject<TemplatesState>(INITIAL_STATE);
  public readonly state$ = this.state.asObservable();

  // Track current search query to avoid duplicate requests
  private currentSearchQuery = '';

  constructor() {
    // Restore selected template from sessionStorage on service init
    this.restoreSelection();
  }

  /**
   * Get current state snapshot
   */
  get snapshot(): TemplatesState {
    return this.state.getValue();
  }

  /**
   * Select a template
   */
  select(id: string, name: string): void {
    this.updateState({ 
      selectedId: id, 
      selectedName: name 
    });

    // Store in sessionStorage (survives refresh, cleared on tab close)
    if (id && name) {
      this.cache.set(
        CACHE_KEYS.SELECTED,
        { id, name },
        CACHE_TTL.SELECTED,
        'session'
      );
    } else {
      this.cache.invalidate(CACHE_KEYS.SELECTED);
    }
  }

  /**
   * Search templates with caching
   * @param query Search query (empty string = load all)
   */
  search(query: string = ''): void {
    const trimmedQuery = query.trim().toLowerCase();
    
    // Avoid duplicate requests for same query
    if (this.currentSearchQuery === trimmedQuery && this.snapshot.status === 'loading') {
      return;
    }

    this.currentSearchQuery = trimmedQuery;
    const cacheKey = trimmedQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${trimmedQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;

    // Check cache first
    const cached = this.cache.get<TemplateItem[]>(cacheKey);
    
    // ✅ FIX: Only use cache if it has actual data
    if (cached && cached.length > 0) {
      // Use cached data immediately
      console.log('✅ Using cached templates:', cached.length);
      this.updateState({ 
        items: cached, 
        status: 'success',
        error: null 
      });
      
      // Optionally: fetch fresh data in background (stale-while-revalidate)
      // Uncomment if you want background refresh:
      // this.fetchTemplatesInBackground(query, cacheKey);
      
      return;
    }

    // No cache or cache is empty - fetch from backend
    console.log('📡 Fetching templates from backend...');
    this.fetchTemplates(query, cacheKey);
  }

  /**
   * Refresh templates (force reload from backend)
   */
  refresh(): void {
    // Invalidate cache for current query
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    this.cache.invalidate(cacheKey);
    
    // Fetch fresh data
    this.fetchTemplates(this.currentSearchQuery, cacheKey);
  }

  /**
   * Check if we have fresh cached data
   */
  hasFreshCache(): boolean {
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    return this.cache.has(cacheKey);
  }

  /**
   * Clear all template-related caches
   */
  clearCache(): void {
    this.cache.invalidatePrefix('templates-');
  }

  // ========== Private Methods ==========

  /**
   * Fetch templates from backend
   */
  private fetchTemplates(query: string, cacheKey: string): void {
    this.updateState({ status: 'loading', error: null });

    const endpoint = '/api/templates';

    this.http.get<{ items: TemplateItem[]; total: number }>(endpoint)
      .pipe(
        tap(response => {
          let items = response.items || [];
          
          // Apply client-side search filter if query exists
          if (query) {
            const lowerQuery = query.toLowerCase();
            items = items.filter(item => 
              item.name?.toLowerCase().includes(lowerQuery) ||
              item.id?.toLowerCase().includes(lowerQuery)
            );
          }
          
          // Only cache if we have actual data
          if (items.length > 0) {
            const ttl = query ? CACHE_TTL.SEARCH : CACHE_TTL.LIST;
            this.cache.set(cacheKey, items, ttl, 'session');
            console.log('💾 Cached', items.length, 'templates');
          } else {
            console.warn('⚠️ No templates to cache');
          }
          
          this.updateState({ 
            items, 
            status: 'success',
            error: null 
          });
        }),
        catchError(error => {
          console.error('Failed to fetch templates:', error);
          
          // Try to use stale cache as fallback
          const stale = this.cache.getStale<TemplateItem[]>(cacheKey);
          
          if (stale && stale.length > 0) {
            console.warn('Using stale cache due to network error');
            this.updateState({ 
              items: stale, 
              status: 'success',
              error: 'Showing cached data (offline)' 
            });
          } else {
            this.updateState({ 
              status: 'error',
              error: error.message || 'Failed to load templates' 
            });
          }
          
          return throwError(() => error);
        }),
        finalize(() => {
          // Loading complete
        })
      )
      .subscribe();
  }

  /**
   * Fetch fresh data in background (for stale-while-revalidate)
   */
  private fetchTemplatesInBackground(query: string, cacheKey: string): void {
    const endpoint = '/api/templates';

    this.http.get<{ items: TemplateItem[]; total: number }>(endpoint)
      .pipe(
        tap(response => {
          let items = response.items || [];
          
          // Apply client-side search filter if query exists
          if (query) {
            const lowerQuery = query.toLowerCase();
            items = items.filter(item => 
              item.name?.toLowerCase().includes(lowerQuery) ||
              item.id?.toLowerCase().includes(lowerQuery)
            );
          }
          
          const ttl = query ? CACHE_TTL.SEARCH : CACHE_TTL.LIST;
          
          // Update cache silently
          this.cache.set(cacheKey, items, ttl, 'session');
          
          // Update state if data changed
          if (JSON.stringify(items) !== JSON.stringify(this.snapshot.items)) {
            this.updateState({ 
              items, 
              status: 'success',
              error: null 
            });
          }
        }),
        catchError(error => {
          console.warn('Background refresh failed:', error);
          return of(null); // Silently fail
        })
      )
      .subscribe();
  }

  /**
   * Restore selected template from sessionStorage
   */
  private restoreSelection(): void {
    const selected = this.cache.get<{ id: string; name: string }>(CACHE_KEYS.SELECTED);
    
    if (selected && selected.id) {
      this.updateState({
        selectedId: selected.id,
        selectedName: selected.name
      });
    }
  }

  /**
   * Update state immutably
   */
  private updateState(partial: Partial<TemplatesState>): void {
    this.state.next({
      ...this.state.getValue(),
      ...partial,
    });
  }
}