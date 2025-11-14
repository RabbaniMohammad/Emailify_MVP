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
   */
  validateAudience(formData: FormData): Observable<any> {
    return this.http.post(`${this.apiUrl}/validate-audience`, formData);
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
}
