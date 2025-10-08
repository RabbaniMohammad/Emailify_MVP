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
    
    if (this.currentSearchQuery === trimmedQuery && this.snapshot.status === 'loading') {
      return;
    }

    const queryChanged = this.currentSearchQuery !== trimmedQuery;
    this.currentSearchQuery = trimmedQuery;
    
    const cacheKey = trimmedQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${trimmedQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;

    const cached = this.cache.get<TemplateItem[]>(cacheKey);
    
    if (cached && cached.length > 0 && !queryChanged) {
      console.log('✅ Using cached templates:', cached.length);
      this.updateState({ items: cached, status: 'success', error: null });
      return;
    }

    if (trimmedQuery) {
      const allTemplates = this.cache.get<TemplateItem[]>(CACHE_KEYS.TEMPLATES_LIST);
      
      if (allTemplates && allTemplates.length > 0) {
        const filtered = allTemplates.filter(item => 
          item.name?.toLowerCase().includes(trimmedQuery) ||
          item.id?.toLowerCase().includes(trimmedQuery)
        );
        
        console.log('✅ Filtered from cache:', filtered.length, 'of', allTemplates.length);
        this.cache.set(cacheKey, filtered, CACHE_TTL.SEARCH, 'session');
        this.updateState({ items: filtered, status: 'success', error: null });
        return;
      }
    }

    console.log('📡 Fetching templates from backend...');
    this.fetchTemplates(trimmedQuery, cacheKey);
  }

  refresh(): void {
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    this.cache.invalidate(cacheKey);
    this.fetchTemplates(this.currentSearchQuery, cacheKey);
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

  private fetchTemplates(query: string, cacheKey: string): void {
    this.updateState({ status: 'loading', error: null });

    this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
      .pipe(
        tap(response => {
          let items = response.items || [];
          
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
          console.error('Failed to fetch templates:', error);
          
          const stale = this.cache.getStale<TemplateItem[]>(cacheKey);
          
          if (stale && stale.length > 0) {
            console.warn('Using stale cache due to network error');
            this.updateState({ items: stale, status: 'success', error: 'Showing cached data (offline)' });
          } else {
            this.updateState({ status: 'error', error: error.message || 'Failed to load templates' });
          }
          
          return throwError(() => error);
        })
      )
      .subscribe();
  }

  private fetchTemplatesInBackground(query: string, cacheKey: string): void {
    this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
      .pipe(
        tap(response => {
          let items = response.items || [];
          
          if (query) {
            const lowerQuery = query.toLowerCase();
            items = items.filter(item => 
              item.name?.toLowerCase().includes(lowerQuery) ||
              item.id?.toLowerCase().includes(lowerQuery)
            );
          }
          
          const ttl = query ? CACHE_TTL.SEARCH : CACHE_TTL.LIST;
          this.cache.set(cacheKey, items, ttl, 'session');
          
          if (JSON.stringify(items) !== JSON.stringify(this.snapshot.items)) {
            this.updateState({ items, status: 'success', error: null });
          }
        }),
        catchError(error => {
          console.warn('Background refresh failed:', error);
          return of(null);
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