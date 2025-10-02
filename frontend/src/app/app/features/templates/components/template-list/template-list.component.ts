import { 
  Component, 
  Input, 
  Output, 
  EventEmitter, 
  ViewChild, 
  ElementRef 
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface TemplateItem {
  id: string;
  name: string;
  // Add other properties as needed
}

@Component({
  selector: 'app-template-list',
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './template-list.component.html',
  styleUrls: ['./template-list.component.scss']
})
export class TemplateListComponent {
  @Input() items: TemplateItem[] = [];
  @Input() selectedId: string | null | undefined = null;
  @Input() showActionForId: string | null | undefined = null;

  @Output() itemClick = new EventEmitter<TemplateItem>();
  @Output() actionClick = new EventEmitter<TemplateItem>();

  @ViewChild('scrollContainer', { static: false }) scrollContainer!: ElementRef<HTMLElement>;

  onClick(item: TemplateItem): void {
    this.itemClick.emit(item);
  }

  onAction(item: TemplateItem, event: Event): void {
    event.stopPropagation();
    this.actionClick.emit(item);
  }

  trackById(index: number, item: TemplateItem): string {
    return item.id;
  }

  // Utility methods for programmatic scrolling
  scrollToItem(itemId: string): void {
    if (!this.scrollContainer) return;
    
    const container = this.scrollContainer.nativeElement;
    const itemElement = container.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement;
    
    if (itemElement) {
      itemElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }

  scrollToTop(): void {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  }

  scrollToBottom(): void {
    if (this.scrollContainer) {
      const container = this.scrollContainer.nativeElement;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  // Debug method - remove after testing
  checkScrollStatus(): void {
    if (!this.scrollContainer) {
      console.log('❌ No scroll container found');
      return;
    }

    const container = this.scrollContainer.nativeElement;
    const computedStyle = window.getComputedStyle(container);
    
    console.log('🔍 Scroll Debug Info:', {
      overflowY: computedStyle.overflowY,
      overflowX: computedStyle.overflowX,
      height: computedStyle.height,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      isScrollable: container.scrollHeight > container.clientHeight,
      itemCount: this.items.length
    });
  }

  // Test method - remove after testing
  addTestItems(): void {
    const testItems: TemplateItem[] = Array.from({length: 10}, (_, i) => ({
      id: `test-${Date.now()}-${i}`,
      name: `Test Template ${i + 1}`
    }));
    this.items = [...this.items, ...testItems];
  }
}