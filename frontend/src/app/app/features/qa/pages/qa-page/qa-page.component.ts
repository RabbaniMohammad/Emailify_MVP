import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay } from 'rxjs';
import { QaService, GoldenResult, VariantItem, VariantsRun } from '../../services/qa.service';
import { TemplatePreviewComponent } from '../../../templates/components/template-preview/template-preview.component';
import { HtmlPreviewComponent } from '../../components/html-preview/html-preview.component';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';



type SuggestionResult = {
  gibberish: Array<{ text: string; reason: string }>;
  suggestions: string[];
};

@Component({
  selector: 'app-qa-page',
  standalone: true,
  imports: [
    CommonModule,
    TemplatePreviewComponent,
    HtmlPreviewComponent,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './qa-page.component.html',
  styleUrls: ['./qa-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QaPageComponent {
  private ar = inject(ActivatedRoute);
  private qa = inject(QaService);

  // Route id
  readonly id$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));

  // Golden
  private goldenSubject = new BehaviorSubject<GoldenResult | null>(null);
  readonly golden$ = this.goldenSubject.asObservable();
  goldenLoading = false;

  // Subjects
  private subjectsSubject = new BehaviorSubject<string[] | null>(null);
  readonly subjects$ = this.subjectsSubject.asObservable();
  subjectsLoading = false;

  // Suggestions (NEW)
  private suggestionsSubject = new BehaviorSubject<SuggestionResult | null>(null);
  readonly suggestions$ = this.suggestionsSubject.asObservable();
  suggestionsLoading = false;

  // Variants
  private variantsRunId: string | null = null;
  private variantsSubject = new BehaviorSubject<VariantsRun | null>(null);
  readonly variants$ = this.variantsSubject.asObservable();
  variantsGenerating = false;

  private router = inject(Router);

  constructor() {
    // Rehydrate cached values on load/refresh
    this.id$.subscribe(id => {
      this.goldenSubject.next(this.qa.getGoldenCached(id));
      this.subjectsSubject.next(this.qa.getSubjectsCached(id));

      const prevRun = this.qa.getVariantsRunCached(id);
      if (prevRun) this.variantsSubject.next(prevRun);
      this.variantsRunId = prevRun?.runId || null;
    });
  }

  // --- existing handlers ---
  onGenerateGolden(id: string) {
    if (this.goldenLoading) return;
    this.goldenLoading = true;
    this.qa.generateGolden(id).subscribe({
      next: (res) => {
        this.goldenSubject.next(res);
        // Auto-run suggestions once golden is ready
        this.onAnalyzeSuggestions(id);
      },
      error: (e) => { console.error('golden error', e); this.goldenLoading = false; },
      complete: () => (this.goldenLoading = false),
    });
  }

  onGenerateSubjects(id: string) {
    if (this.subjectsLoading) return;
    this.subjectsLoading = true;
    this.qa.generateSubjects(id).subscribe({
      next: (list) => this.subjectsSubject.next(list),
      error: (e) => { console.error('subjects error', e); this.subjectsLoading = false; },
      complete: () => (this.subjectsLoading = false),
    });
  }

  // NEW: suggestions trigger
  onAnalyzeSuggestions(id: string) {
    if (this.suggestionsLoading) return;
    this.suggestionsLoading = true;
    this.qa.generateSuggestions(id).subscribe({
      next: (res) => this.suggestionsSubject.next(res),
      error: (e) => { console.error('suggestions error', e); this.suggestionsLoading = false; },
      complete: () => (this.suggestionsLoading = false),
    });
  }

  onUseVariant(templateId: string, runId: string, no: number) {
  this.router.navigate(['/qa', templateId, 'use', runId, no]);
    }

  // --- NEW: variants single-click flow ---
  async onGenerateVariants(templateId: string) {
    if (this.variantsGenerating) return;

    const golden = this.goldenSubject.value;
    const goldenHtml = golden?.html || '';
    if (!goldenHtml) return;

    this.variantsGenerating = true;
    try {
      const start = await firstValueFrom(this.qa.startVariants(templateId, goldenHtml, 5));
      this.variantsRunId = start.runId;
      let run: VariantsRun = { runId: start.runId, target: start.target, items: [] };
      this.variantsSubject.next(run);
      this.qa.saveVariantsRun(templateId, run);

      for (let i = 0; i < start.target; i++) {
        const item = await firstValueFrom(this.qa.nextVariant(start.runId));
        if ((item as any)?.done) break;
        run = { ...run, items: [...run.items, item] };
        this.variantsSubject.next(run);
        this.qa.saveVariantsRun(templateId, run);
      }
    } catch (e) {
      console.error('variants flow error', e);
    } finally {
      this.variantsGenerating = false;
    }
  }

  // template helpers
  trackByIndex = (i: number) => i;
  trackByEdit = (i: number, e: any) => e.before + '|' + e.after + '|' + (e.parent || '');
}
