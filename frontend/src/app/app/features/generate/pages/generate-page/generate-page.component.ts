import { Component, OnInit, OnDestroy, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
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

import { TemplateGenerationService, GenerationMessage } from '../../../../core/services/template-generation.service';

import { PreviewCacheService } from '../../../templates/components/template-preview/preview-cache.service';

import { MatTooltipModule } from '@angular/material/tooltip';

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
    TemplatePreviewPanelComponent,
  ],
  templateUrl: './generate-page.component.html',
  styleUrls: ['./generate-page.component.scss'],
})
export class GeneratePageComponent implements OnInit, OnDestroy {
  private generationService = inject(TemplateGenerationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private snackBar = inject(MatSnackBar);
  private destroy$ = new Subject<void>();
  private previewCache = inject(PreviewCacheService);

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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.messages$.complete();
    this.currentHtml$.complete();
    this.isGenerating$.complete();
  }

  private initializeWelcome(): void {
    // Show welcome message
    const welcomeMessage: GenerationMessage = {
      role: 'assistant',
      content:
        "👋 Hi! I'm your email template generator. Describe the email template you'd like to create, and I'll generate it for you using MJML.\n\nFor example:\n• \"Create a welcome email for new subscribers\"\n• \"Design a product launch announcement\"\n• \"Make a monthly newsletter template\"",
      timestamp: new Date(),
    };
    this.messages$.next([welcomeMessage]);
  }

  // ⭐ ADD: Fullscreen toggle
    toggleFullscreen(): void {
    const element = document.querySelector('.preview-wrapper') as HTMLElement;
    if (!element) return;

    if (!document.fullscreenElement) {
        element.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
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
  
  this.isGenerating$.next(true);
  this.shouldAutoScroll = true;

  if (!this.conversationId) {
    console.log('🆕 Starting new conversation');
    this.startNewConversation(message);
  } else {
    console.log('💬 Continuing conversation:', this.conversationId);
    this.continueConversation(message);
  }

  // Clear input and images
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
      console.log(`🔄 Converting image ${index + 1}:`, file.name, file.type, `${(file.size / 1024).toFixed(2)}KB`);
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

        // Add messages with images
        const newMessages: GenerationMessage[] = [
          { 
            role: 'user', 
            content: message, 
            timestamp: new Date(),
            images: imageAttachments.length > 0 ? imageAttachments : undefined
          },
          {
            role: 'assistant',
            content: response.message,
            timestamp: new Date(),
          },
        ];
        
        console.log('💬 Adding messages to conversation:', newMessages.length);
        console.log('🖼️ User message has images:', !!newMessages[0].images);
        this.messages$.next(newMessages);

        this.isGenerating$.next(false);
        console.log('⬇️ Scrolling to bottom...');
        this.scrollToBottom();

        // Update URL without page reload
        console.log('🔗 Updating URL to:', `/generate/${response.conversationId}`);
        this.router.navigate(['/generate', response.conversationId], {
          replaceUrl: true,
        });

        // Show success message
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

  // Convert selected images to base64
  const imageAttachments: ImageAttachment[] = await Promise.all(
    this.selectedImages.map(async (file, index) => {
      console.log(`🔄 Converting image ${index + 1}:`, file.name, file.type, `${(file.size / 1024).toFixed(2)}KB`);
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

  // Add user message immediately
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

        // Add assistant message
        const updatedMessages = this.messages$.value;
        console.log('📊 Messages count before adding assistant:', updatedMessages.length);
        
        updatedMessages.push({
          role: 'assistant',
          content: response.message,
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
    if (!this.shouldAutoScroll) return;

    setTimeout(() => {
      if (this.messagesContainer) {
        const container = this.messagesContainer.nativeElement;
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }

  onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const atBottom =
      element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    this.shouldAutoScroll = atBottom;
  }


  onImageSelect(event: Event): void {
  console.log('📸 onImageSelect() triggered');
  
  const input = event.target as HTMLInputElement;
  console.log('📁 Input element:', input);
  console.log('📁 Files selected:', input.files?.length || 0);
  
  if (!input.files || input.files.length === 0) {
    console.warn('⚠️ No files selected, aborting');
    return;
  }

  const files = Array.from(input.files);
  console.log('📋 Files array:', files.map(f => `${f.name} (${f.type}, ${(f.size/1024).toFixed(2)}KB)`));
  console.log('🖼️ Current selected images:', this.selectedImages.length);
  console.log('📊 Max images allowed:', this.maxImages);
  
  // Validate count
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
  
  // Process each file
  files.forEach((file, index) => {
    console.log(`🔄 Processing file ${index + 1}/${files.length}:`, file.name);
    this.processImage(file);
  });
  
  input.value = ''; // Reset input
  console.log('🧹 Input value reset');
}
async processImage(file: File): Promise<void> {
  console.log('🔄 processImage() called for:', file.name);
  console.log('📁 File details:', {
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
  
  // ⭐ ALWAYS convert to JPEG for consistency and compatibility
  console.log('🗜️ Converting image to JPEG...');
  
  try {
    const processedFile = await this.compressImage(file);
    console.log('✅ Image converted to JPEG successfully!');
    console.log('📏 Size:', `${(processedFile.size / 1024).toFixed(2)}KB`);
    
    if (processedFile.size > this.maxSizeBytes) {
      console.error('❌ Image still too large after compression');
      this.snackBar.open(
        `Image ${file.name} is too large even after compression. Please use a smaller image.`,
        'Close',
        { duration: 4000, panelClass: ['error-snackbar'] }
      );
      return;
    }
    
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
    };
    reader.onerror = (error) => {
      console.error('❌ FileReader error:', error);
    };
    reader.readAsDataURL(processedFile);
    console.log('🔄 FileReader started...');
    
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