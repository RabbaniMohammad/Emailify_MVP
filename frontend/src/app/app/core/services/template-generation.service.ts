import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';

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
  images?: Array<{ data: string; mediaType: string; fileName: string }>
): Observable<StartGenerationResponse> {
  console.log('🚀 TemplateGenerationService.startGeneration() called');
  console.log('📝 Prompt:', prompt);
  console.log('🖼️ Images count:', images?.length || 0);
  
  if (images && images.length > 0) {
    console.log('📊 Image details:', images.map(img => ({
      fileName: img.fileName,
      mediaType: img.mediaType,
      dataLength: img.data.length
    })));
  }

  const payload = { prompt, images };
  console.log('📦 Request payload:', { prompt, imagesCount: images?.length || 0 });

  return this.http.post<StartGenerationResponse>(
    '/api/generate/start',
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      console.log('✅ startGeneration response received:', {
        conversationId: response.conversationId,
        htmlLength: response.html?.length,
        hasErrors: response.hasErrors
      });

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

      console.log('💾 Caching conversation:', response.conversationId);
      console.log('📊 User message has images:', !!images);
      this.cacheConversation(response.conversationId, conversationState);

      // Set as current conversation
      console.log('🔖 Setting current conversation ID:', response.conversationId);
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
  console.log('💬 TemplateGenerationService.continueConversation() called');
  console.log('🆔 Conversation ID:', conversationId);
  console.log('📝 Message:', message);
  console.log('🖼️ Images count:', images?.length || 0);
  
  if (images && images.length > 0) {
    console.log('📊 Image details:', images.map(img => ({
      fileName: img.fileName,
      mediaType: img.mediaType,
      dataLength: img.data.length
    })));
  }

  const payload = { message, images };
  console.log('📦 Request payload:', { message, imagesCount: images?.length || 0 });

  return this.http.post<ContinueGenerationResponse>(
    `/api/generate/continue/${conversationId}`,
    payload,
    { withCredentials: true }
  ).pipe(
    tap((response) => {
      console.log('✅ continueConversation response received:', {
        conversationId: response.conversationId,
        htmlLength: response.html?.length,
        hasErrors: response.hasErrors
      });

      // Update cached conversation
      const cached = this.getConversationCached(conversationId);
      console.log('💾 Cached conversation found:', !!cached);
      
      if (cached) {
        console.log('📊 Current messages count:', cached.messages.length);
        
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
        
        console.log('📊 Messages count after adding:', cached.messages.length);
        console.log('🖼️ User message has images:', !!images);
        
        cached.currentHtml = response.html;
        cached.currentMjml = response.mjml;
        cached.updatedAt = new Date();
        
        console.log('💾 Updating cached conversation...');
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
  console.log('💾 getConversationCached() called for:', conversationId);
  
  try {
    const raw = localStorage.getItem(this.kConversation(conversationId));
    console.log('📦 Raw data from localStorage:', raw ? 'Found' : 'Not found');
    
    if (!raw) {
      console.log('❌ No cached conversation found');
      return null;
    }
    
    console.log('🔄 Parsing cached data...');
    const parsed = JSON.parse(raw);
    console.log('✅ Data parsed successfully');
    console.log('📊 Cached messages count:', parsed.messages?.length);
    
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    parsed.updatedAt = new Date(parsed.updatedAt);
    parsed.messages = parsed.messages.map((m: any) => ({
      ...m,
      timestamp: new Date(m.timestamp),
      images: m.images || undefined, // Preserve images if they exist
    }));
    
    console.log('✅ Dates converted successfully');
    console.log('🖼️ Messages with images:', parsed.messages.filter((m: any) => m.images).length);
    console.log('✅ Returning cached conversation');
    
    return parsed as ConversationState;
  } catch (error) {
    console.error('❌ Error getting cached conversation:', error);
    return null;
  }
}

cacheConversation(conversationId: string, state: ConversationState): void {
  console.log('💾 cacheConversation() called');
  console.log('🆔 Conversation ID:', conversationId);
  console.log('📊 State to cache:', {
    messagesCount: state.messages.length,
    status: state.status,
    hasTemplateName: !!state.templateName,
    htmlLength: state.currentHtml?.length,
    mjmlLength: state.currentMjml?.length
  });
  console.log('🖼️ Messages with images:', state.messages.filter(m => m.images).length);
  
  try {
    const jsonString = JSON.stringify(state);
    console.log('📦 JSON size:', `${(jsonString.length / 1024).toFixed(2)}KB`);
    
    localStorage.setItem(
      this.kConversation(conversationId),
      jsonString
    );
    console.log('✅ Conversation cached successfully');
  } catch (err) {
    console.error('❌ Failed to cache conversation:', err);
    console.error('Error details:', err);
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
      console.error('Failed to set current conversation ID:', err);
    }
  }

  clearCurrentConversationId(): void {
    try {
      localStorage.removeItem(this.kCurrentConversationId());
    } catch (err) {
      console.error('Failed to clear current conversation ID:', err);
    }
  }

  clearConversationCache(conversationId: string): void {
    try {
      localStorage.removeItem(this.kConversation(conversationId));
    } catch (err) {
      console.error('Failed to clear conversation cache:', err);
    }
  }
}