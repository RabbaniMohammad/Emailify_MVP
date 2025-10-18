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

import { PreviewCacheService } from '../../../templates/components/template-preview/preview-cache.service';

import { MatTooltipModule } from '@angular/material/tooltip';

import { CanComponentDeactivate } from '../../../../core/guards/can-deactivate.guard';

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
    TemplatePreviewPanelComponent,
  ],
  templateUrl: './generate-page.component.html',
  styleUrls: ['./generate-page.component.scss'],
})
export class GeneratePageComponent implements OnInit, OnDestroy, AfterViewInit, CanComponentDeactivate {
  private generationService = inject(TemplateGenerationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private snackBar = inject(MatSnackBar);
  private destroy$ = new Subject<void>();
  private previewCache = inject(PreviewCacheService);
  private scrollAnimation: number | null = null;
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


    ngOnInit(): void {
    this.templateName = 'Generated Template';
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        const conversationId = params.get('conversationId');
        if (conversationId) {
        this.loadConversation(conversationId);
        } else {
        // ✅ FIX: Don't auto-redirect, just show welcome
        this.initializeWelcome();
        }
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
      console.error('Error in ngAfterViewInit:', error);
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
    console.log('🧹 Template generation cancelled by user navigation');
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
          console.error('Failed to load conversation:', error);
          this.snackBar.open('Failed to load conversation', 'Close', {
            duration: 5000,
            panelClass: ['error-snackbar'],
          });
          this.isGenerating$.next(false);
          // Redirect to new conversation
          this.router.navigate(['/generate'], { replaceUrl: true });
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

  hasTemplate(): boolean {
    return !!(this.currentHtml$.value);
  }

onSend(): void {
  console.log('🚀 onSend() triggered');
  
  const message = this.userInput.trim();
  console.log('📝 User message:', message);
  console.log('🔄 Is generating:', this.isGenerating$.value);
  
  if (!message || this.isGenerating$.value) {
    console.warn('⚠️ Message empty or already generating, aborting');
    return;
  }

  // ✅ Check chat limit (20 messages)
  const currentMessages = this.messages$.value;
  console.log('💬 Current message count:', currentMessages.length);
  console.log('📊 Max allowed messages:', this.MAX_CHAT_MESSAGES);
  
  if (currentMessages.length >= this.MAX_CHAT_MESSAGES) {
    console.error('❌ Chat limit reached!');
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

  console.log('✅ Chat limit check passed');
  console.log('🖼️ Selected images count:', this.selectedImages.length);
  
  // ✅ CHANGED: Store ORIGINAL file metadata (before compression stored the compressed size)
  // We need to get the original metadata from the file input
  this.selectedImages.forEach(file => {
    // Check if this is a compressed file (has our naming pattern)
    // If it's compressed, we need to find the original metadata
    // For now, just store what we have - but we'll fix this in processImage
    const originalSize = (file as any).originalSize || file.size;
    const originalName = (file as any).originalName || file.name;
    
    this.sentImages.push({ name: originalName, size: originalSize });
  });
  console.log('💾 Stored sent images metadata BEFORE clearing:', this.sentImages);
  
  this.isGenerating$.next(true);
  this.shouldAutoScroll = true;

  if (!this.conversationId) {
    console.log('🆕 Starting new conversation');
    this.startNewConversation(message);
  } else {
    console.log('💬 Continuing conversation:', this.conversationId);
    this.continueConversation(message);
  }

  // Clear input and images AFTER storing metadata
  console.log('🧹 Clearing input and images');
  this.userInput = '';
  this.selectedImages = [];
  this.imagePreviewUrls = [];
  console.log('✅ Input cleared, images cleared');
}

private async startNewConversation(message: string): Promise<void> {
  console.log('🆕 startNewConversation() called');
  console.log('📝 Message:', message);
  console.log('🖼️ Images to process:', this.selectedImages.length);
  
  // Convert selected images to base64
  const imageAttachments: ImageAttachment[] = await Promise.all(
    this.selectedImages.map(async (file, index) => {
      console.log(`📄 Converting image ${index + 1}:`, file.name, file.type, `${(file.size / 1024).toFixed(2)}KB`);
      const base64 = await this.fileToBase64(file);
      console.log(`✅ Image ${index + 1} converted to base64, length:`, base64.length);
      return {
        data: base64,
        mediaType: file.type,
        fileName: file.name,
      };
    })
  );
  
  console.log('✅ All images converted, total attachments:', imageAttachments.length);
  
  // ❌ REMOVED: Don't store here, already stored in onSend()
  // this.selectedImages.forEach(file => {
  //   this.sentImages.push({ name: file.name, size: file.size });
  // });
  
  console.log('📡 Calling generationService.startGeneration()...');

  this.generationService
    .startGeneration(message, imageAttachments)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('✅ Generation service response received:', response);
        console.log('🆔 Conversation ID:', response.conversationId);
        console.log('📄 HTML length:', response.html?.length);
        
        this.conversationId = response.conversationId;
        this.currentHtml$.next(response.html);

        const newMessages: GenerationMessage[] = [
          { 
            role: 'user', 
            content: message, 
            timestamp: new Date(),
            images: imageAttachments.length > 0 ? imageAttachments : undefined
          },
          {
            role: 'assistant',
            content: '✅ Template generated successfully',
            timestamp: new Date(),
          },
        ];
        
        console.log('💬 Adding messages to conversation:', newMessages.length);
        console.log('🖼️ User message has images:', !!newMessages[0].images);
        this.messages$.next(newMessages);

        this.isGenerating$.next(false);
        console.log('⬇️ Scrolling to bottom...');
        this.scrollToBottom();

        // Update URL without navigation to preserve conversation ID
        this.location.replaceState(`/generate/${response.conversationId}`);

        if (response.hasErrors) {
          console.warn('⚠️ Template has errors:', response.errors);
          this.snackBar.open(
            'Template generated with warnings. Check console for details.',
            'Close',
            { duration: 5000, panelClass: ['info-snackbar'] }
          );
          console.warn('MJML Errors:', response.errors);
        } else {
          console.log('✅ Template generated successfully!');
          this.snackBar.open('Template generated successfully!', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar'],
          });
        }
      },
      error: (error) => {
        console.error('❌ Generation failed:', error);
        console.error('Error details:', error.error);
        this.snackBar.open(
          error.error?.message || 'Failed to generate template',
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
        this.isGenerating$.next(false);
      },
    });
}

private async continueConversation(message: string): Promise<void> {
  console.log('💬 continueConversation() called');
  console.log('🆔 Conversation ID:', this.conversationId);
  console.log('📝 Message:', message);
  console.log('🖼️ Images to process:', this.selectedImages.length);
  
  if (!this.conversationId) {
    console.error('❌ No conversation ID, aborting');
    return;
  }

  const imageAttachments: ImageAttachment[] = await Promise.all(
    this.selectedImages.map(async (file, index) => {
      console.log(`📄 Converting image ${index + 1}:`, file.name, file.type, `${(file.size / 1024).toFixed(2)}KB`);
      const base64 = await this.fileToBase64(file);
      console.log(`✅ Image ${index + 1} converted to base64, length:`, base64.length);
      return {
        data: base64,
        mediaType: file.type,
        fileName: file.name,
      };
    })
  );
  
  console.log('✅ All images converted, total attachments:', imageAttachments.length);

  // ❌ REMOVED: Don't store here, already stored in onSend()
  // this.selectedImages.forEach(file => {
  //   this.sentImages.push({ name: file.name, size: file.size });
  // });

  const currentMessages = this.messages$.value;
  console.log('📊 Current messages count before adding:', currentMessages.length);
  
  currentMessages.push({
    role: 'user',
    content: message,
    timestamp: new Date(),
    images: imageAttachments.length > 0 ? imageAttachments : undefined
  });
  
  console.log('💬 User message added with images:', !!imageAttachments.length);
  console.log('📊 Messages count after adding user message:', currentMessages.length);
  this.messages$.next([...currentMessages]);
  this.scrollToBottom();

  console.log('📡 Calling generationService.continueConversation()...');
  this.generationService
    .continueConversation(this.conversationId, message, imageAttachments)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('✅ Continue conversation response received:', response);
        console.log('📄 HTML length:', response.html?.length);
        
        this.currentHtml$.next(response.html);

        const updatedMessages = this.messages$.value;
        console.log('📊 Messages count before adding assistant:', updatedMessages.length);
        
        updatedMessages.push({
          role: 'assistant',
          content: '✅ Template updated successfully',
          timestamp: new Date(),
        });
        
        console.log('📊 Messages count after adding assistant:', updatedMessages.length);
        this.messages$.next([...updatedMessages]);

        this.isGenerating$.next(false);
        console.log('⬇️ Scrolling to bottom...');
        this.scrollToBottom();

        if (response.hasErrors) {
          console.warn('⚠️ Template has errors:', response.errors);
          this.snackBar.open(
            'Template updated with warnings. Check console for details.',
            'Close',
            { duration: 5000, panelClass: ['info-snackbar'] }
          );
          console.warn('MJML Errors:', response.errors);
        } else {
          console.log('✅ Template updated successfully!');
          this.snackBar.open('Template updated!', 'Close', {
            duration: 3000,
            panelClass: ['success-snackbar'],
          });
        }
      },
      error: (error) => {
        console.error('❌ Continue conversation failed:', error);
        console.error('Error details:', error.error);
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
  console.log('🧪 [RUN_TESTS] onRunTests() triggered');
  console.log('🧪 [RUN_TESTS] Conversation ID:', this.conversationId);
  console.log('🧪 [RUN_TESTS] Template name:', this.templateName);
  console.log('🧪 [RUN_TESTS] Has HTML:', !!this.currentHtml$.value);
  
  if (!this.conversationId) {
    console.error('❌ [RUN_TESTS] No conversation ID - aborting');
    this.snackBar.open('No template to test', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  if (!this.currentHtml$.value) {
    console.error('❌ [RUN_TESTS] No HTML content - aborting');
    this.snackBar.open('No template to save', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  // ✅ Validate template name
  const name = this.templateName?.trim();
  console.log('🧪 [RUN_TESTS] Trimmed template name:', name);
  
  if (!name) {
    console.error('❌ [RUN_TESTS] Template name is empty - aborting');
    this.snackBar.open('Please enter a template name before running tests', 'Close', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
    return;
  }

  console.log('✅ [RUN_TESTS] All validations passed');
  console.log('📡 [RUN_TESTS] Calling generationService.saveTemplate()...');
  console.log('📊 [RUN_TESTS] Parameters:', {
    conversationId: this.conversationId,
    templateName: name
  });

  this.generationService
    .saveTemplate(this.conversationId, name)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('✅ [RUN_TESTS] Template saved successfully!');
        console.log('📊 [RUN_TESTS] Response:', response);
        console.log('🆔 [RUN_TESTS] Template ID:', response.templateId);
        console.log('📝 [RUN_TESTS] Template name:', response.templateName);
        
        this.snackBar.open('Template saved! Redirecting to QA...', 'Close', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });

        console.log('🔗 [RUN_TESTS] Navigating to QA page:', `/qa/${response.templateId}`);
        this.router.navigate(['/qa', response.templateId]);
        console.log('✅ [RUN_TESTS] Navigation initiated');
      },
      error: (error) => {
        console.error('❌ [RUN_TESTS] Save failed:', error);
        console.error('❌ [RUN_TESTS] Error details:', error.error);
        console.error('❌ [RUN_TESTS] Error message:', error.error?.message);
        console.error('❌ [RUN_TESTS] Error code:', error.error?.code);
        
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
  console.log('💾 [SAVE_TEMPLATE] onSaveTemplate() triggered');
  console.log('💾 [SAVE_TEMPLATE] Conversation ID:', this.conversationId);
  console.log('💾 [SAVE_TEMPLATE] Template name:', this.templateName);
  console.log('💾 [SAVE_TEMPLATE] Has HTML:', !!this.currentHtml$.value);
  
  if (!this.conversationId) {
    console.error('❌ [SAVE_TEMPLATE] No conversation ID - aborting');
    this.snackBar.open('No template to save', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar'],
    });
    return;
  }

  // ✅ Validate template name
  const name = this.templateName?.trim();
  console.log('💾 [SAVE_TEMPLATE] Trimmed template name:', name);
  
  if (!name) {
    console.error('❌ [SAVE_TEMPLATE] Template name is empty - aborting');
    this.snackBar.open('Please enter a template name', 'Close', {
      duration: 4000,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
    return;
  }

  console.log('✅ [SAVE_TEMPLATE] All validations passed');
  console.log('📡 [SAVE_TEMPLATE] Calling generationService.saveTemplate()...');
  console.log('📊 [SAVE_TEMPLATE] Parameters:', {
    conversationId: this.conversationId,
    templateName: name
  });

  this.generationService
    .saveTemplate(this.conversationId, name)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('✅ [SAVE_TEMPLATE] Template saved successfully!');
        console.log('📊 [SAVE_TEMPLATE] Response:', response);
        console.log('🆔 [SAVE_TEMPLATE] Template ID:', response.templateId);
        console.log('📝 [SAVE_TEMPLATE] Template name:', response.templateName);
        
        this.snackBar.open('Template saved successfully!', 'Close', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });

        // Navigate to templates page and highlight the new template
        console.log('🔗 [SAVE_TEMPLATE] Navigating to home with query params:', {
          newTemplateId: response.templateId,
          highlight: 'true'
        });
        
        this.router.navigate(['/'], {
          queryParams: {
            newTemplateId: response.templateId,
            highlight: 'true',
          },
        });
        
        console.log('✅ [SAVE_TEMPLATE] Navigation initiated');
      },
      error: (error) => {
        console.error('❌ [SAVE_TEMPLATE] Save failed:', error);
        console.error('❌ [SAVE_TEMPLATE] Error details:', error.error);
        console.error('❌ [SAVE_TEMPLATE] Error message:', error.error?.message);
        console.error('❌ [SAVE_TEMPLATE] Error code:', error.error?.code);
        
        this.snackBar.open(
          error.error?.message || 'Failed to save template',
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
      },
    });
}

onNewConversation(): void {
  // Clear current conversation
  this.conversationId = null;
  this.generationService.clearCurrentConversationId();
  this.messages$.next([]);
  this.currentHtml$.next('');
  this.templateName = '';
  this.userInput = '';
  
  // ✅ NEW: Clear sent images history
  this.sentImages = [];
  console.log('🧹 Cleared sent images history');

  // Navigate to new conversation
  this.router.navigate(['/generate'], { replaceUrl: true });
  this.initializeWelcome();
}

  // ⭐ NEW METHOD: Handle preview refresh
  onRefreshPreview(): void {
    // Optional: Add any custom refresh logic here
    console.log('Preview refreshed');
  }

private scrollToBottom(): void {
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
    const element = event.target as HTMLElement;
    const atBottom =
      element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    this.shouldAutoScroll = atBottom;
  }


async onImageSelect(event: Event): Promise<void> {
  console.log('📸 onImageSelect() triggered');
  
  const input = event.target as HTMLInputElement;
  console.log('📂 Input element:', input);
  console.log('📂 Files selected:', input.files?.length || 0);
  
  if (!input.files || input.files.length === 0) {
    console.warn('⚠️ No files selected, aborting');
    return;
  }

  const files = Array.from(input.files);
  console.log('📋 New files to upload:', files.map(f => `${f.name} (${(f.size/1024).toFixed(2)}KB)`));
  console.log('🖼️ Currently selected images:', this.selectedImages.map(f => `${f.name} (${(f.size/1024).toFixed(2)}KB)`));
  console.log('📊 Max images allowed:', this.maxImages);
  
  // Validate count BEFORE duplicate check
  if (this.selectedImages.length + files.length > this.maxImages) {
    console.error(`❌ Too many images! Current: ${this.selectedImages.length}, Trying to add: ${files.length}, Max: ${this.maxImages}`);
    this.snackBar.open(
      `Maximum ${this.maxImages} images allowed at a time`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
    input.value = '';
    return;
  }

  console.log('✅ Image count validation passed');
  
  // ✅ Check for duplicates
  const { duplicates, newFiles } = this.checkDuplicateImages(files);
  
  console.log('🔍 Duplicate check complete:', {
    totalFiles: files.length,
    duplicatesFound: duplicates.length,
    newFilesFound: newFiles.length
  });
  
  if (duplicates.length > 0) {
    console.warn('⚠️ Duplicates detected:', duplicates.map(f => `${f.name} (${(f.size/1024).toFixed(2)}KB)`));
    
    // Show confirmation dialog
    const duplicateNames = duplicates.map(f => `• ${f.name} (${(f.size/1024).toFixed(2)}KB)`).join('\n');
    const message = duplicates.length === 1
      ? `⚠️ This image is already uploaded:\n\n${duplicateNames}\n\nWould you like to upload it again?`
      : `⚠️ These images are already uploaded:\n\n${duplicateNames}\n\nWould you like to upload them again?`;
    
    const confirmed = confirm(message);
    
    if (!confirmed) {
      console.log('❌ User cancelled duplicate upload');
      
      // Process only NEW files (non-duplicates)
      if (newFiles.length > 0) {
        console.log('✅ Processing only new files:', newFiles.map(f => f.name));
        for (const file of newFiles) {
          await this.processImage(file);
        }
      } else {
        console.log('ℹ️ No new files to add, all were duplicates');
      }
      
      input.value = '';
      return;
    }
    
    console.log('✅ User confirmed, uploading all files including duplicates');
  } else {
    console.log('✅ No duplicates found, processing all files');
  }
  
  // Process all files (either no duplicates, or user confirmed)
  for (const file of files) {
    console.log(`📄 Processing file: ${file.name}`);
    await this.processImage(file);
  }
  
  input.value = ''; // Reset input
  console.log('🧹 Input value reset');
}

// ✅ NEW: Check for duplicate images
private checkDuplicateImages(newFiles: File[]): { duplicates: File[], newFiles: File[] } {
  console.log('🔍 Starting duplicate check...');
  console.log('🔍 Previously sent images:', this.sentImages);
  console.log('🔍 New files to check:', newFiles.map(f => ({
    name: f.name,
    size: f.size,
    sizeKB: (f.size / 1024).toFixed(2)
  })));
  
  const duplicates: File[] = [];
  const newFilesOnly: File[] = [];
  
  newFiles.forEach(newFile => {
    console.log(`🔍 Checking: ${newFile.name} (${newFile.size} bytes)`);
    
    // ✅ CHANGED: Check against sentImages instead of selectedImages
    const isDuplicate = this.sentImages.some(sentImage => {
      const nameMatch = sentImage.name === newFile.name;
      const sizeMatch = sentImage.size === newFile.size;
      
      console.log(`  Comparing with: ${sentImage.name} (${sentImage.size} bytes)`);
      console.log(`    Name match: ${nameMatch}, Size match: ${sizeMatch}`);
      
      return nameMatch && sizeMatch;
    });
    
    if (isDuplicate) {
      console.log(`  ❌ DUPLICATE: ${newFile.name}`);
      duplicates.push(newFile);
    } else {
      console.log(`  ✅ NEW FILE: ${newFile.name}`);
      newFilesOnly.push(newFile);
    }
  });
  
  console.log('🔍 Duplicate check results:', {
    total: newFiles.length,
    duplicates: duplicates.length,
    duplicateNames: duplicates.map(f => f.name),
    newFiles: newFilesOnly.length,
    newFileNames: newFilesOnly.map(f => f.name)
  });
  
  return { duplicates, newFiles: newFilesOnly };
}

// Add this method to your GeneratePageComponent class
// Add this method to your GeneratePageComponent class
toggleFullscreen(): void {
  console.log('🖥️ [Fullscreen] Toggle clicked');
  const element = document.querySelector('.preview-wrapper') as HTMLElement;
  
  if (!element) {
    console.error('❌ [Fullscreen] Element not found!');
    return;
  }

  if (!document.fullscreenElement) {
    console.log('➡️ [Fullscreen] Entering fullscreen...');
    element.requestFullscreen().then(() => {
      console.log('✅ [Fullscreen] Entered successfully');
      
      // 🔍 DEBUG: Check overlay container location
      setTimeout(() => {
        const overlayContainer = document.querySelector('.cdk-overlay-container');
        console.log('📍 [Fullscreen] Overlay container:', overlayContainer);
        console.log('📍 [Fullscreen] Parent:', overlayContainer?.parentElement);
        console.log('📍 [Fullscreen] Fullscreen element:', document.fullscreenElement);
        console.log('📍 [Fullscreen] Is overlay inside fullscreen?', 
          document.fullscreenElement?.contains(overlayContainer as Node));
      }, 100);
    });
  } else {
    console.log('⬅️ [Fullscreen] Exiting fullscreen...');
    document.exitFullscreen();
  }
}


async processImage(file: File): Promise<void> {
  console.log('📄 processImage() called for:', file.name);
  console.log('📝 File details:', {
    name: file.name,
    type: file.type,
    size: `${(file.size / 1024).toFixed(2)}KB`,
    sizeBytes: file.size
  });
  
  // Validate file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  console.log('🔍 File type check:', file.type, '- Valid?', validTypes.includes(file.type));
  
  if (!validTypes.includes(file.type)) {
    console.error('❌ Invalid file type:', file.type);
    this.snackBar.open(
      `Invalid file type: ${file.name}. Please upload images only.`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
    return;
  }

  console.log('✅ File type validation passed');
  console.log('🗜️ Converting image to JPEG...');
  
  // ✅ NEW: Store original file metadata BEFORE compression
  const originalName = file.name;
  const originalSize = file.size;
  console.log('💾 Storing original metadata:', { name: originalName, size: originalSize });
  
  try {
    const processedFile = await this.compressImage(file);
    console.log('✅ Image converted to JPEG successfully!');
    console.log('📝 Size:', `${(processedFile.size / 1024).toFixed(2)}KB`);
    
    if (processedFile.size > this.maxSizeBytes) {
      console.error('❌ Image still too large after compression');
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
    console.log('✅ Attached original metadata to compressed file');
    
    // Create preview URL
    console.log('🖼️ Creating preview URL...');
    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('✅ FileReader loaded successfully');
      const previewUrl = e.target?.result as string;
      console.log('🖼️ Preview URL created, length:', previewUrl?.length);
      
      this.selectedImages.push(processedFile);
      this.imagePreviewUrls.push(previewUrl);
      
      console.log('📊 Total images now:', this.selectedImages.length);
      console.log('📊 Total previews now:', this.imagePreviewUrls.length);
      
      // Scroll to show preview
      setTimeout(() => this.scrollToBottom(), 100);
    };
    reader.onerror = (error) => {
      console.error('❌ FileReader error:', error);
    };
    reader.readAsDataURL(processedFile);
    console.log('📄 FileReader started...');
    
  } catch (error) {
    console.error('❌ Image processing failed:', error);
    this.snackBar.open(
      `Failed to process ${file.name}. Please try another image.`,
      'Close',
      { duration: 4000, panelClass: ['error-snackbar'] }
    );
  }
}
async compressImage(file: File): Promise<File> {
  console.log('🗜️ compressImage() started for:', file.name);
  console.log('📏 Original size:', `${(file.size / 1024).toFixed(2)}KB`);
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      console.log('📖 FileReader loaded, creating image...');
      const img = new Image();
      
      img.onload = () => {
        console.log('🖼️ Image loaded successfully');
        console.log('📐 Original dimensions:', `${img.width}x${img.height}`);
        
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Scale down if too large
        const maxDimension = 2000;
        console.log('📏 Max dimension allowed:', maxDimension);
        
        if (width > maxDimension || height > maxDimension) {
          console.log('⚠️ Image too large, scaling down...');
          if (width > height) {
            height = (height / width) * maxDimension;
            width = maxDimension;
          } else {
            width = (width / height) * maxDimension;
            height = maxDimension;
          }
          console.log('📐 New dimensions:', `${width}x${height}`);
        } else {
          console.log('✅ Dimensions OK, no scaling needed');
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        console.log('🎨 Drawing image on canvas...');
        ctx?.drawImage(img, 0, 0, width, height);
        
        console.log('🗜️ Converting to blob with 80% quality...');
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size <= this.maxSizeBytes) {
              const compressedFile = new File([blob], file.name, {
                type: 'image/jpeg',
                lastModified: Date.now(),
              });
              console.log('✅ Compression successful!');
              console.log('📏 Compressed size:', `${(compressedFile.size / 1024).toFixed(2)}KB`);
              console.log('📊 Compression ratio:', `${((1 - compressedFile.size / file.size) * 100).toFixed(1)}% reduction`);
              resolve(compressedFile);
            } else {
              console.error('❌ Compression failed - file still too large');
              console.error('Blob size:', blob?.size, 'Max allowed:', this.maxSizeBytes);
              reject(new Error('Compression failed - file still too large'));
            }
          },
          'image/jpeg',
          0.8 // 80% quality
        );
      };
      
      img.onerror = () => {
        console.error('❌ Failed to load image');
        reject(new Error('Failed to load image'));
      };
      
      img.src = e.target?.result as string;
      console.log('🔄 Image src set, waiting for load...');
    };
    
    reader.onerror = () => {
      console.error('❌ FileReader failed');
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
    console.log('🔄 Reading file as data URL...');
  });
}
removeImage(index: number): void {
  console.log('🗑️ removeImage() called for index:', index);
  console.log('📊 Images before removal:', this.selectedImages.length);
  console.log('🖼️ Image to remove:', this.selectedImages[index]?.name);
  
  this.selectedImages.splice(index, 1);
  this.imagePreviewUrls.splice(index, 1);
  
  console.log('✅ Image removed');
  console.log('📊 Images after removal:', this.selectedImages.length);
  console.log('📊 Preview URLs after removal:', this.imagePreviewUrls.length);
}
triggerFileInput(): void {
  console.log('📁 triggerFileInput() called');
  const fileInput = document.getElementById('imageUploadInput') as HTMLInputElement;
  console.log('🔍 File input element found:', !!fileInput);
  
  if (!fileInput) {
    console.error('❌ File input element not found!');
    return;
  }
  
  console.log('✅ Triggering file input click...');
  fileInput?.click();
}
private fileToBase64(file: File): Promise<string> {
  console.log('🔄 fileToBase64() started for:', file.name);
  console.log('📁 File type:', file.type, 'Size:', `${(file.size / 1024).toFixed(2)}KB`);
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      console.log('✅ FileReader completed');
      const result = reader.result as string;
      console.log('📊 Data URL length:', result.length);
      
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      console.log('✅ Base64 extracted, length:', base64.length);
      console.log('📊 Base64 size estimate:', `${(base64.length * 0.75 / 1024).toFixed(2)}KB`);
      
      resolve(base64);
    };
    reader.onerror = (error) => {
      console.error('❌ FileReader error:', error);
      reject(error);
    };
    reader.readAsDataURL(file);
    console.log('🔄 Reading file as Data URL...');
  });
}
  trackByIndex(index: number): number {
    return index;
  }
}