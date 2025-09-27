import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';  // 👈 add Observable
import { ApiService, Template } from './api.service';

export interface TemplatesState {
  query: string;
  items: Template[];
  total: number;
  status: 'idle' | 'loading' | 'error';
  error?: string;
  fetchedAt?: number;

  selectedId?: string;
  selectedName?: string;
  previews: Record<string, string>;
  previewStatus?: 'idle' | 'loading' | 'error';
  previewError?: string;
}

const STORAGE_KEY = 'templatesStateV3'; // bump key to clear old cache
const TTL_MS = 10 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class TemplatesService {
  private api = inject(ApiService);

  private state = new BehaviorSubject<TemplatesState>({
    query: '',
    items: [],
    total: 0,
    status: 'idle',
    previews: {},
    previewStatus: 'idle',
  });
  readonly state$: Observable<TemplatesState> = this.state.asObservable();

  constructor() { this.hydrate(); }
  get snapshot(): TemplatesState { return this.state.getValue(); }

  private hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as TemplatesState;
      if (!cached.previews) cached.previews = {};
      if (!cached.previewStatus) cached.previewStatus = 'idle';
      if (!cached.fetchedAt || Date.now() - cached.fetchedAt < TTL_MS) {
        this.state.next({ ...cached, status: 'idle', previewStatus: 'idle', error: undefined, previewError: undefined });
      }
    } catch {}
  }
  private persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state.getValue())); } catch {}
  }

  search(query: string) {
    this.state.next({ ...this.snapshot, query, status: 'loading', error: undefined });
    this.api.getTemplates(query).subscribe({
      next: (resp) => {
        const nextState: TemplatesState = {
          ...this.snapshot,
          query,
          items: resp.items ?? [],
          total: resp.total ?? 0,
          status: 'idle',
          fetchedAt: Date.now(),
        };
        this.state.next(nextState);
        this.persist();
      },
      error: (err) => {
        this.state.next({ ...this.snapshot, status: 'error', error: err?.message ?? 'Failed to load templates' });
      },
    });
  }
  refresh() { this.search(this.snapshot.query || ''); }

  /** select a template and ensure preview is loaded (cached across refresh) */
  select(id: string, name: string) {
    const has = !!this.snapshot.previews[id];
    this.state.next({
      ...this.snapshot,
      selectedId: id,
      selectedName: name,
      previewStatus: has ? 'idle' : 'loading',
      previewError: undefined,
    });
    this.persist();

    if (has) return;
    this.api.getTemplate(id).subscribe({
      next: (d) => {
        const previews = { ...this.snapshot.previews, [id]: d.html ?? '' };
        this.state.next({ ...this.snapshot, previews, previewStatus: 'idle' });
        this.persist();
      },
      error: (e) => {
        this.state.next({ ...this.snapshot, previewStatus: 'error', previewError: e?.message ?? 'Failed to load preview' });
      },
    });
  }
}
