import { Component, ChangeDetectionStrategy, inject  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay } from 'rxjs';
import { trigger, state, style, transition, animate, query, stagger } from '@angular/animations';
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
  // encapsulation: ViewEncapsulation.None,
  animations: [
    // Fade in and slide up animation
    trigger('fadeInUp', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(30px)' }),
        animate('0.5s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, transform: 'translateY(0)' }))
      ])
    ]),

    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.3s ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('0.3s ease-in', style({ opacity: 0 }))
      ])
    ]),
    // Fade in animation
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('0.4s ease-out', style({ opacity: 1 }))
      ])
    ]),

    // Slide in from left
    trigger('slideIn', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-20px)' }),
        animate('0.4s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, transform: 'translateX(0)' }))
      ])
    ]),

    // Expand animation
    trigger('expandIn', [
      transition(':enter', [
        style({ opacity: 0, height: 0, overflow: 'hidden' }),
        animate('0.5s cubic-bezier(0.4, 0, 0.2, 1)', 
          style({ opacity: 1, height: '*' }))
      ])
    ]),

    // Pulse animation
    trigger('pulse', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('0.3s ease-out', style({ opacity: 1, transform: 'scale(1)' }))
      ])
    ]),

    // Chip animation with stagger
    trigger('chipAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.8) translateY(10px)' }),
        animate('0.3s cubic-bezier(0.34, 1.56, 0.64, 1)', 
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }))
      ])
    ]),

    // List item animation
    trigger('listAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateX(-10px)' }),
        animate('0.3s ease-out', 
          style({ opacity: 1, transform: 'translateX(0)' }))
      ])
    ]),

    // Variant card animation
    trigger('variantAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(30px) scale(0.95)' }),
        animate('0.5s cubic-bezier(0.34, 1.56, 0.64, 1)', 
          style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ])
    ])
  ]
})
export class QaPageComponent {
  private ar = inject(ActivatedRoute);
  private qa = inject(QaService);
  private router = inject(Router);

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

  // Suggestions
  private suggestionsSubject = new BehaviorSubject<SuggestionResult | null>(null);
  readonly suggestions$ = this.suggestionsSubject.asObservable();
  suggestionsLoading = false;

  // Variants
  private variantsRunId: string | null = null;
  private variantsSubject = new BehaviorSubject<VariantsRun | null>(null);
  readonly variants$ = this.variantsSubject.asObservable();
  variantsGenerating = false;

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

  getSkeletonArray(target: number, currentCount: number): number[] {
  const remaining = target - currentCount;
  return Array(Math.max(0, remaining)).fill(0);
  }
  
  // Generate Golden Template
  onGenerateGolden(id: string) {
    if (this.goldenLoading) return;
    this.goldenLoading = true;
    this.qa.generateGolden(id).subscribe({
      next: (res) => {
        this.goldenSubject.next(res);
        // Auto-run suggestions once golden is ready
        this.onAnalyzeSuggestions(id);
      },
      error: (e) => { 
        console.error('golden error', e); 
        this.goldenLoading = false; 
      },
      complete: () => (this.goldenLoading = false),
    });
  }


  // Generate Subject Ideas
  onGenerateSubjects(id: string) {
    if (this.subjectsLoading) return;
    this.subjectsLoading = true;
    this.qa.generateSubjects(id).subscribe({
      next: (list) => this.subjectsSubject.next(list),
      error: (e) => { 
        console.error('subjects error', e); 
        this.subjectsLoading = false; 
      },
      complete: () => (this.subjectsLoading = false),
    });
  }

  // Analyze Suggestions
  onAnalyzeSuggestions(id: string) {
    if (this.suggestionsLoading) return;
    this.suggestionsLoading = true;
    this.qa.generateSuggestions(id).subscribe({
      next: (res) => this.suggestionsSubject.next(res),
      error: (e) => { 
        console.error('suggestions error', e); 
        this.suggestionsLoading = false; 
      },
      complete: () => (this.suggestionsLoading = false),
    });
  }

  // Use Variant
  onUseVariant(templateId: string, runId: string, no: number) {
    this.router.navigate(['/qa', templateId, 'use', runId, no]);
  }

  // Generate Variants - Single-click flow
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

      // Auto-scroll to variants section smoothly
      setTimeout(() => {
        const variantsSection = document.querySelector('.variants-section');
        if (variantsSection) {
          variantsSection.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }, 300);

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

  // Template helpers
  trackByIndex = (i: number) => i;
  trackByEdit = (i: number, e: any) => e.before + '|' + e.after + '|' + (e.parent || '');
}