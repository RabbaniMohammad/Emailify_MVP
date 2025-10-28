import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TemplatePreviewPanelComponent } from '../../../../shared/components/template-preview-panel/template-preview-panel.component';

import { MatMenuModule } from '@angular/material/menu';

import { TemplateGenerationService, GenerationMessage } from '../../../../core/services/template-generation.service';
import { TemplatesService } from '../../../../core/services/templates.service';

import { PreviewCacheService } from '../../../templates/components/template-preview/preview-cache.service';

import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

import { CanComponentDeactivate } from '../../../../core/guards/can-deactivate.guard';
import { TemplateStateService } from '../../../../core/services/template-state.service';

// Image upload interfaces
interface ImageAttachment {
  data: string;
  mediaType: string;
  fileName: string;
}

@Component({
  selector: 'app-generate-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule, 
    MatMenuModule,
    MatDialogModule,
    TemplatePreviewPanelComponent,
  ],
  templateUrl: './generate-page.component.html',
  styleUrls: ['./generate-page.component.scss'],
})
export class GeneratePageComponent implements OnInit, OnDestroy, AfterViewInit, CanComponentDeactivate {
  private generationService = inject(TemplateGenerationService);
  private templatesService = inject(TemplatesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private destroy$ = new Subject<void>();
  private previewCache = inject(PreviewCacheService);
  private scrollAnimation: number | null = null;
  private templateState = inject(TemplateStateService);
  // Add this property at the top of your component class
private sentImages: Array<{name: string, size: number}> = [];

  private cdr = inject(ChangeDetectorRef);

  viewMode: 'desktop' | 'tablet' | 'mobile' = 'desktop';

  @ViewChild('messagesContainer') messagesContainer?: ElementRef;
  @ViewChild('messageInput') messageInput?: ElementRef;

  // State
  conversationId: string | null = null;
  messages$ = new BehaviorSubject<GenerationMessage[]>([]);
  currentHtml$ = new BehaviorSubject<string>('');
  isGenerating$ = new BehaviorSubject<boolean>(false);
  isRegenerating = false; // Track if it's a regeneration
  private justCreatedConversationId: string | null = null; // Track conversation we just created
  userInput = '';
  templateName = 'Generated Template';

  // Image upload state
    selectedImages: File[] = [];
    imagePreviewUrls: string[] = [];
    maxImages = 2;
    maxSizeBytes = 5 * 1024 * 1024; // 5MB

    // Chat limit
    readonly MAX_CHAT_MESSAGES = 20;

  // Scroll state
  private shouldAutoScroll = true;
  private isProgrammaticScroll = false; // Flag to ignore scroll events during auto-scroll


    ngOnInit(): void {
    this.templateName = 'Generated Template';
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        const conversationId = params.get('conversationId');
        
        if (conversationId && conversationId !== 'new') {
          // Real conversation ID
          if (this.conversationId !== conversationId) {
            // Only load if we didn't just set this conversationId ourselves
            if (this.conversationId === null) {
              this.loadConversation(conversationId);
            }
          }
        } else if (conversationId === 'new') {
          // Generate a new conversation ID immediately and navigate to it
          const newConversationId = this.generateUUID();
          this.conversationId = newConversationId;
          this.isRegenerating = false;
          this.initializeWelcome();
          // Replace URL with actual ID (no component recreation since it's same route)
          this.router.navigate(['/generate', newConversationId], { replaceUrl: true });
        }
    });
    }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  changeViewMode(mode: 'desktop' | 'tablet' | 'mobile'): void {
    this.viewMode = mode;
  }
  ngAfterViewInit() {
  setTimeout(() => {
    try {
      const chatElement = this.messagesContainer?.nativeElement;
      if (chatElement) {
        chatElement.addEventListener('wheel', () => {
          if (this.scrollAnimation) {
            cancelAnimationFrame(this.scrollAnimation);
            this.scrollAnimation = null;
          }
        });
        
        chatElement.addEventListener('touchmove', () => {
          if (this.scrollAnimation) {
            cancelAnimationFrame(this.scrollAnimation);
            this.scrollAnimation = null;
          }
        });
      }

      window.scrollTo(0, 0);
      this.positionChatAtBottom();
    } catch (error) {

    }
  }, 0);
}

private positionChatAtBottom(): void {
  setTimeout(() => {
    const element = this.messagesContainer?.nativeElement;
    if (element && element.scrollHeight > 0) {
      element.style.scrollBehavior = 'auto'; // No animation on initial load
      element.scrollTop = element.scrollHeight;
      
      setTimeout(() => {
        element.style.scrollBehavior = 'smooth'; // Enable smooth scroll after
      }, 50);
    }
  }, 50);
}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.messages$.complete();
    this.currentHtml$.complete();
    this.isGenerating$.complete();
  }

  /**
 * Handle page refresh (F5) - Show browser confirmation dialog
 */
@HostListener('window:beforeunload', ['$event'])
handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (this.isGenerating$.value) {
    const message = '⚠️ Your template is still being generated and will be lost if you leave.';
    event.preventDefault();
    event.returnValue = message;
    return;
  }
}
/**
 * Handle navigation away - Show custom confirmation
 */
canDeactivate(): boolean {
  // Allow navigation if not generating
  if (!this.isGenerating$.value) {
    return true;
  }

  // Show confirmation dialog
  const confirmed = confirm(
    '⚠️ Your template is still being generated and will be lost if you leave.\n\n' +
    'Are you sure you want to leave? All progress will be lost.'
  );

  if (confirmed) {
    // Clean up if user confirms
    this.isGenerating$.next(false);

  }

  return confirmed;
}

  private initializeWelcome(): void {
    // Show welcome message
    const welcomeMessage: GenerationMessage = {
      role: 'assistant',
      content:
        "👋 Hi! I'm your email template generator. Describe the email template you'd like to create, and I'll generate it for you.\n\nFor example:\n• \"Create a welcome email for new subscribers\"\n• \"Design a product launch announcement\"\n• \"Make a monthly newsletter template\"",
      timestamp: new Date(),
    };
    this.messages$.next([welcomeMessage]);
  }


  private loadConversation(conversationId: string): void {
    this.conversationId = conversationId;
    this.isRegenerating = true; // It's already an existing conversation
    this.isGenerating$.next(true);

    this.generationService
      .getConversation(conversationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (conversation) => {
          this.messages$.next(conversation.messages);
          this.currentHtml$.next(conversation.currentHtml);
          this.templateName = conversation.templateName || '';
          this.isGenerating$.next(false);
          this.scrollToBottom();
        },
        error: (error) => {
          this.snackBar.open('Failed to load conversation', 'Close', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
          this.isGenerating$.next(false);
          // Redirect to new conversation
          this.router.navigate(['/generate/new'], { replaceUrl: true });
        },
      });
  }

  onEnterKey(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;

    if (!event.shiftKey) {
      event.preventDefault();
      this.onSend();
    }
  }

  async onPaste(event: ClipboardEvent): Promise<void> {
    // Get clipboard items
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    // Check for image files in clipboard
    const items = Array.from(clipboardData.items);
    const imageItems = items.filter(item => item.type.startsWith('image/'));

    if (imageItems.length === 0) {
      // No images in clipboard, let default paste behavior happen (text paste)
      return;
    }

    // Prevent default paste behavior when we have images
    event.preventDefault();

    // Check if we've reached the max limit
    if (this.selectedImages.length >= this.maxImages) {
      this.snackBar.open(
        `Maximum ${this.maxImages} images allowed. Remove existing images first.`,
        'Close',
        { duration: 4000, panelClass: ['error-snackbar'] }
      );
      return;
    }

    // Check how many we can add
    const availableSlots = this.maxImages - this.selectedImages.length;
    const itemsToProcess = imageItems.slice(0, availableSlots);

    if (imageItems.length > availableSlots) {
      this.snackBar.open(
        `Only ${availableSlots} image${availableSlots === 1 ? '' : 's'} added. Maximum ${this.maxImages} images allowed.`,
        'Close',
        { duration: 4000, panelClass: ['info-snackbar'] }
      );
    }

    // Process each pasted image
    for (const item of itemsToProcess) {
      const file = item.getAsFile();
      if (file) {
        await this.processImage(file);
      }
    }

    // Show success message if images were added
    if (itemsToProcess.length > 0) {
      this.snackBar.open(
        `${itemsToProcess.length} image${itemsToProcess.length === 1 ? '' : 's'} pasted successfully`,
        'Close',
        { duration: 2000, panelClass: ['success-snackbar'] }
      );
    }
  }

  hasTemplate(): boolean {
    return !!(this.currentHtml$.value);
  }

async onSend(): Promise<void> {
  const message = this.userInput.trim();
  
  if (!message || this.isGenerating$.value) {
    return;
  }

  // Check chat limit (20 messages)
  const currentMessages = this.messages$.value;
  
  if (currentMessages.length >= this.MAX_CHAT_MESSAGES) {
    this.snackBar.open(
      `Chat limit reached (${this.MAX_CHAT_MESSAGES} messages). Please save your template and start a new chat.`,
      'Close',
      { 
        duration: 6000, 
        panelClass: ['error-snackbar'],
        horizontalPosition: 'center',
        verticalPosition: 'top',
      }
    );
    return;
  }
  
  // Convert selected images to base64 FIRST (before adding user message)
  const imageAttachments: ImageAttachment[] = await Promise.all(
    this.selectedImages.map(async (file) => {
      const base64 = await this.fileToBase64(file);
      return {
        data: base64,
        mediaType: file.type,
        fileName: file.name,
      };
    })
  );
  
  // Add user message to UI immediately (before API call) WITH images
  const existingMessages = this.messages$.value;
  const userMessage: GenerationMessage = {
    role: 'user',
    content: message,
    timestamp: new Date(),
    images: imageAttachments.length > 0 ? imageAttachments : undefined,
  };
  this.messages$.next([...existingMessages, userMessage]);
  
  // Store ORIGINAL file metadata (before compression stored the compressed size)
  this.selectedImages.forEach(file => {
    const originalSize = (file as any).originalSize || file.size;
    const originalName = (file as any).originalName || file.name;
    this.sentImages.push({ name: originalName, size: originalSize });
  });
  
  this.isGenerating$.next(true);
  this.shouldAutoScroll = true;
  
  // Scroll to show the new user message
  setTimeout(() => this.scrollToBottom(), 50);

  // ✅ Set isRegenerating to true if we already have a conversation
  if (this.conversationId && this.currentHtml$.value) {
    this.isRegenerating = true;
  }

  // Always use startGeneration with the conversationId (which is pre-generated)
  this.startNewConversation(message, imageAttachments);

  // Clear input and images AFTER storing metadata
  this.userInput = '';
  this.selectedImages = [];
  this.imagePreviewUrls = [];
}

private async startNewConversation(message: string, imageAttachments: ImageAttachment[]): Promise<void> {

  this.generationService
    .startGeneration(message, imageAttachments, this.conversationId || undefined)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {

        // Update conversationId (should match what we sent, but backend might change it)
        this.conversationId = response.conversationId;
        this.generationService.setCurrentConversationId(response.conversationId);
        this.currentHtml$.next(response.html);

        // Add assistant response to existing messages with dynamic message
        const defaultMessage = this.isRegenerating 
          ? "✅ Template regenerated successfully!"
          : "✅ Template generated successfully!";
        
        const assistantMessage: GenerationMessage = {
          role: 'assistant',
          content: response.message || defaultMessage,
          timestamp: new Date(),
        };
        
        const updatedMessages = [...this.messages$.value, assistantMessage];

        this.messages$.next(updatedMessages);

        this.isGenerating$.next(false);
        
        // Set regenerating flag for NEXT generation in this conversation
        if (!this.isRegenerating) {
          this.isRegenerating = true;
        }
        
        this.shouldAutoScroll = true;
        setTimeout(() => {
          this.scrollToBottom();
        }, 100);

        if (response.hasErrors) {

          this.snackBar.open(
            'Template generated with warnings. Check console for details.',
            'Close',
            { duration: 5000, panelClass: ['info-snackbar'] }
          );

        }
      },
      error: (error) => {
        this.isGenerating$.next(false);
        this.snackBar.open(
          error.error?.message || 'Failed to generate template',
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
        this.isGenerating$.next(false);
      },
    });
}

private async continueConversation(message: string, imageAttachments: ImageAttachment[]): Promise<void> {

  if (!this.conversationId) {

    return;
  }

  // Images already converted in onSend(), just use them
  

  // ❌ REMOVED: Don't store here, already stored in onSend()
  // this.selectedImages.forEach(file => {
  //   this.sentImages.push({ name: file.name, size: file.size });
  // });

  // ✅ FIX: Don't add user message here - already added in onSend()
  // User message was already added to messages$ in onSend() before calling this method

  this.generationService
    .continueConversation(this.conversationId, message, imageAttachments)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {

        this.currentHtml$.next(response.html);

        const updatedMessages = this.messages$.value;

        updatedMessages.push({
          role: 'assistant',
          content: '✅ Template updated successfully',
          timestamp: new Date(),
        });
        

        this.messages$.next([...updatedMessages]);

        this.isGenerating$.next(false);

        this.scrollToBottom();

        if (response.hasErrors) {

          this.snackBar.open(
            'Template updated with warnings. Check console for details.',
            'Close',
            { duration: 5000, panelClass: ['info-snackbar'] }
          );

        } else {

          this.snackBar.open('Template updated!', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar'],
          });
        }
      },
      error: (error) => {


        this.snackBar.open(
          error.error?.message || 'Failed to update template',
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
        this.isGenerating$.next(false);
      },
    });
}

onRunTests(): void {

  if (!this.conversationId) {

    this.snackBar.open('No template to test', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  if (!this.currentHtml$.value) {

    this.snackBar.open('No template to save', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  // ✅ Validate template name
  const name = this.templateName?.trim();

  if (!name) {

    this.snackBar.open('Please enter a template name before running tests', 'Close', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
    return;
  }


  this.generationService
    .saveTemplate(this.conversationId, name)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {

        this.snackBar.open('Template saved! Redirecting to QA...', 'Close', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });

        // ✅ Initialize template state with the generated template
        const currentHtml = this.currentHtml$.value;
        if (currentHtml && response.templateId) {
          this.templateState.initializeOriginalTemplate(response.templateId, currentHtml);
        }

        this.router.navigate(['/qa', response.templateId]);

      },
      error: (error) => {




        this.snackBar.open('Failed to save template', 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      },
    });
}

onTemplateNameChange(newName: string): void {
  this.templateName = newName;
}
onSaveTemplate(): void {

  if (!this.conversationId) {

    this.snackBar.open('No template to save', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  // ✅ Validate template name
  const name = this.templateName?.trim();

  if (!name) {

    this.snackBar.open('Please enter a template name', 'Close', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
    return;
  }


  this.generationService
    .saveTemplate(this.conversationId, name)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {

        // ✅ Select the saved template so it appears first when we navigate
        this.templatesService.select(response.templateId, response.templateName || name);
        
        // ✅ Trigger a smart refresh to fetch the latest templates (including our new one)
        this.templatesService.smartRefresh();

        // Navigate to templates page without query parameters
        this.router.navigate(['/']);
        

      },
      error: (error) => {




        this.snackBar.open(
          error.error?.message || 'Failed to save template',
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
      },
    });
}

onNewConversation(): void {
  // Check if there's an active conversation with unsaved content
  const hasActiveConversation = this.conversationId && this.currentHtml$.value;
  
  if (hasActiveConversation) {
    // Show confirmation dialog
    const dialogRef = this.dialog.open(ConfirmNewConversationDialog, {
      width: '500px',
      disableClose: false,
      data: { hasTemplate: true }
    });

    dialogRef.afterClosed().subscribe((result: 'save' | 'discard' | 'cancel') => {
      if (result === 'save') {
        // Open save dialog
        this.onSaveTemplate();
      } else if (result === 'discard') {
        // Proceed with clearing conversation
        this.clearAndStartNew();
      }
      // If 'cancel', do nothing - user stays on current conversation
    });
  } else {
    // No active conversation, just start new
    this.clearAndStartNew();
  }
}

private clearAndStartNew(): void {
  // Clear current conversation
  this.conversationId = null;
  this.generationService.clearCurrentConversationId();
  this.messages$.next([]);
  this.currentHtml$.next('');
  this.templateName = '';
  this.userInput = '';
  
  // Clear sent images history
  this.sentImages = [];

  // Navigate to new conversation
  this.router.navigate(['/generate/new'], { replaceUrl: true });
  this.initializeWelcome();
}

  // ⭐ NEW METHOD: Handle preview refresh
  onRefreshPreview(): void {
    // Optional: Add any custom refresh logic here

  }

private scrollToBottom(): void {
  // Only auto-scroll if user hasn't manually scrolled up
  if (!this.shouldAutoScroll) {

    return;
  }

  // Set flag to ignore scroll events during programmatic scrolling
  this.isProgrammaticScroll = true;

  // Multiple attempts to ensure we catch the final height
  setTimeout(() => {
    const element = this.messagesContainer?.nativeElement;
    if (element) {
      this.smoothScrollTo(element.scrollHeight);
      
      // Second attempt after render is definitely complete
      setTimeout(() => {
        if (element) {
          this.smoothScrollTo(element.scrollHeight);
        }
        
        // Re-enable scroll event handling after programmatic scroll completes
        setTimeout(() => {
          this.isProgrammaticScroll = false;
        }, 100);
      }, 50);
    }
  }, 100);
}

private smoothScrollTo(targetPosition: number): void {
  const element = this.messagesContainer?.nativeElement;
  if (!element) return;

  if (this.scrollAnimation) {
    cancelAnimationFrame(this.scrollAnimation);
  }

  const startPosition = element.scrollTop;
  const distance = targetPosition - startPosition;
  const duration = 400; // ← Reduced from 800ms to 400ms
  let startTime: number | null = null;

  const animateScroll = (currentTime: number) => {
    if (startTime === null) startTime = currentTime;
    const timeElapsed = currentTime - startTime;
    const progress = Math.min(timeElapsed / duration, 1);

    // ✅ Better easing: ease-out (fast start, slow end)
    const ease = 1 - Math.pow(1 - progress, 3);

    element.scrollTop = startPosition + distance * ease;

    if (progress < 1) {
      this.scrollAnimation = requestAnimationFrame(animateScroll);
    } else {
      this.scrollAnimation = null;
    }
  };

  this.scrollAnimation = requestAnimationFrame(animateScroll);
}

  onScroll(event: Event): void {
    // Ignore scroll events triggered by programmatic scrolling
    if (this.isProgrammaticScroll) {
      return;
    }
    
    const element = event.target as HTMLElement;
    const atBottom =
      element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    this.shouldAutoScroll = atBottom;
  }


async onImageSelect(event: Event): Promise<void> {

  const input = event.target as HTMLInputElement;

  if (!input.files || input.files.length === 0) {

    return;
  }

  const files = Array.from(input.files);

  // Validate count BEFORE duplicate check
  if (this.selectedImages.length + files.length > this.maxImages) {

    this.snackBar.open(
      `Maximum ${this.maxImages} images allowed at a time`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
    input.value = '';
    return;
  }


  // ✅ Check for duplicates
  const { duplicates, newFiles } = this.checkDuplicateImages(files);
  

  if (duplicates.length > 0) {

    // Show confirmation dialog
    const duplicateNames = duplicates.map(f => `• ${f.name} (${(f.size/1024).toFixed(2)}KB)`).join('\n');
    const message = duplicates.length === 1
      ? `⚠️ This image is already uploaded:\n\n${duplicateNames}\n\nWould you like to upload it again?`
      : `⚠️ These images are already uploaded:\n\n${duplicateNames}\n\nWould you like to upload them again?`;
    
    const confirmed = confirm(message);
    
    if (!confirmed) {

      // Process only NEW files (non-duplicates)
      if (newFiles.length > 0) {

        for (const file of newFiles) {
          await this.processImage(file);
        }
      } else {

      }
      
      input.value = '';
      return;
    }
    

  } else {

  }
  
  // Process all files (either no duplicates, or user confirmed)
  for (const file of files) {

    await this.processImage(file);
  }
  
  input.value = ''; // Reset input

}

// ✅ NEW: Check for duplicate images
private checkDuplicateImages(newFiles: File[]): { duplicates: File[], newFiles: File[] } {

  const duplicates: File[] = [];
  const newFilesOnly: File[] = [];
  
  newFiles.forEach(newFile => {

    // ✅ CHANGED: Check against sentImages instead of selectedImages
    const isDuplicate = this.sentImages.some(sentImage => {
      const nameMatch = sentImage.name === newFile.name;
      const sizeMatch = sentImage.size === newFile.size;
      

      return nameMatch && sizeMatch;
    });
    
    if (isDuplicate) {

      duplicates.push(newFile);
    } else {

      newFilesOnly.push(newFile);
    }
  });
  

  return { duplicates, newFiles: newFilesOnly };
}

// Add this method to your GeneratePageComponent class
// Add this method to your GeneratePageComponent class
toggleFullscreen(): void {

  const element = document.querySelector('.preview-wrapper') as HTMLElement;
  
  if (!element) {

    return;
  }

  if (!document.fullscreenElement) {

    element.requestFullscreen().then(() => {

      // 🔍 DEBUG: Check overlay container location
      setTimeout(() => {
        const overlayContainer = document.querySelector('.cdk-overlay-container');

      }, 100);
    });
  } else {

    document.exitFullscreen();
  }
}


async processImage(file: File): Promise<void> {

  // Validate file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (!validTypes.includes(file.type)) {

    this.snackBar.open(
      `Invalid file type: ${file.name}. Please upload images only.`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
    return;
  }


  // ✅ NEW: Store original file metadata BEFORE compression
  const originalName = file.name;
  const originalSize = file.size;

  try {
    const processedFile = await this.compressImage(file);

    if (processedFile.size > this.maxSizeBytes) {

      this.snackBar.open(
        `Image ${file.name} is too large even after compression. Please use a smaller image.`,
        'Close',
        { duration: 4000, panelClass: ['error-snackbar'] }
      );
      return;
    }
    
    // ✅ NEW: Attach original metadata to the compressed file
    (processedFile as any).originalName = originalName;
    (processedFile as any).originalSize = originalSize;

    // Create preview URL

    const reader = new FileReader();
    reader.onload = (e) => {

      const previewUrl = e.target?.result as string;

      this.selectedImages.push(processedFile);
      this.imagePreviewUrls.push(previewUrl);
      

      // Scroll to show preview
      setTimeout(() => this.scrollToBottom(), 100);
    };
    reader.onerror = (error) => {

    };
    reader.readAsDataURL(processedFile);

  } catch (error) {

    this.snackBar.open(
      `Failed to process ${file.name}. Please try another image.`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
  }
}
async compressImage(file: File): Promise<File> {

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {

      const img = new Image();
      
      img.onload = () => {

        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if too large
        const maxDimension = 2000;

        if (width > maxDimension || height > maxDimension) {

          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }

        } else {

        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');

        ctx?.drawImage(img, 0, 0, width, height);
        

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size <= this.maxSizeBytes) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });

              resolve(compressedFile);
            } else {

              reject(new Error('Compression failed - file still too large'));
            }
          },
          'image/jpeg',
          0.8 // 80% quality
        );
      };
      
      img.onerror = () => {

        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target?.result as string;

    };
    
    reader.onerror = () => {

      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);

  });
}
removeImage(index: number): void {

  this.selectedImages.splice(index, 1);
  this.imagePreviewUrls.splice(index, 1);
  

}
triggerFileInput(): void {

  const fileInput = document.getElementById('imageUploadInput') as HTMLInputElement;

  if (!fileInput) {

    return;
  }
  

  fileInput?.click();
}
private fileToBase64(file: File): Promise<string> {

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {

      const result = reader.result as string;

      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];

      resolve(base64);
    };
    reader.onerror = (error) => {

      reject(error);
    };
    reader.readAsDataURL(file);

  });
}
  trackByIndex(index: number): number {
    return index;
  }
}

// ========================================
// Confirmation Dialog Component
// ========================================
@Component({
  selector: 'confirm-new-conversation-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="confirm-dialog">
      <div class="dialog-header">
        <mat-icon class="warning-icon">warning</mat-icon>
        <h2>Start New Conversation?</h2>
      </div>
      
      <div class="dialog-content">
        <p>You have an unsaved template in the current conversation.</p>
        <p><strong>Would you like to save it before starting a new conversation?</strong></p>
      </div>
      
      <div class="dialog-actions">
        <button mat-button (click)="onCancel()" class="cancel-btn">
          Cancel
        </button>
        <button mat-stroked-button (click)="onDiscard()" class="discard-btn">
          Discard
        </button>
        <button mat-raised-button (click)="onSave()" class="save-btn">
          Save Template
        </button>
      </div>
    </div>
  `,
  styles: [`
    .confirm-dialog {
      padding: 1.5rem;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .warning-icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: #f59e0b;
    }

    h2 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      color: #1e293b;
    }

    .dialog-content {
      margin-bottom: 2rem;
      line-height: 1.6;
      color: #475569;
    }

    .dialog-content p {
      margin: 0.5rem 0;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .cancel-btn {
      color: #64748b;
    }

    .discard-btn {
      color: #ef4444;
      border-color: #ef4444;
    }

    .discard-btn:hover {
      background-color: #fef2f2;
    }

    .save-btn {
      background: linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%);
      color: white;
    }

    .save-btn:hover {
      background: linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%);
    }
  `]
})
export class ConfirmNewConversationDialog {
  private dialogRef = inject(MatDialogRef<ConfirmNewConversationDialog>);

  onSave(): void {
    this.dialogRef.close('save');
  }

  onDiscard(): void {
    this.dialogRef.close('discard');
  }

  onCancel(): void {
    this.dialogRef.close('cancel');
  }
}