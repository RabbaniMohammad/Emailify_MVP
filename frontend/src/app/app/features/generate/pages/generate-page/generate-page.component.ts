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
import { IdeogramImageService } from '../../../../core/services/ideogram-image.service';

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
  private ideogramService = inject(IdeogramImageService);
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
  @ViewChild(TemplatePreviewPanelComponent) previewPanel?: TemplatePreviewPanelComponent;

  // State
  conversationId: string | null = null;
  messages$ = new BehaviorSubject<GenerationMessage[]>([]);
  currentHtml$ = new BehaviorSubject<string>('');
  currentMjml$ = new BehaviorSubject<string>('');  // ✅ Track MJML separately
  isGenerating$ = new BehaviorSubject<boolean>(false);
  isRegenerating = false; // Track if it's a regeneration
  private justCreatedConversationId: string | null = null; // Track conversation we just created
  userInput = '';
  templateName = '';

  // Image upload state
    selectedImages: File[] = [];
    imagePreviewUrls: string[] = [];
    maxImages = 2;
    maxSizeBytes = 5 * 1024 * 1024; // 5MB

  // Scroll state
  private shouldAutoScroll = true;
  private isProgrammaticScroll = false; // Flag to ignore scroll events during auto-scroll

  // Attach Choice Banner state
  showAttachChoiceBanner = false;

  // Generation Type Selection
  generationType: 'template' | 'image' = 'template';
  generatedImages: Array<{url: string, prompt: string}> = [];
  isGeneratingImage = false;
  // HTML for image gallery preview (rendered in left preview panel when generationType==='image')
  imageGalleryHtml: string = '';
  // Fallback placeholder HTML shown before any images are generated
  // Use the same robot/hero styling as the template preview panel so image mode feels consistent
  imagePlaceholderHtml: string = `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html,body{width:100%;height:100%;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center}
      .container{display:flex;flex-direction:column;align-items:center;gap:12px;color:#475569}
      .robot{width:120px;height:120px}
      h2{margin:0;font-size:22px;color:#111827}
      p{margin:0;color:#6b7280}
      .badge{display:inline-flex;align-items:center;gap:8px;background:#fff;border-radius:20px;padding:8px 12px;border:1px solid rgba(15,23,42,0.06);box-shadow:0 6px 18px rgba(15,23,42,0.04)}
    </style>
  </head>
  <body>
    <div class="container">
      <svg class="robot" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="60" y="70" width="80" height="70" rx="10" fill="url(#robotGradient)" stroke="currentColor" stroke-width="3"/>
        <line x1="100" y1="70" x2="100" y2="50" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <circle cx="100" cy="45" r="5" fill="currentColor"/>
        <circle cx="80" cy="95" r="8" fill="currentColor"/>
        <circle cx="120" cy="95" r="8" fill="currentColor"/>
        <path d="M 75 115 Q 100 125 125 115" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>
        <path class="sparkle sparkle-1" d="M 145 75 L 147 80 L 152 82 L 147 84 L 145 89 L 143 84 L 138 82 L 143 80 Z" fill="currentColor"/>
        <path class="sparkle sparkle-2" d="M 48 85 L 50 90 L 55 92 L 50 94 L 48 99 L 46 94 L 41 92 L 46 90 Z" fill="currentColor"/>
        <defs>
          <linearGradient id="robotGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.3" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:0.3" />
          </linearGradient>
        </defs>
      </svg>
      <h2>AI-Powered Generation</h2>
      <p>AI can make mistakes. Please review and verify all generated content carefully before use.</p>
      <div class="badge">⭐ Always Verify</div>
    </div>
  </body>
  </html>`;

  // Website URL Analyzer state
  showUrlAnalyzer = false;
  websiteUrl = '';
  isAnalyzingWebsite = false;
  analyzedBrandDNA: any = null;
  selectedColors: string[] = [];
  selectedBrandImages: string[] = [];
  selectedContent: string[] = [];
  selectedCTAs: any[] = [];
  selectedSocialLinks: any = {};
  selectedTemplateStyle: string = '';
  templateStyles = [
    { value: 'modern', label: 'Modern & Minimal', icon: 'layers' },
    { value: 'bold', label: 'Bold & Vibrant', icon: 'flash_on' },
    { value: 'professional', label: 'Professional', icon: 'business_center' },
    { value: 'creative', label: 'Creative', icon: 'palette' },
    { value: 'mobile-first', label: 'Mobile-First', icon: 'smartphone' },
    { value: 'ecommerce', label: 'E-commerce', icon: 'shopping_cart' }
  ];

  // CSV Banner state
  showCsvBanner = false;
  uploadedFile: File | null = null;
  generatedPrompt: string = '';
  isGeneratingPrompt = false;
  isAttachingFile = false;
  isDragOver = false;

  // File attachment state (for chat)
  attachedFile: File | null = null;
  
  // ⭐ Track if file data was already sent to avoid re-sending
  private fileDataAlreadySent = false;


    ngOnInit(): void {
    this.templateName = '';
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        const conversationId = params.get('conversationId');
        
        if (conversationId && conversationId !== 'new') {
          // ✅ Only load if this is not the conversation we just created
          if (conversationId !== this.justCreatedConversationId) {
            this.loadConversation(conversationId);
          }
        } else if (conversationId === 'new') {
          // Generate a new conversation ID immediately and navigate to it
          const newConversationId = this.generateUUID();
          this.conversationId = newConversationId;
          this.justCreatedConversationId = newConversationId;
          this.isRegenerating = false;
          this.initializeWelcome();
          // Replace URL with actual ID (no component recreation since it's same route)
          this.router.navigate(['/generate', newConversationId], { replaceUrl: true });
        }
    });
    }

  // Shared assistant welcome text usable for both email template and image modes
  private imageGenerationWelcome = `👋 Hi — I can help generate marketing images. For best results, provide detailed design specifications.

Example prompt structure:

Create a restaurant promotional poster that matches the following design exactly:

Background:
Light beige/cream gradient background.
Soft organic abstract shapes behind the food images.
Clean, modern Indian-restaurant aesthetic.

Header (top-left):
Circular restaurant logo placeholder.
To the right, a green pill-shaped label with the text "Pista House".
Below that label, the text "Indian Cuisine".

Offer Section (left side):
Beige rounded rectangle box containing:
"Buy One Haleem"
"Get 5$ OFF on any Biryani!"
Below the offer box, the text "Online Orders Only".
A dark brown rectangular button with white text that says "ORDER NOW".
A QR code placed directly under the button.
Under the QR code, place the contact details exactly in this order:
+1 703-429-1033
Pista House Indian Cuisine, 3055 Nutley Street,
Woody Place, Benton, VA 20191

Main Food Image (center-left):
A large red Haleem bucket container with visible food inside.
Position matches typical promotional placement: centered left and slightly forward.

Right-Side Image Stack:
Three separate biryani images stacked vertically.
Each image should be in a rounded-corner square/rectangle frame.
Slight tilt or angle to match promotional aesthetics.
All biryani bowls should be richly styled and realistic.

Connecting Visual Elements:
Thin curved arrows or connecting lines pointing from offer text to food imagery.
Maintain a modern, stylish flow.

Color Palette:
Beige (#f3e8d7) for background.
Dark brown (#5c3b1e) for button.
Green (#3fa26f) for the "Pista House" label.
White for button text.
Black or dark gray for general text.

Composition:
Square format (1:1 aspect ratio).
Maintain spacing, hierarchy, and visual balance similar to a modern Instagram food promotion.
Keep the Haleem bucket large and prominent.
Keep the biryani collage aligned vertically on the right.

Output Requirements:
Generate a high-resolution promotional poster (at least 1500×1500).
Match the described layout, typography, colors, and placements as closely as possible.`;

  private templateGenerationWelcome = `👋 Hi — I can help generate email templates or marketing images. Describe what you'd like and include any exact on-image text in quotes (for example: "BUY ONE GET ONE — $10").

Examples:
• "Create a welcome email for new subscribers"
• "Design an Instagram banner featuring a spicy dosa with headline 'TODAY: 20% OFF'"
• "Make a mobile-first product announcement email"`;

  private get sharedAssistantWelcome(): string {
    return this.generationType === 'image' ? this.imageGenerationWelcome : this.templateGenerationWelcome;
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

  // Generation Type Selection
  onGenerationTypeChange(type: 'template' | 'image'): void {
    this.generationType = type;
    // Clear any previous generation state when switching
    if (type === 'image') {
      // Optionally clear template-related state
      // Ensure the image preview shows the shared robot placeholder when no images yet
      if (!this.imageGalleryHtml || !this.imageGalleryHtml.trim()) {
        this.imageGalleryHtml = '';
      }
      // If there are no existing messages, initialize the shared assistant welcome so the right pane matches
      const msgs = this.messages$.value || [];
      if (!msgs || msgs.length === 0) {
        this.initializeWelcome();
      } else if (msgs.length === 1 && msgs[0].role === 'assistant') {
        // If the conversation only contains the original assistant welcome, replace it with the shared message
        const updated = [{ ...msgs[0], content: this.sharedAssistantWelcome }];
        this.messages$.next(updated);
      }
    } else {
      // Optionally clear image-related state
      this.generatedImages = [];
    }
  }

  // Open Save Generated Image dialog
  async openSaveImageDialog(): Promise<void> {
    // Lazy import dialog component to avoid circular module issues
    try {
      const { SaveGeneratedImageDialog } = await import('../save-generated-image-dialog.component');
      const dialogRef = this.dialog.open(SaveGeneratedImageDialog, {
        width: '700px',
        data: { images: this.generatedImages, prompt: this.generatedImages?.[0]?.prompt || '' }
      });

      dialogRef.afterClosed().subscribe((result: any) => {
        if (result && result.success) {
          this.snackBar.open('Image saved!', 'Close', { duration: 3000, panelClass: ['success-snackbar'] });
        }
      });
    } catch (err) {
      console.error('Failed to open save dialog', err);
      this.snackBar.open('Failed to open save dialog', 'Close', { duration: 3000, panelClass: ['error-snackbar'] });
    }
  }

  // Attach Choice Banner methods
  openAttachChoiceBanner(): void {
    this.showAttachChoiceBanner = true;
  }

  closeAttachChoiceBanner(): void {
    this.showAttachChoiceBanner = false;
  }

  selectImageAttachment(): void {
    this.closeAttachChoiceBanner();
    this.triggerFileInput();
  }

  selectDocumentAttachment(): void {
    this.closeAttachChoiceBanner();
    this.openCsvBanner();
  }

  selectUrlAttachment(): void {
    this.closeAttachChoiceBanner();
    this.openUrlAnalyzer();
  }

  // Website URL Analyzer methods
  openUrlAnalyzer(): void {
    this.showUrlAnalyzer = true;
  }

  closeUrlAnalyzer(): void {
    this.showUrlAnalyzer = false;
    this.resetAnalyzer();
  }

  resetAnalyzer(): void {
    this.websiteUrl = '';
    this.analyzedBrandDNA = null;
    this.selectedColors = [];
    this.selectedBrandImages = [];
    this.selectedContent = [];
    this.selectedCTAs = [];
    this.selectedSocialLinks = {};
    this.selectedTemplateStyle = '';
    this.isAnalyzingWebsite = false;
  }

  async analyzeWebsite(): Promise<void> {
    if (!this.websiteUrl || this.isAnalyzingWebsite) {
      return;
    }

    // Validate URL format
    const urlValidation = this.validateUrl(this.websiteUrl);
    if (!urlValidation.valid) {
      this.snackBar.open(
        urlValidation.error || 'Invalid URL',
        'Close',
        { duration: 4000, panelClass: ['error-snackbar'] }
      );
      return;
    }

    this.isAnalyzingWebsite = true;

    try {
      const response = await fetch('/api/analyze-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlValidation.normalizedUrl }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to analyze website';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          // If response is not JSON, use default message
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      this.analyzedBrandDNA = data;

      // Auto-select first 3 colors, images, content snippets, and CTAs
      if (data.colors && data.colors.length > 0) {
        this.selectedColors = data.colors.slice(0, 3);
      }
      if (data.images && data.images.length > 0) {
        this.selectedBrandImages = data.images.slice(0, 2);
      }
      if (data.content && data.content.length > 0) {
        this.selectedContent = data.content.slice(0, 2);
      }
      if (data.ctas && data.ctas.length > 0) {
        this.selectedCTAs = data.ctas.slice(0, 3);
      }
      if (data.social) {
        // Auto-select all social links
        this.selectedSocialLinks = { ...data.social };
      }

      this.snackBar.open(
        '✨ Website analyzed successfully!',
        'Close',
        { duration: 3000 }
      );
    } catch (error: any) {
      console.error('Error analyzing website:', error);
      this.snackBar.open(
        error.message || 'Failed to analyze website. Please try again.',
        'Close',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
    } finally {
      this.isAnalyzingWebsite = false;
    }
  }

  validateUrl(url: string): { valid: boolean; error?: string; normalizedUrl?: string } {
    try {
      // Add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      const urlObj = new URL(url);

      // Protocol check
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { valid: false, error: 'Only HTTP/HTTPS protocols supported' };
      }

      // Localhost/internal IP check
      const hostname = urlObj.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return { valid: false, error: 'Cannot analyze local or internal network URLs' };
      }

      return { valid: true, normalizedUrl: urlObj.toString() };
    } catch (e) {
      return { valid: false, error: 'Invalid URL format. Example: https://example.com' };
    }
  }

  toggleColorSelection(color: string): void {
    const index = this.selectedColors.indexOf(color);
    if (index > -1) {
      this.selectedColors.splice(index, 1);
    } else {
      if (this.selectedColors.length < 5) {
        this.selectedColors.push(color);
      } else {
        this.snackBar.open(
          'Maximum 5 colors allowed',
          'Close',
          { duration: 3000 }
        );
      }
    }
  }

  toggleImageSelection(image: string): void {
    const index = this.selectedBrandImages.indexOf(image);
    if (index > -1) {
      this.selectedBrandImages.splice(index, 1);
    } else {
      if (this.selectedBrandImages.length < 3) {
        this.selectedBrandImages.push(image);
      } else {
        this.snackBar.open(
          'Maximum 3 images allowed',
          'Close',
          { duration: 3000 }
        );
      }
    }
  }

  toggleContentSelection(snippet: string): void {
    const index = this.selectedContent.indexOf(snippet);
    if (index > -1) {
      this.selectedContent.splice(index, 1);
    } else {
      this.selectedContent.push(snippet);
    }
  }

  selectTemplateStyle(style: string): void {
    this.selectedTemplateStyle = style;
  }

  getTruncatedUrl(url: string): string {
    if (url.length <= 50) return url;
    const urlObj = new URL(url);
    const filename = urlObj.pathname.split('/').pop() || 'image';
    return `.../${filename}`;
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
  }

  getSocialLinksCount(social: any): number {
    if (!social) return 0;
    return Object.keys(social).filter(key => social[key]).length;
  }

  toggleCTASelection(cta: any): void {
    const index = this.selectedCTAs.findIndex(c => c.url === cta.url);
    if (index > -1) {
      this.selectedCTAs.splice(index, 1);
    } else {
      if (this.selectedCTAs.length < 5) {
        this.selectedCTAs.push(cta);
      } else {
        this.snackBar.open(
          'Maximum 5 CTAs allowed',
          'Close',
          { duration: 3000 }
        );
      }
    }
  }

  toggleSocialLink(platform: string, url: string): void {
    if (this.selectedSocialLinks[platform]) {
      delete this.selectedSocialLinks[platform];
    } else {
      this.selectedSocialLinks[platform] = url;
    }
  }

  isSocialLinkSelected(platform: string): boolean {
    return !!this.selectedSocialLinks[platform];
  }

  async generatePromptFromBrandDNA(): Promise<void> {
    if (!this.analyzedBrandDNA || !this.selectedTemplateStyle) {
      return;
    }

    this.isGeneratingPrompt = true;

    try {
      const payload = {
        colors: this.selectedColors,
        images: this.selectedBrandImages,
        content: this.selectedContent,
        contentSections: this.analyzedBrandDNA.contentSections,
        ctas: this.selectedCTAs,
        fonts: this.analyzedBrandDNA.fonts,
        templateStyle: this.selectedTemplateStyle,
        url: this.websiteUrl,
        logo: this.analyzedBrandDNA.logo,
        products: this.analyzedBrandDNA.products,
        brandInfo: this.analyzedBrandDNA.brandInfo,
        testimonials: this.analyzedBrandDNA.testimonials,
        contact: this.analyzedBrandDNA.contact,
        social: this.selectedSocialLinks
      };

      const response = await fetch('/api/brand-dna-to-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to generate prompt';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          // If response is not JSON, use default message
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const generatedPrompt = data.prompt || '';

      // Set the prompt in the message input
      this.userInput = generatedPrompt;

      // Close the analyzer
      this.closeUrlAnalyzer();

      // Focus on the message input
      setTimeout(() => {
        this.messageInput?.nativeElement.focus();
      }, 100);

      this.snackBar.open(
        '✨ Prompt generated from brand DNA!',
        'Close',
        { duration: 3000, panelClass: ['success-snackbar'] }
      );
    } catch (error) {
      console.error('Error generating prompt:', error);
      this.snackBar.open(
        'Failed to generate prompt. Please try again.',
        'Close',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
    } finally {
      this.isGeneratingPrompt = false;
    }
  }

  // CSV Banner methods
  openCsvBanner(): void {
    this.showCsvBanner = true;
  }

  closeCsvBanner(): void {
    this.showCsvBanner = false;
    this.resetUpload();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      // Validate file size (1MB limit)
      const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
      if (file.size > MAX_FILE_SIZE) {
        this.snackBar.open(
          `File too large (${this.formatFileSize(file.size)}). Maximum size is 1MB.`,
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
        input.value = ''; // Reset input
        return;
      }
      
      this.uploadedFile = file;
      this.generatedPrompt = ''; // Reset prompt when new file is selected
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver = false;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      
      // Validate file size (1MB limit)
      const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
      if (file.size > MAX_FILE_SIZE) {
        this.snackBar.open(
          `File too large (${this.formatFileSize(file.size)}). Maximum size is 1MB.`,
          'Close',
          { duration: 5000, panelClass: ['error-snackbar'] }
        );
        return;
      }
      
      // Validate file type
      const validExtensions = ['.xlsx', '.xls', '.csv', '.txt', '.doc', '.docx', '.pdf'];
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (validExtensions.includes(fileExtension)) {
        this.uploadedFile = file;
        this.generatedPrompt = '';
      } else {
        this.snackBar.open(
          'Please upload a valid file (Excel, CSV, TXT, Word, or PDF)',
          'Close',
          { duration: 4000, panelClass: ['error-snackbar'] }
        );
      }
    }
  }

  removeUploadedFile(): void {
    this.uploadedFile = null;
    this.generatedPrompt = '';
  }

  resetUpload(): void {
    this.uploadedFile = null;
    this.generatedPrompt = '';
    this.isGeneratingPrompt = false;
  }

  getFileIcon(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'xlsx':
      case 'xls':
        return 'table_chart';
      case 'csv':
        return 'grid_on';
      case 'doc':
      case 'docx':
        return 'description';
      case 'pdf':
        return 'picture_as_pdf';
      default:
        return 'insert_drive_file';
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  async generatePromptFromFile(): Promise<void> {
    console.log('🔴 generatePromptFromFile called', {
      hasFile: !!this.uploadedFile,
      isGenerating: this.isGeneratingPrompt
    });
    
    if (!this.uploadedFile || this.isGeneratingPrompt) {
      console.log('🔴 generatePromptFromFile blocked');
      return;
    }

    console.log('🔴 generatePromptFromFile executing...');
    this.isGeneratingPrompt = true;

    try {
      const formData = new FormData();
      formData.append('file', this.uploadedFile);

      const response = await fetch('/api/csv-to-prompt', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || 'Failed to generate prompt');
      }

      const data = await response.json();
      this.generatedPrompt = data.prompt || data.message || '';

      if (!this.generatedPrompt) {
        throw new Error('No prompt received from server');
      }

      this.snackBar.open(
        '✨ Prompt generated successfully!',
        'Close',
        { duration: 3000, panelClass: ['success-snackbar'] }
      );
    } catch (error) {
      console.error('Error generating prompt:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate prompt. Please try again.';
      this.snackBar.open(
        errorMessage,
        'Close',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
    } finally {
      this.isGeneratingPrompt = false;
      console.log('🔴 generatePromptFromFile finished');
    }
  }

  useGeneratedPrompt(): void {
    if (this.generatedPrompt) {
      // Set the prompt in the message input
      this.userInput = this.generatedPrompt;
      
      // Close the banner
      this.closeCsvBanner();
      
      // Focus on the message input
      setTimeout(() => {
        this.messageInput?.nativeElement.focus();
      }, 100);

      this.snackBar.open(
        'Prompt added! Click Send to generate your template.',
        'Close',
        { duration: 4000, panelClass: ['success-snackbar'] }
      );
    }
  }

  async useFileInChat(): Promise<void> {
    console.log('🟢 useFileInChat called', {
      hasFile: !!this.uploadedFile,
      isGenerating: this.isGeneratingPrompt,
      isAttaching: this.isAttachingFile
    });
    
    if (!this.uploadedFile || this.isGeneratingPrompt || this.isAttachingFile) {
      console.log('🟢 useFileInChat blocked');
      return;
    }

    console.log('🟢 useFileInChat executing...');
    this.isAttachingFile = true;

    // Attach the file to the chat
    this.attachedFile = this.uploadedFile;
    
    // Close the banner
    this.closeCsvBanner();
    
    // Enable auto-scroll and scroll to show the attachment
    this.shouldAutoScroll = true;
    
    // Wait for DOM to update with the attachment, then scroll smoothly
    this.cdr.detectChanges();
    setTimeout(() => {
      this.scrollToBottom();
    }, 150);
    
    // Focus after scroll animation completes
    setTimeout(() => {
      this.messageInput?.nativeElement.focus();
      this.isAttachingFile = false;
    }, 600);
    
    console.log('🟢 useFileInChat finished');
  }

  removeAttachedFile(): void {
    this.attachedFile = null;
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
      // ✅ Only position at bottom on initial load, then respect user scroll
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
      this.shouldAutoScroll = true; // ✅ Reset to true when positioned at bottom
      
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
    this.currentMjml$.complete();  // ✅ Clean up MJML
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
      content: this.sharedAssistantWelcome,
      timestamp: new Date(),
    };
    this.messages$.next([welcomeMessage]);
    
    // ✅ Save welcome message to cache for new conversations
    if (this.conversationId) {
      this.generationService.updateConversationCache(
        this.conversationId,
        [welcomeMessage],
        '',
        '',
        this.templateName
      );
    }
  }


  private loadConversation(conversationId: string): void {
    console.log('🔵 [GENERATE PAGE] Loading conversation:', conversationId);
    this.conversationId = conversationId;
    this.isGenerating$.next(true);
    
    // Reset file data flag when loading a conversation
    this.fileDataAlreadySent = false;

    this.generationService
      .getConversation(conversationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (conversation) => {
          console.log('🔵 [GENERATE PAGE] Conversation loaded:', {
            conversationId: conversation.conversationId,
            messagesCount: conversation.messages.length,
            hasHtml: !!conversation.currentHtml,
            templateName: conversation.templateName,
            status: conversation.status
          });
          console.log('🔵 [GENERATE PAGE] Messages history:', conversation.messages);
          this.messages$.next(conversation.messages);
          this.currentHtml$.next(conversation.currentHtml);
          this.templateName = conversation.templateName || '';
          
          // ✅ Set isRegenerating based on whether there's already generated HTML
          this.isRegenerating = !!conversation.currentHtml;
          
          this.isGenerating$.next(false);
          
          // ✅ Position at bottom initially, then let user control scroll
          this.shouldAutoScroll = true;
          this.scrollToBottom();
        },
        error: (error) => {
          // ✅ Don't show error if it's a 404 - conversation might not be saved yet
          if (error.status !== 404) {
            this.snackBar.open('Failed to load conversation', 'Close', {
              duration: 5000,
              panelClass: ['error-snackbar'],
            });
          }
          
          this.isGenerating$.next(false);
          
          // Only redirect on non-404 errors
          if (error.status !== 404) {
            this.router.navigate(['/generate/new'], { replaceUrl: true });
          }
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
  
  console.log('🔵 [GENERATE PAGE] onSend called:', {
    message: message.substring(0, 50) + '...',
    conversationId: this.conversationId,
    currentMessagesCount: this.messages$.value.length,
    hasTemplate: !!this.currentHtml$.value,
    isGenerating: this.isGenerating$.value,
    hasAttachedFile: !!this.attachedFile
  });
  
  if ((!message && !this.attachedFile) || this.isGenerating$.value) {
    console.log('🔵 [GENERATE PAGE] onSend blocked - empty message/no file or already generating');
    return;
  }

  // Route to image generation if image mode is selected
    if (this.generationType === 'image') {
      // Add the user's message to the chat UI so the conversation remains conversational
      const userMessage: GenerationMessage = {
        role: 'user',
        content: message,
        timestamp: new Date()
      };
      this.messages$.next([...this.messages$.value, userMessage]);
      this.scrollToBottom();
      // Clear the input box immediately so the user's message doesn't remain in the composer
      this.userInput = '';

      // If user already has generated images in this session, ALWAYS remix the existing image
      // to maintain continuity throughout the session. Only generate a new image when
      // the generatedImages array is empty (first message in a new session).
      if (this.generatedImages && this.generatedImages.length > 0) {
        await this.remixLastGeneratedImage(message);
      } else {
        this.generateImage(message);
      }

      return;
    }

  // If there's an attached file, we'll send it directly to the template generation
  // No need to pre-process into a prompt
  const finalMessage = message || 'Generate an email template based on the attached document data';
  
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
  
  // Store file reference before clearing
  const fileToSend = this.attachedFile;
  
  // Add user message to UI immediately (before API call) WITH images AND attachment
  const existingMessages = this.messages$.value;
  const userMessage: GenerationMessage = {
    role: 'user',
    content: finalMessage,
    timestamp: new Date(),
    images: imageAttachments.length > 0 ? imageAttachments : undefined,
    attachment: fileToSend ? {
      fileName: fileToSend.name,
      fileSize: fileToSend.size,
      fileType: fileToSend.type
    } : undefined,
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
  
  // Clear input, images, and attached file AFTER storing metadata
  this.userInput = '';
  this.selectedImages = [];
  this.imagePreviewUrls = [];
  this.attachedFile = null;

  // ✅ If there's an attached file, extract its data first, then send to chat
  if (fileToSend && !this.fileDataAlreadySent) {
    console.log('📎 [GENERATE PAGE] Processing attached file before sending to chat:', fileToSend.name);
    
    try {
      // Extract data from the file using the backend API
      const formData = new FormData();
      formData.append('file', fileToSend);

      const response = await fetch('/api/csv-to-prompt/extract', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to extract file data');
      }

      const { extractedData } = await response.json();
      console.log('📎 [GENERATE PAGE] File data extracted successfully, length:', extractedData.length);

      // Mark that file data has been sent
      this.fileDataAlreadySent = true;

      // Send chat message with the extracted file data
      this.sendChatMessage(finalMessage, imageAttachments, extractedData);
    } catch (error) {
      console.error('📎 [GENERATE PAGE] Error extracting file data:', error);
      this.snackBar.open('Failed to process attached file', 'Close', { 
        duration: 4000, 
        panelClass: ['error-snackbar'] 
      });
      this.isGenerating$.next(false);
    }
  } else if (fileToSend && this.fileDataAlreadySent) {
    console.log('📎 [GENERATE PAGE] File data already sent in conversation - skipping extraction to save tokens');
    // File data was already sent earlier, don't send it again
    this.sendChatMessage(finalMessage, imageAttachments);
  } else {
    // No file attached, send normal chat message
    this.sendChatMessage(finalMessage, imageAttachments);
  }
}

  // Heuristic to detect if the user's message is a follow-up edit intent
  private isEditIntent(message: string): boolean {
    if (!message) return false;
    // Action words that suggest editing/modifying existing image
    const editKeywords = /\b(remix|edit|change|convert|make|recolor|recolour|realistic|photorealistic|tint|warm|cool|saturat|desaturat|replace|add|remove|update|modify|adjust|move|position|place|put|insert|delete|shift|reposition)\b/i;
    // Spatial/positional words that suggest editing layout
    const positionalKeywords = /\b(next to|beside|near|above|below|on top|under|over|left|right|center|middle|corner|side|top|bottom)\b/i;
    // Content modification words
    const contentKeywords = /\b(icon|logo|text|title|banner|image|picture|element|object|item)\b/i;
    // Color/price indicators
    const colorHex = /#([0-9a-fA-F]{3,6})/;
    const priceOrText = /\$\s*\d+/;
    
    // Check if message contains edit keywords OR (positional + content keywords together)
    const hasEditKeyword = editKeywords.test(message);
    const hasPositionalAndContent = positionalKeywords.test(message) && contentKeywords.test(message);
    
    return hasEditKeyword || hasPositionalAndContent || colorHex.test(message) || priceOrText.test(message);
  }

  // Call Ideogram remix API using the last generated image URL and update the preview
  private async remixLastGeneratedImage(prompt: string): Promise<void> {
    if (!this.generatedImages || this.generatedImages.length === 0) {
      this.snackBar.open('No image available to remix', 'Close', { duration: 3000, panelClass: ['error-snackbar'] });
      return;
    }

    const last = this.generatedImages[0] || this.generatedImages[this.generatedImages.length - 1];
    const imageUrl = last.url;
    if (!imageUrl) {
      this.snackBar.open('No image URL found for remix', 'Close', { duration: 3000, panelClass: ['error-snackbar'] });
      return;
    }

    this.isGeneratingImage = true;
    try {
      // The backend will wrap this with remix-specific instructions that maintain
      // the original image context. We just pass the user's request directly.
      const remixPrompt = prompt;

      const resp: any = await this.ideogramService.remixImage(imageUrl, remixPrompt, { 
        styleType: 'REALISTIC'
      }).toPromise();

      // Normalize response similar to generate flow
      let dataArray: any[] = [];
      if (resp && Array.isArray(resp)) dataArray = resp as any[];
      else if (resp && resp.data && Array.isArray(resp.data)) dataArray = resp.data;
      else if (resp && resp.data) dataArray = Array.isArray(resp.data) ? resp.data : [resp.data];

      if (dataArray.length === 0) throw new Error('No image returned from remix');

      // Replace the first generated image in-place with the remixed result
      const newUrl = dataArray[0].url || (dataArray[0].images && dataArray[0].images[0]?.url) || null;
      if (!newUrl) throw new Error('Remix did not return a usable image URL');

      // Update generatedImages array and gallery HTML
      this.generatedImages[0] = { url: newUrl, prompt: prompt };

      const galleryItems = this.generatedImages.map((g, idx) => `
          <div style="display:inline-block;margin:8px;text-align:center;">
            <img src=\"${g.url}\" alt=\"Generated ${idx + 1}\" style=\"max-width:420px;max-height:420px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.08);display:block;margin:0 auto;\" />
          </div>
        `).join('');

      this.imageGalleryHtml = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a} .gallery{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:12px}</style></head><body><div class=\"gallery\">${galleryItems}</div></body></html>`;

      this.snackBar.open('Image remixed successfully!', 'Close', { duration: 3000, panelClass: ['success-snackbar'] });
    } catch (err: any) {
      console.error('Remix error:', err);
      this.snackBar.open(err?.message || 'Failed to remix image', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
    } finally {
      this.isGeneratingImage = false;
      try { this.previewPanel?.onRefresh(); } catch { this.cdr.detectChanges(); }
      this.scrollToBottom();
    }
  }

private async sendChatMessage(
  message: string, 
  imageAttachments: ImageAttachment[], 
  extractedFileData?: string
): Promise<void> {
  console.log('🔵 [GENERATE PAGE] sendChatMessage called:', {
    messageLength: message.length,
    imageCount: imageAttachments.length,
    conversationId: this.conversationId,
    currentMessagesCount: this.messages$.value.length,
    hasCurrentMjml: !!this.currentHtml$.value,
    hasExtractedFileData: !!extractedFileData,
    extractedFileDataLength: extractedFileData?.length || 0
  });

  // Get current conversation history (excluding the user message we just added)
  const historyMessages = this.messages$.value.slice(0, -1);

  this.generationService
    .chat(message, historyMessages, this.currentMjml$.value || undefined, imageAttachments, extractedFileData)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('🔵 [GENERATE PAGE] chat response received:', {
          hasHtml: !!response.html,
          hasMjml: !!response.mjml,
          message: response.message,
          hasErrors: response.hasErrors
        });

        this.currentHtml$.next(response.html);
        this.currentMjml$.next(response.mjml);  // ✅ Store MJML

        // Add assistant response to messages
        const assistantMessage: GenerationMessage = {
          role: 'assistant',
          content: response.message ||'✅ Template updated successfully!',
          timestamp: new Date(),
        };
        
        const updatedMessages = [...this.messages$.value, assistantMessage];
        this.messages$.next(updatedMessages);

        // ✅ Save the complete conversation state back to cache
        console.log('🔵 [GENERATE PAGE] Saving conversation to cache:', {
          conversationId: this.conversationId,
          messagesCount: updatedMessages.length,
          templateName: this.templateName
        });
        
        if (this.conversationId) {
          this.generationService.updateConversationCache(
            this.conversationId,
            updatedMessages,
            response.html,
            response.mjml || '',
            this.templateName
          );
        }

        // ✅ Set isRegenerating to true after first successful generation
        if (!this.isRegenerating) {
          this.isRegenerating = true;
        }

        this.isGenerating$.next(false);
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
      },
    });
}

private async startNewConversation(message: string, imageAttachments: ImageAttachment[]): Promise<void> {
  console.log('🔵 [GENERATE PAGE] startNewConversation called:', {
    messageLength: message.length,
    imageCount: imageAttachments.length,
    conversationId: this.conversationId,
    isRegenerating: this.isRegenerating
  });

  this.generationService
    .startGeneration(message, imageAttachments, this.conversationId || undefined)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        console.log('🔵 [GENERATE PAGE] startGeneration response received:', {
          conversationId: response.conversationId,
          hasHtml: !!response.html,
          hasMjml: !!response.mjml,
          message: response.message,
          hasErrors: response.hasErrors
        });

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

        // ✅ Save the complete conversation state back to cache
        console.log('🔵 [GENERATE PAGE] Saving conversation to cache:', {
          conversationId: response.conversationId,
          messagesCount: updatedMessages.length,
          templateName: this.templateName
        });
        this.generationService.updateConversationCache(
          response.conversationId,
          updatedMessages,
          response.html,
          response.mjml || '',
          this.templateName
        );

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

        // ✅ Save the complete conversation state back to cache
        this.generationService.updateConversationCache(
          this.conversationId!,
          updatedMessages,
          response.html,
          response.mjml || '',
          this.templateName
        );

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

// Image Generation Method
async generateImage(prompt: string): Promise<void> {
  if (!prompt.trim()) {
    this.snackBar.open('Please enter a prompt to generate an image', 'Close', {
      duration: 3000,
      panelClass: ['error-snackbar']
    });
    return;
  }

  this.isGeneratingImage = true;
  this.userInput = '';

  // Clear any previously generated images so new prompt does not include old results
  // This ensures the preview only shows images generated for the current prompt.
  this.generatedImages = [];
  this.imageGalleryHtml = '';
  try {
    // Force refresh of preview panel (OnPush) to clear old images immediately
    try { this.previewPanel?.onRefresh(); } catch { this.cdr.detectChanges(); }
  } catch {}

  try {
    // Build a marketing-focused prompt. If the user requested on-image text
    // (for example a price like "$100"), prefer a prompt that explicitly
    // instructs Ideogram to render that exact text as an overlay. In that
    // case we must NOT include the "no text" negative prompt which would
    // prevent text from being rendered.
    const priceOrCurrencyMatch = prompt.match(/(?:\$|€|£)\s*\d+/);
    const explicitTextMatch = prompt.match(/(?:include|with)\s+["']([^"']+)["']/i);

    let finalPrompt = this.buildStrictMarketingPrompt(prompt);
    let negative = 'watermark, caption, words, logo, signature, subtitle'; // keep watermark/branding blocked

    // If we detect a price/currency token or an explicit include "text" request,
    // strengthen the instruction to render that text verbatim and avoid blocking text.
    if (priceOrCurrencyMatch || explicitTextMatch) {
      const overlayText = (explicitTextMatch && explicitTextMatch[1]) || (priceOrCurrencyMatch && priceOrCurrencyMatch[0]) || '';
      finalPrompt = this.buildMarketingPromptWithOverlay(prompt, overlayText);
      // Do not block text rendering when explicit overlay requested
      negative = 'watermark, caption, logo, signature, subtitle';
    }

    const response = await this.ideogramService.generateImage({
      prompt: finalPrompt,
      aspectRatio: '1:1',
      model: 'V_2',
      magicPromptOption: 'AUTO',
      styleType: 'DESIGN',
      negativePrompt: negative
    }).toPromise();

  console.debug('Ideogram generate response (raw):', response);
  if (response && response.data && response.data.length > 0) {
      // Add generated images to the gallery
        response.data.forEach(img => {
          this.generatedImages.push({
            url: img.url,
            prompt: img.prompt || prompt
          });
        });

        // Build image gallery HTML for the left preview panel
        // Only show images (centered). No captions below.
        const galleryItems = this.generatedImages.map((g, idx) => `
          <div style="display:inline-block;margin:8px;text-align:center;">
            <img src=\"${g.url}\" alt=\"Generated ${idx + 1}\" style=\"max-width:420px;max-height:420px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.08);display:block;margin:0 auto;\" />
          </div>
        `).join('');

        this.imageGalleryHtml = `<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a} .gallery{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:12px}</style></head><body><div class=\"gallery\">${galleryItems}</div></body></html>`;

        // Trigger change detection if needed
        // Force the preview panel (OnPush) to refresh its iframe content
        try {
          this.previewPanel?.onRefresh();
        } catch (e) {
          // fallback to parent change detection
          this.cdr.detectChanges();
        }

      // After generation, keep generatedImages array (used for saving)
      // and offer quick save via dialog. We don't auto-open the save dialog,
      // but expose a button in the template to let users save the selected image.

      // Add assistant response to chat
      const assistantMessage: GenerationMessage = {
        role: 'assistant',
        content: `✅ Generated ${response.data.length} image(s) successfully!`,
        timestamp: new Date()
      };
      this.messages$.next([...this.messages$.value, assistantMessage]);

      this.snackBar.open('Image generated successfully!', 'Close', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });
    } else {
      throw new Error('No images were generated');
    }

  } catch (error: any) {
    console.error('Image generation error:', error);
    
    const assistantMessage: GenerationMessage = {
      role: 'assistant',
      content: `❌ Failed to generate image: ${error.message || 'Unknown error'}`,
      timestamp: new Date()
    };
    this.messages$.next([...this.messages$.value, assistantMessage]);

    this.snackBar.open('Failed to generate image', 'Close', {
      duration: 4000,
      panelClass: ['error-snackbar']
    });
  } finally {
    this.isGeneratingImage = false;
    this.scrollToBottom();
  }
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
  
  // ✅ Save template name to cache whenever it changes
  if (this.conversationId) {
    this.generationService.updateConversationCache(
      this.conversationId,
      this.messages$.value,
      this.currentHtml$.value,
      '', // mjml not needed for name update
      newName
    );
  }
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

        // ✅ Production-grade: Add new template directly to cache (no unnecessary API call for 1000 templates)
        this.templatesService.addTemplateToCache({
          id: response.templateId,
          name: response.templateName || name,
          content: this.currentHtml$.value,
          source: 'ai-generated',
          templateType: 'AI Generated',
        });
        
        // ✅ Select the saved template so it appears first when we navigate
        this.templatesService.select(response.templateId, response.templateName || name);

        // Navigate to templates page
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
  
  console.log('🔵 [GENERATE PAGE] onNewConversation called:', {
    conversationId: this.conversationId,
    hasTemplate: !!this.currentHtml$.value,
    hasActiveConversation,
    messagesCount: this.messages$.value.length
  });
  
  if (hasActiveConversation) {
    // Show confirmation dialog
    console.log('🔵 [GENERATE PAGE] Opening confirmation dialog');
    const dialogRef = this.dialog.open(ConfirmNewConversationDialog, {
      width: '500px',
      disableClose: false,
      data: { hasTemplate: true }
    });

    dialogRef.afterClosed().subscribe((result: 'save' | 'discard' | 'cancel') => {
      console.log('🔵 [GENERATE PAGE] Dialog closed with result:', result);
      if (result === 'save') {
        // Open save dialog
        console.log('🔵 [GENERATE PAGE] User chose to save template');
        this.onSaveTemplate();
      } else if (result === 'discard') {
        // Proceed with clearing conversation
        console.log('🔵 [GENERATE PAGE] User chose to discard and start new');
        this.clearAndStartNew();
      } else {
        console.log('🔵 [GENERATE PAGE] User cancelled - staying on current conversation');
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
  
  // Clear generated images to allow new image generation in new session
  this.generatedImages = [];
  this.imageGalleryHtml = '';

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

  // Small utility to escape HTML used inside our generated gallery captions
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Build a strict marketing prompt wrapper to bias Ideogram toward promotional images
  // The wrapper is intentionally concise and prescriptive:
  // - Only marketing/promotional images
  // - Center the main subject
  // - No overlay text, captions, watermarks, or logos
  // - Use a banner/design style suitable for promotions
  private buildStrictMarketingPrompt(userPrompt: string): string {
    const base = `Marketing promotional banner only. Center the main subject. No people unless explicitly requested. No overlay text, captions, logos, signatures, or watermarks. High quality, crisp lighting, marketing composition, bright contrast, product-focused.`;
    // Keep the final prompt compact: wrapper + user content
    return `${base} ${userPrompt}`;
  }

  // Build a marketing prompt that explicitly instructs the model to render
  // an exact overlay text string (useful for prices, promo headlines, etc.).
  // We keep the marketing constraints but explicitly allow and require the
  // overlay text to appear verbatim and highly legible.
  private buildMarketingPromptWithOverlay(userPrompt: string, overlayText: string): string {
    const base = `Marketing promotional banner only. Center the main subject. No people unless explicitly requested. High quality, crisp lighting, marketing composition, bright contrast, product-focused.`;
    const overlayInstruction = overlayText
      ? `IMPORTANT: Render the following text exactly as written as a large, high-contrast overlay on the image: "${overlayText}". Do not paraphrase, move, or remove characters; include currency symbols and punctuation exactly. The text should be legible, centered or top-right as a bold headline.`
      : `If any on-image text is mentioned in the prompt, render it exactly as written as a large, high-contrast overlay.`;

    return `${base} ${overlayInstruction} ${userPrompt}`;
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
