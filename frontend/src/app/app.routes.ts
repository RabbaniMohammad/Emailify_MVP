import { Routes } from '@angular/router';
import { TemplatesPageComponent } from './app/features/templates/pages/templates-page/templates-page.component';
import { QaPageComponent } from './app/features/qa/pages/qa-page/qa-page.component';
import { AuthPageComponent } from './app/features/auth/pages/auth-page/auth-page.component';
import { AuthCallbackComponent } from './app/features/auth/pages/auth-page/auth-callback.component';
import { PendingApprovalComponent } from './app/features/auth/pages/auth-page/pending-approval.component';
import { GeneratePageComponent } from './app/features/generate/pages/generate-page/generate-page.component';
import { authGuard } from './app/core/guards/auth.guard';
import { adminGuard } from './app/core/guards/admin.guard';
import { qaDeactivateGuard } from './app/core/guards/qa-deactivate.guard';
import { VisualEditorComponent } from '../app/app/features/visual-editor/visual-editor.component';

import { CanDeactivateGuard } from './app/core/guards/can-deactivate.guard';
import { OrganizationPageComponent } from './app/features/organization/pages/organization-page/organization-page.component';
import { CampaignDetailPageComponent } from './app/features/organization/pages/campaign-detail-page/campaign-detail-page.component';
import { AudienceListPageComponent } from './app/features/organization/pages/audience-list-page/audience-list-page.component';

export const routes: Routes = [
  // Public routes
  { path: 'auth', component: AuthPageComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'auth/pending', component: PendingApprovalComponent },

  // Generate Template routes (add after auth routes, before admin routes)
  // Single route with required conversationId parameter (use 'new' for fresh start)
{ 
  path: 'generate/:conversationId', 
  component: GeneratePageComponent,
  canActivate: [authGuard],
  canDeactivate: [CanDeactivateGuard]
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
  
  // Organization route (all authenticated users)
  { 
    path: 'organization', 
    component: OrganizationPageComponent,
    canActivate: [authGuard]
  },
  
  // Campaign detail route
  { 
    path: 'organization/campaigns/:id', 
    component: CampaignDetailPageComponent,
    canActivate: [authGuard]
  },

  // Audience list route
  {
    path: 'organization/audience',
    component: AudienceListPageComponent,
    canActivate: [authGuard]
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
    canDeactivate: [qaDeactivateGuard]
  },
  { 
    path: 'qa/:id/use/:runId/:no',
    loadComponent: () =>
      import('./app/features/qa/pages/use-variant-page/use-variant-page.component')
        .then(m => m.UseVariantPageComponent),
    canActivate: [authGuard],
    canDeactivate: [qaDeactivateGuard]
  },
  {
    path: 'qa/:id/use/:runId/:no/campaign',
    loadComponent: () =>
      import('./app/features/qa/pages/campaign-setup-page/campaign-setup-page.component')
        .then(m => m.CampaignSetupPageComponent),
    canActivate: [authGuard]
  },
  
// ✅ Visual Editor routes - ADD BOTH
{
  path: 'visual-editor',
  component: VisualEditorComponent,
  canActivate: [authGuard]
},
{
  path: 'visual-editor/:id',
  component: VisualEditorComponent,
  canActivate: [authGuard]
},
  
  // Wildcard
  { path: '**', redirectTo: '' },
];