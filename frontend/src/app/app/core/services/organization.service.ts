import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

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

@Injectable({
  providedIn: 'root'
})
export class OrganizationService {
  private http = inject(HttpClient);

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
}
