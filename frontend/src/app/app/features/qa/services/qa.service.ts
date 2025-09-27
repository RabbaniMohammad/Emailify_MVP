import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, of, tap } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class QaService {
  private http = inject(HttpClient);

  /* ---------- localStorage keys ---------- */
  private kGolden(id: string)   { return `qa:golden:${id}`; }
  private kSubjects(id: string) { return `qa:subjects:${id}`; }

  private kRunId(tplId: string)   { return `qa:variants:runId:${tplId}`; }
  private kRunData(runId: string) { return `qa:variants:run:${runId}`; }

  private kChat(runId: string, no: number) { return `qa:chat:${runId}:${no}`; }

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

  saveVariantsRun(templateId: string, run: VariantsRun) {
    try {
      localStorage.setItem(this.kRunId(templateId), run.runId);
      localStorage.setItem(this.kRunData(run.runId), JSON.stringify(run));
    } catch {}
  }

  startVariants(templateId: string, goldenHtml: string, target = 5) {
    return this.http.post<{ runId: string; target: number }>(
      `/api/qa/${templateId}/variants/start`, { html: goldenHtml, target }
    );
  }

  nextVariant(runId: string) {
    return this.http.post<VariantItem>(`/api/qa/variants/${runId}/next`, {});
  }

  getVariantsStatus(runId: string) {
    return this.http.get<{ runId: string; templateId: string; target: number; count: number; items: VariantItem[] }>(
      `/api/qa/variants/${runId}/status`
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
}
