# Multi-Channel Campaign Frontend Implementation Plan

## Overview
Extend the existing email campaign system to support SMS and WhatsApp channels using the same CSV upload workflow.

---

## 1. CSV Structure Update

### Current CSV Format:
```csv
audiences_list,scheduled_time,test_emails,timezone
user@example.com,2025-11-13 10:00:00,test@example.com,America/New_York
```

### New Multi-Channel CSV Format:
```csv
audiences_list,phone,scheduled_time,test_emails,timezone
user@example.com,+15133065946,2025-11-13 10:00:00,test@example.com,America/New_York
```

**Key Changes:**
- Add `phone` column for SMS and WhatsApp
- `audiences_list` (email) - used for Email channel
- `phone` - used for SMS and WhatsApp channels (E.164 format: +1234567890)
- Same recipient can receive email, SMS, and WhatsApp (if all columns filled)

---

## 2. Frontend Component Updates

### A. Update MasterDocRow Interface
**File**: `frontend/src/app/app/features/qa/pages/use-variant-page/campaign-submit.service.ts`

```typescript
export type MasterDocRow = {
  audiences_list: string; // email address
  phone?: string;        // ✅ NEW: phone number for SMS/WhatsApp
  scheduled_time: string;
  test_emails: string;
  timezone?: string;
};
```

### B. Add Channel Selection UI
**File**: `frontend/src/app/app/features/qa/components/campaign-submit/campaign-submit.component.ts`

Add properties:
```typescript
selectedChannels: {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
} = {
  email: true,  // Default to email
  sms: false,
  whatsapp: false
};

// Track recipients per channel
recipientStats = {
  email: 0,
  sms: 0,
  whatsapp: 0
};
```

### C. Update HTML Template
**File**: `frontend/src/app/app/features/qa/components/campaign-submit/campaign-submit.component.html`

Add after "Step 4: Campaign Configuration" section:

```html
<!-- NEW SECTION: Channel Selection -->
<div class="section-card" *ngIf="masterData.length">
  <div class="card-header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
      </svg>
    </div>
    <div class="header-content">
      <h3>Select Channels</h3>
      <p>Choose which channels to send this campaign through</p>
    </div>
  </div>

  <div class="channel-selection">
    <!-- Email Channel -->
    <label class="channel-option">
      <input 
        type="checkbox" 
        [(ngModel)]="selectedChannels.email"
        (change)="updateRecipientStats()"
      />
      <div class="channel-info">
        <div class="channel-name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>
          <span>Email</span>
        </div>
        <div class="channel-stats">
          <span class="recipient-count">{{recipientStats.email}} recipients</span>
          <span class="channel-cost">Included in plan</span>
        </div>
      </div>
    </label>

    <!-- SMS Channel -->
    <label class="channel-option" [class.disabled]="recipientStats.sms === 0">
      <input 
        type="checkbox" 
        [(ngModel)]="selectedChannels.sms"
        (change)="updateRecipientStats()"
        [disabled]="recipientStats.sms === 0"
      />
      <div class="channel-info">
        <div class="channel-name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
          </svg>
          <span>SMS</span>
        </div>
        <div class="channel-stats">
          <span class="recipient-count">{{recipientStats.sms}} recipients</span>
          <span class="channel-cost" *ngIf="recipientStats.sms > 0">
            ~${{(recipientStats.sms * 0.00645).toFixed(2)}}
          </span>
          <span class="channel-warning" *ngIf="recipientStats.sms === 0">
            No phone numbers in CSV
          </span>
        </div>
      </div>
    </label>

    <!-- WhatsApp Channel -->
    <label class="channel-option" [class.disabled]="recipientStats.whatsapp === 0">
      <input 
        type="checkbox" 
        [(ngModel)]="selectedChannels.whatsapp"
        (change)="updateRecipientStats()"
        [disabled]="recipientStats.whatsapp === 0"
      />
      <div class="channel-info">
        <div class="channel-name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
          </svg>
          <span>WhatsApp</span>
        </div>
        <div class="channel-stats">
          <span class="recipient-count">{{recipientStats.whatsapp}} recipients</span>
          <span class="channel-cost" *ngIf="recipientStats.whatsapp > 0 && recipientStats.whatsapp <= 1000">
            FREE (first 1,000/month)
          </span>
          <span class="channel-cost" *ngIf="recipientStats.whatsapp > 1000">
            ~${{((recipientStats.whatsapp - 1000) * 0.02).toFixed(2)}}
          </span>
          <span class="channel-warning" *ngIf="recipientStats.whatsapp === 0">
            No phone numbers in CSV
          </span>
        </div>
      </div>
    </label>
  </div>

  <!-- AI Content Adaptation Notice -->
  <div class="ai-notice" *ngIf="selectedChannels.sms || selectedChannels.whatsapp">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4M12 8h.01"/>
    </svg>
    <span>
      AI will automatically adapt your email content to {{getSelectedChannelsText()}} format
    </span>
  </div>
</div>
```

---

## 3. TypeScript Implementation

### A. Parse Phone Numbers from CSV

```typescript
async onFileUpload(event: Event): Promise<void> {
  // ... existing code ...
  
  // After parsing CSV data:
  this.masterData = data.map(row => ({
    audiences_list: row.audiences_list,
    phone: row.phone || '', // ✅ Parse phone column
    scheduled_time: row.scheduled_time,
    test_emails: row.test_emails,
    timezone: row.timezone
  }));
  
  // Update recipient stats
  this.updateRecipientStats();
}
```

### B. Update Recipient Stats

```typescript
updateRecipientStats(): void {
  this.recipientStats = {
    email: this.masterData.filter(row => row.audiences_list?.trim()).length,
    sms: this.masterData.filter(row => row.phone?.trim()).length,
    whatsapp: this.masterData.filter(row => row.phone?.trim()).length
  };
  
  // Auto-disable channels with no recipients
  if (this.recipientStats.sms === 0) {
    this.selectedChannels.sms = false;
  }
  if (this.recipientStats.whatsapp === 0) {
    this.selectedChannels.whatsapp = false;
  }
  
  this.cdr.markForCheck();
}
```

### C. Submit Multi-Channel Campaign

```typescript
async onSubmit(): Promise<void> {
  // ... existing validation code ...
  
  // Get selected channels
  const selectedChannelList = Object.entries(this.selectedChannels)
    .filter(([_, selected]) => selected)
    .map(([channel, _]) => channel);
  
  if (selectedChannelList.length === 0) {
    this.showError('Please select at least one channel');
    return;
  }
  
  // Prepare recipients by channel
  const recipients: any = {};
  
  if (this.selectedChannels.email) {
    recipients.email = this.masterData
      .filter(row => row.audiences_list?.trim())
      .map(row => row.audiences_list.trim());
  }
  
  if (this.selectedChannels.sms) {
    recipients.sms = this.masterData
      .filter(row => row.phone?.trim())
      .map(row => ({
        phone: row.phone!.trim(),
        name: 'Customer' // Can extract from email or add name column
      }));
  }
  
  if (this.selectedChannels.whatsapp) {
    recipients.whatsapp = this.masterData
      .filter(row => row.phone?.trim())
      .map(row => ({
        phone: row.phone!.trim(),
        name: 'Customer'
      }));
  }
  
  // Call multi-channel API
  try {
    const response = await firstValueFrom(
      this.http.post('/api/multi-channel/campaigns', {
        name: `Campaign - ${new Date().toLocaleString()}`,
        channels: selectedChannelList,
        emailHtml: this.templateHtml,
        emailSubject: this.subjectControl.value,
        recipients,
        useAIAdaptation: true, // AI adapts email content to SMS/WhatsApp
        scheduledFor: this.hasImmediateSends() ? undefined : new Date()
      })
    );
    
    this.showSuccess(`Campaign sent to ${selectedChannelList.join(', ')}!`);
    this.router.navigate(['/campaigns']);
    
  } catch (error: any) {
    this.showError(`Campaign failed: ${error.message}`);
  }
}
```

### D. Helper Methods

```typescript
getSelectedChannelsText(): string {
  const channels = [];
  if (this.selectedChannels.sms) channels.push('SMS');
  if (this.selectedChannels.whatsapp) channels.push('WhatsApp');
  if (channels.length === 0) return '';
  if (channels.length === 1) return channels[0];
  return channels.join(' and ');
}

getEstimatedCost(): number {
  let total = 0;
  
  if (this.selectedChannels.sms) {
    total += this.recipientStats.sms * 0.00645; // AWS SNS cost
  }
  
  if (this.selectedChannels.whatsapp && this.recipientStats.whatsapp > 1000) {
    total += (this.recipientStats.whatsapp - 1000) * 0.02; // WhatsApp after free tier
  }
  
  return total;
}
```

---

## 4. Add Styling

**File**: `campaign-submit.component.scss`

```scss
.channel-selection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  
  .channel-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    
    &:hover:not(.disabled) {
      border-color: #7c3aed;
      background: #f5f3ff;
    }
    
    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    input[type="checkbox"] {
      width: 20px;
      height: 20px;
      cursor: pointer;
    }
    
    .channel-info {
      flex: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      .channel-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        
        svg {
          width: 24px;
          height: 24px;
          color: #7c3aed;
        }
      }
      
      .channel-stats {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        
        .recipient-count {
          font-size: 14px;
          color: #666;
        }
        
        .channel-cost {
          font-size: 12px;
          color: #10b981;
          font-weight: 500;
        }
        
        .channel-warning {
          font-size: 12px;
          color: #f59e0b;
        }
      }
    }
  }
}

.ai-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #eff6ff;
  border-radius: 6px;
  margin-top: 12px;
  
  svg {
    width: 20px;
    height: 20px;
    color: #3b82f6;
    flex-shrink: 0;
  }
  
  span {
    font-size: 14px;
    color: #1e40af;
  }
}
```

---

## 5. Multi-Channel Service (New File)

**File**: `frontend/src/app/app/features/qa/services/multi-channel.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MultiChannelCampaign {
  name: string;
  channels: string[];
  emailHtml?: string;
  emailSubject?: string;
  recipients: {
    email?: string[];
    sms?: { phone: string; name: string }[];
    whatsapp?: { phone: string; name: string }[];
  };
  useAIAdaptation: boolean;
  scheduledFor?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class MultiChannelService {
  constructor(private http: HttpClient) {}
  
  createCampaign(campaign: MultiChannelCampaign): Observable<any> {
    return this.http.post('/api/multi-channel/campaigns', campaign);
  }
  
  adaptContent(emailHtml: string, emailSubject: string): Observable<any> {
    return this.http.post('/api/multi-channel/adapt-content', {
      emailHtml,
      emailSubject
    });
  }
  
  getChannelStatus(): Observable<any> {
    return this.http.get('/api/multi-channel/channel-status');
  }
  
  estimateCost(channels: string[], recipientCounts: any): Observable<any> {
    return this.http.post('/api/multi-channel/estimate-cost', {
      channels,
      recipientCounts
    });
  }
}
```

---

## 6. Testing Plan

### Test CSV Example:
```csv
audiences_list,phone,scheduled_time,test_emails,timezone
user1@example.com,+15133065946,2025-11-13 10:00:00,test@example.com,America/New_York
user2@example.com,+15551234567,2025-11-13 11:00:00,test@example.com,America/Chicago
user3@example.com,,2025-11-13 12:00:00,test@example.com,America/Los_Angeles
```

### Test Cases:
1. ✅ Email only (no phone) - only email checkbox enabled
2. ✅ Phone only (no email) - SMS + WhatsApp enabled, email disabled
3. ✅ Both email and phone - all channels available
4. ✅ AI content adaptation preview
5. ✅ Cost estimation display
6. ✅ Multi-channel campaign submission

---

## 7. Migration Steps

1. **Update TypeScript interfaces** (MasterDocRow)
2. **Add channel selection UI** to HTML template
3. **Add component properties** (selectedChannels, recipientStats)
4. **Update CSV parsing** to include phone column
5. **Implement updateRecipientStats()** method
6. **Update onSubmit()** to send multi-channel campaigns
7. **Add styling** for channel selection
8. **Create multi-channel.service.ts**
9. **Test with sample CSV**

---

## Expected User Flow

1. User uploads CSV with email and phone columns
2. System parses and shows available recipients per channel:
   - Email: 100 recipients
   - SMS: 80 recipients (20 rows missing phone)
   - WhatsApp: 80 recipients (same phones)
3. User selects channels: ✅ Email, ✅ SMS, ✅ WhatsApp
4. System shows cost estimate: $0.52 (80 SMS × $0.00645)
5. User clicks "Submit Campaign"
6. Backend AI adapts email content to SMS/WhatsApp format
7. Campaign sent to all channels
8. User receives confirmation

---

## Summary

**CSV Format**:
- `audiences_list` → Email recipients
- `phone` → SMS + WhatsApp recipients  
- Same phone number used for both SMS and WhatsApp

**Frontend Changes**:
- Channel selection checkboxes
- Recipient count per channel
- Cost estimation
- AI adaptation notice

**Backend Integration**:
- POST `/api/multi-channel/campaigns`
- AI automatically adapts content
- Sends to selected channels

This maintains backward compatibility (email-only CSVs still work) while adding multi-channel support! 🚀
