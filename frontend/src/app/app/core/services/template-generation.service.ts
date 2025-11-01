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

  /* ---------- sessionStorage keys (like QA page) ---------- */
  private kConversation(conversationId: string) {
    return `generate:conversation:${conversationId}`;
  }

  private kCurrentConversationId() {
    return 'generate:currentConversationId';
  }
  
  private kConversationSession(conversationId: string) {
    return `generate_session:${conversationId}`;
  }

  /* --------------------------- Start Generation -------------------------- */

startGeneration(
  prompt: string,
  images?: Array<{ data: string; mediaType: string; fileName: string }>,
  conversationId?: string
): Observable<StartGenerationResponse> {
  console.log('🔵 [SERVICE] startGeneration called:', {
    promptLength: prompt.length,
    imageCount: images?.length || 0,
    conversationId
  });
  const payload = { prompt, images, conversationId };
  return this.http.post<StartGenerationResponse>(
    '/api/generate/start',
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      console.log('🔵 [SERVICE] startGeneration response:', {
        conversationId: response.conversationId,
        hasHtml: !!response.html,
        hasMjml: !!response.mjml
      });
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
  console.log('🔵 [SERVICE] continueConversation called:', {
    conversationId,
    messageLength: message.length,
    imageCount: images?.length || 0
  });
  const payload = { message, images };
  return this.http.post<ContinueGenerationResponse>(
    `/api/generate/continue/${conversationId}`,
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      console.log('🔵 [SERVICE] continueConversation response:', {
        conversationId: response.conversationId,
        hasHtml: !!response.html,
        hasMjml: !!response.mjml
      });
    })
  );
}

  /* --------------------------- Chat (Unified Endpoint) -------------------------- */

  chat(
    message: string,
    conversationHistory: GenerationMessage[],
    currentMjml?: string,
    images?: Array<{ data: string; mediaType: string; fileName: string }>,
    extractedFileData?: string
  ): Observable<{
    html: string;
    mjml: string;
    message: string;
    hasErrors: boolean;
    errors: Array<{ line: number; message: string; tagName: string }>;
  }> {
    console.log('🔵 [SERVICE] chat called:', {
      messageLength: message.length,
      historyLength: conversationHistory.length,
      hasCurrentMjml: !!currentMjml,
      imageCount: images?.length || 0,
      hasExtractedFileData: !!extractedFileData,
      extractedFileDataLength: extractedFileData?.length || 0
    });
    
    const payload = {
      message,
      conversationHistory,
      currentMjml,
      images,
      extractedFileData
    };
    
    return this.http.post<{
      html: string;
      mjml: string;
      message: string;
      hasErrors: boolean;
      errors: Array<{ line: number; message: string; tagName: string }>;
    }>(
      '/api/generate/chat',
      payload,
      { withCredentials: true }
    ).pipe(
      tap((response) => {
        console.log('🔵 [SERVICE] chat response:', {
          hasHtml: !!response.html,
          hasMjml: !!response.mjml,
          message: response.message
        });
      })
    );
  }

  /* --------------------------- Get Conversation -------------------------- */

  getConversation(conversationId: string): Observable<ConversationState> {
    // ✅ CACHE ONLY: No database storage, everything in IndexedDB
    const cached = this.getConversationCached(conversationId);
    console.log('🔵 [SERVICE] getConversation called:', {
      conversationId,
      hasCachedData: !!cached,
      cachedMessagesCount: cached?.messages?.length || 0
    });
    
    if (cached && cached.messages && cached.messages.length > 0) {
      console.log('🔵 [SERVICE] Returning cached conversation');
      return of(cached);
    }

    // ✅ No database call - return empty conversation if not in cache
    console.log('🔵 [SERVICE] No cache found, returning empty conversation');
    const emptyConversation: ConversationState = {
      conversationId,
      messages: [],
      currentHtml: '',
      currentMjml: '',
      templateName: 'Generated Template',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    return of(emptyConversation);
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
  // ✅ Get HTML and MJML from cache to send to backend
  const cached = this.getConversationCached(conversationId);
  
  if (!cached || !cached.currentHtml) {
    throw new Error('No template to save');
  }
  
  console.log('💾 [SERVICE] Saving template:', {
    conversationId,
    templateName,
    hasHtml: !!cached.currentHtml,
    hasMjml: !!cached.currentMjml
  });

  return this.http.post<SaveTemplateResponse>(
    `/api/generate/save/${conversationId}`,
    { 
      templateName,
      html: cached.currentHtml,  // ✅ Send HTML from cache
      mjml: cached.currentMjml   // ✅ Send MJML from cache
    },
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // Update cached conversation
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
    // ✅ PRIORITY 1: Check sessionStorage first (like QA page - survives refresh)
    const sessionKey = this.kConversationSession(conversationId);
    let raw = sessionStorage.getItem(sessionKey);
    let source = 'sessionStorage';
    
    // ✅ PRIORITY 2: Fallback to localStorage (longer persistence)
    if (!raw) {
      const localKey = this.kConversation(conversationId);
      raw = localStorage.getItem(localKey);
      source = 'localStorage';
    }
    
    if (!raw) {
      return null;
    }
    
    const parsed = JSON.parse(raw);
    
    // Validate required fields
    if (!parsed.conversationId || !Array.isArray(parsed.messages)) {
      this.clearConversationCache(conversationId);
      return null;
    }
    
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    parsed.messages = parsed.messages.map((m: any) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      images: m.images || undefined,
    }));
    
    return parsed as ConversationState;
  } catch (error: any) {
    // Clear corrupted cache
    try {
      this.clearConversationCache(conversationId);
    } catch (e) {
      // Ignore cleanup errors
    }
    return null;
  }
}

cacheConversation(conversationId: string, state: ConversationState): void {
  try {
    const serialized = JSON.stringify(state);
    
    // ✅ Save to BOTH sessionStorage (priority - survives refresh) AND localStorage (backup)
    try {
      const sessionKey = this.kConversationSession(conversationId);
      sessionStorage.setItem(sessionKey, serialized);
    } catch (sessionErr: any) {
      // If sessionStorage is full, clear old conversations
      this.clearOldConversations('session');
      try {
        sessionStorage.setItem(this.kConversationSession(conversationId), serialized);
      } catch (retryErr) {
        // Silent fail - localStorage will be backup
      }
    }
    
    try {
      const localKey = this.kConversation(conversationId);
      localStorage.setItem(localKey, serialized);
    } catch (localErr) {
      // Silent fail - sessionStorage is primary
    }
  } catch (err) {
    // Silent fail
  }
}

updateConversationCache(
  conversationId: string,
  messages: GenerationMessage[],
  currentHtml: string,
  currentMjml: string,
  templateName?: string
): void {
  console.log('🔵 [SERVICE] updateConversationCache called:', {
    conversationId,
    messagesCount: messages.length,
    hasHtml: !!currentHtml,
    hasMjml: !!currentMjml,
    templateName
  });
  
  try {
    const cached = this.getConversationCached(conversationId);
    if (cached) {
      console.log('🔵 [SERVICE] Updating existing cache entry');
      cached.messages = messages;
      cached.currentHtml = currentHtml;
      cached.currentMjml = currentMjml;
      if (templateName !== undefined) {
        cached.templateName = templateName;
      }
      cached.updatedAt = new Date();
      this.cacheConversation(conversationId, cached);
    } else {
      console.log('🔵 [SERVICE] Creating new cache entry');
      // Create new cache entry
      const newState: ConversationState = {
        conversationId,
        messages,
        currentHtml,
        currentMjml,
        templateName,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.cacheConversation(conversationId, newState);
    }
  } catch (err) {
    console.error('🔴 [SERVICE] updateConversationCache error:', err);
    // Silent fail
  }
}

  getCurrentConversationId(): string | null {
    try {
      // ✅ Check sessionStorage first (like QA page)
      return sessionStorage.getItem(this.kCurrentConversationId()) || 
             localStorage.getItem(this.kCurrentConversationId());
    } catch {
      return null;
    }
  }

  setCurrentConversationId(conversationId: string): void {
    try {
      // ✅ Save to BOTH storages
      sessionStorage.setItem(this.kCurrentConversationId(), conversationId);
      localStorage.setItem(this.kCurrentConversationId(), conversationId);
    } catch (err) {

    }
  }

  clearCurrentConversationId(): void {
    try {
      sessionStorage.removeItem(this.kCurrentConversationId());
      localStorage.removeItem(this.kCurrentConversationId());
    } catch (err) {

    }
  }

  clearConversationCache(conversationId: string): void {
    try {
      sessionStorage.removeItem(this.kConversationSession(conversationId));
      localStorage.removeItem(this.kConversation(conversationId));
    } catch (err) {

    }
  }
  
  private clearOldConversations(storageType: 'session' | 'local' = 'session'): void {
    try {
      const storage = storageType === 'session' ? sessionStorage : localStorage;
      const prefix = storageType === 'session' ? 'generate_session:' : 'generate:conversation:';
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      
      // Remove oldest conversations (keep only the 5 most recent)
      if (keysToRemove.length > 5) {
        keysToRemove.slice(0, keysToRemove.length - 5).forEach(key => {
          storage.removeItem(key);
        });
      }
    } catch (err) {
      // Silent fail
    }
  }
}