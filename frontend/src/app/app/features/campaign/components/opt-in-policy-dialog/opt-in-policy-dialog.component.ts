import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-opt-in-policy-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatCheckboxModule, FormsModule],
  template: `
    <div class="optin-policy-dialog">
      <h2>Messaging & Opt-In Policy</h2>

      <div class="policy-frame">
        <iframe src="/assets/messaging-opt-in-policy.html" title="Messaging & Opt-In Policy"></iframe>
      </div>

      <p class="policy-note">
        The proof and details you provide will be stored securely for compliance purposes. By continuing, you confirm that all uploaded contacts have legally consented to the selected channels and that you agree to our <a href="/assets/messaging-opt-in-policy.html" target="_blank">Messaging & Opt-In Policy</a>.
      </p>

      <mat-checkbox [(ngModel)]="accepted" name="accepted">I have read and agree to the Messaging & Opt-In Policy</mat-checkbox>

      <div class="actions">
        <button mat-stroked-button (click)="close(false)">Cancel</button>
        <button mat-flat-button color="primary" (click)="confirm()" [disabled]="!accepted">I Agree</button>
      </div>
    </div>
  `,
  styleUrls: ['./opt-in-policy-dialog.component.scss']
})
export class OptInPolicyDialogComponent {
  accepted = false;

  constructor(private dialogRef: MatDialogRef<OptInPolicyDialogComponent>) {}

  confirm(): void {
    this.dialogRef.close(true);
  }

  close(v = false): void {
    this.dialogRef.close(v);
  }
}
