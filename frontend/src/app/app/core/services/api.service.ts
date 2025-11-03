import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

export interface Template { id: string; name: string }
export interface TemplatesResponse { items: Template[]; total: number }
export interface TemplateDetail { id: string; name: string; html?: string }




@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private readonly BASE_URL = ''; // Use relative URLs (proxied by nginx)

  getTemplates(query = '', limit = 100, offset = 0) {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (query) params = params.set('query', query);
    return this.http.get<TemplatesResponse>(`${this.BASE_URL}/api/templates`, { params });
  }
  getTemplate(id: string) {
  return this.http.get<TemplateDetail>(`${this.BASE_URL}/api/templates/${id}`);
  }
}
