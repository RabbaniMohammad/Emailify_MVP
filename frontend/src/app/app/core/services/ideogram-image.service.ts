import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface IdeogramGenerationRequest {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  model?: 'V_2' | 'V_2_TURBO';
  magicPromptOption?: 'AUTO' | 'ON' | 'OFF';
  styleType?: 'GENERAL' | 'REALISTIC' | 'DESIGN' | 'RENDER_3D' | 'ANIME';
  negativePrompt?: string;
}

export interface IdeogramGenerationResponse {
  created: string;
  data: Array<{
    url: string;
    prompt: string;
    resolution: string;
    is_image_safe: boolean;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class IdeogramImageService {
  private http = inject(HttpClient);
  // Prefer using the existing backend Ideogram routes if available (/api/ideogram).
  // We previously used a separate proxy at /api/ai-image to experiment with v3.
  // If your Ideogram API key is for v2 (or the app already has working /api/ideogram routes),
  // switch to '/api/ideogram' so we reuse the existing handlers.
  private apiUrl = '/api/ideogram'; // use existing backend ideogram routes by default

  /**
   * Generate images using Ideogram 2.0 API
   */
  generateImage(request: IdeogramGenerationRequest): Observable<IdeogramGenerationResponse> {
    const payload = {
      image_request: {
        prompt: request.prompt,
        aspect_ratio: request.aspectRatio || '1:1',
        model: request.model || 'V_2',
        magic_prompt_option: request.magicPromptOption || 'AUTO',
  style_type: request.styleType || 'REALISTIC',
        ...(request.negativePrompt && { negative_prompt: request.negativePrompt })
      }
    };

    return this.http.post<IdeogramGenerationResponse>(
      `${this.apiUrl}/generate`,
      payload
    ).pipe(
      // Our backend proxies Ideogram and wraps responses as { success: true, data: <ideogramResponse> }
      // Normalize so callers receive the inner Ideogram response directly.
      map((res: any) => {
        if (res && res.data) return res.data as IdeogramGenerationResponse;
        return res as IdeogramGenerationResponse;
      }),
      catchError(error => {
        console.error('Ideogram API Error:', error);
        return throwError(() => new Error(
          error.error?.message || 'Failed to generate image. Please try again.'
        ));
      })
    );
  }

  /**
   * Generate multiple images with different variations
   */
  generateVariations(
    prompt: string, 
    count: number = 4,
    options?: Partial<IdeogramGenerationRequest>
  ): Observable<IdeogramGenerationResponse> {
    const request: IdeogramGenerationRequest = {
      prompt,
      ...options
    };

    return this.generateImage(request);
  }

  /**
   * Describe an image using Ideogram's describe endpoint
   */
  describeImage(imageUrl: string): Observable<{ descriptions: string[] }> {
    return this.http.post<{ descriptions: string[] }>(
      `${this.apiUrl}/describe`,
      { image_url: imageUrl }
    ).pipe(
      catchError(error => {
        console.error('Ideogram Describe Error:', error);
        return throwError(() => new Error(
          error.error?.message || 'Failed to describe image.'
        ));
      })
    );
  }

  /**
   * Remix an existing image with a new prompt
   */
  remixImage(
    imageUrl: string,
    prompt: string,
    options?: Partial<IdeogramGenerationRequest>
  ): Observable<IdeogramGenerationResponse> {
    const payload = {
      image_request: {
        prompt,
        image_file: imageUrl,
        aspect_ratio: options?.aspectRatio || '1:1',
        model: options?.model || 'V_2',
        magic_prompt_option: options?.magicPromptOption || 'AUTO',
  style_type: options?.styleType || 'REALISTIC',
        ...(options?.negativePrompt && { negative_prompt: options.negativePrompt })
      }
    };

    return this.http.post<IdeogramGenerationResponse>(
      `${this.apiUrl}/remix`,
      payload
    ).pipe(
      map((res: any) => {
        // Backend wraps Ideogram responses as { success: true, data: <ideogramResponse> }
        if (res && res.data) return res.data as IdeogramGenerationResponse;
        return res as IdeogramGenerationResponse;
      }),
      catchError(error => {
        console.error('Ideogram Remix Error:', error);
        return throwError(() => new Error(
          error.error?.message || 'Failed to remix image.'
        ));
      })
    );
  }
}
