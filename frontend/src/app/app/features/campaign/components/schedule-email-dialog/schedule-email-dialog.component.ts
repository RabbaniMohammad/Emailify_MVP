import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { FormsModule } from '@angular/forms';

interface ScheduleData {
  email: string;
}

interface ScheduleResult {
  email: string;
  time: string;
  timezone: string;
}

@Component({
  selector: 'app-schedule-email-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    FormsModule
  ],
  template: `
    <div class="schedule-dialog">
      <h2 mat-dialog-title>
        <mat-icon>schedule_send</mat-icon>
        Schedule Email
      </h2>

      <mat-dialog-content>
        <div class="email-badge">
          <mat-icon>email</mat-icon>
          <span>{{ data.email }}</span>
        </div>

        <!-- Send Now or Schedule -->
        <div class="send-options">
          <div 
            class="option-card"
            [class.selected]="sendImmediately"
            (click)="setSendImmediately(true)">
            <mat-icon>flash_on</mat-icon>
            <h3>Send Immediately</h3>
            <p>Send as soon as you submit</p>
          </div>
          <div 
            class="option-card"
            [class.selected]="!sendImmediately"
            (click)="setSendImmediately(false)">
            <mat-icon>schedule</mat-icon>
            <h3>Schedule for Later</h3>
            <p>Pick a specific time</p>
          </div>
        </div>

        <!-- Time Input -->
        <div class="time-input-section" *ngIf="!sendImmediately">
          <h3>
            <mat-icon>access_time</mat-icon>
            Enter Time
          </h3>
          
          <div class="time-inputs">
            <div class="input-group">
              <label>Hour</label>
              <input 
                type="number" 
                [(ngModel)]="hourInput"
                (input)="validateHour()"
                (blur)="formatHour()"
                placeholder="09"
                min="0"
                max="23"
                class="time-input"
                [class.error]="hourError">
              <span class="hint">0-23</span>
              <span class="error-msg" *ngIf="hourError">{{ hourError }}</span>
            </div>

            <span class="time-separator">:</span>

            <div class="input-group">
              <label>Minute</label>
              <input 
                type="number" 
                [(ngModel)]="minuteInput"
                (input)="validateMinute()"
                (blur)="formatMinute()"
                placeholder="00"
                min="0"
                max="59"
                class="time-input"
                [class.error]="minuteError">
              <span class="hint">0-59</span>
              <span class="error-msg" *ngIf="minuteError">{{ minuteError }}</span>
            </div>
          </div>

          <div class="time-preview" *ngIf="isTimeValid()">
            <mat-icon>schedule</mat-icon>
            <span>{{ getFormattedTime() }}</span>
          </div>
        </div>

        <!-- Timezone Selection -->
        <div class="timezone-section" *ngIf="!sendImmediately">
          <h3>
            <mat-icon>public</mat-icon>
            Select Timezone (Optional)
          </h3>
          <div class="timezone-grid">
            <div 
              class="timezone-chip"
              [class.selected]="selectedTimezone === ''"
              (click)="selectTimezone('')">
              <mat-icon>my_location</mat-icon>
              <div class="chip-content">
                <span class="chip-label">Local Time</span>
                <span class="chip-sublabel">Your timezone</span>
              </div>
            </div>
            <div 
              *ngFor="let tz of timezones"
              class="timezone-chip"
              [class.selected]="selectedTimezone === tz.value"
              (click)="selectTimezone(tz.value)">
              <mat-icon>language</mat-icon>
              <div class="chip-content">
                <span class="chip-label">{{ tz.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Info Message -->
        <div class="info-message" [ngClass]="getMessageClass()">
          <mat-icon>{{ getMessageIcon() }}</mat-icon>
          <p>{{ getMessage() }}</p>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">
          <mat-icon>close</mat-icon>
          Cancel
        </button>
        <button 
          mat-raised-button 
          color="primary" 
          (click)="confirm()"
          [disabled]="!canConfirm()">
          <mat-icon>check_circle</mat-icon>
          Add to Master
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .schedule-dialog {
      min-width: 600px;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #1976d2;
      margin: 0;
      padding: 1.5rem;
      border-bottom: 2px solid #e3f2fd;
    }

    mat-dialog-content {
      padding: 1.5rem;
      max-height: 80vh;
      overflow-y: auto;
    }

    .email-badge {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .email-badge mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .email-badge span {
      font-weight: 500;
      font-size: 0.95rem;
    }

    .send-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .option-card {
      padding: 1.5rem;
      border: 3px solid #e0e0e0;
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.3s ease;
      text-align: center;
    }

    .option-card:hover {
      border-color: #1976d2;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(25, 118, 210, 0.2);
    }

    .option-card.selected {
      border-color: #1976d2;
      background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
      box-shadow: 0 6px 20px rgba(25, 118, 210, 0.3);
    }

    .option-card mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #1976d2;
      margin-bottom: 0.5rem;
    }

    .option-card h3 {
      margin: 0.5rem 0 0.25rem 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #424242;
    }

    .option-card p {
      margin: 0;
      font-size: 0.85rem;
      color: #757575;
    }

    .time-input-section h3,
    .timezone-section h3 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #424242;
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }

    .time-input-section h3 mat-icon,
    .timezone-section h3 mat-icon {
      color: #1976d2;
    }

    .time-inputs {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .input-group label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #757575;
      text-align: center;
    }

    .time-input {
      width: 100px;
      font-size: 2.5rem;
      font-weight: 700;
      font-family: 'Roboto Mono', monospace;
      text-align: center;
      padding: 1rem;
      border: 3px solid #e0e0e0;
      border-radius: 12px;
      background: white;
      transition: all 0.3s ease;
    }

    .time-input:focus {
      outline: none;
      border-color: #1976d2;
      box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.1);
    }

    .time-input.error {
      border-color: #f44336;
      background: #ffebee;
    }

    .time-input::placeholder {
      color: #bdbdbd;
    }

    .time-separator {
      font-size: 3rem;
      font-weight: 700;
      color: #1976d2;
      align-self: center;
      padding-top: 1.5rem;
    }

    .hint {
      font-size: 0.75rem;
      color: #9e9e9e;
      text-align: center;
    }

    .error-msg {
      font-size: 0.75rem;
      color: #f44336;
      text-align: center;
      font-weight: 600;
    }

    .time-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 1rem;
      background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
      border-radius: 12px;
      margin-bottom: 1rem;
    }

    .time-preview mat-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .time-preview span {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: 'Roboto Mono', monospace;
      color: #1976d2;
    }

    .timezone-section {
      margin-top: 2rem;
    }

    .timezone-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 0.75rem;
    }

    .timezone-chip {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: #f5f5f5;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .timezone-chip:hover {
      background: #e8f5e9;
      border-color: #4caf50;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(76, 175, 80, 0.2);
    }

    .timezone-chip.selected {
      background: linear-gradient(135deg, #4caf50 0%, #388e3c 100%);
      border-color: #4caf50;
      color: white;
      box-shadow: 0 6px 16px rgba(76, 175, 80, 0.4);
    }

    .timezone-chip.selected mat-icon {
      color: white;
    }

    .timezone-chip mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: #4caf50;
    }

    .chip-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .chip-label {
      font-weight: 600;
      font-size: 0.9rem;
    }

    .chip-sublabel {
      font-size: 0.75rem;
      opacity: 0.8;
    }

    .info-message {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: 12px;
      margin-top: 1.5rem;
      font-size: 0.95rem;
    }

    .info-message.success {
      background: #e8f5e9;
      color: #2e7d32;
      border: 2px solid #4caf50;
    }

    .info-message.warning {
      background: #fff3e0;
      color: #e65100;
      border: 2px solid #ff9800;
    }

    .info-message.error {
      background: #ffebee;
      color: #c62828;
      border: 2px solid #f44336;
    }

    .info-message mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .info-message p {
      margin: 0;
      font-weight: 500;
    }

    mat-dialog-actions {
      padding: 1rem 1.5rem;
      border-top: 2px solid #e3f2fd;
      gap: 0.75rem;
    }

    mat-dialog-actions button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
    }

    /* Chrome, Safari, Edge, Opera - Remove spinner */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    /* Firefox - Remove spinner */
    input[type=number] {
      -moz-appearance: textfield;
    }
  `]
})
export class ScheduleEmailDialogComponent {
  sendImmediately = true;
  hourInput: number | null = 9;
  minuteInput: number | null = 0;
  selectedTimezone = '';
  
  hourError = '';
  minuteError = '';

  timezones = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'Europe/London', label: 'London (GMT)' },
    { value: 'Europe/Paris', label: 'Paris (CET)' },
    { value: 'Asia/Dubai', label: 'Dubai (GST)' },
    { value: 'Asia/Kolkata', label: 'India (IST)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)' }
  ];

  constructor(
    public dialogRef: MatDialogRef<ScheduleEmailDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ScheduleData
  ) {}

  setSendImmediately(immediate: boolean): void {
    this.sendImmediately = immediate;
  }

  validateHour(): void {
    this.hourError = '';
    
    if (this.hourInput === null || this.hourInput === undefined) {
      return;
    }

    const hour = Number(this.hourInput);
    
    if (isNaN(hour)) {
      this.hourError = 'Invalid number';
      return;
    }

    if (hour < 0) {
      this.hourInput = 0;
      this.hourError = 'Min is 0';
    } else if (hour > 23) {
      this.hourInput = 23;
      this.hourError = 'Max is 23';
    }
  }

  validateMinute(): void {
    this.minuteError = '';
    
    if (this.minuteInput === null || this.minuteInput === undefined) {
      return;
    }

    const minute = Number(this.minuteInput);
    
    if (isNaN(minute)) {
      this.minuteError = 'Invalid number';
      return;
    }

    if (minute < 0) {
      this.minuteInput = 0;
      this.minuteError = 'Min is 0';
    } else if (minute > 59) {
      this.minuteInput = 59;
      this.minuteError = 'Max is 59';
    }
  }

  formatHour(): void {
    if (this.hourInput !== null && this.hourInput !== undefined) {
      const hour = Number(this.hourInput);
      if (!isNaN(hour) && hour >= 0 && hour <= 23) {
        this.hourInput = hour;
        this.hourError = '';
      }
    }
  }

  formatMinute(): void {
    if (this.minuteInput !== null && this.minuteInput !== undefined) {
      const minute = Number(this.minuteInput);
      if (!isNaN(minute) && minute >= 0 && minute <= 59) {
        this.minuteInput = minute;
        this.minuteError = '';
      }
    }
  }

  selectTimezone(timezone: string): void {
    this.selectedTimezone = timezone;
  }

  isTimeValid(): boolean {
    if (this.sendImmediately) return true;
    
    return this.hourInput !== null && 
           this.hourInput !== undefined && 
           this.minuteInput !== null && 
           this.minuteInput !== undefined &&
           this.hourInput >= 0 && 
           this.hourInput <= 23 &&
           this.minuteInput >= 0 && 
           this.minuteInput <= 59 &&
           !this.hourError &&
           !this.minuteError;
  }

  getFormattedTime(): string {
    if (!this.isTimeValid() || this.hourInput === null || this.minuteInput === null) {
      return '';
    }

    const hour = this.hourInput;
    const minute = this.minuteInput;
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const period = hour >= 12 ? 'PM' : 'AM';
    
    const hourStr = hour12.toString().padStart(2, '0');
    const minStr = minute.toString().padStart(2, '0');
    
    return `${hourStr}:${minStr} ${period}`;
  }

  getMessageClass(): string {
    if (this.sendImmediately) {
      return 'warning';
    }
    if (!this.isTimeValid()) {
      return 'error';
    }
    return 'success';
  }

  getMessage(): string {
    if (this.sendImmediately) {
      return '⚡ Email will be sent immediately when you submit the campaign';
    }

    if (!this.isTimeValid()) {
      return '⚠️ Please enter a valid time (Hour: 0-23, Minute: 0-59)';
    }

    const timeStr = this.getFormattedTime();

    if (!this.selectedTimezone) {
      return `📅 Email will be sent at ${timeStr} in your local timezone`;
    }

    const tzLabel = this.timezones.find(t => t.value === this.selectedTimezone)?.label || this.selectedTimezone;
    return `🌍 Email will be sent at ${timeStr} ${tzLabel}`;
  }

  getMessageIcon(): string {
    if (this.sendImmediately) {
      return 'flash_on';
    }
    if (!this.isTimeValid()) {
      return 'error_outline';
    }
    return 'schedule_send';
  }

  canConfirm(): boolean {
    if (this.sendImmediately) {
      return true;
    }
    return this.isTimeValid();
  }

  confirm(): void {
    if (!this.canConfirm()) return;

    let time = '';
    
    if (!this.sendImmediately && this.hourInput !== null && this.minuteInput !== null) {
      // Create a datetime for today at the specified time in the selected timezone
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const day = now.getDate().toString().padStart(2, '0');
      const hourStr = this.hourInput.toString().padStart(2, '0');
      const minStr = this.minuteInput.toString().padStart(2, '0');
      
      // Format: YYYY-MM-DDTHH:MM
      time = `${year}-${month}-${day}T${hourStr}:${minStr}`;
      
      console.log('📅 Schedule dialog result:', {
        time,
        timezone: this.selectedTimezone,
        email: this.data.email
      });
    }

    this.dialogRef.close({
      email: this.data.email,
      time: time,
      timezone: this.selectedTimezone
    });
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
