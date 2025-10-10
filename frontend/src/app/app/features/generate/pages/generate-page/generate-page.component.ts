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
  templateName = '';

  // Scroll state
  private shouldAutoScroll = true;

    ngOnInit(): void {
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
    const message = this.userInput.trim();
    if (!message || this.isGenerating$.value) return;

    this.isGenerating$.next(true);
    this.shouldAutoScroll = true;

    if (!this.conversationId) {
      // Start new conversation
      this.startNewConversation(message);
    } else {
      // Continue existing conversation
      this.continueConversation(message);
    }

    // Clear input
    this.userInput = '';
  }

  private startNewConversation(message: string): void {
    this.generationService
      .startGeneration(message)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.conversationId = response.conversationId;
          this.currentHtml$.next(response.html);

          // Add messages
          const newMessages: GenerationMessage[] = [
            { role: 'user', content: message, timestamp: new Date() },
            {
              role: 'assistant',
              content: response.message,
              timestamp: new Date(),
            },
          ];
          this.messages$.next(newMessages);

          this.isGenerating$.next(false);
          this.scrollToBottom();

          // Update URL without page reload
          this.router.navigate(['/generate', response.conversationId], {
            replaceUrl: true,
          });

          // Show success message
          if (response.hasErrors) {
            this.snackBar.open(
              'Template generated with warnings. Check console for details.',
              'Close',
              { duration: 5000, panelClass: ['info-snackbar'] }
            );
            console.warn('MJML Errors:', response.errors);
          } else {
            this.snackBar.open('Template generated successfully!', 'Close', {
              duration: 3000,
              panelClass: ['success-snackbar'],
            });
          }
        },
        error: (error) => {
          console.error('Generation failed:', error);
          this.snackBar.open(
            error.error?.message || 'Failed to generate template',
            'Close',
            { duration: 5000, panelClass: ['error-snackbar'] }
          );
          this.isGenerating$.next(false);
        },
      });
  }

  private continueConversation(message: string): void {
    if (!this.conversationId) return;

    // Add user message immediately
    const currentMessages = this.messages$.value;
    currentMessages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    this.messages$.next([...currentMessages]);
    this.scrollToBottom();

    this.generationService
      .continueConversation(this.conversationId, message)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.currentHtml$.next(response.html);

          // Add assistant message
          const updatedMessages = this.messages$.value;
          updatedMessages.push({
            role: 'assistant',
            content: response.message,
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
            console.warn('MJML Errors:', response.errors);
          } else {
            this.snackBar.open('Template updated!', 'Close', {
              duration: 3000,
              panelClass: ['success-snackbar'],
            });
          }
        },
        error: (error) => {
          console.error('Continue conversation failed:', error);
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

  const tempName = this.templateName || `Generated_${Date.now()}`;
  const currentHtml = this.currentHtml$.value;
  
  // ✅ Show loading state
  this.isGenerating$.next(true);
  
  this.generationService
    .saveTemplate(this.conversationId, tempName)
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (response) => {
        // ✅ Cache the HTML before navigating
        this.previewCache.set(response.templateId, currentHtml);
        
        this.snackBar.open('Template saved! Redirecting to QA...', 'Close', {
          duration: 2000,
          panelClass: ['success-snackbar'],
        });

        // ✅ Navigate immediately (no timeout needed since we cached it)
        this.isGenerating$.next(false);
        this.router.navigate(['/qa', response.templateId]);
      },
      error: (error) => {
        console.error('Save failed:', error);
        this.isGenerating$.next(false);
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
      panelClass: ['error-snackbar'],
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
        this.snackBar.open('Template saved successfully!', 'Close', {
          duration: 3000,
          panelClass: ['success-snackbar'],
        });

        // Navigate to templates page and highlight the new template
        this.router.navigate(['/'], {
          queryParams: {
            newTemplateId: response.templateId,
            highlight: 'true',
          },
        });
      },
      error: (error) => {
        console.error('Save failed:', error);
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

  trackByIndex(index: number): number {
    return index;
  }
}