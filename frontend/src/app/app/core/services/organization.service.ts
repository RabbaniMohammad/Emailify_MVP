import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from './cache.service';

export interface Organization {
  _id: string;
  name: string;
  slug: string;
  domain?: string;
  mailchimpApiKey?: string;
  mailchimpServerPrefix?: string;
  mailchimpAudienceId?: string;
  maxUsers: number;
  maxTemplates: number;
  isActive: boolean;
  owner: string;
  createdAt: string;
  updatedAt: string;
  usersCount?: number;
}

export interface OrganizationsResponse {
  organizations: Organization[];
}

export interface DeleteOrganizationResponse {
  message: string;
  deletedOrganization: string;
  deletedUsers?: number;
  deletedTemplates?: number;
  deletedConversations?: number;
}

export interface Campaign {
  _id: string;
  mailchimpCampaignId: string;
  name: string;
  subject?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'canceled';
  recipientsCount: number;
  createdAt: string;
  sentAt?: string;
  scheduledFor?: string;
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  metrics: {
    emailsSent: number;
    opens: number;
    uniqueOpens: number;
    openRate: number;
    clicks: number;
    uniqueClicks: number;
    clickRate: number;
    bounces: number;
    bounceRate: number;
    unsubscribes: number;
    unsubscribeRate: number;
  };
}

export interface CampaignsResponse {
  success: boolean;
  campaigns: Campaign[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats: {
    total: number;
    draft: number;
    scheduled: number;
    sent: number;
  };
}

export interface DashboardResponse {
  success: boolean;
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
  };
  stats: {
    campaigns: {
      total: number;
      draft: number;
      scheduled: number;
      sent: number;
    };
    templates: number;
    members: number;
  };
  recentCampaigns: Campaign[];
}

export interface AudienceStats {
  totalSubscribers: number;
  subscribed: number;
  unsubscribed: number;
  cleaned: number;
  newLast30Days: number;
  openRate: number;
  clickRate: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startItem: number;
  endItem: number;
}

export interface AudienceMember {
  email: string;
  status: string;
  joinedAt: string;
  firstName: string;
  lastName: string;
}

export interface AudienceResponse {
  success: boolean;
  audienceId: string;
  stats: AudienceStats;
  members?: AudienceMember[];  // Paginated members
  recentMembers?: AudienceMember[];  // For backward compatibility
  pagination?: PaginationMeta;
  filters?: {
    status?: string;
    search?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class OrganizationService {
  private http = inject(HttpClient);
  private cache = inject(CacheService);

  // Get all organizations (super admin only)
  getAllOrganizations(): Observable<OrganizationsResponse> {
    return this.http.get<OrganizationsResponse>('/api/admin/organizations', { 
      withCredentials: true 
    });
  }

  // Delete organization (super admin only)
  deleteOrganization(slug: string, deleteData: boolean): Observable<DeleteOrganizationResponse> {
    return this.http.delete<DeleteOrganizationResponse>(
      `/api/admin/organizations/${slug}`,
      { 
        body: { deleteData },
        withCredentials: true 
      }
    );
  }

  // Get organization by slug
  getOrganization(slug: string): Observable<{ organization: Organization }> {
    return this.http.get<{ organization: Organization }>(
      `/api/organizations/${slug}`,
      { withCredentials: true }
    );
  }

  // Create new organization
  createOrganization(data: { name: string; slug: string; domain?: string }): Observable<any> {
    return this.http.post('/api/organizations', data, { withCredentials: true });
  }

  // Get organization dashboard with caching
  getDashboard(orgId: string, forceRefresh: boolean = false): Observable<DashboardResponse> {
    const cacheKey = `dashboard_${orgId}`;
    
    // Clear cache if force refresh
    if (forceRefresh) {
      this.cache.invalidate(cacheKey);
    }
    
    // Try to get from cache first
    const cached = this.cache.get<DashboardResponse>(cacheKey);
    if (cached) {
      return of(cached);
    }
    
    // Fetch fresh data and cache it
    return this.http.get<DashboardResponse>(
      `/api/organizations/${orgId}/dashboard`,
      { withCredentials: true }
    ).pipe(
      tap(data => this.cache.set(cacheKey, data, 5 * 60 * 1000, 'session')) // Cache for 5 minutes in session storage
    );
  }

  // Get campaigns for organization
  getCampaigns(orgId: string, status?: string, limit: number = 50): Observable<CampaignsResponse> {
    const params: any = { limit };
    if (status) {
      params.status = status;
    }
    return this.http.get<CampaignsResponse>(
      `/api/organizations/${orgId}/campaigns`,
      { params, withCredentials: true }
    );
  }

  // Get audience stats with pagination support and caching
  getAudienceStats(
    orgId: string, 
    options?: {
      page?: number;
      limit?: number;
      status?: string;
      search?: string;
    },
    forceRefresh: boolean = false
  ): Observable<AudienceResponse> {
    const params: any = {};
    
    if (options?.page) params.page = options.page.toString();
    if (options?.limit) params.limit = options.limit.toString();
    if (options?.status && options.status !== 'all') params.status = options.status;
    if (options?.search) params.search = options.search;

    // Create cache key based on params (including pagination)
    const cacheKey = `audience_${orgId}_${JSON.stringify(params)}`;
    
    // Clear cache if force refresh
    if (forceRefresh) {
      this.cache.invalidate(cacheKey);
    }
    
    // Try to get from cache first (cache all requests except search)
    if (!options?.search) {
      const cached = this.cache.get<AudienceResponse>(cacheKey);
      if (cached) {
        console.log('✅ Returning cached audience data for:', cacheKey);
        return of(cached);
      }
    }

    console.log('🌐 Fetching fresh audience data for:', cacheKey);
    return this.http.get<AudienceResponse>(
      `/api/organizations/${orgId}/audience`,
      { params, withCredentials: true }
    ).pipe(
      tap(data => {
        // Cache all requests except search (search results may change frequently)
        if (!options?.search) {
          this.cache.set(cacheKey, data, 5 * 60 * 1000, 'session');
          console.log('💾 Cached audience data for:', cacheKey);
        }
      })
    );
  }

  // Sync campaign metrics from Mailchimp
  syncCampaignMetrics(orgId: string, campaignId: string): Observable<any> {
    return this.http.post(
      `/api/organizations/${orgId}/campaigns/${campaignId}/sync`,
      {},
      { withCredentials: true }
    );
  }

  // Get detailed campaign report
  getCampaignReport(orgId: string, campaignId: string): Observable<any> {
    return this.http.get(
      `/api/organizations/${orgId}/campaigns/${campaignId}/report`,
      { withCredentials: true }
    );
  }

  // Get campaign subscriber activity
  getCampaignActivity(orgId: string, campaignId: string, limit: number = 50): Observable<any> {
    return this.http.get(
      `/api/organizations/${orgId}/campaigns/${campaignId}/activity`,
      { params: { limit: limit.toString() }, withCredentials: true }
    );
  }

  // Setup Mailchimp audience for organization
  setupAudience(orgId: string): Observable<any> {
    return this.http.post(
      `/api/organizations/${orgId}/setup-audience`,
      {},
      { withCredentials: true }
    ).pipe(
      tap(() => {
        // Clear both dashboard and audience caches
        this.clearOrgCaches(orgId);
      })
    );
  }

  // Add single subscriber
  addSubscriber(orgId: string, subscriber: { email: string, firstName?: string, lastName?: string, tags?: string[] }): Observable<any> {
    return this.http.post(
      `/api/organizations/${orgId}/subscribers/add`,
      subscriber,
      { withCredentials: true }
    ).pipe(
      tap(() => {
        // Clear audience cache
        this.clearAudienceCaches(orgId);
      })
    );
  }

  // Bulk import subscribers
  bulkImportSubscribers(orgId: string, subscribers: any[]): Observable<any> {
    return this.http.post(
      `/api/organizations/${orgId}/subscribers/bulk-import`,
      { subscribers },
      { withCredentials: true }
    ).pipe(
      tap(() => {
        // Clear audience cache
        this.clearAudienceCaches(orgId);
      })
    );
  }

  // Update subscriber
  updateSubscriber(orgId: string, email: string, data: any): Observable<any> {
    return this.http.put(
      `/api/organizations/${orgId}/subscribers/${encodeURIComponent(email)}`,
      data,
      { withCredentials: true }
    ).pipe(
      tap(() => {
        // Clear audience cache
        this.clearAudienceCaches(orgId);
      })
    );
  }

  // Delete subscriber
  deleteSubscriber(orgId: string, email: string, permanent = false): Observable<any> {
    return this.http.delete(
      `/api/organizations/${orgId}/subscribers/${encodeURIComponent(email)}`,
      { params: { permanent: permanent.toString() }, withCredentials: true }
    ).pipe(
      tap(() => {
        // Clear audience cache
        this.clearAudienceCaches(orgId);
      })
    );
  }

  // Get tags
  getSubscriberTags(orgId: string): Observable<any> {
    return this.http.get(
      `/api/organizations/${orgId}/subscribers/tags`,
      { withCredentials: true }
    );
  }

  // Helper method to clear all organization caches
  private clearOrgCaches(orgId: string): void {
    this.cache.invalidate(`dashboard_${orgId}`);
    this.clearAudienceCaches(orgId);
  }

  // Helper method to clear audience-related caches
  private clearAudienceCaches(orgId: string): void {
    // Clear all audience cache entries by prefix matching
    // This clears base audience, paginated results, and filtered results
    this.cache.invalidatePrefix(`audience_${orgId}_`);
  }
}
