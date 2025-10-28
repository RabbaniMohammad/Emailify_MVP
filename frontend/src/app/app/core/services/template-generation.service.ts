import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import { DatabaseService } from '../../../core/services/db.service';

/* ----------------------------- Types ----------------------------- */

export interface GenerationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  images?: Array<{
    data: string;
    mediaType: string;
    fileName: string;
  }>;
}

export interface ConversationState {
  conversationId: string;
  messages: GenerationMessage[];
  currentHtml: string;
  currentMjml: string;
  templateName?: string;
  status: 'active' | 'saved' | 'discarded';
  createdAt: Date;
  updatedAt: Date;
}

export interface StartGenerationResponse {
  conversationId: string;
  html: string;
  mjml: string;
  message: string;
  hasErrors: boolean;
  errors: Array<{
    line: number;
    message: string;
    tagName: string;
  }>;
}

export interface ContinueGenerationResponse {
  conversationId: string;
  html: string;
  mjml: string;
  message: string;
  hasErrors: boolean;
  errors: Array<{
    line: number;
    message: string;
    tagName: string;
  }>;
}

export interface SaveTemplateResponse {
  templateId: string;
  templateName: string;
  fileName: string;
  message: string;
}

export interface ConversationHistoryItem {
  conversationId: string;
  templateName: string;
  status: 'active' | 'saved' | 'discarded';
  messageCount: number;
  lastMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({ providedIn: 'root' })
export class TemplateGenerationService {
  private http = inject(HttpClient);
  private db!: DatabaseService; // 🔥 ADD IndexedDB

  constructor() {
    // Manual injection to avoid circular dependency
    this.db = inject(DatabaseService);
  }

  /* ---------- localStorage keys ---------- */
  private kConversation(conversationId: string) {
    return `generate:conversation:${conversationId}`;
  }

  private kCurrentConversationId() {
    return 'generate:currentConversationId';
  }

  /* --------------------------- Start Generation -------------------------- */

startGeneration(
  prompt: string,
  images?: Array<{ data: string; mediaType: string; fileName: string }>,
  conversationId?: string
): Observable<StartGenerationResponse> {
  if (images && images.length > 0) {
  }

  const payload = { prompt, images, conversationId };
  return this.http.post<StartGenerationResponse>(
    '/api/generate/start',
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // Cache the conversation
      const conversationState = {
        conversationId: response.conversationId,
        messages: [
          { 
            role: 'user' as const, 
            content: prompt, 
            timestamp: new Date(),
            images: images || undefined
          },
          { 
            role: 'assistant' as const, 
            content: response.message, 
            timestamp: new Date() 
          }
        ],
        currentHtml: response.html,
        currentMjml: response.mjml,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.cacheConversation(response.conversationId, conversationState);

      // Set as current conversation
      this.setCurrentConversationId(response.conversationId);
    })
  );
}

  /* --------------------------- Continue Conversation -------------------------- */

continueConversation(
  conversationId: string,
  message: string,
  images?: Array<{ data: string; mediaType: string; fileName: string }>
): Observable<ContinueGenerationResponse> {
  if (images && images.length > 0) {
  }

  const payload = { message, images };
  return this.http.post<ContinueGenerationResponse>(
    `/api/generate/continue/${conversationId}`,
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // Update cached conversation
      const cached = this.getConversationCached(conversationId);
      if (cached) {
        cached.messages.push(
          { 
            role: 'user', 
            content: message, 
            timestamp: new Date(),
            images: images || undefined
          },
          { 
            role: 'assistant', 
            content: response.message, 
            timestamp: new Date() 
          }
        );
        
        cached.currentHtml = response.html;
        cached.currentMjml = response.mjml;
        cached.updatedAt = new Date();
        
        this.cacheConversation(conversationId, cached);
      }
    })
  );
}

  /* --------------------------- Get Conversation -------------------------- */

  getConversation(conversationId: string): Observable<ConversationState> {
    // Check cache first
    const cached = this.getConversationCached(conversationId);
    if (cached) {
      return of(cached);
    }

    // Fetch from backend
    return this.http.get<ConversationState>(
      `/api/generate/conversation/${conversationId}`,
      { withCredentials: true }
    ).pipe(
      tap((conversation) => {
        this.cacheConversation(conversationId, conversation);
      })
    );
  }

  /* --------------------------- Get History -------------------------- */

  getHistory(limit = 10, offset = 0): Observable<{
    items: ConversationHistoryItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.http.get<{
      items: ConversationHistoryItem[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/generate/history?limit=${limit}&offset=${offset}`, {
      withCredentials: true,
    });
  }

  /* --------------------------- Save Template -------------------------- */
saveTemplate(
  conversationId: string,
  templateName: string
): Observable<SaveTemplateResponse> {
  return this.http.post<SaveTemplateResponse>(
    `/api/generate/save/${conversationId}`,
    { templateName },
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // Update cached conversation
      const cached = this.getConversationCached(conversationId);
      
      if (cached) {
        cached.templateName = templateName;
        cached.status = 'saved';
        
        this.cacheConversation(conversationId, cached);
        
      } else {
      }
    })
  );
}

  /* --------------------------- Preview MJML -------------------------- */

  previewMjml(mjml: string): Observable<{
    html: string;
    hasErrors: boolean;
    errors: Array<{
      line: number;
      message: string;
      tagName: string;
    }>;
  }> {
    return this.http.post<{
      html: string;
      hasErrors: boolean;
      errors: Array<{
        line: number;
        message: string;
        tagName: string;
      }>;
    }>('/api/generate/preview', { mjml }, { withCredentials: true });
  }

  /* --------------------------- Get Starter Template -------------------------- */

  getStarter(): Observable<{ mjml: string; html: string }> {
    return this.http.get<{ mjml: string; html: string }>(
      '/api/generate/starter',
      { withCredentials: true }
    );
  }

  /* --------------------------- localStorage Helpers -------------------------- */

getConversationCached(conversationId: string): ConversationState | null {
  try {
    const raw = localStorage.getItem(this.kConversation(conversationId));
    if (!raw) {
      return null;
    }
    
    const parsed = JSON.parse(raw);
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    parsed.messages = parsed.messages.map((m: any) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      images: m.images || undefined, // Preserve images if they exist
    }));
    
    return parsed as ConversationState;
  } catch (error) {

    return null;
  }
}

cacheConversation(conversationId: string, state: ConversationState): void {
  try {
    localStorage.setItem(this.kConversation(conversationId), JSON.stringify(state));
  } catch (err) {

  }
}

  getCurrentConversationId(): string | null {
    try {
      return localStorage.getItem(this.kCurrentConversationId());
    } catch {
      return null;
    }
  }

  setCurrentConversationId(conversationId: string): void {
    try {
      localStorage.setItem(this.kCurrentConversationId(), conversationId);
    } catch (err) {

    }
  }

  clearCurrentConversationId(): void {
    try {
      localStorage.removeItem(this.kCurrentConversationId());
    } catch (err) {

    }
  }

  clearConversationCache(conversationId: string): void {
    try {
      localStorage.removeItem(this.kConversation(conversationId));
    } catch (err) {

    }
  }
}