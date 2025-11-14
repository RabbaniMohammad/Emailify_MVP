import { Component, inject, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { Organization } from '../../../../../core/services/organization.service';

export interface DeleteOrgDialogData {
  organization: Organization;
}

export interface DeleteOrgDialogResult {
  confirmed: boolean;
  deleteData: boolean;
}

@Component({
  selector: 'app-delete-org-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatIconModule,
    MatDividerModule,
    FormsModule
  ],
  templateUrl: './delete-org-dialog.component.html',
  styleUrls: ['./delete-org-dialog.component.scss']
})
export class DeleteOrgDialogComponent {
  dialogRef = inject(MatDialogRef<DeleteOrgDialogComponent>);
  
  deleteData = false;
  confirmationStep = 1; // 1 = initial, 2 = final confirmation

  constructor(@Inject(MAT_DIALOG_DATA) public data: DeleteOrgDialogData) {}

  goToFinalConfirmation(): void {
    this.confirmationStep = 2;
  }

  onCancel(): void {
    this.dialogRef.close({ confirmed: false });
  }

  onConfirm(): void {
    this.dialogRef.close({ 
      confirmed: true, 
      deleteData: this.deleteData 
    });
  }
}
