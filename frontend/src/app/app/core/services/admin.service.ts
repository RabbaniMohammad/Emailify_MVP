import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminUser {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  role: 'super_admin' | 'admin' | 'user';
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

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private http = inject(HttpClient);

  // Get all users
  getAllUsers(): Observable<{ users: AdminUser[] }> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users', { withCredentials: true });
  }

  // Get pending users
  getPendingUsers(): Observable<{ users: AdminUser[] }> {
    return this.http.get<{ users: AdminUser[] }>('/api/admin/users/pending', { withCredentials: true });
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

}