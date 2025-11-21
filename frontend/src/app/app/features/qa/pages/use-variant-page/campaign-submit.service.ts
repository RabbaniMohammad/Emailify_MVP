import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';

export type MailchimpAudience = {
  id: string;
  name: string;
  memberCount: number;
  stats: {
    member_count: number;
    unsubscribe_count: number;
    cleaned_count: number;
  };
};

export type MasterDocRow = {
  audiences_list: string; // email address
  phone?: string; // ✅ Phone number for SMS/WhatsApp (E.164 format: +1234567890)
  instagram_handle?: string; // Optional instagram handle (without @)
  scheduled_time: string; // ISO format or parseable date
  test_emails: string; // comma-separated emails
  timezone?: string; // ✅ Optional timezone column
};

export type AudienceReconciliation = {
  existing: string[]; // emails already in Mailchimp
  new: string[]; // emails to be added
  ignored: string[]; // invalid or duplicates
  summary: {
    existingCount: number;
    newCount: number;
    ignoredCount: number;
  };
};

export type ScheduleGroup = {
  scheduledTime: Date;
  emails: string[];
  count: number;
  isImmediate?: boolean; // Flag for immediate sends
  timezone?: string; // Timezone for this group
  timezoneSource?: 'customer' | 'single' | 'local' | 'none'; // How timezone was determined
};

export type TimezoneAnalysis = {
  hasTimezoneColumn: boolean;
  uniqueTimezones: string[];
  timezoneMode: 'none' | 'single' | 'multiple' | 'mixed';
  emptyTimezoneCount: number;
  totalRows: number;
};

export type CampaignSubmission = {
  subject: string;
  bodyAddition?: string;
  templateHtml: string;
  scheduleGroups: ScheduleGroup[];
  testEmails: string[];
  timezoneAnalysis: TimezoneAnalysis;
};

@Injectable({ providedIn: 'root' })
export class CampaignSubmitService {
  private audiencesSubject = new BehaviorSubject<MailchimpAudience[]>([]);
  readonly audiences$ = this.audiencesSubject.asObservable();

  private selectedAudienceSubject = new BehaviorSubject<MailchimpAudience | null>(null);
  readonly selectedAudience$ = this.selectedAudienceSubject.asObservable();

  private masterDataSubject = new BehaviorSubject<MasterDocRow[]>([]);
  readonly masterData$ = this.masterDataSubject.asObservable();

  private reconciliationSubject = new BehaviorSubject<AudienceReconciliation | null>(null);
  readonly reconciliation$ = this.reconciliationSubject.asObservable();

  private timezoneAnalysisSubject = new BehaviorSubject<TimezoneAnalysis | null>(null);
  readonly timezoneAnalysis$ = this.timezoneAnalysisSubject.asObservable();

  constructor(private http: HttpClient) {}

  // ============================================
  // MAILCHIMP AUDIENCE OPERATIONS
  // ============================================

  fetchMailchimpAudiences(): Observable<MailchimpAudience[]> {
    return this.http.get<{ lists: any[] }>('/api/mailchimp/audiences').pipe(
      map(response => {
        const audiences: MailchimpAudience[] = (response.lists || []).map(list => ({
          id: list.id,
          name: list.name,
          memberCount: list.stats?.member_count || 0,
          stats: list.stats || { member_count: 0, unsubscribe_count: 0, cleaned_count: 0 }
        }));
        this.audiencesSubject.next(audiences);
        return audiences;
      }),
      catchError(err => {

        return throwError(() => new Error('Failed to load Mailchimp audiences'));
      })
    );
  }

  selectAudience(audience: MailchimpAudience): void {
    this.selectedAudienceSubject.next(audience);
  }

  // ============================================
  // MASTER DOCUMENT UPLOAD & PARSING
  // ============================================

  uploadMasterDocument(file: File): Observable<MasterDocRow[]> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<{ data: MasterDocRow[] }>('/api/campaign/upload-master', formData).pipe(
      map(response => {
        const data = response.data || [];
        this.masterDataSubject.next(data);
        
        const analysis = this.analyzeTimezones(data);
        this.timezoneAnalysisSubject.next(analysis);
        
        return data;
      }),
      catchError(err => {

        return throwError(() => new Error('Failed to parse master document'));
      })
    );
  }

  // ============================================
  // TIMEZONE ANALYSIS
  // ============================================

  analyzeTimezones(data: MasterDocRow[]): TimezoneAnalysis {
    const hasTimezoneColumn = data.some(row => 'timezone' in row);
    
    if (!hasTimezoneColumn) {
      return {
        hasTimezoneColumn: false,
        uniqueTimezones: [],
        timezoneMode: 'none',
        emptyTimezoneCount: data.length,
        totalRows: data.length
      };
    }

    const timezones = data
      .map(row => row.timezone?.trim())
      .filter(tz => tz && tz.length > 0) as string[];

    const uniqueTimezones = Array.from(new Set(timezones));
    const emptyTimezoneCount = data.length - timezones.length;

    let timezoneMode: 'none' | 'single' | 'multiple' | 'mixed';
    
    if (timezones.length === 0) {
      timezoneMode = 'none';
    } else if (uniqueTimezones.length === 1 && emptyTimezoneCount === 0) {
      timezoneMode = 'single';
    } else if (uniqueTimezones.length > 1 && emptyTimezoneCount === 0) {
      timezoneMode = 'multiple';
    } else {
      timezoneMode = 'mixed';
    }

    return {
      hasTimezoneColumn,
      uniqueTimezones,
      timezoneMode,
      emptyTimezoneCount,
      totalRows: data.length
    };
  }

  // ============================================
  // AUDIENCE RECONCILIATION
  // ============================================

  reconcileAudiences(audienceId: string, uploadedEmails: string[]): Observable<AudienceReconciliation> {
    return this.http.post<AudienceReconciliation>('/api/campaign/reconcile', {
      audienceId,
      emails: uploadedEmails
    }).pipe(
      tap(result => {
        this.reconciliationSubject.next(result);
      }),
      catchError(err => {

        return throwError(() => new Error('Failed to reconcile audiences'));
      })
    );
  }

  // ============================================
  // TEST EMAIL
  // ============================================

  sendTestEmails(testEmails: string[], subject: string, html: string): Observable<{ sent: number; failed: string[] }> {
    return this.http.post<{ sent: number; failed: string[] }>('/api/campaign/send-test', {
      testEmails,
      subject,
      html
    }).pipe(
      catchError(err => {

        return throwError(() => new Error('Failed to send test emails'));
      })
    );
  }

  // ============================================
  // SCHEDULE GROUPING WITH TIMEZONE SUPPORT
  // ============================================

  groupByScheduleTime(masterData: MasterDocRow[]): ScheduleGroup[] {
    const groups = new Map<string, { emails: string[]; timezone?: string }>();
    const immediateEmails: string[] = [];
    
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    masterData.forEach(row => {
      const email = row.audiences_list?.trim().toLowerCase();
      const timeStr = row.scheduled_time?.trim();
      const timezone = row.timezone?.trim();

      if (!email) return;

      console.log(`📅 Processing schedule for ${email}:`, {
        timeStr,
        timezone,
        isEmpty: !timeStr
      });

      // Handle missing/empty schedule time → Immediate send
      if (!timeStr) {
        immediateEmails.push(email);
        console.log(`  ⚡ Marked as immediate (no time)`);
        return;
      }

      try {
        let scheduledDate: Date;
        
        if (timezone) {
          scheduledDate = this.parseTimeInTimezone(timeStr, timezone);
        } else {
          scheduledDate = new Date(timeStr);
        }

        if (isNaN(scheduledDate.getTime())) {
          throw new Error('Invalid date');
        }

        const groupKey = `${scheduledDate.toISOString()}_${timezone || 'LOCAL'}`;
        
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { 
            emails: [], 
            timezone: timezone || browserTimezone 
          });
        }
        groups.get(groupKey)!.emails.push(email);

      } catch (error) {
        immediateEmails.push(email);
      }
    });

    const scheduleGroups: ScheduleGroup[] = [];

    if (immediateEmails.length > 0) {
      scheduleGroups.push({
        scheduledTime: new Date(),
        emails: Array.from(new Set(immediateEmails)),
        count: immediateEmails.length,
        isImmediate: true,
        timezoneSource: 'none'
      });
    }

    groups.forEach((data, groupKey) => {
      const [isoTime, tzKey] = groupKey.split('_');
      const isLocal = tzKey === 'LOCAL';
      
      scheduleGroups.push({
        scheduledTime: new Date(isoTime),
        emails: Array.from(new Set(data.emails)),
        count: data.emails.length,
        isImmediate: false,
        timezone: data.timezone,
        timezoneSource: isLocal ? 'local' : 'customer'
      });
    });

    scheduleGroups.sort((a, b) => {
      if (a.isImmediate && !b.isImmediate) return -1;
      if (!a.isImmediate && b.isImmediate) return 1;
      return a.scheduledTime.getTime() - b.scheduledTime.getTime();
    });

    return scheduleGroups;
  }

  private parseTimeInTimezone(timeStr: string, timezone: string): Date {
    if (timeStr.includes('+') || timeStr.match(/-\d{2}:\d{2}$/)) {
      return new Date(timeStr);
    }
    
    try {
      const date = new Date(timeStr);
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      };
      return new Date(date.toLocaleString('en-US', options));
    } catch (error) {
      try {
        return new Date(timeStr + ' ' + timezone);
      } catch {
        return new Date(timeStr);
      }
    }
  }

  // ============================================
  // FINAL CAMPAIGN SUBMISSION
  // ============================================

  submitCampaign(submission: CampaignSubmission): Observable<{ campaignIds: string[]; success: boolean; message?: string }> {
    return this.http.post<{ campaignIds: string[]; success: boolean }>(
      '/api/campaign/submit',
      submission
    ).pipe(
      catchError(err => {
        console.error('Submit campaign error:', err);
        // Pass through the actual error from backend
        return throwError(() => err);
      })
    );
  }

  // ============================================
  // EXTRACT TEST EMAILS
  // ============================================

  extractTestEmails(masterData: MasterDocRow[]): string[] {
    const testEmailsSet = new Set<string>();

    masterData.forEach(row => {
      const testEmailsStr = row.test_emails?.trim();
      if (!testEmailsStr) return;

      testEmailsStr.split(',').forEach(email => {
        const trimmed = email.trim().toLowerCase();
        if (this.isValidEmail(trimmed)) {
          testEmailsSet.add(trimmed);
        }
      });
    });

    return Array.from(testEmailsSet);
  }

  // ============================================
  // UTILITIES
  // ============================================

  private isValidEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  clearState(): void {
    this.audiencesSubject.next([]);
    this.selectedAudienceSubject.next(null);
    this.masterDataSubject.next([]);
    this.reconciliationSubject.next(null);
    this.timezoneAnalysisSubject.next(null);
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  getCurrentTimezoneAnalysis(): TimezoneAnalysis | null {
    return this.timezoneAnalysisSubject.value;
  }

  getBrowserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  hasImmediateSends(scheduleGroups: ScheduleGroup[]): boolean {
    return scheduleGroups.some(group => group.isImmediate);
  }

  getImmediateSendCount(scheduleGroups: ScheduleGroup[]): number {
    const immediateGroup = scheduleGroups.find(group => group.isImmediate);
    return immediateGroup?.count || 0;
  }

  isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }

  cleanupTempMembers(audienceId: string, emails: string[]): Observable<{ success: boolean }> {
  return this.http.post<{ success: boolean }>('/api/campaign/cleanup-temp', {
    audienceId,
    emails
  });
}

  // Add this method after reconcileAudiences()
addNewMembersToAudience(audienceId: string, newEmails: string[]): Observable<{ success: boolean; addedCount: number }> {
  return this.http.post<{ success: boolean; addedCount: number; errorCount: number }>(
    '/api/campaign/add-members',
    { audienceId, emails: newEmails }
  ).pipe(
    catchError(err => {

      return throwError(() => new Error('Failed to add members to audience'));
    })
  );
}
}