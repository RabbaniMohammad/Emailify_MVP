import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './app/features/templates/pages/templates-page/templates-page.component';

import { QaPageComponent } from './app/features/qa/pages/qa-page/qa-page.component'

export const routes: Routes = [
  { path: '', component: TemplatesPageComponent },
  { path: 'qa/:id', component: QaPageComponent },
  { 
  path: 'qa/:id/use/:runId/:no',
  loadComponent: () =>
    import('./app/features/qa/pages/use-variant-page/use-variant-page.component')
      .then(m => m.UseVariantPageComponent)
    },
    { path: '**', redirectTo: '' },
];
