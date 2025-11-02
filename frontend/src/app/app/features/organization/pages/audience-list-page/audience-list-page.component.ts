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
import { takeUntil, take, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { OrganizationService, AudienceMember } from '../../../../core/services/organization.service';
import { AuthService } from '../../../../core/services/auth.service';
import { PaginationComponent, PageChangeEvent } from '../../../../shared/components/pagination/pagination.component';

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
    MatMenuModule,
    PaginationComponent  // 🚀 Import our new pagination component
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
  private searchSubject$ = new Subject<string>();

  loading = true;
  paginationLoading = false; // Separate loading state for pagination
  error: string | null = null;
  organizationId: string | null = null;
  
  // Audience data
  audienceMembers: AudienceMember[] = [];
  filteredMembers: AudienceMember[] = [];
  totalSubscribers = 0;
  
  // Pagination state
  currentPage = 1;
  pageSize = 5;
  totalItems = 0;
  
  // Pagination cache
  private paginationCache = new Map<string, AudienceMember[]>();
  
  // Filters
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
    
    // Setup search debounce
    this.searchSubject$.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchText => {
      this.searchText = searchText;
      this.currentPage = 1; // Reset to first page on search
      this.loadAudienceData(true); // Use pagination loading for search
    });
    
    // Get organization ID from current user - only once on init
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

  loadAudienceData(isPagination: boolean = false): void {
    if (!this.organizationId) return;

    // Create cache key for pagination
    const cacheKey = `page_${this.currentPage}_${this.pageSize}_${this.selectedStatus}_${this.searchText}`;
    
    // Check pagination cache first
    const cached = this.paginationCache.get(cacheKey);
    if (cached && isPagination) {
      this.audienceMembers = cached;
      this.filteredMembers = [...cached];
      this.paginationLoading = false;
      return;
    }

    // Use different loading states for initial load vs pagination
    if (isPagination) {
      this.paginationLoading = true;
    } else {
      this.loading = true;
    }
    
    console.log(`📊 Loading audience page ${this.currentPage} for org: ${this.organizationId}`);

    this.orgService.getAudienceStats(this.organizationId, {
      page: this.currentPage,
      limit: this.pageSize,
      status: this.selectedStatus,
      search: this.searchText
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any) => {
          console.log('✅ Audience data loaded:', data);
          
          // Handle both old and new response formats
          this.audienceMembers = data.members || data.recentMembers || [];
          this.filteredMembers = [...this.audienceMembers];
          
          // Cache the page data
          this.paginationCache.set(cacheKey, this.audienceMembers);
          
          // Update stats
          this.totalSubscribers = data.stats?.totalSubscribers || 0;
          
          // Update pagination metadata
          if (data.pagination) {
            this.totalItems = data.pagination.totalItems;
            this.currentPage = data.pagination.page;
          } else {
            // Fallback for backward compatibility
            this.totalItems = this.audienceMembers.length;
          }
          
          this.loading = false;
          this.paginationLoading = false;
        },
        error: (err: any) => {
          console.error('❌ Failed to load audience:', err);
          this.error = 'Failed to load audience data';
          this.loading = false;
          this.paginationLoading = false;
        }
      });
  }

  // Search filter with debounce
  onSearchChange(searchText: string): void {
    this.searchSubject$.next(searchText);
  }

  // Status filter - triggers server-side reload
  filterMembers(): void {
    this.currentPage = 1; // Reset to first page
    this.paginationCache.clear(); // Clear pagination cache
    this.loadAudienceData();
  }

  // Manual refresh method
  refreshData(): void {
    console.log('🔄 Refreshing audience data...');
    this.paginationCache.clear(); // Clear all pagination cache
    this.currentPage = 1; // Reset to first page
    this.loadAudienceData();
  }

  // Pagination handlers
  onPageChange(event: PageChangeEvent): void {
    console.log('📄 Page changed:', event);
    this.currentPage = event.page;
    this.pageSize = event.pageSize;
    this.loadAudienceData(true); // Pass true to indicate pagination change
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.newSubscriber = { email: '', firstName: '', lastName: '' };
    }
  }

  addSubscriber(): void {
    if (!this.organizationId || !this.newSubscriber.email) return;

    // Create optimistic member
    const optimisticMember: AudienceMember = {
      email: this.newSubscriber.email,
      firstName: this.newSubscriber.firstName || '',
      lastName: this.newSubscriber.lastName || '',
      status: 'subscribed',
      joinedAt: new Date().toISOString()
    };
    
    // Optimistic update - add to UI immediately
    this.audienceMembers.unshift(optimisticMember);
    this.filteredMembers = [...this.audienceMembers];
    this.totalSubscribers++;
    this.totalItems++;
    
    // Clear form and hide
    const subscriberData = { ...this.newSubscriber };
    this.showAddForm = false;
    this.newSubscriber = { email: '', firstName: '', lastName: '' };
    
    // Clear pagination cache
    this.paginationCache.clear();

    // Send to server
    this.orgService.addSubscriber(this.organizationId, subscriberData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('✅ Subscriber added:', response);
          // Update with server response if available
          if (response.member) {
            const index = this.audienceMembers.findIndex(m => m.email === optimisticMember.email);
            if (index !== -1) {
              this.audienceMembers[index] = response.member;
              this.filteredMembers = [...this.audienceMembers];
            }
          }
        },
        error: (err: any) => {
          console.error('❌ Failed to add subscriber:', err);
          // Rollback optimistic update
          this.audienceMembers = this.audienceMembers.filter(m => m.email !== optimisticMember.email);
          this.filteredMembers = [...this.audienceMembers];
          this.totalSubscribers--;
          this.totalItems--;
          // Show error to user
          alert('Failed to add subscriber: ' + (err.error?.message || err.message));
        }
      });
  }

  deleteSubscriber(email: string): void {
    if (!this.organizationId) return;
    
    if (!confirm(`Are you sure you want to unsubscribe ${email}?`)) return;

    // Find the member to delete
    const memberToDelete = this.audienceMembers.find(m => m.email === email);
    if (!memberToDelete) return;
    
    // Optimistic update - remove from UI immediately
    this.audienceMembers = this.audienceMembers.filter(m => m.email !== email);
    this.filteredMembers = [...this.audienceMembers];
    this.totalSubscribers--;
    this.totalItems--;
    
    // Clear pagination cache
    this.paginationCache.clear();

    // Send to server
    this.orgService.deleteSubscriber(this.organizationId, email, false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          console.log('✅ Subscriber removed');
        },
        error: (err: any) => {
          console.error('❌ Failed to remove subscriber:', err);
          // Rollback optimistic update - add back the deleted member
          this.audienceMembers.push(memberToDelete);
          this.filteredMembers = [...this.audienceMembers];
          this.totalSubscribers++;
          this.totalItems++;
          alert('Failed to delete subscriber: ' + (err.error?.message || err.message));
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

    // Store original data for rollback
    const originalMember = { ...member };
    
    // Optimistic update - update UI immediately
    const index = this.audienceMembers.findIndex(m => m.email === member.email);
    if (index !== -1) {
      if (firstName !== null) this.audienceMembers[index].firstName = firstName;
      if (lastName !== null) this.audienceMembers[index].lastName = lastName;
      this.filteredMembers = [...this.audienceMembers];
    }
    
    // Clear pagination cache
    this.paginationCache.clear();

    // Send to server
    this.orgService.updateSubscriber(this.organizationId, member.email, updateData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          console.log('✅ Subscriber updated:', response);
          // Update with server response if available
          if (response.member && index !== -1) {
            this.audienceMembers[index] = response.member;
            this.filteredMembers = [...this.audienceMembers];
          }
        },
        error: (err: any) => {
          console.error('❌ Failed to update subscriber:', err);
          // Rollback optimistic update
          if (index !== -1) {
            this.audienceMembers[index] = originalMember;
            this.filteredMembers = [...this.audienceMembers];
          }
          alert('Failed to update subscriber: ' + (err.error?.message || err.message));
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
    
    // Clear pagination cache before import
    this.paginationCache.clear();
    
    this.orgService.bulkImportSubscribers(this.organizationId, subscribers)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: any) => {
          console.log('✅ Bulk import complete:', result);
          alert(`Added ${result.addedCount} subscribers, ${result.errorCount} errors`);
          this.loadAudienceData(); // Reload list after bulk import
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
