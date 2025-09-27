// src/app/services/qa.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, tap, throwError } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class QaService {
  private http = inject(HttpClient);

  /* ---------- localStorage keys ---------- */
  private kGolden(id: string)   { return `qa:golden:${id}`; }
  private kSubjects(id: string) { return `qa:subjects:${id}`; }

  private kRunId(tplId: string)   { return `qa:variants:runId:${tplId}`; }
  private kRunData(runId: string) { return `qa:variants:run:${runId}`; }

  private kChat(runId: string, no: number) { return `qa:chat:${runId}:${no}`; }

  // Per-template+variant+run snapshots (prevents bleed across templates)
  private kSnaps(templateId: string, no: number, runId: string) {
    return `qa:snaps:${templateId}:${no}:${runId}`;
  }

  /* --------------------------- Golden / Subjects -------------------------- */
  getGoldenCached(id: string) {
    try { const raw = localStorage.getItem(this.kGolden(id)); return raw ? (JSON.parse(raw) as GoldenResult) : null; } catch { return null; }
  }
  getSubjectsCached(id: string) {
    try { const raw = localStorage.getItem(this.kSubjects(id)); return raw ? (JSON.parse(raw) as string[]) : null; } catch { return null; }
  }

  generateGolden(id: string, force = true) {
    if (!force) { const cached = this.getGoldenCached(id); if (cached) return of(cached); }
    return this.http.post<GoldenResult>(`/api/qa/${id}/golden`, {}).pipe(
      tap(res => { try { localStorage.setItem(this.kGolden(id), JSON.stringify(res)); } catch {} })
    );
  }

  generateSubjects(id: string, force = true) {
    if (!force) { const cached = this.getSubjectsCached(id); if (cached) return of(cached); }
    return this.http.post<{ subjects: string[] }>(`/api/qa/${id}/subjects`, {}).pipe(
      map(r => r.subjects || []),
      tap(list => { try { localStorage.setItem(this.kSubjects(id), JSON.stringify(list)); } catch {} })
    );
  }

  generateSuggestions(id: string) {
    return this.http.post<{ gibberish: Array<{text: string; reason: string}>, suggestions: string[] }>(
      `/api/qa/${id}/suggestions`, {}
    );
  }

  clearGolden(id: string)   { try { localStorage.removeItem(this.kGolden(id)); } catch {} }
  clearSubjects(id: string) { try { localStorage.removeItem(this.kSubjects(id)); } catch {} }

  /* ------------------------------- Variants ------------------------------- */
  getVariantsRunCached(templateId: string): VariantsRun | null {
    try {
      const runId = localStorage.getItem(this.kRunId(templateId));
      if (!runId) return null;
      const raw = localStorage.getItem(this.kRunData(runId));
      return raw ? (JSON.parse(raw) as VariantsRun) : null;
    } catch { return null; }
  }

  getVariantsRunById(runId: string): VariantsRun | null {
    try {
      const raw = localStorage.getItem(this.kRunData(runId));
      return raw ? (JSON.parse(raw) as VariantsRun) : null;
    } catch { return null; }
  }

  private setRunIdForTemplate(templateId: string, runId: string) {
    try { localStorage.setItem(this.kRunId(templateId), runId); } catch {}
  }

  saveVariantsRun(templateId: string, run: VariantsRun) {
    try {
      this.setRunIdForTemplate(templateId, run.runId);
      localStorage.setItem(this.kRunData(run.runId), JSON.stringify(run));
    } catch {}
  }

  startVariants(templateId: string, goldenHtml: string, target = 5) {
    return this.http.post<{ runId: string; target: number }>(
      `/api/qa/${templateId}/variants/start`, { html: goldenHtml, target }
    ).pipe(
      tap(({ runId, target }) => {
        // seed local cache for convenience
        const run: VariantsRun = { runId, target, items: [] };
        this.saveVariantsRun(templateId, run);
      })
    );
  }

  nextVariant(runId: string) {
    return this.http.post<VariantItem>(`/api/qa/variants/${runId}/next`, {}).pipe(
      tap((item) => {
        // Merge into cached run if present
        const cached = this.getVariantsRunById(runId);
        if (cached) {
          const idx = cached.items.findIndex(i => i.no === item.no);
          if (idx >= 0) cached.items[idx] = item;
          else cached.items.push(item);
          try { localStorage.setItem(this.kRunData(runId), JSON.stringify(cached)); } catch {}
        }
      })
    );
  }

  getVariantsStatus(runId: string) {
    return this.http.get<{ runId: string; templateId: string; target: number; count: number; items: VariantItem[] }>(
      `/api/qa/variants/${runId}/status`
    ).pipe(
      catchError((e) => {
        // If the server restarted or id is wrong, surface a helpful error
        if (e?.status === 404) {
          return throwError(() => new Error('Run not found (server restarted or bad runId). Start a new run.'));
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
    } catch { return null; }
  }

  saveChat(runId: string, no: number, thread: ChatThread) {
    try { localStorage.setItem(this.kChat(runId, no), JSON.stringify(thread)); } catch {}
  }

  sendChatMessage(
    runId: string,
    no: number,
    html: string,
    history: Array<{ role: 'user'|'assistant'; content: string }>,
    userMessage: string
  ) {
    return this.http.post<{ assistantText: string; json: ChatAssistantJson }>(
      `/api/qa/variants/${runId}/chat/message`,
      { no, html, history, userMessage }
    );
  }

  /** Apply assistant (or manual) edits to current HTML. */
  applyChatEdits(runId: string, html: string, edits: GoldenEdit[]) {
    // Note: backend doesn't need the variant number for apply
    return this.http.post<{ html: string; changes: Array<{ before: string; after: string; parent: string; reason?: string }> }>(
      `/api/qa/variants/${runId}/chat/apply`,
      { html, edits }
    );
  }

  /* ------------------------------ Snapshots ------------------------------- */
  /** Get snapshot list for a specific template + variant + run (persisted). */
  getSnapsCached(templateId: string, no: number, runId: string): SnapResult[] {
    try {
      const raw = localStorage.getItem(this.kSnaps(templateId, no, runId));
      const list = raw ? (JSON.parse(raw) as SnapResult[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  /** Save/overwrite snapshot list for a specific template + variant + run. */
  saveSnaps(templateId: string, no: number, runId: string, snaps: SnapResult[]) {
    try { localStorage.setItem(this.kSnaps(templateId, no, runId), JSON.stringify(snaps)); } catch {}
  }

  /** Insert or replace a single snapshot by URL (prefers finalUrl match if present). */
  addOrReplaceSnap(templateId: string, no: number, runId: string, snap: SnapResult): SnapResult[] {
    const list = this.getSnapsCached(templateId, no, runId);
    const key = (snap.finalUrl || snap.url).toLowerCase();
    const idx = list.findIndex(s => ((s.finalUrl || s.url).toLowerCase() === key));
    if (idx >= 0) list[idx] = snap;
    else list.unshift(snap); // newest first
    this.saveSnaps(templateId, no, runId, list);
    return list;
  }

  /** Call backend to capture a screenshot for URL; persists the result. */
  snapUrl(templateId: string, no: number, runId: string, url: string) {
    return this.http.post<SnapApiResponse>(`/api/qa/snap`, { url }).pipe(
      map((resp) => {
        const snap: SnapResult = { ...resp, ts: Date.now() };
        const snaps = this.addOrReplaceSnap(templateId, no, runId, snap);
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
        const snaps = this.addOrReplaceSnap(templateId, no, runId, snap);
        return of({ snap, snaps });
      })
    );
  }
}
