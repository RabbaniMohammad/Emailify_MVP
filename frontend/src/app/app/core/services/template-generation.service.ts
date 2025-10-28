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
  if (images && images.length > 0) {
  }

  const payload = { prompt, images, conversationId };
  return this.http.post<StartGenerationResponse>(
    '/api/generate/start',
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // ✅ Minimal cache - component will update with full message context
      // This prevents double-caching and message inconsistencies
      console.log('✅ Start generation response received:', {
        conversationId: response.conversationId,
        htmlLength: response.html?.length || 0,
        hasErrors: response.hasErrors
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
  if (images && images.length > 0) {
  }

  const payload = { message, images };
  return this.http.post<ContinueGenerationResponse>(
    `/api/generate/continue/${conversationId}`,
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      // ✅ Cache update removed - component will handle it with full context
      // This prevents race conditions and duplicate cache updates
      console.log('✅ Continue conversation response received:', {
        conversationId,
        htmlLength: response.html?.length || 0,
        hasErrors: response.hasErrors
      });
    })
  );
}

  /* --------------------------- Get Conversation -------------------------- */

  getConversation(conversationId: string): Observable<ConversationState> {
    console.log('🌐🌐🌐 [SERVICE-GET] getConversation called for:', conversationId);
    
    // ✅ MATCH QA PAGE PATTERN: Always check cache first for instant load
    const cached = this.getConversationCached(conversationId);
    if (cached && cached.messages && cached.messages.length > 0) {
      console.log('✅✅✅ [SERVICE-GET] Using cached conversation (INSTANT LOAD)');
      console.log('✅ [SERVICE-GET] Cache details:', {
        messageCount: cached.messages.length,
        hasHtml: !!cached.currentHtml,
        htmlLength: cached.currentHtml?.length || 0
      });
      
      // ✅ Return cached immediately - NO background fetch to avoid conflicts
      // Unlike QA page which has stable template IDs, conversations are ephemeral
      // and may not exist on server until first message is sent
      return of(cached);
    }

    // No cache or incomplete cache - fetch from server
    console.log('📡📡 [SERVICE-GET] No cache found, fetching from backend');
    return this.http.get<ConversationState>(
      `/api/generate/conversation/${conversationId}`,
      { withCredentials: true }
    ).pipe(
      tap((conversation) => {
        console.log('✅✅✅ [SERVICE-GET] Conversation fetched from backend successfully');
        console.log('✅ [SERVICE-GET] Backend data:', {
          messageCount: conversation.messages.length,
          hasHtml: !!conversation.currentHtml,
          htmlLength: conversation.currentHtml?.length || 0
        });
        console.log('💾 [SERVICE-GET] Calling cacheConversation to save backend data');
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
  console.log('🔍🔍🔍 [CACHE-GET] Looking for conversation:', conversationId);
  
  try {
    // ✅ PRIORITY 1: Check sessionStorage first (like QA page - survives refresh)
    const sessionKey = this.kConversationSession(conversationId);
    let raw = sessionStorage.getItem(sessionKey);
    let source = 'sessionStorage';
    
    console.log('🔍 [CACHE-GET] Checking sessionStorage with key:', sessionKey);
    console.log('🔍 [CACHE-GET] sessionStorage result:', raw ? `Found (${raw.length} bytes)` : 'Not found');
    
    // ✅ PRIORITY 2: Fallback to localStorage (longer persistence)
    if (!raw) {
      const localKey = this.kConversation(conversationId);
      raw = localStorage.getItem(localKey);
      source = 'localStorage';
      
      console.log('🔍 [CACHE-GET] Checking localStorage with key:', localKey);
      console.log('🔍 [CACHE-GET] localStorage result:', raw ? `Found (${raw.length} bytes)` : 'Not found');
    }
    
    if (!raw) {
      console.log('📭📭📭 [CACHE-GET] No cached conversation found in either storage');
      return null;
    }
    
    console.log(`📦📦📦 [CACHE-GET] Found cached conversation in ${source}`);
    const parsed = JSON.parse(raw);
    
    // Validate required fields
    if (!parsed.conversationId || !Array.isArray(parsed.messages)) {
      console.warn('⚠️⚠️ [CACHE-GET] Invalid cached conversation data - missing required fields');
      console.warn('⚠️ [CACHE-GET] Data:', { hasConversationId: !!parsed.conversationId, hasMessages: Array.isArray(parsed.messages) });
      this.clearConversationCache(conversationId);
      return null;
    }
    
    console.log('✅✅✅ [CACHE-GET] Cached conversation is VALID');
    console.log('✅ [CACHE-GET] Details:', {
      messageCount: parsed.messages.length,
      hasHtml: !!parsed.currentHtml,
      htmlLength: parsed.currentHtml?.length || 0,
      templateName: parsed.templateName,
      source
    });
    
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    parsed.messages = parsed.messages.map((m: any) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      images: m.images || undefined, // Preserve images if they exist
    }));
    
    console.log('✅ [CACHE-GET] Returning parsed conversation');
    return parsed as ConversationState;
  } catch (error: any) {
    console.error('❌❌❌ [CACHE-GET] Error parsing cached conversation:', error.message, error);
    // Clear corrupted cache
    try {
      this.clearConversationCache(conversationId);
      console.log('🗑️ [CACHE-GET] Cleared corrupted cache');
    } catch (e) {
      console.error('❌ [CACHE-GET] Failed to clear corrupted cache:', e);
    }
    return null;
  }
}

cacheConversation(conversationId: string, state: ConversationState): void {
  console.log('💾💾💾 [CACHE-SAVE] Starting save operation for:', conversationId);
  console.log('💾 [CACHE-SAVE] Data to save:', {
    conversationId: state.conversationId,
    messageCount: state.messages.length,
    hasHtml: !!state.currentHtml,
    htmlLength: state.currentHtml?.length || 0,
    templateName: state.templateName,
    status: state.status
  });
  
  try {
    const serialized = JSON.stringify(state);
    console.log('💾 [CACHE-SAVE] Serialized length:', serialized.length, 'bytes');
    
    // ✅ Save to BOTH sessionStorage (priority - survives refresh) AND localStorage (backup)
    // This mimics how QA page preserves state across refresh
    try {
      const sessionKey = this.kConversationSession(conversationId);
      sessionStorage.setItem(sessionKey, serialized);
      console.log('✅✅✅ [CACHE-SAVE] SUCCESS - Saved to sessionStorage with key:', sessionKey);
      
      // Verify it was saved
      const verification = sessionStorage.getItem(sessionKey);
      console.log('✅ [CACHE-SAVE] Verification - Can read back from sessionStorage:', !!verification);
    } catch (sessionErr: any) {
      console.error('❌ [CACHE-SAVE] sessionStorage ERROR:', sessionErr.message);
      console.warn('⚠️ [CACHE-SAVE] sessionStorage full, attempting to clear old data');
      // If sessionStorage is full, clear old conversations
      this.clearOldConversations('session');
      try {
        sessionStorage.setItem(this.kConversationSession(conversationId), serialized);
        console.log('✅ [CACHE-SAVE] Saved to sessionStorage after cleanup');
      } catch (retryErr: any) {
        console.error('❌ [CACHE-SAVE] sessionStorage FAILED even after cleanup:', retryErr.message);
      }
    }
    
    try {
      const localKey = this.kConversation(conversationId);
      localStorage.setItem(localKey, serialized);
      console.log('✅✅✅ [CACHE-SAVE] SUCCESS - Saved to localStorage with key:', localKey);
      
      // Verify it was saved
      const verification = localStorage.getItem(localKey);
      console.log('✅ [CACHE-SAVE] Verification - Can read back from localStorage:', !!verification);
    } catch (localErr: any) {
      console.error('❌ [CACHE-SAVE] localStorage ERROR:', localErr.message);
      console.warn('⚠️ [CACHE-SAVE] localStorage full, using sessionStorage only');
    }
    
    console.log('💾💾💾 [CACHE-SAVE] Save operation completed');
  } catch (err: any) {
    console.error('❌❌❌ [CACHE-SAVE] CRITICAL ERROR - Failed to save:', err.message, err);
  }
}

updateConversationCache(
  conversationId: string,
  messages: GenerationMessage[],
  currentHtml: string,
  currentMjml: string,
  templateName?: string
): void {
  console.log('🔄🔄🔄 [UPDATE-CACHE] Starting update for:', conversationId);
  console.log('🔄 [UPDATE-CACHE] Update data:', {
    messageCount: messages.length,
    htmlLength: currentHtml.length,
    mjmlLength: currentMjml.length,
    templateName,
    messagesPreview: messages.slice(-2).map(m => ({ role: m.role, content: m.content.substring(0, 50) }))
  });
  
  try {
    const cached = this.getConversationCached(conversationId);
    if (cached) {
      console.log('🔄 [UPDATE-CACHE] Found existing cache, updating it');
      cached.messages = messages;
      cached.currentHtml = currentHtml;
      cached.currentMjml = currentMjml;
      if (templateName !== undefined) {
        cached.templateName = templateName;
      }
      cached.updatedAt = new Date();
      
      console.log('🔄 [UPDATE-CACHE] Calling cacheConversation with updated state');
      this.cacheConversation(conversationId, cached);
      console.log('✅✅✅ [UPDATE-CACHE] Successfully updated existing cache');
    } else {
      console.log('📦 [UPDATE-CACHE] No existing cache found, creating NEW cache entry');
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
      
      console.log('📦 [UPDATE-CACHE] New state created:', {
        conversationId: newState.conversationId,
        messageCount: newState.messages.length,
        hasHtml: !!newState.currentHtml,
        status: newState.status
      });
      
      console.log('📦 [UPDATE-CACHE] Calling cacheConversation with NEW state');
      this.cacheConversation(conversationId, newState);
      console.log('✅✅✅ [UPDATE-CACHE] Successfully created new cache entry');
    }
  } catch (err: any) {
    console.error('❌❌❌ [UPDATE-CACHE] CRITICAL ERROR:', err.message, err);
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
      console.error('Failed to clear old conversations:', err);
    }
  }
}