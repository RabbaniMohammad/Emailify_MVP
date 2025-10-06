import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './app/features/templates/pages/templates-page/templates-page.component';
import { QaPageComponent } from './app/features/qa/pages/qa-page/qa-page.component';
import { AuthPageComponent } from './app/features/auth/pages/auth-page/auth-page.component';
import { AuthCallbackComponent } from './app/features/auth/pages/auth-page/auth-callback.component';
import { PendingApprovalComponent } from './app/features/auth/pages/auth-page/pending-approval.component';
import { authGuard } from './app/core/guards/auth.guard';
import { adminGuard } from './app/core/guards/admin.guard';

export const routes: Routes = [
  // Public routes
  { path: 'auth', component: AuthPageComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'auth/pending', component: PendingApprovalComponent },
  
  // Admin routes (super_admin and admin only)
  {
    path: 'admin',
    loadComponent: () => 
      import('./app/features/admin/pages/admin-dashboard/admin-dashboard.component')
        .then(m => m.AdminDashboardComponent),
    canActivate: [authGuard, adminGuard],
    runGuardsAndResolvers: 'always'
  },
  
  // Protected routes (all authenticated users)
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