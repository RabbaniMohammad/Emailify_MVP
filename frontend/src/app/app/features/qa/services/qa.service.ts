// src/app/services/qa.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, tap, throwError, switchMap, Observable } from 'rxjs';

/* ----------------------------- Golden types ----------------------------- */
export type GoldenEdit = {
  find: string;
  replace: string;
  before_context: string;
  after_context: string;
  reason?: string;
};

export type GoldenResult = {
  html: string;
  edits: GoldenEdit[];
  stats?: {
    totalSuggestions: number;
    autoApplied: number;
    manualReview: number;
    successRate: string;
  };
};

/* ---------------------------- Variants types ---------------------------- */
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

/* ------------------------------ Chat types ------------------------------ */
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
  html: string;            // current working HTML for this variant
  messages: ChatTurn[];    // chat transcript
};

/* ------------------------------ Snap types ------------------------------ */
export type SnapResult = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  dataUrl?: string;  // data:image/jpeg;base64,...
  error?: string;
  ts: number;        // when captured (ms)
};

type SnapApiResponse = {
  url: string;
  ok: boolean;
  status?: number;
  finalUrl?: string;
  dataUrl?: string;
  error?: string;
};

/* ------------------------- Suggestions types ---------------------------- */
export type SuggestionResult = {
  gibberish: Array<{ text: string; reason: string }>;
  suggestions: string[];
};

@Injectable({ providedIn: 'root' })
export class QaService {
  private http = inject(HttpClient);

  /* ---------- localStorage keys ---------- */
  private kGolden(id: string)      { return `qa:golden:${id}`; }
  private kSubjects(id: string)    { return `qa:subjects:${id}`; }
  private kSuggestions(id: string) { return `qa:suggestions:${id}`; }
  
  private kRunId(tplId: string)    { return `qa:variants:runId:${tplId}`; }
  private kRunData(runId: string)  { return `qa:variants:run:${runId}`; }
  
  private kChat(runId: string, no: number) { return `qa:chat:${runId}:${no}`; }
  
  // Per-run snapshots
  private kSnaps(runId: string) { return `qa:snaps:${runId}`; }
  
  // Per-run valid links list
  private kValidLinks(runId: string) { return `qa:validlinks:${runId}`; }

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
   * ✅ UPDATED: Generate Golden Template
   * Now fetches HTML and sends it to the backend
   */
  generateGolden(id: string, force = true): Observable<GoldenResult> {
    if (!force) {
      const cached = this.getGoldenCached(id);
      if (cached) return of(cached);
    }
    
    // Fetch the template HTML first, then send to backend
    return this.getTemplateHtml(id).pipe(
      switchMap(html => {
        return this.http.post<GoldenResult>(
          `/api/qa/${id}/golden`,
          { html }  // ✅ Send HTML in request body
        );
      }),
      tap(res => {
        try {
          localStorage.setItem(this.kGolden(id), JSON.stringify(res));
        } catch {}
      })
    );
  }

  /**
   * ✅ NEW: Get template HTML from API
   * This fetches the raw HTML content for a template
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

  generateSubjects(id: string, force = true) {
    if (!force) {
      const cached = this.getSubjectsCached(id);
      if (cached) return of(cached);
    }
    
    return this.http.post<{ subjects: string[] }>(`/api/qa/${id}/subjects`, {}).pipe(
      map(r => r.subjects || []),
      tap(list => {
        try {
          localStorage.setItem(this.kSubjects(id), JSON.stringify(list));
        } catch {}
      })
    );
  }

  generateSuggestions(id: string, force = false) {
    // Check cache first if not forcing
    if (!force) {
      const cached = this.getSuggestionsCached(id);
      if (cached) return of(cached);
    }
    
    return this.http.post<SuggestionResult>(
      `/api/qa/${id}/suggestions`,
      {}
    ).pipe(
      tap(res => {
        try {
          localStorage.setItem(this.kSuggestions(id), JSON.stringify(res));
        } catch {}
      })
    );
  }

  clearGolden(id: string) {
    try {
      localStorage.removeItem(this.kGolden(id));
    } catch {}
  }
  
  clearSubjects(id: string) {
    try {
      localStorage.removeItem(this.kSubjects(id));
    } catch {}
  }
  
  clearSuggestions(id: string) {
    try {
      localStorage.removeItem(this.kSuggestions(id));
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
      localStorage.setItem(this.kRunData(run.runId), JSON.stringify(run));
    } catch {}
  }

  startVariants(templateId: string, goldenHtml: string, target = 5) {
    return this.http.post<{ runId: string; target: number }>(
      `/api/qa/${templateId}/variants/start`,
      { html: goldenHtml, target }
    ).pipe(
      tap(({ runId, target }) => {
        const run: VariantsRun = { runId, target, items: [] };
        this.saveVariantsRun(templateId, run);
      })
    );
  }

  nextVariant(runId: string) {
    return this.http.post<VariantItem>(
      `/api/qa/variants/${runId}/next`,
      {}
    ).pipe(
      tap((item) => {
        const cached = this.getVariantsRunById(runId);
        if (cached) {
          const idx = cached.items.findIndex(i => i.no === item.no);
          if (idx >= 0) cached.items[idx] = item;
          else cached.items.push(item);
          try {
            localStorage.setItem(this.kRunData(runId), JSON.stringify(cached));
          } catch {}
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
    try {
      localStorage.setItem(this.kChat(runId, no), JSON.stringify(thread));
    } catch {}
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
  
  getSnapsCached(runId: string): SnapResult[] {
    try {
      const raw = localStorage.getItem(this.kSnaps(runId));
      const list = raw ? (JSON.parse(raw) as SnapResult[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  saveSnaps(runId: string, snaps: SnapResult[]) {
    try {
      localStorage.setItem(this.kSnaps(runId), JSON.stringify(snaps));
    } catch {}
  }

  addOrReplaceSnap(runId: string, snap: SnapResult): SnapResult[] {
    const list = this.getSnapsCached(runId);
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
      map((resp) => {
        const snap: SnapResult = { ...resp, ts: Date.now() };
        const snaps = this.addOrReplaceSnap(runId, snap);
        return { snap, snaps };
      }),
      catchError((e) => {
        const snap: SnapResult = {
          url,
          ok: false,
          status: e?.status,
          finalUrl: undefined,
          dataUrl: undefined,
          error: e?.message || 'Snap failed',
          ts: Date.now(),
        };
        const snaps = this.addOrReplaceSnap(runId, snap);
        return of({ snap, snaps });
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

  saveValidLinks(runId: string, links: string[]) {
    try {
      const clean = Array.from(
        new Set(
          (links || [])
            .map((s) => String(s || '').trim())
            .filter((s) => !!s)
        )
      );
      localStorage.setItem(this.kValidLinks(runId), JSON.stringify(clean));
    } catch {}
  }
}