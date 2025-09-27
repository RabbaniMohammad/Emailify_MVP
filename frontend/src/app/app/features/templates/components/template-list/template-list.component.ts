import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
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
export class TemplateListComponent {
  @Input() items: ReadonlyArray<TemplateListItem> = [];
  @Input() selectedId?: string;

  /** If this id matches a row, show the action button on that row. */
  @Input() showActionForId?: string;

  @Output() select = new EventEmitter<TemplateListItem>();
  @Output() action = new EventEmitter<string>(); // emits template id

  onClick(item: TemplateListItem) {
    this.select.emit(item);
  }

  onAction(item: TemplateListItem, ev: MouseEvent) {
    ev.stopPropagation(); // don't re-trigger row select
    this.action.emit(item.id);
  }

  trackById = (_: number, item: TemplateListItem) => item.id;
}
