import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './app/features/templates/pages/templates-page/templates-page.component';
import { QaPageComponent } from './app/features/qa/pages/qa-page/qa-page.component';
import { AuthPageComponent } from './app/features/auth/pages/auth-page/auth-page.component';
import { AuthCallbackComponent } from './app/features/auth/pages/auth-page/auth-callback.component';
import { PendingApprovalComponent } from './app/features/auth/pages/auth-page/pending-approval.component';
import { GeneratePageComponent } from './app/features/generate/pages/generate-page/generate-page.component';
import { authGuard } from './app/core/guards/auth.guard';
import { adminGuard } from './app/core/guards/admin.guard';
import { qaDeactivateGuard } from './app/core/guards/qa-deactivate.guard'; // ✅ ADD THIS

export const routes: Routes = [
  // Public routes
  { path: 'auth', component: AuthPageComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'auth/pending', component: PendingApprovalComponent },

  // Generate Template routes (add after auth routes, before admin routes)
  { 
    path: 'generate', 
    component: GeneratePageComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'generate/:conversationId', 
    component: GeneratePageComponent,
    canActivate: [authGuard]
  },
  
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
    canActivate: [authGuard],
    canDeactivate: [qaDeactivateGuard] // ✅ ADD THIS
  },
  { 
    path: 'qa/:id/use/:runId/:no',
    loadComponent: () =>
      import('./app/features/qa/pages/use-variant-page/use-variant-page.component')
        .then(m => m.UseVariantPageComponent),
    canActivate: [authGuard],
    canDeactivate: [qaDeactivateGuard] // ✅ ADD THIS
  },
  
  // Wildcard
  { path: '**', redirectTo: '' },
];