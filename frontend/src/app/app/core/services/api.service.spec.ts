import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

export interface Template { id: string; name: string }
export interface TemplatesResponse { items: Template[]; total: number }

// Dev backend URL. Change here if your port differs.
const BASE_URL = 'http://localhost:3000';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getTemplates(query = '', limit = 100, offset = 0) {
    let params = new HttpParams().set('limit', limit).set('offset', offset);
    if (query) params = params.set('query', query);
    return this.http.get<TemplatesResponse>(`${BASE_URL}/api/templates`, { params });
  }
}
