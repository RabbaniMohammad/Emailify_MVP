import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface TemplateListItem {
  id: string;
  name: string;
}

@Component({
  selector: 'app-template-list',
  standalone: true,
  imports: [CommonModule, MatListModule, MatButtonModule, MatIconModule],
  templateUrl: './template-list.component.html',
  styleUrls: ['./template-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateListComponent implements AfterViewInit, OnDestroy {
  @Input() items: ReadonlyArray<TemplateListItem> = [];
  @Input() selectedId?: string;

  /** If this id matches a row, show the action button on that row. */
  @Input() showActionForId?: string;

  @Output() select = new EventEmitter<TemplateListItem>();
  @Output() action = new EventEmitter<string>(); // emits template id

  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;
  
  private scrollListener?: () => void;

  ngAfterViewInit() {
    this.setupScrollDetection();
  }

  ngOnDestroy() {
    if (this.scrollListener && this.scrollContainer) {
      this.scrollContainer.nativeElement.removeEventListener('scroll', this.scrollListener);
    }
  }

  onClick(item: TemplateListItem) {
    this.select.emit(item);
  }

  onAction(item: TemplateListItem, ev: MouseEvent) {
    ev.stopPropagation(); // don't re-trigger row select
    this.action.emit(item.id);
  }

  trackById = (_: number, item: TemplateListItem) => item.id;

  private setupScrollDetection() {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;

    this.scrollListener = () => {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const scrollBottom = scrollHeight - scrollTop - clientHeight;

      // Add class when scrolled from top
      if (scrollTop > 10) {
        container.classList.add('scrolled-top');
      } else {
        container.classList.remove('scrolled-top');
      }

      // Add class when scrolled to bottom
      if (scrollBottom < 10) {
        container.classList.add('scrolled-bottom');
      } else {
        container.classList.remove('scrolled-bottom');
      }
    };

    container.addEventListener('scroll', this.scrollListener);
    
    // Initial check after a short delay
    setTimeout(() => {
      if (this.scrollListener) {
        this.scrollListener();
      }
    }, 100);
  }
}