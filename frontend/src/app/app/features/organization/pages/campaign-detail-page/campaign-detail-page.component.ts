import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { BaseChartDirective } from 'ng2-charts';
import { 
  Chart,
  ChartConfiguration, 
  ChartType,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { OrganizationService } from '../../../../core/services/organization.service';
import { AuthService } from '../../../../core/services/auth.service';

// Register Chart.js components
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface CampaignReport {
  campaign: {
    id: string;
    name: string;
    subject: string;
    status: string;
    createdAt: string;
    sentAt: string;
    createdBy: any;
    recipientsCount: number;
  };
  performance: {
    emailsSent: number;
    delivered: number;
    opens: {
      total: number;
      unique: number;
      rate: number;
      lastOpen: string | null;
    };
    clicks: {
      total: number;
      unique: number;
      rate: number;
      lastClick: string | null;
      subscriberClicks: number;
    };
    bounces: {
      total: number;
      hard: number;
      soft: number;
      rate: number;
    };
    unsubscribes: {
      total: number;
      rate: number;
    };
  };
  clickedLinks: Array<{
    url: string;
    totalClicks: number;
    uniqueClicks: number;
    clickPercentage: number;
  }>;
  topLocations: Array<{
    country: string;
    opens: number;
    region: string;
  }>;
  timeseries: any[];
  sendTime: {
    sentAt: string;
    timezone: string;
  };
  list: {
    id: string;
    name: string;
  };
}

interface SubscriberActivity {
  email: string;
  opened: boolean;
  clicked: boolean;
  openCount: number;
  clickCount: number;
  lastOpened: string | null;
  lastClicked: string | null;
}

@Component({
  selector: 'app-campaign-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatTableModule,
    MatChipsModule,
    BaseChartDirective
  ],
  templateUrl: './campaign-detail-page.component.html',
  styleUrls: ['./campaign-detail-page.component.scss']
})
export class CampaignDetailPageComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private orgService = inject(OrganizationService);
  private authService = inject(AuthService);
  private destroy$ = new Subject<void>();

  loading = true;
  error: string | null = null;
  campaignId: string | null = null;
  organizationId: string | null = null;
  
  reportData: CampaignReport | null = null;
  subscriberActivity: SubscriberActivity[] = [];
  loadingActivity = false;

  // Chart configuration
  public lineChartType: ChartType = 'line';
  public lineChartData: ChartConfiguration['data'] = {
    datasets: [],
    labels: []
  };
  public lineChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom'
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        }
      }
    }
  };

  // Table columns
  locationColumns = ['country', 'region', 'opens'];
  linkColumns = ['url', 'totalClicks', 'uniqueClicks', 'percentage'];
  activityColumns = ['email', 'opened', 'clicked', 'openCount', 'clickCount'];

  ngOnInit(): void {
    console.log('📊 Campaign detail page initializing...');

    // Get campaign ID from route
    this.route.params
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        this.campaignId = params['id'];
        console.log(`📧 Campaign ID from route: ${this.campaignId}`);
        
        // Get organization ID from user - only once to prevent reload on auth status updates
        this.authService.currentUser$
          .pipe(take(1))
          .subscribe(user => {
            if (user?.organizationId) {
              const orgId = typeof user.organizationId === 'string' 
                ? user.organizationId 
                : (user.organizationId as any)?._id;
              
              if (orgId) {
                this.organizationId = orgId;
                this.loadCampaignReport();
              } else {
                this.error = 'Invalid organization data';
                this.loading = false;
              }
            } else {
              this.error = 'You are not a member of any organization';
              this.loading = false;
            }
          });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCampaignReport(): void {
    if (!this.organizationId || !this.campaignId) return;

    this.loading = true;
    console.log(`📊 Loading report for campaign: ${this.campaignId}`);

    this.orgService.getCampaignReport(this.organizationId, this.campaignId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any) => {
          console.log('✅ Campaign report loaded:', data);
          this.reportData = data;
          this.loading = false;
          
          // Build chart data
          this.buildChartData();
          
          // Load subscriber activity
          this.loadSubscriberActivity();
        },
        error: (err) => {
          console.error('❌ Failed to load campaign report:', err);
          this.error = 'Failed to load campaign report';
          this.loading = false;
        }
      });
  }

  loadSubscriberActivity(): void {
    if (!this.organizationId || !this.campaignId) return;

    this.loadingActivity = true;
    console.log(`👥 Loading subscriber activity...`);

    this.orgService.getCampaignActivity(this.organizationId, this.campaignId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any) => {
          console.log('✅ Subscriber activity loaded:', data);
          this.subscriberActivity = data.activity || [];
          this.loadingActivity = false;
        },
        error: (err) => {
          console.warn('⚠️ Failed to load subscriber activity:', err);
          this.loadingActivity = false;
        }
      });
  }

  goBack(): void {
    this.router.navigate(['/organization']);
  }

  buildChartData(): void {
    if (!this.reportData || !this.reportData.timeseries || this.reportData.timeseries.length === 0) {
      console.log('⚠️ No timeseries data available for chart');
      return;
    }

    const timeseries = this.reportData.timeseries;
    
    // Extract labels (timestamps)
    const labels = timeseries.map((point: any) => {
      const date = new Date(point.timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    });

    // Extract data points
    const opensData = timeseries.map((point: any) => point.emails_sent ? 
      ((point.unique_opens / point.emails_sent) * 100) : 0);
    const clicksData = timeseries.map((point: any) => point.emails_sent ? 
      ((point.unique_clicks / point.emails_sent) * 100) : 0);

    this.lineChartData = {
      labels: labels,
      datasets: [
        {
          label: 'Open Rate (%)',
          data: opensData,
          borderColor: '#E5893F',
          backgroundColor: 'rgba(229, 137, 63, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Click Rate (%)',
          data: clicksData,
          borderColor: '#E5893F',
          backgroundColor: 'rgba(245, 87, 108, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    };

    console.log('📊 Chart data built:', this.lineChartData);
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatPercent(value: number): string {
    return value.toFixed(1) + '%';
  }

  formatNumber(value: number): string {
    return value.toLocaleString();
  }
}
