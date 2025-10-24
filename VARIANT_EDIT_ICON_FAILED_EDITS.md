# Variant Edit Icon - Failed Edits Visual Indicator

## ✅ Implementation Summary

Added visual feedback to the variant edit icon to indicate when a variant has failed edits that need manual attention.

## 🎯 Features Added

### 1. **Color Change Based on Failed Edits**
- **Blue (default)**: When variant has no failed edits - normal editing flow
- **Red**: When variant has failed edits detected - requires manual fixing

### 2. **Dynamic Tooltip**
- **Default**: "Edit in Visual Editor"
- **With Failed Edits**: "Failed edits detected - open editor"

## 📝 Changes Made

### 1. **TypeScript Component** (`qa-page.component.ts`)

Added two helper methods:

```typescript
/**
 * Check if a variant has failed edits
 */
hasFailedEdits(variant: any): boolean {
  return variant?.failedEdits && variant.failedEdits.length > 0;
}

/**
 * Get tooltip text for variant edit button
 */
getEditTooltip(variant: any): string {
  return this.hasFailedEdits(variant) 
    ? 'Failed edits detected - open editor' 
    : 'Edit in Visual Editor';
}
```

### 2. **HTML Template** (`qa-page.component.html`)

Updated the variant edit button:

```html
<button 
  mat-icon-button 
  class="variant-edit-btn"
  [class.has-failed-edits]="hasFailedEdits(v)"
  (click)="onEditVariant(vr.runId, v.no, v)"
  [matTooltip]="getEditTooltip(v)">
  <mat-icon>edit</mat-icon>
</button>
```

### 3. **SCSS Styling** (`qa-page.component.scss`)

Added red gradient for failed edits state:

```scss
&.has-failed-edits {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  
  &:hover {
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.5);
    background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
  }
}
```

### 4. **Type Definition** (`qa.service.ts`)

Added `failedEdits` property to `VariantItem` type for better TypeScript support:

```typescript
export type VariantItem = {
  no: number;
  html: string;
  changes: Array<{ before: string; after: string; parent: string; reason?: string }>;
  why: string[];
  artifacts: { usedIdeas: string[] };
  failedEdits?: Array<{
    find: string;
    replace: string;
    reason?: string;
  }>;
};
```

## 🎨 Visual Behavior

### Normal Variant (No Failed Edits)
- **Icon Color**: Purple gradient
- **Tooltip**: "Edit in Visual Editor"
- **Hover Effect**: Lighter purple with glow

### Variant with Failed Edits
- **Icon Color**: Red gradient (stands out)
- **Tooltip**: "Failed edits detected - open editor"
- **Hover Effect**: Lighter red with red glow

## 🔄 How It Works

1. Backend sends variants with both `changes` (successful edits) and `failedEdits` (failed edits)
2. Component checks if `variant.failedEdits` exists and has length > 0
3. If true, applies `has-failed-edits` CSS class and changes tooltip
4. Visual editor will load these failed edits from localStorage for manual fixing

## ✨ User Experience

- **Clear Visual Indication**: Users immediately see which variants need attention (red icon)
- **Informative Tooltip**: Tooltip explains why the icon is red
- **Consistent with Existing Pattern**: Similar to the golden template visual editor button that also changes color based on failed edits

## 🧪 Testing

To test:
1. Generate variants for a campaign
2. If backend returns any variants with `failedEdits`, their edit icons should be red
3. Hovering should show "Failed edits detected - open editor"
4. Clicking should still open the visual editor with failed edits loaded for fixing
