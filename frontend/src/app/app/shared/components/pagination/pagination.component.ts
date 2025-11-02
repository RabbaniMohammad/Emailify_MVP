import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

export interface PageChangeEvent {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginationConfig {
  pageSizeOptions?: number[];
  showFirstLastButtons?: boolean;
  showPageSizeSelector?: boolean;
  showPageInfo?: boolean;
  maxVisiblePages?: number;
  previousLabel?: string;
  nextLabel?: string;
  firstLabel?: string;
  lastLabel?: string;
}

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './pagination.component.html',
  styleUrls: ['./pagination.component.scss']
})
export class PaginationComponent implements OnChanges {
  // Required inputs
  @Input() totalItems = 0;
  @Input() currentPage = 1;
  @Input() pageSize = 25;
  @Input() loading = false; // Loading state for pagination

  // Optional configuration
  @Input() config: PaginationConfig = {
    pageSizeOptions: [10, 25, 50, 100],
    showFirstLastButtons: true,
    showPageSizeSelector: true,
    showPageInfo: true,
    maxVisiblePages: 7,
    previousLabel: 'Previous',
    nextLabel: 'Next',
    firstLabel: 'First',
    lastLabel: 'Last'
  };

  // Events
  @Output() pageChange = new EventEmitter<PageChangeEvent>();
  @Output() pageSizeChange = new EventEmitter<number>();

  // Computed properties
  totalPages = 0;
  visiblePages: number[] = [];
  startItem = 0;
  endItem = 0;

  // Default config
  private defaultConfig: PaginationConfig = {
    pageSizeOptions: [10, 25, 50, 100],
    showFirstLastButtons: true,
    showPageSizeSelector: true,
    showPageInfo: true,
    maxVisiblePages: 7,
    previousLabel: 'Previous',
    nextLabel: 'Next',
    firstLabel: 'First',
    lastLabel: 'Last'
  };

  ngOnChanges(changes: SimpleChanges): void {
    // Merge config with defaults
    this.config = { ...this.defaultConfig, ...this.config };

    // Recalculate when inputs change
    this.calculatePagination();
  }

  private calculatePagination(): void {
    // Calculate total pages
    this.totalPages = Math.ceil(this.totalItems / this.pageSize);

    // Ensure current page is within bounds
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    // Calculate visible page numbers
    this.visiblePages = this.calculateVisiblePages();

    // Calculate item range being displayed
    this.startItem = this.totalItems === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    this.endItem = Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  private calculateVisiblePages(): number[] {
    const maxVisible = this.config.maxVisiblePages || 7;
    const pages: number[] = [];

    if (this.totalPages <= maxVisible) {
      // Show all pages if total is less than max
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Smart pagination - show pages around current page
      const halfVisible = Math.floor(maxVisible / 2);
      let startPage = Math.max(1, this.currentPage - halfVisible);
      let endPage = Math.min(this.totalPages, startPage + maxVisible - 1);

      // Adjust if we're near the end
      if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
      }

      // Add first page and ellipsis
      if (startPage > 1) {
        pages.push(1);
        if (startPage > 2) {
          pages.push(-1); // -1 represents ellipsis
        }
      }

      // Add visible pages
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      // Add ellipsis and last page
      if (endPage < this.totalPages) {
        if (endPage < this.totalPages - 1) {
          pages.push(-1); // ellipsis
        }
        pages.push(this.totalPages);
      }
    }

    return pages;
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) {
      return;
    }

    this.currentPage = page;
    this.calculatePagination();
    this.emitPageChange();
  }

  goToFirstPage(): void {
    this.goToPage(1);
  }

  goToLastPage(): void {
    this.goToPage(this.totalPages);
  }

  goToPreviousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  goToNextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  onPageSizeChange(newSize: number): void {
    if (newSize === this.pageSize) {
      return;
    }

    this.pageSize = newSize;
    
    // Adjust current page to maintain approximate position
    const currentFirstItem = (this.currentPage - 1) * this.pageSize;
    this.currentPage = Math.floor(currentFirstItem / newSize) + 1;
    
    this.calculatePagination();
    this.pageSizeChange.emit(this.pageSize);
    this.emitPageChange();
  }

  private emitPageChange(): void {
    const event: PageChangeEvent = {
      page: this.currentPage,
      pageSize: this.pageSize,
      offset: (this.currentPage - 1) * this.pageSize
    };
    this.pageChange.emit(event);
  }

  get hasPreviousPage(): boolean {
    return this.currentPage > 1;
  }

  get hasNextPage(): boolean {
    return this.currentPage < this.totalPages;
  }

  get isFirstPage(): boolean {
    return this.currentPage === 1;
  }

  get isLastPage(): boolean {
    return this.currentPage === this.totalPages;
  }
}
