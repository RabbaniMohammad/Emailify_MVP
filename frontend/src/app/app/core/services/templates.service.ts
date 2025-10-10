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
  LIST: 2 * 60 * 60 * 1000,      // 2 hours
  SEARCH: 2 * 60 * 60 * 1000,    // 2 hours for search results
  SELECTED: 2 * 60 * 60 * 1000, // 2 hours for selected template
};

@Injectable({
  providedIn: 'root',
})
export class TemplatesService {
  private http = inject(HttpClient);
  private cache = inject(CacheService);

  private state = new BehaviorSubject<TemplatesState>(INITIAL_STATE);
  public readonly state$ = this.state.asObservable();

  private currentSearchQuery = '';

  constructor() {
    this.restoreSelection();
  }

  get snapshot(): TemplatesState {
    return this.state.getValue();
  }

  select(id: string, name: string): void {
    this.updateState({ 
      selectedId: id, 
      selectedName: name 
    });

    if (id && name) {
      this.cache.set(CACHE_KEYS.SELECTED, { id, name }, CACHE_TTL.SELECTED, 'session');
    } else {
      this.cache.invalidate(CACHE_KEYS.SELECTED);
    }
  }

  search(query: string = ''): void {
    const trimmedQuery = query.trim().toLowerCase();
    
    // ✅ Prevent duplicate searches while loading
    if (this.currentSearchQuery === trimmedQuery && this.snapshot.status === 'loading') {
      console.log('⏭️ Search already in progress, skipping');
      return;
    }

    const queryChanged = this.currentSearchQuery !== trimmedQuery;
    this.currentSearchQuery = trimmedQuery;
    
    const cacheKey = trimmedQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${trimmedQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;

    // ✅ Check cache FIRST - instant results, no loading state
    const cached = this.cache.get<TemplateItem[]>(cacheKey);
    
    if (cached && cached.length > 0) {
      console.log('✅ Instant cache hit:', cached.length, 'templates');
      // ✅ Set status to 'success' immediately - no loading state!
      this.updateState({ items: cached, status: 'success', error: null });
      return;
    }

    // ✅ Try filtering from full list if searching
    if (trimmedQuery) {
      const allTemplates = this.cache.get<TemplateItem[]>(CACHE_KEYS.TEMPLATES_LIST);
      
      if (allTemplates && allTemplates.length > 0) {
        console.log('🔍 Filtering from cache...');
        
        // ✅ Filter instantly without loading state
        const filtered = allTemplates.filter(item => 
          item.name?.toLowerCase().includes(trimmedQuery) ||
          item.id?.toLowerCase().includes(trimmedQuery)
        );
        
        console.log('✅ Filtered instantly:', filtered.length, 'of', allTemplates.length);
        
        // Cache the filtered results
        this.cache.set(cacheKey, filtered, CACHE_TTL.SEARCH, 'session');
        
        // ✅ Update state immediately - no loading!
        this.updateState({ items: filtered, status: 'success', error: null });
        return;
      }
    }

    // ✅ Only show loading if we need to fetch from API
    console.log('📡 No cache - fetching from backend...');
    this.fetchTemplates(trimmedQuery, cacheKey);
  }

  refresh(): void {
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    this.cache.invalidate(cacheKey);
    this.fetchTemplates(this.currentSearchQuery, cacheKey);
  }

  // Add this to your TemplatesService class:

/**
 * Smart refresh: Fetch new template list but skip cached content
 */
// Replace the smartRefresh method in your TemplatesService with this:

smartRefresh(): void {
  console.log('🔄 Smart refresh started...');
  
  // Set loading state
  this.updateState({ status: 'loading', error: null });
  
  // Fetch fresh template list from server
  this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
    .pipe(
      tap(response => {
        const freshItems = response.items || [];
        
        console.log(`✅ Smart refresh: ${freshItems.length} templates from server`);
        
        // Cache the fresh list
        this.cache.set(CACHE_KEYS.TEMPLATES_LIST, freshItems, CACHE_TTL.LIST, 'session');
        
        // Update state with fresh list
        this.updateState({ 
          items: freshItems, 
          status: 'success', 
          error: null 
        });
      }),
      catchError(error => {
        console.error('❌ Smart refresh failed:', error);
        
        // Try to use stale cache
        const stale = this.cache.getStale<TemplateItem[]>(CACHE_KEYS.TEMPLATES_LIST);
        
        if (stale && stale.length > 0) {
          console.warn('⚠️ Using stale cache due to network error');
          this.updateState({ 
            items: stale, 
            status: 'success', 
            error: 'Showing cached data (offline)' 
          });
        } else {
          this.updateState({ 
            status: 'error', 
            error: error.message || 'Failed to refresh templates' 
          });
        }
        
        return throwError(() => error);
      })
    )
    .subscribe();
}

  hasFreshCache(): boolean {
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    return this.cache.has(cacheKey);
  }

  clearCache(): void {
    this.cache.invalidatePrefix('templates-');
  }

  deleteTemplate(id: string): Observable<any> {
  return this.http.delete(`/api/templates/${id}`).pipe(
    tap(() => {
      // Remove from current state
      const currentItems = this.snapshot.items;
      const updatedItems = currentItems.filter(item => item.id !== id);
      
      this.updateState({ 
        items: updatedItems,
        selectedId: null,
        selectedName: null
      });
      
      // Clear all caches for this template
      const cacheKeys = [
        `${CACHE_KEYS.TEMPLATES_LIST}`,
        `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      ];
      
      cacheKeys.forEach(key => this.cache.invalidate(key));
      
      console.log('✅ Template removed from state and cache');
    })
  );
}

  private fetchTemplates(query: string, cacheKey: string): void {
    // ✅ Only set loading state when actually fetching
    this.updateState({ status: 'loading', error: null });

    this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
      .pipe(
        tap(response => {
          let items = response.items || [];
          
          // ✅ Filter efficiently
          if (query) {
            const lowerQuery = query.toLowerCase();
            items = items.filter(item => 
              item.name?.toLowerCase().includes(lowerQuery) ||
              item.id?.toLowerCase().includes(lowerQuery)
            );
          }
          
          if (items.length > 0) {
            const ttl = query ? CACHE_TTL.SEARCH : CACHE_TTL.LIST;
            this.cache.set(cacheKey, items, ttl, 'session');
            console.log('💾 Cached', items.length, 'templates');
          } else {
            console.warn('⚠️ No templates to cache');
          }
          
          this.updateState({ items, status: 'success', error: null });
        }),
        catchError(error => {
          console.error('❌ Failed to fetch templates:', error);
          
          const stale = this.cache.getStale<TemplateItem[]>(cacheKey);
          
          if (stale && stale.length > 0) {
            console.warn('⚠️ Using stale cache due to network error');
            this.updateState({ items: stale, status: 'success', error: 'Showing cached data (offline)' });
          } else {
            this.updateState({ status: 'error', error: error.message || 'Failed to load templates' });
          }
          
          return throwError(() => error);
        })
      )
      .subscribe();
  }

  private restoreSelection(): void {
    const selected = this.cache.get<{ id: string; name: string }>(CACHE_KEYS.SELECTED);
    
    if (selected && selected.id) {
      this.updateState({ selectedId: selected.id, selectedName: selected.name });
    }
  }

  private updateState(partial: Partial<TemplatesState>): void {
    this.state.next({ ...this.state.getValue(), ...partial });
  }
}