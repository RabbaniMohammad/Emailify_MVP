import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TemplatesService, TemplatesState } from '../../../../core/services/templates.service';
import { SearchBarComponent } from '../../components/search-bar/search-bar.component';
import { TemplateListComponent } from '../../components/template-list/template-list.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { map } from 'rxjs';
import { TemplatePreviewComponent } from '../../components/template-preview/template-preview.component';

import { Router } from '@angular/router';

@Component({
  selector: 'app-templates-page',
  standalone: true,
  imports: [
    CommonModule,
    SearchBarComponent,
    TemplateListComponent,
    MatProgressSpinnerModule,
    TemplatePreviewComponent
  ],
  templateUrl: './templates-page.component.html',
  styleUrls: ['./templates-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesPageComponent implements OnInit {
  private svc = inject(TemplatesService);

  readonly state$   = this.svc.state$;
  readonly items$   = this.state$.pipe(map((s: TemplatesState) => s.items));
  readonly status$  = this.state$.pipe(map((s: TemplatesState) => s.status));
  readonly error$   = this.state$.pipe(map((s: TemplatesState) => s.error));

  readonly selectedId$   = this.state$.pipe(map((s: TemplatesState) => s.selectedId));
  readonly selectedName$ = this.state$.pipe(map((s: TemplatesState) => s.selectedName));

  private router = inject(Router);

  // show the action button for this id only when: user clicked + preview loaded
  runButtonItemId?: string;
  private clickedThisSelection = false;

  ngOnInit(): void {
    // restore last selection (button won’t show until a fresh click)
    try {
      const id = localStorage.getItem('lastTemplateId');
      const name = localStorage.getItem('lastTemplateName') || '';
      if (id) this.svc.select(id, name);
    } catch {}

    if (!this.svc.snapshot.items.length) this.svc.search('');
    this.svc.refresh();
  }

  onSearch(q: string) {
    this.svc.search(q);
  }

  onSelect(t: { id: string; name: string }) {
    this.svc.select(t.id, t.name);
    this.runButtonItemId = undefined;   // hide until loaded
    this.clickedThisSelection = true;   // require a user click
    try {
      localStorage.setItem('lastTemplateId', t.id);
      localStorage.setItem('lastTemplateName', t.name || '');
    } catch {}
  }

  // from <app-template-preview (ready)="onPreviewReady($event)">
  onPreviewReady(loadedId: string) {
    const current = this.svc.snapshot.selectedId;
    if (this.clickedThisSelection && loadedId === current) {
      this.runButtonItemId = loadedId;  // show button on this row
      this.clickedThisSelection = false;
    }
  }

  onRunTests(id: string) {
    // TODO: integrate with your QA rail; placeholder action:
    this.router.navigate(['/qa', id]);
  }
}
