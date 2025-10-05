import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './app/features/templates/pages/templates-page/templates-page.component';
import { QaPageComponent } from './app/features/qa/pages/qa-page/qa-page.component';
import { AuthPageComponent } from './app/features/auth/pages/auth-page/auth-page.component';
import { AuthCallbackComponent } from './app/features/auth/pages/auth-page/auth-callback.component';
import { authGuard } from './app/core/guards/auth.guard';
import { PendingApprovalComponent } from './app/features/auth/pages/auth-page/pending-approval.component';

export const routes: Routes = [
  // Public routes
  { path: 'auth', component: AuthPageComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'auth/pending', component: PendingApprovalComponent },
  
  // Protected routes
  { 
    path: '', 
    component: TemplatesPageComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'qa/:id', 
    component: QaPageComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'qa/:id/use/:runId/:no',
    loadComponent: () =>
      import('./app/features/qa/pages/use-variant-page/use-variant-page.component')
        .then(m => m.UseVariantPageComponent),
    canActivate: [authGuard]
  },
  
  // Wildcard
  { path: '**', redirectTo: '' },
];