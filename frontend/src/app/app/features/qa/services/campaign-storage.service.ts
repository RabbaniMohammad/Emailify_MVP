import { Injectable } from '@angular/core';
import { MailchimpAudience, MasterDocRow, AudienceReconciliation, ScheduleGroup, TimezoneAnalysis } from '../pages/use-variant-page/campaign-submit.service';

export interface CampaignFormData {
  // Step 1: Audience
  selectedAudience: MailchimpAudience | null;
  
  // Step 2: Master Document
  masterData: MasterDocRow[];
  uploadedFileName: string;
  
  // Step 3: Reconciliation
  reconciliation: AudienceReconciliation | null;
  addNewMembersToAudience: boolean;
  
  // Step 4: Schedule
  scheduleGroups: ScheduleGroup[];
  timezoneAnalysis: TimezoneAnalysis | null;
  
  // Step 5: Subject & Content
  subject: string;
  bodyAddition: string;
  generatedSubjects: string[];
  
  // Step 6: Test Emails
  testEmails: string[];
  testEmailSent: boolean;
  testEmailSentAt: string | null;
  
  // Metadata
  templateId: string;
  runId: string;
  variantNo: string;
  savedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class CampaignStorageService {
  private readonly STORAGE_KEY_PREFIX = 'campaign_form_';

  /**
   * Generate unique storage key based on template/run/variant
   */
  private getStorageKey(templateId: string, runId: string, variantNo: string): string {
    return `${this.STORAGE_KEY_PREFIX}${templateId}_${runId}_${variantNo}`;
  }

  /**
   * Save campaign form data to localStorage
   */
  saveCampaignData(
    templateId: string,
    runId: string,
    variantNo: string,
    data: Partial<CampaignFormData>
  ): void {
    try {
      const key = this.getStorageKey(templateId, runId, variantNo);
      
      // Get existing data or create new
      const existingData = this.getCampaignData(templateId, runId, variantNo);
      
      const updatedData: CampaignFormData = {
        ...existingData,
        ...data,
        templateId,
        runId,
        variantNo,
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(key, JSON.stringify(updatedData));
    } catch (error) {
      console.error('Error saving campaign data to localStorage:', error);
    }
  }

  /**
   * Load campaign form data from localStorage
   */
  getCampaignData(
    templateId: string,
    runId: string,
    variantNo: string
  ): CampaignFormData {
    try {
      const key = this.getStorageKey(templateId, runId, variantNo);
      const data = localStorage.getItem(key);
      
      if (data) {
        return JSON.parse(data) as CampaignFormData;
      }
    } catch (error) {
      console.error('Error loading campaign data from localStorage:', error);
    }
    
    // Return empty state
    return this.getEmptyFormData(templateId, runId, variantNo);
  }

  /**
   * Check if campaign data exists
   */
  hasCampaignData(templateId: string, runId: string, variantNo: string): boolean {
    try {
      const key = this.getStorageKey(templateId, runId, variantNo);
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Clear campaign data
   */
  clearCampaignData(templateId: string, runId: string, variantNo: string): void {
    try {
      const key = this.getStorageKey(templateId, runId, variantNo);
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Error clearing campaign data from localStorage:', error);
    }
  }

  /**
   * Clear all campaign data (for logout, etc.)
   */
  clearAllCampaignData(): void {
    try {
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.STORAGE_KEY_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.error('Error clearing all campaign data:', error);
    }
  }

  /**
   * Get empty form data structure
   */
  private getEmptyFormData(templateId: string, runId: string, variantNo: string): CampaignFormData {
    return {
      selectedAudience: null,
      masterData: [],
      uploadedFileName: '',
      reconciliation: null,
      addNewMembersToAudience: false,
      scheduleGroups: [],
      timezoneAnalysis: null,
      subject: '',
      bodyAddition: '',
      generatedSubjects: [],
      testEmails: [],
      testEmailSent: false,
      testEmailSentAt: null,
      templateId,
      runId,
      variantNo,
      savedAt: new Date().toISOString()
    };
  }
}
