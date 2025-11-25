import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export interface SaveDialogData {
  images: Array<{ url: string; prompt?: string }>;
  prompt?: string;
  templateName?: string;
}

@Component({
  selector: 'save-generated-image-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Save Generated Image</h2>
    <div mat-dialog-content>
  <p *ngIf="data.images && data.images.length === 1">You're saving the generated image below.</p>
  <p *ngIf="data.images && data.images.length > 1">Choose an image to save and give it a name.</p>

      <div class="image-choices" *ngIf="data.images && data.images.length > 0">
        <label *ngFor="let img of data.images; let i = index" class="choice">
          <input type="radio" name="selected" [value]="i" [(ngModel)]="selectedIndex" />
          <img [src]="img.url" [alt]="'Generated ' + (i+1)" />
        </label>
      </div>

      <mat-form-field style="width:100%;margin-top:12px">
        <input matInput placeholder="Image name" [(ngModel)]="name" />
      </mat-form-field>

      <mat-form-field style="width:100%">
        <input matInput placeholder="Source prompt (optional)" [(ngModel)]="prompt" />
      </mat-form-field>

      <div *ngIf="error" class="error">{{ error }}</div>
    </div>
    <div mat-dialog-actions>
      <button mat-button (click)="onCancel()">Cancel</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="isSaving">
        <mat-spinner *ngIf="isSaving" diameter="18"></mat-spinner>
        <span *ngIf="!isSaving">Save</span>
      </button>
    </div>
  `,
  styles: [
    `
    .image-choices{display:flex;gap:8px;flex-wrap:wrap}
    .choice{display:flex;flex-direction:column;align-items:center;cursor:pointer}
    .choice img{width:120px;height:120px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb}
    .error{color:#b91c1c;margin-top:8px}
    `
  ]
})
export class SaveGeneratedImageDialog {
  private http = inject(HttpClient);
  dialogRef = inject(MatDialogRef<SaveGeneratedImageDialog>);
  data = inject(MAT_DIALOG_DATA) as SaveDialogData;
  private router = inject(Router);

  selectedIndex = 0;
  name: string = '';
  prompt: string = '';
  isSaving = false;
  error: string | null = null;

  constructor() {
    // Initialize name with templateName from parent if provided
    this.name = this.data.templateName || '';
  }

  onCancel() {
    this.dialogRef.close(null);
  }

  async onSave() {
    this.error = null;

    const idx = this.selectedIndex || 0;
    const image = this.data.images && this.data.images[idx];

    if (!image) {
      this.error = 'No image selected';
      return;
    }

    const payload = {
      name: this.name && this.name.trim() ? this.name.trim() : undefined,
      // backend expects `prompt` to be present; provide a safe fallback if user left it empty
      prompt: (this.prompt && this.prompt.trim()) ? this.prompt.trim() : (image.prompt || this.data.prompt || 'Generated image'),
      // backend expects `imageUrl` (not `url`)
      imageUrl: image.url,
      metadata: { savedFrom: 'gemini' }
    } as any;

    this.isSaving = true;

    try {
      const res = await this.http.post('/api/images', payload, { withCredentials: true }).toPromise();
      const savedId = (res as any)?.id;

      // Notify other parts of the app that a generated image was saved so lists can refresh
      try {
        window.dispatchEvent(new CustomEvent('generatedImages:updated', { detail: { id: savedId } }));
      } catch (e) { }

      // Navigate to templates dashboard and show AI Generated category + scroll/select new image
      try {
        this.dialogRef.close({ success: true, record: res });
        // Use query params so TemplatesPageComponent can pick them up and select/scroll
        await this.router.navigate([''], { queryParams: { category: 'ai-generated-images', id: savedId } });
      } catch (e) {
        // If navigation fails, just close dialog and let user continue
      }
    } catch (err: any) {
      console.error('Failed to save generated image', err);
      this.error = err?.error?.message || err?.message || 'Failed to save image';
    } finally {
      this.isSaving = false;
    }
  }
}
