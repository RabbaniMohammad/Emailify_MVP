# Audience Validation Feature - Integration Guide

## Overview
The audience validation feature allows users to upload a CSV file and compare it against their Mailchimp audience before sending a campaign. It shows:
- 🟠 **New subscribers** (in CSV, not in Mailchimp) - LEFT PANE
- 🟢 **Existing subscribers** (in both CSV and Mailchimp) - LEFT PANE  
- 🔴 **Excluded subscribers** (in Mailchimp, not in CSV) - RIGHT PANE

## Files Created

### Backend
- `backend/src/routes/campaign.routes.ts` - Added `POST /api/campaign/validate-audience` endpoint

### Frontend
- `frontend/src/app/app/core/services/campaign.service.ts` - Campaign service with validation methods
- `frontend/src/app/app/features/campaign/components/audience-validation-dialog/` - Dialog component

## How to Integrate

### Step 1: Import the Dialog Component

In your campaign submission component (e.g., `campaign-submit.component.ts`):

```typescript
import { MatDialog } from '@angular/material/dialog';
import { AudienceValidationDialogComponent } from '../audience-validation-dialog/audience-validation-dialog.component';

export class CampaignSubmitComponent {
  private dialog = inject(MatDialog);
  
  // ... your existing code
}
```

### Step 2: Add File Upload Handler

When user uploads a CSV file, trigger the validation dialog:

```typescript
onCsvFileSelected(event: any): void {
  const file = event.target.files[0];
  if (!file) return;

  // Open validation dialog
  const dialogRef = this.dialog.open(AudienceValidationDialogComponent, {
    width: '1000px',
    maxWidth: '95vw',
    data: {
      csvFile: file,
      organizationId: this.currentOrgId
    },
    disableClose: true
  });

  dialogRef.afterClosed().subscribe(result => {
    if (result?.validated) {
      console.log('✅ Audience validated:', result);
      // Proceed with campaign submission
      this.proceedWithCampaign(file, result.result);
    } else {
      console.log('❌ Validation cancelled');
    }
  });
}
```

### Step 3: Add File Input to Template

In your campaign form HTML:

```html
<div class="upload-section">
  <h3>Upload Subscriber List</h3>
  <input 
    type="file" 
    accept=".csv"
    (change)="onCsvFileSelected($event)"
    #csvInput>
  <button mat-raised-button (click)="csvInput.click()">
    <mat-icon>upload_file</mat-icon>
    Upload CSV
  </button>
</div>
```

## API Endpoint

### Request
```http
POST /api/campaign/validate-audience
Content-Type: multipart/form-data

csvFile: <file>
```

### Response
```json
{
  "success": true,
  "masterDocument": {
    "total": 500,
    "new": ["email1@example.com", "email2@example.com", ...],
    "existing": ["email3@example.com", ...]
  },
  "excludedFromCampaign": {
    "total": 75,
    "subscribers": ["excluded1@example.com", ...]
  },
  "summary": {
    "newCount": 50,
    "existingCount": 450,
    "excludedCount": 75,
    "totalInCsv": 500,
    "totalInMailchimp": 525
  }
}
```

## CSV Format

The CSV file should have one of these column headers for emails:
- `email`
- `audiences_list`
- `email_address`
- `subscriber_email`

Example CSV:
```csv
email,firstName,lastName
john@example.com,John,Doe
jane@example.com,Jane,Smith
```

## Features

### Bulk Add New Subscribers
Users can click "Add All to Mailchimp" button to add all new subscribers (orange) to their Mailchimp audience in one action.

### Pagination
Lists are paginated (50 per page) to handle large subscriber lists efficiently.

### Color Coding
- 🟠 Orange = New (needs attention)
- 🟢 Green = Existing (all good)
- 🔴 Red = Excluded (informational)

## Testing

1. Navigate to campaign submission page
2. Upload a CSV file with email addresses
3. Validation dialog opens automatically
4. Review the three categories
5. Click "Add All to Mailchimp" for new subscribers (optional)
6. Click "Proceed with Campaign" to continue

## Production Considerations

- Backend handles pagination for large Mailchimp audiences (1000+ subscribers)
- CSV parsing supports multiple email column names
- Mailchimp account owner email is filtered from excluded list
- Validation results are cached for 5 minutes (optional, not implemented yet)
- Error handling for invalid CSV formats
- Organization isolation enforced (users only see their own audience)
