import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { 
  OrganizationService, 
  DashboardResponse, 
  AudienceResponse,
  Campaign
} from '../../../../core/services/organization.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
  selector: 'app-organization-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatTooltipModule
  ],
  templateUrl: './organization-page.component.html',
  styleUrls: ['./organization-page.component.scss']
})
export class OrganizationPageComponent implements OnInit, OnDestroy {
  private orgService = inject(OrganizationService);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private destroy$ = new Subject<void>();

  loading = true;
  error: string | null = null;
  
  dashboardData: DashboardResponse | null = null;
  audienceData: AudienceResponse | null = null;
  organizationId: string | null = null;
  syncingCampaigns = new Set<string>(); // Track which campaigns are syncing
  settingUpAudience = false;
  
  private isInitialized = false; // Prevent multiple initializations

  ngOnInit(): void {
    if (this.isInitialized) {
      console.warn('⚠️ Organization page already initialized, skipping...');
      return;
    }
    
    this.isInitialized = true;
    console.log('🏢 Organization page initializing...');
    
    // Get organization ID from current user - only take the first emission
    this.authService.currentUser$
      .pipe(take(1))
      .subscribe(user => {
        if (user?.organizationId) {
          console.log(`👤 User org:`, user.organizationId);
          // organizationId might be an object, extract _id
          const orgId = typeof user.organizationId === 'string' 
            ? user.organizationId 
            : (user.organizationId as any)?._id;
          
          if (orgId) {
            this.organizationId = orgId;
            this.loadDashboardData();
          } else {
            console.warn('⚠️ Could not extract organization ID');
            this.error = 'Invalid organization data';
            this.loading = false;
          }
        } else {
          console.warn('⚠️ User has no organization');
          this.error = 'You are not a member of any organization';
          this.loading = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDashboardData(): void {
    if (!this.organizationId) return;

    this.loading = true;
    console.log(`📊 Loading dashboard for org: ${this.organizationId}`);

    // Load dashboard data
    this.orgService.getDashboard(this.organizationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          console.log('✅ Dashboard data loaded:', data);
          this.dashboardData = data;
          this.loadAudienceData();
        },
        error: (err) => {
          console.error('❌ Failed to load dashboard:', err);
          this.error = 'Failed to load dashboard data';
          this.loading = false;
        }
      });
  }

  loadAudienceData(): void {
    if (!this.organizationId) return;

    console.log(`👥 Loading audience stats for org: ${this.organizationId}`);

    this.orgService.getAudienceStats(this.organizationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          console.log('✅ Audience data loaded:', data);
          this.audienceData = data;
          this.loading = false;
        },
        error: (err) => {
          console.warn('⚠️ Failed to load audience data:', err);
          // Don't fail the whole page if audience fails
          this.loading = false;
        }
      });
  }

  getStatusClass(status: string): string {
    const statusMap: { [key: string]: string } = {
      'draft': 'status-draft',
      'scheduled': 'status-scheduled',
      'sent': 'status-sent',
      'sending': 'status-sending',
      'paused': 'status-paused',
      'canceled': 'status-canceled'
    };
    return statusMap[status] || 'status-default';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  formatPercent(value: number): string {
    return value.toFixed(1) + '%';
  }

  refreshCampaignMetrics(campaignId: string): void {
    if (!this.organizationId) return;

    console.log(`🔄 Refreshing metrics for campaign ${campaignId}`);
    this.syncingCampaigns.add(campaignId);

    this.orgService.syncCampaignMetrics(this.organizationId, campaignId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('✅ Metrics synced:', response);
          
          // Update the campaign in the list
          if (this.dashboardData?.recentCampaigns) {
            const campaignIndex = this.dashboardData.recentCampaigns.findIndex(
              c => c._id === campaignId
            );
            if (campaignIndex !== -1 && response.campaign) {
              // Update metrics
              this.dashboardData.recentCampaigns[campaignIndex].metrics = response.campaign.metrics;
              this.dashboardData.recentCampaigns[campaignIndex].status = response.campaign.status;
            }
          }
          
          this.syncingCampaigns.delete(campaignId);
        },
        error: (err) => {
          console.error('❌ Failed to sync metrics:', err);
          this.syncingCampaigns.delete(campaignId);
          // You could add a snackbar notification here
        }
      });
  }

  viewAudienceList(): void {
    // Navigate to audience list page or open modal
    this.router.navigate(['/organization/audience']);
  }

  setupAudience(): void {
    if (!this.organizationId) return;

    this.settingUpAudience = true;
    console.log(`🔧 Setting up audience for org: ${this.organizationId}`);

    this.orgService.setupAudience(this.organizationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('✅ Audience setup complete:', response);
          this.settingUpAudience = false;
          
          this.snackBar.open('✅ Audience setup complete!', 'Close', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'top',
            panelClass: ['success-snackbar']
          });
          
          // Reload audience data
          this.loadAudienceData();
        },
        error: (err) => {
          console.error('❌ Failed to setup audience:', err);
          this.settingUpAudience = false;
          
          // Show user-friendly error message
          const errorMessage = err.error?.message || err.message || 'Failed to setup audience';
          
          if (errorMessage.includes('sender email')) {
            this.snackBar.open(
              '⚠️ Please configure sender email and name in Organization Settings before setting up audience',
              'Got it',
              {
                duration: 8000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
                panelClass: ['error-snackbar']
              }
            );
          } else {
            this.snackBar.open(
              `❌ ${errorMessage}`,
              'Close',
              {
                duration: 5000,
                horizontalPosition: 'center',
                verticalPosition: 'top',
                panelClass: ['error-snackbar']
              }
            );
          }
        }
      });
  }
}
