# CORRECT Implementation: Click-then-Click-Hold-Drag

## What You Actually Want

**Sequence:**
1. **Click 1** - Full click (mousedown + mouseup) → Nothing happens, just records time
2. **Click 2 DOWN** - Second mousedown (within 500ms) → **Immediately starts dragging**
3. **Hold** - Keep mouse button pressed → Element follows cursor
4. **Drag** - Move mouse while holding → Element moves
5. **Release** - Mouseup → Drop element

## Key Difference from Double-Click

| Standard Double-Click | Your Requirement |
|----------------------|------------------|
| Click (down+up) | Click (down+up) ✓ |
| Click (down+up) | **Click down (hold)** ← Key difference! |
| Then drag | Already dragging ✓ |

## Implementation

### TypeScript Logic

```typescript
private lastButtonClickTime = 0;
private readonly DOUBLE_CLICK_THRESHOLD = 500; // ms

onButtonMouseDown(event: MouseEvent): void {
  const currentTime = Date.now();
  const timeSinceLastClick = currentTime - this.lastButtonClickTime;
  
  // Check if this is SECOND mousedown within threshold
  if (timeSinceLastClick < this.DOUBLE_CLICK_THRESHOLD) {
    // SECOND MOUSEDOWN = START DRAGGING IMMEDIATELY
    event.stopPropagation();
    event.preventDefault();
    
    this.dragEnabled = true;
    this.isDragging = true;
    
    // Calculate drag offset
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    this.dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    
    // Reset timer
    this.lastButtonClickTime = 0;
  } else {
    // FIRST MOUSEDOWN = Just record time
    this.lastButtonClickTime = currentTime;
  }
}

onButtonClick(event: MouseEvent): void {
  if (this.isDragging || this.dragEnabled) return;
  
  const currentTime = Date.now();
  const timeSinceMouseDown = currentTime - this.lastButtonClickTime;
  
  // Only toggle if standalone click (not part of double-click)
  if (timeSinceMouseDown > this.DOUBLE_CLICK_THRESHOLD) {
    this.isWidgetOpen = !this.isWidgetOpen;
  }
}
```

### HTML

```html
<div 
  class="floating-button"
  (mousedown)="onButtonMouseDown($event)"  <!-- Track clicks -->
  (click)="onButtonClick($event)">         <!-- Handle single clicks -->
```

## How It Works

### Scenario 1: Single Click (Open/Close Widget)

```
Time    Event           Action
----    -----           ------
0ms     mousedown       Record time (lastButtonClickTime = 0)
50ms    mouseup         -
60ms    click           Check: 60ms > 500ms? No
                        But no second click coming...
600ms   (timeout)       Now it's been > 500ms
                        Next click will be treated as NEW first click
```

**Wait, this needs a fix for single click!**

### Scenario 2: Click-Click-Hold-Drag

```
Time    Event           Action
----    -----           ------
0ms     mousedown #1    Record time (lastButtonClickTime = 0)
50ms    mouseup #1      -
60ms    click #1        Check: 60ms < 500ms, but isDragging = false
                        So do nothing (wait for potential second click)

300ms   mousedown #2    Check: 300ms < 500ms? YES!
                        ✅ START DRAGGING IMMEDIATELY
                        isDragging = true
                        Calculate dragOffset

310ms   mousemove       onDragMove() → Element follows cursor
320ms   mousemove       onDragMove() → Element follows cursor
...     ...             ...

800ms   mouseup #2      onDragEnd() → Drop element
                        isDragging = false
```

## Wait - Single Click Issue!

I need to fix the single-click detection. Let me update:

```typescript
onButtonClick(event: MouseEvent): void {
  if (this.isDragging || this.dragEnabled) {
    return; // Don't process if dragging
  }
  
  const currentTime = Date.now();
  const timeSinceMouseDown = currentTime - this.lastButtonClickTime;
  
  if (timeSinceMouseDown < this.DOUBLE_CLICK_THRESHOLD) {
    // This click is part of potential double-click sequence
    // Don't toggle yet, wait to see if second mousedown comes
    console.log('⏳ Waiting for potential second click...');
    
    // Set timeout to toggle if no second click comes
    setTimeout(() => {
      const now = Date.now();
      const elapsed = now - this.lastButtonClickTime;
      
      // If still no second click after threshold, toggle widget
      if (elapsed >= this.DOUBLE_CLICK_THRESHOLD && !this.isDragging) {
        console.log('✅ No second click came, toggle widget');
        this.isWidgetOpen = !this.isWidgetOpen;
        
        if (this.isWidgetOpen && !this.hasShownPulseAnimation) {
          this.hasShownPulseAnimation = true;
        }
        
        this.cdr.markForCheck();
      }
    }, this.DOUBLE_CLICK_THRESHOLD);
  }
}
```

Actually, this is getting complicated again. Let me think of a simpler approach...

## Simpler Approach

The issue is distinguishing between:
- Single click (toggle widget)
- Click-then-click-hold (drag)

**Better solution:**
- First mousedown: Record time
- Second mousedown within 500ms: Start drag
- First click event: Set timeout to toggle after 500ms (if no second click comes)

But this creates delay for single clicks...

## Actually, Let's Use This Logic:

```typescript
onButtonMouseDown(event: MouseEvent): void {
  const currentTime = Date.now();
  const timeSinceLastClick = currentTime - this.lastButtonClickTime;
  
  if (timeSinceLastClick < 500) {
    // SECOND CLICK - Start dragging
    this.dragEnabled = true;
    this.isDragging = true;
    // ... setup drag
  } else {
    // FIRST CLICK - Record time
    this.lastButtonClickTime = currentTime;
  }
}

onButtonClick(event: MouseEvent): void {
  if (this.isDragging) return;
  
  // Toggle widget (will happen on first click)
  this.isWidgetOpen = !this.isWidgetOpen;
}
```

**Problem:** First click will toggle widget immediately, then if you click again fast, it will start drag but widget already toggled.

**Solution:** Don't toggle on first click, toggle only if no second click comes:

```typescript
private pendingToggle: any = null;

onButtonClick(event: MouseEvent): void {
  if (this.isDragging) return;
  
  const currentTime = Date.now();
  const timeSinceMouseDown = currentTime - this.lastButtonClickTime;
  
  if (timeSinceMouseDown < 500) {
    // First click - schedule toggle
    this.pendingToggle = setTimeout(() => {
      this.isWidgetOpen = !this.isWidgetOpen;
      this.cdr.markForCheck();
    }, 500);
  }
}

onButtonMouseDown(event: MouseEvent): void {
  const currentTime = Date.now();
  const timeSinceLastClick = currentTime - this.lastButtonClickTime;
  
  if (timeSinceLastClick < 500) {
    // Second click - cancel pending toggle and start drag
    if (this.pendingToggle) {
      clearTimeout(this.pendingToggle);
      this.pendingToggle = null;
    }
    
    this.dragEnabled = true;
    this.isDragging = true;
    // ... setup drag
  } else {
    // First click
    this.lastButtonClickTime = currentTime;
  }
}
```

This way:
- Single click: Toggles after 500ms delay
- Click-click-hold: Cancels toggle, starts drag immediately

Let me implement this properly!
