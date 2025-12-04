import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CampaignService {
  private http = inject(HttpClient);
  private apiUrl = '/api/campaign';

  /**
   * Validate uploaded CSV against Mailchimp audience
   * @param formData - FormData containing csvFile
   * @param pagination - Optional pagination parameters for each section
   */
  validateAudience(formData: FormData, pagination?: {
    newPage?: number; newLimit?: number;
    existingPage?: number; existingLimit?: number;
    excludedPage?: number; excludedLimit?: number;
  }): Observable<any> {
    if (pagination) {
      if (pagination.newPage) formData.append('newPage', pagination.newPage.toString());
      if (pagination.newLimit) formData.append('newLimit', pagination.newLimit.toString());
      if (pagination.existingPage) formData.append('existingPage', pagination.existingPage.toString());
      if (pagination.existingLimit) formData.append('existingLimit', pagination.existingLimit.toString());
      if (pagination.excludedPage) formData.append('excludedPage', pagination.excludedPage.toString());
      if (pagination.excludedLimit) formData.append('excludedLimit', pagination.excludedLimit.toString());
    }
    return this.http.post(`${this.apiUrl}/validate-audience`, formData);
  }

  /**
   * Upload and persist the master document (parsed CSV) to the server.
   * If an uploadId is provided the server will link parsed results to the existing UploadMaster.
   */
  uploadMasterDocument(file: File, uploadId?: string): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);
    if (uploadId) {
      formData.append('uploadId', uploadId);
    }
    return this.http.post(`${this.apiUrl}/upload-master`, formData);
  }

  /**
   * Create a raw upload record and get an uploadId (does not parse CSV).
   * Used to obtain uploadId before showing consent dialog.
   */
  createUploadDocument(file: File): Observable<{ uploadId: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ uploadId: string }>(`${this.apiUrl}/create-upload`, formData);
  }

  /**
   * Add new subscribers to Mailchimp from validation results
   * @param organizationId - Organization ID
   * @param emails - Array of email addresses to add
   */
  addNewSubscribers(organizationId: string, emails: string[]): Observable<any> {
    const subscribers = emails.map(email => ({
      email,
      firstName: '',
      lastName: ''
    }));
    
    return this.http.post(`/api/organizations/${organizationId}/subscribers/bulk-import`, {
      subscribers
    });
  }

  /**
   * Submit upload consent/proof before processing CSV
   * Expects FormData with fields: uploadId, sms_optin, whatsapp_optin, instagram_optin, email_optin, proof_file, proof_page_url, description
   */
  submitUploadConsent(formData: FormData): Observable<any> {
    return this.http.post('/api/uploads/consent', formData);
  }
}
