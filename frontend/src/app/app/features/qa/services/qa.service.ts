import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, tap, throwError, switchMap, mergeMap, from, Observable, shareReplay, finalize } from 'rxjs';
import { DatabaseService } from '../../../../core/services/db.service';

/* ----------------------------- Types (keep existing) ----------------------------- */
export type GoldenEdit = {
  find: string;
  replace: string;
  before_context: string;
  after_context: string;
  reason?: string;
};

// ✅ Add these types at the top of qa.service.ts (after imports)
export type EditStatus = 'applied' | 'not_found' | 'blocked' | 'skipped' | 'context_mismatch' | 'boundary_issue' | 'already_correct';

export interface EditDiagnostics {
  normalizedFind?: string;
  rawOccurrences?: number;
  normalizedOccurrences?: number;
  contextMatched?: boolean;
  crossesBoundary?: boolean;
  
  // ✅ ENHANCED: More detailed location tracking
  locations?: Array<{
    tag: string;
    line?: number;
    actualContext: string;
    confidence: number;
    xpath?: string;              // ✅ NEW: Path to element
    htmlSnippet?: string;        // ✅ NEW: Raw HTML around match
    spanningElements?: string[]; // ✅ NEW: Tags it crosses
    visualPreview?: string;      // ✅ NEW: What user would see
  }>;
  
  // ✅ NEW: Manual fix guidance for failed edits
  manualFixGuidance?: {
    strategy: 'split-across-boundary' | 'not-found' | 'context-mismatch' | 'normalization-issue';
    recommendation: string;
    searchHints?: string[];      // Alternative ways to find it
    affectedElements?: Array<{
      tag: string;
      xpath: string;
      textContent: string;
    }>;
  };
  
  timings?: {
    search: number;
    apply: number;
    verify: number;
  };
}

export interface GoldenResult {
  html: string;
  edits?: GoldenEdit[];  // ✅ Changed from inline Array type
  changes?: Array<{ before: string; after: string; parent: string; reason?: string }>;
  
  // ✅ NEW: Atomic verification data (all optional for backward compatibility)
  atomicResults?: any[];
  failedEdits?: Array<{
    find?: string;
    replace?: string;
    before_context?: string;
    after_context?: string;
    reason?: string;
    status?: EditStatus;
    diagnostics?: EditDiagnostics;
  }>;
  stats?: {
    total: number;
    applied: number;
    failed: number;
    blocked: number;
    skipped: number;
  };
  timings?: {
    total: number;
    parsing: number;
    processing: number;
    verification: number;
  };
}

export type VariantItem = {
  no: number;
  html: string;
  changes: Array<{ before: string; after: string; parent: string; reason?: string }>;
  why: string[];
  artifacts: { usedIdeas: string[] };
};

export type VariantsRun = {
  runId: string;
  target: number;
  items: VariantItem[];
};

export type ChatIntent = 'suggest' | 'edit' | 'both' | 'clarify';

export type ChatAssistantJson = {
  intent: ChatIntent;
  ideas?: string[];
  edits?: GoldenEdit[];
  targets?: string[];
  notes?: string[];
};

export type ChatTurn = {
  role: 'user' | 'assistant';
  text: string;
  json?: ChatAssistantJson | null;
  ts: number;
};

export type ChatThread = {
  html: string;
  messages: ChatTurn[];
};

export type SnapResult = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  dataUrl?: string;
  error?: string;
  ts: number;
};

type SnapApiResponse = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  dataUrl?: string;
  error?: string;
};

export type SuggestionResult = {
  gibberish: Array<{ text: string; reason: string }>;
  suggestions: string[];
};

@Injectable({ providedIn: 'root' })
export class QaService {
  private http = inject(HttpClient);
  private db = inject(DatabaseService);

  /* ---------- localStorage keys ---------- */
  private kGolden(id: string)      { return `qa:golden:${id}`; }
  private kSubjects(id: string)    { return `qa:subjects:${id}`; }
  private kSuggestions(id: string) { return `qa:suggestions:${id}`; }
  
  private kRunId(tplId: string)    { return `qa:variants:runId:${tplId}`; }
  private kRunData(runId: string)  { return `qa:variants:run:${runId}`; }
  
  private kChat(runId: string, no: number) { return `qa:chat:${runId}:${no}`; }
  private kSnaps(runId: string) { return `qa:snaps:${runId}`; }
  private kValidLinks(runId: string) { return `qa:validlinks:${runId}`; }

  /* ---------- Observable caches ---------- */
  private goldenCache$ = new Map<string, Observable<GoldenResult>>();
  private subjectsCache$ = new Map<string, Observable<string[]>>();
  private suggestionsCache$ = new Map<string, Observable<SuggestionResult>>();

  /* ------------------- Golden / Subjects / Suggestions ------------------- */
  
  getGoldenCached(id: string): GoldenResult | null {
    try {
      const raw = localStorage.getItem(this.kGolden(id));
      return raw ? (JSON.parse(raw) as GoldenResult) : null;
    } catch {
      return null;
    }
  }
  
  getSubjectsCached(id: string): string[] | null {
    try {
      const raw = localStorage.getItem(this.kSubjects(id));
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  }
  
  getSuggestionsCached(id: string): SuggestionResult | null {
    try {
      const raw = localStorage.getItem(this.kSuggestions(id));
      return raw ? (JSON.parse(raw) as SuggestionResult) : null;
    } catch {
      return null;
    }
  }

  /**
   * ✅ UPDATED: Generate Golden Template with ShareReplay
   */
  generateGolden(id: string, force = false): Observable<GoldenResult> {
    // If not forcing and observable cache exists, return it
    if (!force && this.goldenCache$.has(id)) {
      return this.goldenCache$.get(id)!;
    }

    // Check localStorage cache
    if (!force) {
      const cached = this.getGoldenCached(id);
      if (cached) {
        return of(cached);
      }
    }
    
    // Create new observable with shareReplay
    const golden$ = this.getTemplateHtml(id).pipe(
      switchMap(html => {
        return this.http.post<GoldenResult>(
          `/api/qa/${id}/golden`,
          { html }
        );
      }),
      tap(async res => {
        // 🔥 Save to IndexedDB instead of localStorage
        try {
          await this.db.cacheTemplate({
            id: `golden-${id}`,
            runId: `golden-${id}`,
            html: res.html || '',
            timestamp: Date.now()
          });
        } catch (e) {
        }
      }),
      shareReplay(1), // ✅ Cache the result for late subscribers
      finalize(() => {
        // Clean up observable cache after completion
        this.goldenCache$.delete(id);
      })
    );
    
    // Store in observable cache
    this.goldenCache$.set(id, golden$);
    
    return golden$;
  }

  /**
   * ✅ UPDATED: Generate Subjects with ShareReplay and Template HTML
   */
  generateSubjects(id: string, templateHtml: string, force = false): Observable<string[]> {
    if (!force && this.subjectsCache$.has(id)) {
      return this.subjectsCache$.get(id)!;
    }

    if (!force) {
      const cached = this.getSubjectsCached(id);
      if (cached) {
        return of(cached);
      }
    }
    
    // ✅ Send template HTML in request body
    const subjects$ = this.http.post<{ subjects: string[] }>(
      `/api/qa/${id}/subjects`, 
      { html: templateHtml }  // ✅ Include template HTML
    ).pipe(
      map(r => r.subjects || []),
      tap(list => {
        try {
          localStorage.setItem(this.kSubjects(id), JSON.stringify(list));
        } catch {}
      }),
      shareReplay(1),
      finalize(() => {
        this.subjectsCache$.delete(id);
      })
    );
    
    this.subjectsCache$.set(id, subjects$);
    return subjects$;
  }

  /**
   * ✅ UPDATED: Generate Suggestions with ShareReplay
   */
  generateSuggestions(id: string, force = false): Observable<SuggestionResult> {
    if (!force && this.suggestionsCache$.has(id)) {
      return this.suggestionsCache$.get(id)!;
    }

    if (!force) {
      const cached = this.getSuggestionsCached(id);
      if (cached) {
        return of(cached);
      }
    }
    
    const suggestions$ = this.http.post<SuggestionResult>(
      `/api/qa/${id}/suggestions`,
      {}
    ).pipe(
      tap(res => {
        try {
          localStorage.setItem(this.kSuggestions(id), JSON.stringify(res));
        } catch {}
      }),
      shareReplay(1),
      finalize(() => {
        this.suggestionsCache$.delete(id);
      })
    );
    
    this.suggestionsCache$.set(id, suggestions$);
    return suggestions$;
  }

  /**
   * ✅ NEW: Get template HTML from API
   */
  private getTemplateHtml(templateId: string): Observable<string> {
    return this.http.get(`/api/templates/${templateId}/raw`, { 
      responseType: 'text' 
    }).pipe(
      catchError(error => {
        console.error('Failed to fetch template HTML:', error);
        return throwError(() => new Error('Failed to fetch template HTML'));
      })
    );
  }

  /**
   * Save subjects to localStorage
   */
  saveSubjects(id: string, subjects: string[]): void {
    try {
      localStorage.setItem(this.kSubjects(id), JSON.stringify(subjects));
    } catch (e) {
    }
  }

  /**
   * Clear subjects from cache and storage
   */
  clearSubjectsForTemplate(id: string): void {
    try {
      localStorage.removeItem(this.kSubjects(id));
      this.subjectsCache$.delete(id);
    } catch (e) {
    }
  }

  /**
   * Clear ALL QA data (call this on logout)
   */
  clearAllQaData(): void {
    try {
      // Get all localStorage keys
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('qa:')) {
          keysToRemove.push(key);
        }
      }
      
      // Remove all QA keys
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Clear observable caches
      this.goldenCache$.clear();
      this.subjectsCache$.clear();
      this.suggestionsCache$.clear();
      
    } catch (e) {
      console.error('Failed to clear QA data:', e);
    }
  }

  /**
   * Clear chat thread for a specific variant
   */
  clearChatForRun(runId: string, no: number): void {
    try {
      const key = this.kChat(runId, no);
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Failed to clear chat:', e);
    }
  }

  checkTemplateGrammar(html: string): Observable<{
    hasErrors: boolean;
    mistakes: Array<{ word: string; suggestion: string; context: string }>;
    count: number;
    message: string;
  }> {
    return this.http.post<{
      hasErrors: boolean;
      mistakes: Array<{ word: string; suggestion: string; context: string }>;
      count: number;
      message: string;
    }>('/api/qa/template/grammar-check', { html });
  }

  // ============================================
  // GRAMMAR CHECK PERSISTENCE
  // ============================================

  saveGrammarCheck(runId: string, no: number, result: {
    hasErrors: boolean;
    mistakes: Array<{ word: string; suggestion: string; context: string }>;
    count: number;
    message: string;
  }): void {
    try {
      const key = `grammar_${runId}_${no}`;
      localStorage.setItem(key, JSON.stringify(result));
    } catch (error) {
    }
  }

  getGrammarCheckCached(runId: string, no: number): {
    hasErrors: boolean;
    mistakes: Array<{ word: string; suggestion: string; context: string }>;
    count: number;
    message: string;
  } | null {
    try {
      const key = `grammar_${runId}_${no}`;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      
      const result = JSON.parse(stored);
      return result;
    } catch (error) {
      return null;
    }
  }

  clearGrammarCheck(runId: string, no: number): void {
    try {
      const key = `grammar_${runId}_${no}`;
      localStorage.removeItem(key);
    } catch (error) {
    }
  }

  /**
   * Clear all snapshots for a run
   */
  clearSnapsForRun(runId: string): void {
    try {
      const key = this.kSnaps(runId);
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Failed to clear snaps:', e);
    }
  }

  clearGolden(id: string) {
    try {
      localStorage.removeItem(this.kGolden(id));
      this.goldenCache$.delete(id);
    } catch {}
  }
  
  clearSubjects(id: string) {
    try {
      localStorage.removeItem(this.kSubjects(id));
      this.subjectsCache$.delete(id);
    } catch {}
  }
  
  clearSuggestions(id: string) {
    try {
      localStorage.removeItem(this.kSuggestions(id));
      this.suggestionsCache$.delete(id);
    } catch {}
  }

  /* ------------------------------- Variants ------------------------------- */
  
  getVariantsRunCached(templateId: string): VariantsRun | null {
    try {
      const runId = localStorage.getItem(this.kRunId(templateId));
      if (!runId) return null;
      const raw = localStorage.getItem(this.kRunData(runId));
      return raw ? (JSON.parse(raw) as VariantsRun) : null;
    } catch {
      return null;
    }
  }

  getVariantsRunById(runId: string): VariantsRun | null {
    try {
      const raw = localStorage.getItem(this.kRunData(runId));
      return raw ? (JSON.parse(raw) as VariantsRun) : null;
    } catch {
      return null;
    }
  }

  private setRunIdForTemplate(templateId: string, runId: string) {
    try {
      localStorage.setItem(this.kRunId(templateId), runId);
    } catch {}
  }

  saveVariantsRun(templateId: string, run: VariantsRun) {
    try {
      this.setRunIdForTemplate(templateId, run.runId);
      
      // 🔥 Save variants to IndexedDB ONLY
      this.saveVariantsRunToCache(templateId, run).catch(err => {})
    } catch {}
  }

  startVariants(templateId: string, goldenHtml: string, target = 5) {
    return this.http.post<{ runId: string; target: number }>(
      `/api/qa/${templateId}/variants/start`,
      { html: goldenHtml, target }
    ).pipe(
      tap(async ({ runId, target }) => {
        const run: VariantsRun = { runId, target, items: [] };
        this.saveVariantsRun(templateId, run);
        
        // 🔥 Also cache the golden template HTML as a variant
        await this.db.cacheTemplate({
          id: `variant-golden-${runId}`,
          runId: runId,
          html: goldenHtml,
          timestamp: Date.now()
        });
      })
    );
  }

  nextVariant(runId: string) {
    return this.http.post<VariantItem>(
      `/api/qa/variants/${runId}/next`,
      {}
    ).pipe(
      tap(async (item) => {
        const cached = this.getVariantsRunById(runId);
        if (cached) {
          const idx = cached.items.findIndex(i => i.no === item.no);
          if (idx >= 0) cached.items[idx] = item;
          else cached.items.push(item);
          
          // 🔥 Cache individual variant HTML to IndexedDB
          await this.db.cacheTemplate({
            id: `variant-${runId}-${item.no}`,
            runId: runId,
            html: item.html,
            timestamp: Date.now()
          });
          
          // 🔥 Save updated variants run to IndexedDB
          await this.saveVariantsRunToCache(runId, cached);
        }
      })
    );
  }

  getVariantsStatus(runId: string) {
    return this.http.get<{
      runId: string;
      templateId: string;
      target: number;
      count: number;
      items: VariantItem[];
    }>(`/api/qa/variants/${runId}/status`).pipe(
      catchError((e) => {
        if (e?.status === 404) {
          return throwError(() => new Error(
            'Run not found (server restarted or bad runId). Start a new run.'
          ));
        }
        return throwError(() => e);
      })
    );
  }

  /* --------------------------------- Chat --------------------------------- */
  
  getChatCached(runId: string, no: number): ChatThread | null {
    try {
      const raw = localStorage.getItem(this.kChat(runId, no));
      return raw ? (JSON.parse(raw) as ChatThread) : null;
    } catch {
      return null;
    }
  }

  saveChat(runId: string, no: number, thread: ChatThread) {
    // 🔥 REMOVED localStorage - now using IndexedDB only
    // Chat threads are saved via saveChatThreadToCache() which uses IndexedDB
  }

  sendChatMessage(
    runId: string,
    no: number,
    html: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    userMessage: string
  ) {
    return this.http.post<{
      assistantText: string;
      json: ChatAssistantJson;
    }>(`/api/qa/variants/${runId}/chat/message`, {
      no,
      html,
      history,
      userMessage
    });
  }

  applyChatEdits(runId: string, html: string, edits: GoldenEdit[]) {
    return this.http.post<{
      html: string;
      changes: Array<{
        before: string;
        after: string;
        parent: string;
        reason?: string;
      }>;
    }>(`/api/qa/variants/${runId}/chat/apply`, {
      html,
      edits
    });
  }

  /* ------------------------------ Snapshots ------------------------------- */
  
  async getSnapsCached(runId: string): Promise<SnapResult[]> {
    try {
      // Get metadata from localStorage
      const raw = localStorage.getItem(this.kSnaps(runId));
      const metadata = raw ? (JSON.parse(raw) as SnapResult[]) : [];
      
      if (!Array.isArray(metadata) || metadata.length === 0) {
        return [];
      }
      
      // Get screenshots from IndexedDB
      const screenshots = await this.db.getScreenshotsByRun(runId);
      
      // Merge screenshots with metadata
      const snaps = metadata.map(snap => ({
        ...snap,
        dataUrl: screenshots.get(snap.url) || snap.dataUrl
      }));
      
      return snaps;
    } catch {
      return [];
    }
  }

  saveSnaps(runId: string, snaps: SnapResult[]) {
    // 🔥 Save screenshots to IndexedDB, metadata to localStorage
    snaps.forEach(snap => {
      if (snap.dataUrl) {
        // Cache screenshot to IndexedDB
        this.db.cacheScreenshot(snap.url, runId, snap.dataUrl).catch(err => {})
      }
    });
    
    // Save metadata (without dataUrl) to localStorage
    try {
      const metadata = snaps.map(({ dataUrl, ...rest }) => rest);
      localStorage.setItem(this.kSnaps(runId), JSON.stringify(metadata));
    } catch (err) {
    }
  }

  async addOrReplaceSnap(runId: string, snap: SnapResult): Promise<SnapResult[]> {
    const list = await this.getSnapsCached(runId);
    const key = (snap.finalUrl || snap.url).toLowerCase();
    const idx = list.findIndex(s => (
      (s.finalUrl || s.url).toLowerCase() === key
    ));
    
    if (idx >= 0) list[idx] = snap;
    else list.unshift(snap);
    
    this.saveSnaps(runId, list);
    return list;
  }

  snapUrl(runId: string, url: string) {
    return this.http.post<SnapApiResponse>(`/api/qa/snap`, { url }).pipe(
      mergeMap(async (resp: SnapApiResponse) => {
        const snap: SnapResult = { ...resp, ts: Date.now() };
        const snaps = await this.addOrReplaceSnap(runId, snap);
        return { snap, snaps };
      }),
      catchError(async (e: any) => {
        const snap: SnapResult = {
          url,
          ok: false,
          status: e?.status,
          finalUrl: undefined,
          dataUrl: undefined,
          error: e?.message || 'Snap failed',
          ts: Date.now(),
        };
        const snaps = await this.addOrReplaceSnap(runId, snap);
        return { snap, snaps };
      })
    );
  }

  /* ------------------------- Valid Links (per run) ------------------------ */
  
  getValidLinks(runId: string): string[] {
    try {
      const raw = localStorage.getItem(this.kValidLinks(runId));
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  saveGoldenToCache(templateId: string, golden: GoldenResult): void {
    // 🔥 REMOVED localStorage - golden templates are now cached to IndexedDB
    // See the tap() in getGolden() which calls db.cacheTemplate()
  }

  saveValidLinks(runId: string, links: string[]) {
    try {
      const clean = Array.from(
        new Set(
          (links || [])
            .map((s) => String(s || '').trim())
            .filter((s) => !!s)
        )
      );
      
      // ✅ Save to IndexedDB for persistent caching
      this.db.cacheValidLinks(runId, clean).catch(err => {})
      // Keep localStorage for fast synchronous access
      localStorage.setItem(this.kValidLinks(runId), JSON.stringify(clean));
    } catch {}
  }

  /**
   * Clear valid links for a specific run
   * Called when navigating to a template from QA page to force re-finalization
   */
  clearValidLinks(runId: string): void {
    try {
      // ✅ Clear from IndexedDB
      this.db.validLinks?.delete(runId).catch(err => {})
      // Clear from localStorage
      const key = this.kValidLinks(runId);
      localStorage.removeItem(key);
    } catch (e) {
      console.error('Failed to clear valid links:', e);
    }
  }

  /* ==================== IndexedDB Cache Methods ==================== */

  /**
   * Get variants run from IndexedDB cache
   */
  async getVariantsRunFromCache(runId: string): Promise<VariantsRun | null> {
    const cached = await this.db.getConversation(runId);
    if (cached && (cached as any).variants) {
      return (cached as any).variants as VariantsRun;
    }
    return null;
  }

  /**
   * Save variants run to IndexedDB cache
   */
  async saveVariantsRunToCache(templateId: string, run: VariantsRun): Promise<void> {
    await this.db.cacheConversation({
      runId: run.runId,
      templateId,
      messages: [],
      variants: run as any,
      timestamp: Date.now()
    });
  }

  /**
   * Get chat thread from IndexedDB cache
   */
  async getChatThreadFromCache(runId: string, variantNo: number): Promise<ChatThread | null> {
    const cached = await this.db.getConversation(`${runId}:${variantNo}`);
    if (cached && cached.messages) {
      return {
        html: (cached as any).html || '',
        messages: cached.messages
      };
    }
    return null;
  }

  /**
   * Save chat thread to IndexedDB cache
   */
  async saveChatThreadToCache(runId: string, variantNo: number, thread: ChatThread): Promise<void> {
    await this.db.cacheConversation({
      runId: `${runId}:${variantNo}`,
      messages: thread.messages,
      html: thread.html, // 🔥 SAVE THE FULL HTML!
      timestamp: Date.now(),
      ...(thread.html && { templateId: thread.html.substring(0, 50) }) // Store snippet for reference
    } as any);
  }

  /**
   * Invalidate conversation cache when user creates new variants
   */
  async invalidateConversationCache(runId: string): Promise<void> {
    await this.db.invalidateConversation(runId);
  }
}
