import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { OrganizationService } from '../../../../core/services/organization.service';
import { AuthService } from '../../../../core/services/auth.service';

interface AudienceMember {
  email: string;
  status: string;
  firstName?: string;
  lastName?: string;
  joinedAt?: string;
}

@Component({
  selector: 'app-audience-list-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatTooltipModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule
  ],
  templateUrl: './audience-list-page.component.html',
  styleUrls: ['./audience-list-page.component.scss']
})
export class AudienceListPageComponent implements OnInit, OnDestroy {
  private orgService = inject(OrganizationService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private destroy$ = new Subject<void>();

  loading = true;
  error: string | null = null;
  organizationId: string | null = null;
  audienceMembers: AudienceMember[] = [];
  filteredMembers: AudienceMember[] = [];
  totalSubscribers = 0;
  searchText = '';
  selectedStatus = 'all';
  showAddForm = false;
  
  newSubscriber = {
    email: '',
    firstName: '',
    lastName: ''
  };

  displayedColumns: string[] = ['email', 'firstName', 'lastName', 'status', 'joinedAt', 'actions'];

  ngOnInit(): void {
    console.log('👥 Audience list page initializing...');
    
    // Get organization ID from current user - only once on init
    // Using take(1) to prevent reloading when auth service updates user status every 30s
    this.authService.currentUser$
      .pipe(take(1))
      .subscribe(user => {
        if (user?.organizationId) {
          const orgId = typeof user.organizationId === 'string' 
            ? user.organizationId 
            : user.organizationId._id;
          
          this.organizationId = orgId;
          this.loadAudienceData();
        } else {
          this.error = 'You are not a member of any organization';
          this.loading = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAudienceData(): void {
    if (!this.organizationId) return;

    this.loading = true;
    console.log(`📊 Loading audience for org: ${this.organizationId}`);

    this.orgService.getAudienceStats(this.organizationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any) => {
          console.log('✅ Audience data loaded:', data);
          this.audienceMembers = data.recentMembers || [];
          this.filteredMembers = [...this.audienceMembers];
          this.totalSubscribers = data.stats?.totalSubscribers || 0;
          this.loading = false;
        },
        error: (err: any) => {
          console.error('❌ Failed to load audience:', err);
          this.error = 'Failed to load audience data';
          this.loading = false;
        }
      });
  }

  filterMembers(): void {
    let filtered = [...this.audienceMembers];

    // Filter by search text
    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      filtered = filtered.filter(m => 
        m.email.toLowerCase().includes(search) ||
        m.firstName?.toLowerCase().includes(search) ||
        m.lastName?.toLowerCase().includes(search)
      );
    }

    // Filter by status
    if (this.selectedStatus !== 'all') {
      filtered = filtered.filter(m => m.status === this.selectedStatus);
    }

    this.filteredMembers = filtered;
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.newSubscriber = { email: '', firstName: '', lastName: '' };
    }
  }

  addSubscriber(): void {
    if (!this.organizationId || !this.newSubscriber.email) return;

    this.loading = true;
    this.orgService.addSubscriber(this.organizationId, this.newSubscriber)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          console.log('✅ Subscriber added');
          this.showAddForm = false;
          this.newSubscriber = { email: '', firstName: '', lastName: '' };
          this.loadAudienceData(); // Reload list
        },
        error: (err: any) => {
          console.error('❌ Failed to add subscriber:', err);
          this.loading = false;
        }
      });
  }

  deleteSubscriber(email: string): void {
    if (!this.organizationId) return;
    
    if (!confirm(`Are you sure you want to unsubscribe ${email}?`)) return;

    this.orgService.deleteSubscriber(this.organizationId, email, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          console.log('✅ Subscriber removed');
          this.loadAudienceData(); // Reload list
        },
        error: (err: any) => {
          console.error('❌ Failed to remove subscriber:', err);
        }
      });
  }

  editSubscriber(member: AudienceMember): void {
    // TODO: Open dialog/modal to edit subscriber firstName, lastName, and tags
    console.log('📝 Edit subscriber:', member.email);
    const firstName = prompt('Enter first name:', member.firstName || '');
    const lastName = prompt('Enter last name:', member.lastName || '');
    
    if (firstName === null && lastName === null) return; // User cancelled
    
    if (!this.organizationId) return;

    const updateData: any = {};
    if (firstName !== null) updateData.firstName = firstName;
    if (lastName !== null) updateData.lastName = lastName;

    this.orgService.updateSubscriber(this.organizationId, member.email, updateData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          console.log('✅ Subscriber updated');
          this.loadAudienceData(); // Reload list
        },
        error: (err: any) => {
          console.error('❌ Failed to update subscriber:', err);
        }
      });
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e: any) => {
      const csvData = e.target.result;
      this.parseCsvAndImport(csvData);
    };
    reader.readAsText(file);
  }

  parseCsvAndImport(csvData: string): void {
    const lines = csvData.split('\n');
    const subscribers: any[] = [];

    // Skip header row, parse data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [email, firstName, lastName] = line.split(',').map(s => s.trim());
      if (email) {
        subscribers.push({ email, firstName: firstName || '', lastName: lastName || '' });
      }
    }

    if (subscribers.length === 0) {
      alert('No valid subscribers found in CSV');
      return;
    }

    if (!this.organizationId) return;

    this.loading = true;
    this.orgService.bulkImportSubscribers(this.organizationId, subscribers)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: any) => {
          console.log('✅ Bulk import complete:', result);
          alert(`Added ${result.addedCount} subscribers, ${result.errorCount} errors`);
          this.loadAudienceData(); // Reload list
        },
        error: (err: any) => {
          console.error('❌ Failed to import:', err);
          this.loading = false;
        }
      });
  }

  goBack(): void {
    this.router.navigate(['/organization']);
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'subscribed':
        return 'primary';
      case 'unsubscribed':
        return 'warn';
      case 'cleaned':
        return 'accent';
      default:
        return '';
    }
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  }

  getStatusCount(status: string): number {
    if (status === 'all') return this.audienceMembers.length;
    return this.audienceMembers.filter(m => m.status === status).length;
  }
}
