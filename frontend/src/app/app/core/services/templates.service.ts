import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { CacheService } from './cache.service';
import { DatabaseService } from '../../../core/services/db.service';

// Interfaces
export interface TemplateItem {
  id: string;
  name: string;
  content?: string;
  source?: string; // 'mailchimp', 'ai-generated', 'visual-editor'
  templateType?: string; // 'AI Generated', 'Visual Editor', etc.
}

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

export interface TemplatesState {
  items: TemplateItem[];
  status: LoadingStatus;
  error: string | null;
  selectedId: string | null;
  selectedName: string | null;
  searchQuery: string; // ✅ NEW: Store search query in state
}

const INITIAL_STATE: TemplatesState = {
  items: [],
  status: 'idle',
  error: null,
  selectedId: null,
  selectedName: null,
  searchQuery: '', // ✅ NEW
};

// Cache configuration
const CACHE_KEYS = {
  TEMPLATES_LIST: 'templates-list',
  SEARCH_PREFIX: 'templates-search-',
  SELECTED: 'templates-selected',
  SEARCH_QUERY: 'templates-search-query', // ✅ NEW: Cache key for search query
  LAST_SELECTED: 'templates-last-selected-id', // ✅ NEW: For reordering
};

const CACHE_TTL = {
  LIST: 2 * 60 * 60 * 1000,      // 2 hours
  SEARCH: 2 * 60 * 60 * 1000,    // 2 hours for search results
  SELECTED: 2 * 60 * 60 * 1000, // 2 hours for selected template
  SEARCH_QUERY: 24 * 60 * 60 * 1000, // ✅ 24 hours for search query
};

@Injectable({
  providedIn: 'root',
})
export class TemplatesService {
  private http = inject(HttpClient);
  private cache = inject(CacheService);
  private db = inject(DatabaseService); // 🔥 ADD IndexedDB

  private state = new BehaviorSubject<TemplatesState>(INITIAL_STATE);
  public readonly state$ = this.state.asObservable();

  private currentSearchQuery = '';

  constructor() {
    this.restoreSelection();
    this.restoreSearchQuery(); // ✅ NEW: Restore search query on init
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
      // ✅ NEW: Store last selected ID for reordering
      this.cache.set(CACHE_KEYS.LAST_SELECTED, id, CACHE_TTL.SELECTED, 'local');
    } else {
      this.cache.invalidate(CACHE_KEYS.SELECTED);
    }
  }

  search(query: string = ''): void {
    const trimmedQuery = query.trim().toLowerCase();
    
    // ✅ Prevent duplicate searches while loading
    if (this.currentSearchQuery === trimmedQuery && this.snapshot.status === 'loading') {
      return;
    }

    const queryChanged = this.currentSearchQuery !== trimmedQuery;
    this.currentSearchQuery = trimmedQuery;
    
    // ✅ NEW: Persist search query
    this.updateState({ searchQuery: trimmedQuery });
    this.cache.set(CACHE_KEYS.SEARCH_QUERY, trimmedQuery, CACHE_TTL.SEARCH_QUERY, 'local');
    
    const cacheKey = trimmedQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${trimmedQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;

    // ✅ Check cache FIRST - instant results, no loading state
    const cached = this.cache.get<TemplateItem[]>(cacheKey);
    
    if (cached && cached.length > 0) {
      // ✅ Reorder to show last selected first
      const reordered = this.reorderByLastSelected(cached);
      this.updateState({ items: reordered, status: 'success', error: null });
      return;
    }

    // ✅ Try filtering from full list if searching
    if (trimmedQuery) {
      const allTemplates = this.cache.get<TemplateItem[]>(CACHE_KEYS.TEMPLATES_LIST);
      
      if (allTemplates && allTemplates.length > 0) {
        // ✅ Filter instantly without loading state
        const filtered = allTemplates.filter(item => 
          item.name?.toLowerCase().includes(trimmedQuery) ||
          item.id?.toLowerCase().includes(trimmedQuery)
        );
        
        // Cache the filtered results
        this.cache.set(cacheKey, filtered, CACHE_TTL.SEARCH, 'session');
        
        // ✅ Reorder to show last selected first
        const reordered = this.reorderByLastSelected(filtered);
        this.updateState({ items: reordered, status: 'success', error: null });
        return;
      }
    }

    // ✅ Only show loading if we need to fetch from API
    this.fetchTemplates(trimmedQuery, cacheKey);
  }

  refresh(): void {
    const cacheKey = this.currentSearchQuery 
      ? `${CACHE_KEYS.SEARCH_PREFIX}${this.currentSearchQuery}`
      : CACHE_KEYS.TEMPLATES_LIST;
    
    this.cache.invalidate(cacheKey);
    this.fetchTemplates(this.currentSearchQuery, cacheKey);
  }

  smartRefresh(): void {
    // Set loading state
    this.updateState({ status: 'loading', error: null });
    
    // Fetch fresh template list from server
    this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
      .pipe(
        tap(async response => {
          const freshItems = response.items || [];
          
          // Cache the fresh list (localStorage)
          this.cache.set(CACHE_KEYS.TEMPLATES_LIST, freshItems, CACHE_TTL.LIST, 'session');
          
          // 🔥 SAVE TO INDEXEDDB
          for (const template of freshItems) {
            await this.db.cacheTemplate({
              id: template.id,
              runId: 'template-' + template.id,
              html: template.content || '',
              timestamp: Date.now()
            });
          }
          // ✅ Reorder to show last selected first
          const reordered = this.reorderByLastSelected(freshItems);
          
          // Update state with fresh list
          this.updateState({ 
            items: reordered, 
            status: 'success', 
            error: null 
          });
        }),
        catchError(error => {

          // Try to use stale cache
          const stale = this.cache.getStale<TemplateItem[]>(CACHE_KEYS.TEMPLATES_LIST);
          
          if (stale && stale.length > 0) {
            const reordered = this.reorderByLastSelected(stale);
            this.updateState({ 
              items: reordered, 
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
        
        // ✅ If we deleted the last selected, clear that too
        const lastSelectedId = this.cache.get<string>(CACHE_KEYS.LAST_SELECTED);
        if (lastSelectedId === id) {
          this.cache.invalidate(CACHE_KEYS.LAST_SELECTED);
        }
        
      })
    );
  }

  // ✅ NEW: Restore search query from cache
  private restoreSearchQuery(): void {
    const savedQuery = this.cache.get<string>(CACHE_KEYS.SEARCH_QUERY);
    
    if (savedQuery) {
      this.currentSearchQuery = savedQuery;
      this.updateState({ searchQuery: savedQuery });
    }
  }

  // ✅ NEW: Reorder templates to show last selected first
  private reorderByLastSelected(items: TemplateItem[]): TemplateItem[] {
    const lastSelectedId = this.cache.get<string>(CACHE_KEYS.LAST_SELECTED);
    if (!lastSelectedId || items.length === 0) {
      return items;
    }
    
    const selectedIndex = items.findIndex(item => item.id === lastSelectedId);
    if (selectedIndex > 0) {
      const selected = items[selectedIndex];
      const reordered = [selected, ...items.slice(0, selectedIndex), ...items.slice(selectedIndex + 1)];
      return reordered;
    }
    
    return items;
  }

  private fetchTemplates(query: string, cacheKey: string): void {
    // ✅ Only set loading state when actually fetching
    this.updateState({ status: 'loading', error: null });

    this.http.get<{ items: TemplateItem[]; total: number }>('/api/templates')
      .pipe(
        tap(async response => {
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
            // 🔥 SAVE TO INDEXEDDB
            for (const template of items) {
              await this.db.cacheTemplate({
                id: template.id,
                runId: 'template-' + template.id,
                html: template.content || '',
                timestamp: Date.now()
              });
            }
          } else {
          }
          
          // ✅ Reorder to show last selected first
          const reordered = this.reorderByLastSelected(items);
          this.updateState({ items: reordered, status: 'success', error: null });
        }),
        catchError(error => {

          const stale = this.cache.getStale<TemplateItem[]>(cacheKey);
          
          if (stale && stale.length > 0) {
            const reordered = this.reorderByLastSelected(stale);
            this.updateState({ items: reordered, status: 'success', error: 'Showing cached data (offline)' });
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
    } else {
    }
  }

  private updateState(partial: Partial<TemplatesState>): void {
    this.state.next({ ...this.state.getValue(), ...partial });
  }

  // ✅ NEW: Reset service state on logout
  clearState(): void {
    this.state.next(INITIAL_STATE);
    this.currentSearchQuery = '';
  }
}