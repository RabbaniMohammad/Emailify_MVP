import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminUser {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  orgRole: 'super_admin' | 'admin' | 'member';
  isActive: boolean;
  isApproved: boolean;
  approvedBy?: {
    _id: string;
    name: string;
    email: string;
  };
  approvedAt?: string;
  createdAt: string;
  lastLogin: string;
}

export interface AllowedOrganization {
  _id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AllowedUser {
  _id: string;
  email: string;
  phoneNumber?: string;
  organizationId: string;
  defaultRole: 'admin' | 'member';
  autoApprove: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorizedUserWithStatus {
  _id: string;
  email: string;
  defaultRole: 'admin' | 'member';
  authorizedAt: string;
  hasSignedUp: boolean;
  name: string | null;
  picture: string | null;
  actualRole: 'super_admin' | 'admin' | 'member';
  isActive: boolean;
  signedUpAt: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private http = inject(HttpClient);

  // Get all users
  getAllUsers(): Observable<{ users: AdminUser[] }> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users', { withCredentials: true });
  }

  // Get pending users (legacy - for backwards compatibility)
  getPendingUsers(): Observable<{ users: AdminUser[] }> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users/pending', { withCredentials: true });
  }

  // Get authorized users with their signup status
  getAuthorizedUsersWithStatus(): Observable<{ 
    authorizedUsers: AuthorizedUserWithStatus[]; 
    stats: { total: number; signedUp: number; awaitingSignup: number } 
  }> {
    return this.http.get<{ 
      authorizedUsers: AuthorizedUserWithStatus[]; 
      stats: { total: number; signedUp: number; awaitingSignup: number } 
    }>('/api/org/allowed-users/with-status', { withCredentials: true });
  }

  // Approve user
  approveUser(userId: string): Observable<{ message: string; user: AdminUser }> {
    return this.http.post<{ message: string; user: AdminUser }>(
      `/api/admin/users/${userId}/approve`,
      {},
      { withCredentials: true }
    );
  }

  // Deactivate user
  deactivateUser(userId: string): Observable<{ message: string; user: AdminUser }> {
    return this.http.post<{ message: string; user: AdminUser }>(
      `/api/admin/users/${userId}/deactivate`,
      {},
      { withCredentials: true }
    );
  }

  // Promote to admin (super admin only)
  promoteToAdmin(userId: string): Observable<{ message: string; user: AdminUser }> {
    return this.http.post<{ message: string; user: AdminUser }>(
      `/api/admin/users/${userId}/promote`,
      {},
      { withCredentials: true }
    );
  }

  // Reactivate user
    reactivateUser(userId: string): Observable<{ message: string; user: AdminUser }> {
    return this.http.post<{ message: string; user: AdminUser }>(
        `/api/admin/users/${userId}/reactivate`,
        {},
        { withCredentials: true }
    );
    }

  // Demote admin (super admin only)
  demoteAdmin(userId: string): Observable<{ message: string; user: AdminUser }> {
    return this.http.post<{ message: string; user: AdminUser }>(
      `/api/admin/users/${userId}/demote`,
      {},
      { withCredentials: true }
    );
  }

  // Delete user permanently
    deleteUser(userId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
        `/api/admin/users/${userId}`,
        { withCredentials: true }
    );
    }

  // ==================== Allowed Organizations (Platform Super Admin) ====================

  // Get all allowed organizations
  getAllowedOrganizations(): Observable<{ success: boolean; allowedOrganizations: AllowedOrganization[] }> {
    return this.http.get<{ success: boolean; allowedOrganizations: AllowedOrganization[] }>(
      '/api/admin/allowed-orgs',
      { withCredentials: true }
    );
  }

  // Add allowed organization
  addAllowedOrganization(data: { name: string; allowedDomains?: string[] }): Observable<{ success: boolean; allowedOrganization: AllowedOrganization }> {
    return this.http.post<{ success: boolean; allowedOrganization: AllowedOrganization }>(
      '/api/admin/allowed-orgs',
      data,
      { withCredentials: true }
    );
  }

  // Update allowed organization
  updateAllowedOrganization(id: string, data: Partial<AllowedOrganization>): Observable<{ success: boolean; allowedOrganization: AllowedOrganization }> {
    return this.http.put<{ success: boolean; allowedOrganization: AllowedOrganization }>(
      `/api/admin/allowed-orgs/${id}`,
      data,
      { withCredentials: true }
    );
  }

  // Delete allowed organization
  deleteAllowedOrganization(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `/api/admin/allowed-orgs/${id}`,
      { withCredentials: true }
    );
  }

  // ==================== Allowed Users (Org Admin) ====================

  // Get allowed users for current organization
  getAllowedUsers(): Observable<{ success: boolean; allowedUsers: AllowedUser[] }> {
    return this.http.get<{ success: boolean; allowedUsers: AllowedUser[] }>(
      '/api/org/allowed-users',
      { withCredentials: true }
    );
  }

  // Add allowed user
  addAllowedUser(data: { email: string; phoneNumber?: string; defaultRole?: string; autoApprove?: boolean }): Observable<{ success: boolean; allowedUser: AllowedUser }> {
    return this.http.post<{ success: boolean; allowedUser: AllowedUser }>(
      '/api/org/allowed-users',
      data,
      { withCredentials: true }
    );
  }

  // Bulk import allowed users
  bulkImportAllowedUsers(users: Array<{ email: string; phoneNumber?: string; defaultRole?: string; autoApprove?: boolean }>): Observable<{ success: boolean; results: { success: string[]; failed: Array<{ email: string; reason: string }>; skipped: Array<{ email: string; reason: string }> } }> {
    return this.http.post<{ success: boolean; results: { success: string[]; failed: Array<{ email: string; reason: string }>; skipped: Array<{ email: string; reason: string }> } }>(
      '/api/org/allowed-users/bulk',
      { users },
      { withCredentials: true }
    );
  }

  // Update allowed user
  updateAllowedUser(id: string, data: Partial<AllowedUser>): Observable<{ success: boolean; allowedUser: AllowedUser }> {
    return this.http.put<{ success: boolean; allowedUser: AllowedUser }>(
      `/api/org/allowed-users/${id}`,
      data,
      { withCredentials: true }
    );
  }

  // Delete allowed user
  deleteAllowedUser(id: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `/api/org/allowed-users/${id}`,
      { withCredentials: true }
    );
  }

}