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
  templateUrl: './schedule-email-dialog.component.html',
  styleUrls: ['./schedule-email-dialog.component.scss']
})
export class ScheduleEmailDialogComponent {
  sendImmediately = true;
  hourInput: number | null = 9;
  minuteInput: number | null = 0;
  selectedTimezone = '';
  
  hourError = '';
  minuteError = '';

  timezones = [
    // North America
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Anchorage', label: 'Alaska (AKST)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
    { value: 'America/Halifax', label: 'Atlantic Time (AST)' },
    // Latin America
    { value: 'America/Sao_Paulo', label: 'Brazil (BRT)' },
    { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (ART)' },
    { value: 'America/Santiago', label: 'Chile (CLT)' },
    { value: 'America/Mexico_City', label: 'Mexico City (CST)' },
    // Europe
    { value: 'Europe/London', label: 'London (GMT)' },
    { value: 'Europe/Paris', label: 'Paris (CET)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET)' },
    { value: 'Europe/Madrid', label: 'Madrid (CET)' },
    { value: 'Europe/Rome', label: 'Rome (CET)' },
    { value: 'Europe/Amsterdam', label: 'Amsterdam (CET)' },
    { value: 'Europe/Athens', label: 'Athens (EET)' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
    { value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
    // Middle East
    { value: 'Asia/Dubai', label: 'Dubai (GST)' },
    { value: 'Asia/Jerusalem', label: 'Israel (IST)' },
    { value: 'Asia/Riyadh', label: 'Saudi Arabia (AST)' },
    // Asia
    { value: 'Asia/Kolkata', label: 'India (IST)' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Seoul', label: 'Seoul (KST)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
    { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
    { value: 'Asia/Jakarta', label: 'Jakarta (WIB)' },
    { value: 'Asia/Manila', label: 'Manila (PHT)' },
    { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
    // Australia & Oceania
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEDT)' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
    { value: 'Australia/Perth', label: 'Perth (AWST)' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZDT)' },
    // Africa
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
    { value: 'Africa/Nairobi', label: 'Nairobi (EAT)' },
    { value: 'Africa/Lagos', label: 'Lagos (WAT)' },
    { value: 'Africa/Cairo', label: 'Cairo (EET)' }
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
      return 'Email will be sent immediately when you submit the campaign';
    }

    if (!this.isTimeValid()) {
      return 'Please enter a valid time (Hour: 0-23, Minute: 0-59)';
    }

    const timeStr = this.getFormattedTime();

    if (!this.selectedTimezone) {
      return `Email will be sent at ${timeStr} in your local timezone`;
    }

    const tzLabel = this.timezones.find(t => t.value === this.selectedTimezone)?.label || this.selectedTimezone;
    return `Email will be sent at ${timeStr} ${tzLabel}`;
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
