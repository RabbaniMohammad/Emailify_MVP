import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CampaignSubmitComponent } from '../../components/campaign-submit/campaign-submit.component';
import { QaService } from '../../services/qa.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-campaign-setup-page',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    CampaignSubmitComponent
  ],
  templateUrl: './campaign-setup-page.component.html',
  styleUrls: ['./campaign-setup-page.component.scss']
})
export class CampaignSetupPageComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private qa = inject(QaService);
  private destroy$ = new Subject<void>();

  templateHtml: string = '';
  templateId: string = '';
  runId: string = '';
  no: string = '';

  ngOnInit(): void {
    // Get route parameters
    this.templateId = this.route.snapshot.paramMap.get('id') || '';
    this.runId = this.route.snapshot.paramMap.get('runId') || '';
    this.no = this.route.snapshot.paramMap.get('no') || '';

    // Load the template HTML from the variant
    this.loadTemplateHtml();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadTemplateHtml(): void {
    if (!this.runId || !this.no) {
      console.error('❌ Missing runId or variant number');
      return;
    }

    // Get the variant from QA service cache
    this.qa.getVariantsRunById(this.runId).then(run => {
      if (run && run.items && run.items.length > 0) {
        const variantIndex = parseInt(this.no) - 1;
        if (variantIndex >= 0 && variantIndex < run.items.length) {
          this.templateHtml = run.items[variantIndex].html;
        } else {
          console.error('❌ Variant index out of bounds');
        }
      } else {
        console.error('❌ No variant items found in run');
      }
    }).catch(error => {
      console.error('❌ Failed to load variant:', error);
    });
  }

  goBack(): void {
    this.location.back();
  }

  onCampaignClose(): void {
    // Navigate back to the use-variant page
    this.router.navigate(['/qa', this.templateId, 'use', this.runId, this.no]);
  }
}
