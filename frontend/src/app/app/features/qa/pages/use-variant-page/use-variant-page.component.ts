import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, AfterViewInit, OnInit, OnDestroy, HostListener  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router  } from '@angular/router';
import { trigger, transition, style, animate } from '@angular/animations';
import { BehaviorSubject, firstValueFrom, map, shareReplay, combineLatest, Subscription, Observable  } from 'rxjs';
import { FormControl, ReactiveFormsModule , FormsModule} from '@angular/forms';
import {
  QaService,
  ChatTurn,
  ChatThread,
  GoldenEdit,
  ChatAssistantJson,
  ChatIntent,
  SnapResult,
} from '../../services/qa.service';
import { HtmlPreviewComponent } from '../../components/html-preview/html-preview.component';
import { HtmlEditorComponent } from '../../components/html-editor/html-editor.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ViewChild, ElementRef } from '@angular/core';





type AssistantPayload = {
  assistantText: string;
  json: ChatAssistantJson;
};

type LinkCheck = { url: string; inFile: boolean; inHtml: boolean };

@Component({
  selector: 'app-use-variant-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HtmlPreviewComponent,
    HtmlEditorComponent,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTooltipModule,
    FormsModule, 
  ],
  templateUrl: './use-variant-page.component.html',
  styleUrls: ['./use-variant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('150ms ease-in', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('100ms ease-out', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class UseVariantPageComponent implements AfterViewInit, OnInit, OnDestroy {
  private ar = inject(ActivatedRoute);
  private router = inject(Router);
  private qa = inject(QaService);
  private cdr = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);

  readonly templateId$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));
  readonly runId$      = this.ar.paramMap.pipe(map(p => p.get('runId')!), shareReplay(1));
  readonly no$         = this.ar.paramMap.pipe(map(p => Number(p.get('no')!)), shareReplay(1));

  private htmlSubject = new BehaviorSubject<string>('');
  readonly html$ = this.htmlSubject.asObservable();

  private originalSnapUrls = new Map<string, string>(); // Map<current snap key, original URL>

  private messagesSubject = new BehaviorSubject<ChatTurn[]>([]);
  readonly messages$ = this.messagesSubject.asObservable();

  private editorOpenSubject!: BehaviorSubject<boolean>;
  readonly editorOpen$!: Observable<boolean>;

  input = new FormControl<string>('', { nonNullable: true });
  loadingVariant = true;
  sending = false;

  applyingIndex: number | null = null;

  editInputValue: string = '';
  

  private snapsSubject = new BehaviorSubject<SnapResult[]>([]);
  readonly snaps$ = this.snapsSubject.asObservable();

  private snapping = new Map<string, boolean>();
  
  private finalizingSubject = new BehaviorSubject<boolean>(false);
  readonly finalizing$ = this.finalizingSubject.asObservable();
  
  private finalizeClickedInSession = false;
  
  // Track which snap is in edit mode
  private editingSnapUrl: string | null = null;
  
  get isFinalizing() { return this.finalizingSubject.value; }
  get isEditorOpen(): boolean { return this.editorOpenSubject.value; }
  get editorOpenSync(): boolean { return this.editorOpenSubject.value; }

    getEditInputValue(): string {
  return this.editInputValue;
}

  private validLinksSubject = new BehaviorSubject<string[]>([]);
  readonly validLinks$ = this.validLinksSubject.asObservable();

  private htmlLinks$ = this.html$.pipe(map(html => this.extractAllLinks(html)));

  @ViewChild('chatMessages') private chatMessagesRef!: ElementRef;
  private scrollAnimation: number | null = null;
  private loadingTimeout?: number;

  selectedImage: SnapResult | null = null;
  
  // Editor state persistence
  private editorStateKey = '';
  // Draft message persistence
  private draftMessageKey = '';
  private routerSub?: Subscription;
  private refreshSub?: Subscription;
  private navigationRefreshSub?: Subscription;


  readonly linkChecks$ = combineLatest([this.validLinks$, this.htmlLinks$]).pipe(
    map(([fileLinks, htmlLinks]) => {
      const norm = (u: string) => u.trim().toLowerCase();
      const fset = new Set(fileLinks.map(norm));
      const hset = new Set(htmlLinks.map(norm));
      const union: string[] = [];

      for (const u of fileLinks) if (!union.map(norm).includes(norm(u))) union.push(u);
      for (const u of htmlLinks) if (!union.map(norm).includes(norm(u))) union.push(u);

      const checks: LinkCheck[] = union.map(u => ({
        url: u,
        inFile: fset.has(norm(u)),
        inHtml: hset.has(norm(u)),
      }));
      checks.sort((a, b) => {
        const aw = (a.inFile && a.inHtml) ? 1 : 0;
        const bw = (b.inFile && b.inHtml) ? 1 : 0;
        return aw - bw;
      });
      return checks;
    })
  );

  ngOnInit() {
    window.scrollTo(0, 0);
    
    // Set up reactive subscription for future route changes
    combineLatest([this.runId$, this.no$]).subscribe(([runId, no]) => {
      this.editorStateKey = `editor_state_${runId}_${no}`;
      this.draftMessageKey = `draft_message_${runId}_${no}`;
    });
    
    // Subscribe to input changes to auto-save draft
    this.input.valueChanges.subscribe(value => {
      this.saveDraft(value);
    });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.navigationRefreshSub?.unsubscribe();
    
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }
  }

constructor() {
  // RESTORE STATE FIRST - before any template rendering
  const runId = this.ar.snapshot.paramMap.get('runId');
  const no = this.ar.snapshot.paramMap.get('no');

  if (runId && no) {
    this.editorStateKey = `editor_state_${runId}_${no}`;
    this.draftMessageKey = `draft_message_${runId}_${no}`;
    
    const wasEditorOpen = this.restoreEditorState();
    this.editorOpenSubject = new BehaviorSubject<boolean>(wasEditorOpen);
    
    const savedDraft = this.restoreDraft();
    if (savedDraft) {
      this.input.setValue(savedDraft);
    }
  } else {
    this.editorOpenSubject = new BehaviorSubject<boolean>(false);
  }

  this.editorOpen$ = this.editorOpenSubject.asObservable();

  // Now continue with existing constructor code
  this.loadingTimeout = window.setTimeout(() => {
    if (this.loadingVariant) {
      console.warn('Loading timeout reached, forcing completion');
      this.loadingVariant = false;
      this.cdr.markForCheck();
    }
  }, 10000);

  this.runId$.subscribe(async (runId) => {
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    try {
      // ✅ CHECK FOR SYNTHETIC RUN IN SESSIONSTORAGE
      let syntheticRun = null;
      try {
        const stored = sessionStorage.getItem(`synthetic_run_${runId}`);
        if (stored) {
          syntheticRun = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to load synthetic run:', e);
      }
      
      if (syntheticRun && syntheticRun.runId === runId) {
        const item = syntheticRun.items?.find((it: any) => it.no === no);
        if (item?.html) {
          this.htmlSubject.next(item.html);
          const intro: ChatTurn = {
            role: 'assistant',
            text: 'Hi! I can suggest ideas or make targeted changes. Ask about any line.',
            json: null,
            ts: Date.now(),
          };
          const thread: ChatThread = { html: item.html, messages: [intro] };
          this.messagesSubject.next(thread.messages);
          
          // ✅ SAVE TO CACHE so it persists
          this.qa.saveChat(runId, no, thread);
          
          this.snapsSubject.next([]);
          this.loadingVariant = false;
          if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = undefined;
          }
          this.cdr.markForCheck();
          this.positionChatAtBottom();
          return;
        }
      }

      const cachedThread = this.qa.getChatCached(runId, no);
      if (cachedThread?.html) {
        this.htmlSubject.next(cachedThread.html);
        this.messagesSubject.next(cachedThread.messages || []);
        
        this.snapsSubject.next(this.qa.getSnapsCached(runId));
        return;
      }

      const run = this.qa.getVariantsRunById(runId);
      const item = run?.items?.find(it => it.no === no) || null;
      if (item?.html) {
        this.htmlSubject.next(item.html);

        const intro: ChatTurn = {
          role: 'assistant',
          text: 'Hi! I can suggest ideas or make targeted changes. Ask about any line.',
          json: null,
          ts: Date.now(),
        };
        const thread: ChatThread = { html: item.html, messages: [intro] };
        this.messagesSubject.next(thread.messages);
        this.qa.saveChat(runId, no, thread);
        
        this.snapsSubject.next(this.qa.getSnapsCached(runId));
        return;
      }

      try {
        const status = await firstValueFrom(this.qa.getVariantsStatus(runId));
        const fromApi = status.items.find(it => it.no === no) || null;
        const html = fromApi?.html || '';
        this.htmlSubject.next(html);

        const intro: ChatTurn = {
          role: 'assistant',
          text: 'Hi! I can suggest ideas or make targeted changes. Ask about any line.',
          json: null,
          ts: Date.now(),
        };
        const thread: ChatThread = { html, messages: [intro] };
        this.messagesSubject.next(thread.messages);
        this.qa.saveChat(runId, no, thread);
      } catch (apiError) {
        console.error('Failed to load from API:', apiError);
        const intro: ChatTurn = {
          role: 'assistant',
          text: "I couldn't restore this variant from the server. If you go back and reopen it from the Variants list, I'll pick it up.",
          json: null,
          ts: Date.now(),
        };
        this.messagesSubject.next([intro]);
      }

      this.snapsSubject.next(this.qa.getSnapsCached(runId));
    } catch (error) {
      console.error('Error during component initialization:', error);
      const errorMessage: ChatTurn = {
        role: 'assistant',
        text: 'An error occurred while loading this variant. Please try refreshing the page.',
        json: null,
        ts: Date.now(),
      };
      this.messagesSubject.next([errorMessage]);
      this.snapsSubject.next([]);
    } finally {
      this.loadingVariant = false;
      if (this.loadingTimeout) {
        clearTimeout(this.loadingTimeout);
        this.loadingTimeout = undefined;
      }
      this.cdr.markForCheck();
      
      this.positionChatAtBottom();
    }
  });
}

  // EDITOR METHODS - UPDATED TO PERSIST STATE
  openEditor(): void {
    this.editorOpenSubject.next(true);
    this.saveEditorState(true);
    this.cdr.detectChanges();
  }

  closeEditor(): void {
    this.editorOpenSubject.next(false);
    this.saveEditorState(false);
    this.cdr.detectChanges();
  }

  onEditorClose(): void {
    this.closeEditor();
  }

  onEditorSave(newHtml: string): void {
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    this.htmlSubject.next(newHtml);

    const thread: ChatThread = {
      html: newHtml,
      messages: this.messagesSubject.value
    };
    this.qa.saveChat(runId, no, thread);

    this.showSuccess('Template updated successfully!');
    
    this.cdr.markForCheck();
  }

  private saveEditorState(isOpen: boolean): void {
    try {
      if (this.editorStateKey) {
        sessionStorage.setItem(this.editorStateKey, isOpen.toString());
      }
    } catch (error) {
      console.warn('Failed to save editor state:', error);
    }
  }

  private restoreEditorState(): boolean {
    try {
      if (this.editorStateKey) {
        const saved = sessionStorage.getItem(this.editorStateKey);
        return saved === 'true';
      }
    } catch (error) {
      console.warn('Failed to restore editor state:', error);
    }
    return false;
  }

  private saveDraft(message: string): void {
    try {
      if (this.draftMessageKey) {
        if (message.trim()) {
          sessionStorage.setItem(this.draftMessageKey, message);
        } else {
          sessionStorage.removeItem(this.draftMessageKey);
        }
      }
    } catch (error) {
      console.warn('Failed to save draft:', error);
    }
  }

  private restoreDraft(): string {
    try {
      if (this.draftMessageKey) {
        return sessionStorage.getItem(this.draftMessageKey) || '';
      }
    } catch (error) {
      console.warn('Failed to restore draft:', error);
    }
    return '';
  }

  toggleEditor(): void {
    const currentState = this.editorOpenSubject.value;
    if (currentState) {
      this.closeEditor();
    } else {
      this.openEditor();
    }
  }

  // IMAGE MODAL METHODS
  openImageModal(snap: SnapResult): void {
    if (snap.dataUrl) {
      this.selectedImage = snap;
      document.body.style.overflow = 'hidden';
    }
  }

  closeImageModal(): void {
    this.selectedImage = null;
    document.body.style.overflow = 'auto';
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (this.selectedImage) {
      this.closeImageModal();
    }
  }

  ngAfterViewInit() {
    setTimeout(() => {
      try {
        const chatElement = this.chatMessagesRef?.nativeElement;
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
      const element = this.chatMessagesRef?.nativeElement;
      if (element && element.scrollHeight > 0) {
        element.style.scrollBehavior = 'auto';
        element.scrollTop = element.scrollHeight;
        
        setTimeout(() => {
          element.style.scrollBehavior = 'smooth';
        }, 50);
      }
    }, 50);
  }

  scrollToTop(): void {
    this.smoothScrollTo(0);
  }

  scrollToBottom(): void {
    const element = this.chatMessagesRef?.nativeElement || document.querySelector('.chat-messages');
    if (element) {
      this.smoothScrollTo(element.scrollHeight);
    }
  }


  private smoothScrollTo(targetPosition: number): void {
    const element = this.chatMessagesRef?.nativeElement || document.querySelector('.chat-messages');
    if (!element) return;

    if (this.scrollAnimation) {
      cancelAnimationFrame(this.scrollAnimation);
    }

    const startPosition = element.scrollTop;
    const distance = targetPosition - startPosition;
    const duration = 800;
    let startTime: number | null = null;

    const animateScroll = (currentTime: number) => {
      if (startTime === null) startTime = currentTime;
      const timeElapsed = currentTime - startTime;
      const progress = Math.min(timeElapsed / duration, 1);

      const ease = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      element.scrollTop = startPosition + distance * ease;

      if (progress < 1) {
        this.scrollAnimation = requestAnimationFrame(animateScroll);
      } else {
        this.scrollAnimation = null;
      }
    };

    this.scrollAnimation = requestAnimationFrame(animateScroll);
  }

  async onSend() {
    const message = (this.input.value || '').trim();
    if (!message || this.sending) return;
    
    this.input.setValue('');
    this.saveDraft('');
    this.sending = true;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    const html = this.htmlSubject.value;

    const hist = (this.messagesSubject.value || []).slice(-6).map(t => ({
      role: t.role,
      content: t.text,
    }));

    try {
      const userTurn: ChatTurn = { role: 'user', text: message, ts: Date.now() };
      const msgs = [...this.messagesSubject.value, userTurn];
      this.messagesSubject.next(msgs);
      this.persistThread(runId, no, html, msgs);
      
      setTimeout(() => this.scrollToBottom(), 50);

      const resp = await firstValueFrom(this.qa.sendChatMessage(runId, no, html, hist, message)) as AssistantPayload;

      const assistantText = resp.assistantText || 'Okay.';
      const assistantTurn: ChatTurn = {
        role: 'assistant',
        text: assistantText,
        json: this.toAssistantJson(resp.json),
        ts: Date.now(),
      };
      const msgs2 = [...this.messagesSubject.value, assistantTurn];
      this.messagesSubject.next(msgs2);
      this.persistThread(runId, no, html, msgs2);
      
      setTimeout(() => this.scrollToBottom(), 50);
    } catch (e) {
      console.error('chat send error', e);
    } finally {
      this.sending = false;
    }
  }

  async onApplyEdits(turnIndex: number) {
    if (this.applyingIndex !== null) return;
    this.applyingIndex = turnIndex;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    const turn = this.messagesSubject.value[turnIndex];
    const edits = (turn?.json?.edits || []).slice();
    if (!edits.length) { this.applyingIndex = null; return; }

    try {
      const currentHtml = this.htmlSubject.value;
      const resp = await firstValueFrom(this.qa.applyChatEdits(runId, currentHtml, edits));
      const newHtml = resp?.html || currentHtml;
      const numChanges = Array.isArray((resp as any)?.changes) ? (resp as any).changes.length : 0;

      this.htmlSubject.next(newHtml);
      this.updateMessageEdits(turnIndex, []);

      const noteText = numChanges > 0
        ? `Applied ${numChanges} change(s).`
        : `No matching text found.`;

      const appliedNote: ChatTurn = { role: 'assistant', text: noteText, json: null, ts: Date.now() };
      const msgs = [...this.messagesSubject.value, appliedNote];
      this.messagesSubject.next(msgs);
      this.persistThread(runId, no, newHtml, msgs);
      
      setTimeout(() => this.scrollToBottom(), 50);
    } catch (e) {
      console.error('apply edits error', e);
    } finally {
      this.applyingIndex = null;
    }
  }


  handleEnterKey(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      event.preventDefault();
      this.onSend();
    }
  }

  captureUrl(inputElement: HTMLInputElement): void {
    const url = inputElement.value.trim();
    if (url) {
      this.onSnapUrl(url);
      inputElement.value = '';
    }
  }

async onFinalize() {
  console.log('=== 🎬 onFinalize CALLED ===');
  
  const el = document.getElementById('finalize');
  if (el) {
    console.log('📜 Scrolling to finalize section');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const runId = this.ar.snapshot.paramMap.get('runId')!;
  console.log('RunId:', runId);
  
  if (!runId) {
    console.log('❌ No runId found, exiting');
    return;
  }

  const isAlreadyFinalizing = this.finalizingSubject.value;
  console.log('Is already finalizing?', isAlreadyFinalizing);
  
  if (isAlreadyFinalizing) {
    console.log('⏭️ Already finalizing, exiting');
    return;
  }

  console.log('✅ Setting finalizing state to true');
  this.finalizingSubject.next(true);
  this.cdr.markForCheck();

  try {
    // ✅ ALWAYS clear existing snaps when finalizing (start from scratch)
    console.log('\n🧹 CLEARING EXISTING SNAPS:');
    const existingSnaps = this.snapsSubject.value;
    console.log('  - Existing snaps count:', existingSnaps.length);
    console.log('  - Existing snap URLs:', existingSnaps.map(s => s.finalUrl || s.url));
    
    console.log('  - Clearing all snaps...');
    this.snapsSubject.next([]);
    console.log('  ✅ Snaps cleared');
    
    // Save empty snaps to storage
    this.qa.saveSnaps(runId, []);
    console.log('  ✅ Empty snaps saved to storage');
    
    this.cdr.markForCheck();

    console.log('\n📄 EXTRACTING LINKS FROM HTML:');
    const html = this.htmlSubject.value || '';
    console.log('  - HTML length:', html.length);
    
    const urls = this.extractAllLinks(html);
    console.log('  - Extracted URLs count:', urls.length);
    console.log('  - Extracted URLs:', urls);
    
    if (urls.length === 0) {
      console.log('⚠️ No URLs found in HTML');
      this.finalizingSubject.next(false);
      this.cdr.markForCheck();
      console.log('=== ⏭️ onFinalize EXITED (no URLs) ===\n');
      return;
    }

    console.log('\n🌐 STARTING CAPTURE PROCESS:');
    console.log('  - Creating', urls.length, 'capture promises...');
    
    const capturePromises = urls.map((url, index) => {
      console.log(`  - [${index + 1}/${urls.length}] Queuing capture for:`, url);
      return this.captureOneWithPromise(runId, url);
    });
    
    console.log('  ✅ All capture promises created');
    console.log('  ⏳ Waiting for all captures to complete...');
    
    const results = await Promise.allSettled(capturePromises);
    
    console.log('\n📊 CAPTURE RESULTS:');
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected').length;
    console.log('  - Fulfilled:', fulfilled);
    console.log('  - Rejected:', rejected);
    console.log('  - Total:', results.length);
    
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`  ❌ [${index + 1}] Failed:`, urls[index], result.reason);
      } else {
        console.log(`  ✅ [${index + 1}] Success:`, urls[index]);
      }
    });

    console.log('\n✅ Capture process complete');
    console.log('  - Final snaps count:', this.snapsSubject.value.length);
    console.log('  - Final snap URLs:', this.snapsSubject.value.map(s => s.finalUrl || s.url));
    
    this.finalizingSubject.next(false);
    this.cdr.markForCheck();
    
    console.log('=== ✅ onFinalize COMPLETE ===\n');

  } catch (error) {
    console.error('\n❌ FINALIZE ERROR:');
    console.error('  - Error:', error);
    console.error('  - Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('  - Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    this.finalizingSubject.next(false);
    this.cdr.markForCheck();
    
    console.log('=== ❌ onFinalize ERROR HANDLED ===\n');
  }
}

onRetestUrl(url: string, newUrl?: string) {
  console.log('=== 🔄 onRetestUrl CALLED ===');
  console.log('Input url parameter:', url);
  console.log('Input newUrl parameter:', newUrl);
  console.log('Current editInputValue:', this.editInputValue);
  console.log('Current originalSnapUrls Map:', Array.from(this.originalSnapUrls.entries()));
  
  const runId = this.ar.snapshot.paramMap.get('runId')!;
  if (!runId || !url) {
    console.log('❌ Missing runId or url, exiting');
    return;
  }
  console.log('RunId:', runId);
  
  let targetUrl = newUrl?.trim() || url;
  console.log('Initial targetUrl:', targetUrl);
  
  if (newUrl !== undefined) {
    console.log('🔵 newUrl is provided');
    this.editInputValue = newUrl.trim();
    console.log('Updated editInputValue to:', this.editInputValue);
    
    // ✅ STORE THE ORIGINAL URL before retest
    if (newUrl.trim() && newUrl.trim() !== url) {
      const snapKey = url; // Current URL is the key
      console.log('📌 STORING original URL...');
      console.log('  - Key (current URL):', snapKey);
      console.log('  - Value (original URL):', url);
      this.originalSnapUrls.set(snapKey, url); // Store original
      console.log('  - New URL to test:', newUrl.trim());
      console.log('✅ Stored! Map now has:', this.originalSnapUrls.size, 'entries');
      console.log('  - Full map:', Array.from(this.originalSnapUrls.entries()));
    } else {
      console.log('⏭️ Not storing - newUrl is empty or same as current url');
    }
  } else {
    console.log('⏭️ newUrl is undefined, using existing url');
  }
  
  if (newUrl !== undefined && !newUrl.trim()) {
    console.log('⚠️ Empty newUrl provided, showing confirmation dialog');
    const confirmed = confirm('Input field is empty. It will only test the original link');
    console.log('User confirmation result:', confirmed);
    if (!confirmed) {
      console.log('❌ User cancelled, exiting');
      return;
    }
    targetUrl = url;
    console.log('Using original url as targetUrl:', targetUrl);
  }
  
  console.log('Final targetUrl to capture:', targetUrl);
  
  const existingSnap = this.snapsSubject.value.find(s => 
    (s.finalUrl || s.url) === url
  );
  console.log('Looking for existing snap with url:', url);
  console.log('Existing snap found:', !!existingSnap);
  
  if (existingSnap) {
    console.log('✅ Calling captureAndReplace with:', {
      runId,
      targetUrl,
      existingSnapUrl: existingSnap.finalUrl || existingSnap.url
    });
    this.captureAndReplace(runId, targetUrl, existingSnap);
  } else {
    console.log('✅ Calling captureOne with:', { runId, targetUrl });
    this.captureOne(runId, targetUrl);
  }
  
  console.log('=== ✅ onRetestUrl COMPLETE ===\n');
}

  // ✅ NEW: Handle Enter key in edit input field
  onEditInputKeyDown(event: KeyboardEvent, snap: SnapResult, inputElement: HTMLInputElement): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      const newUrl = inputElement.value.trim();
      this.onRetestUrl(snap.finalUrl || snap.url, newUrl || undefined);
    }
  }

  isSnapping(url: string): boolean {
    return !!this.snapping.get(url.toLowerCase());
  }

  onSnapUrl(raw: string) {
    const url = (raw || '').trim();
    if (!url) return;
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    this.captureOne(runId, url);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSend();
    }
  }

  async onValidLinksUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();

    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      try {
        const XLSX: any = await import('xlsx').catch(() => null);
        if (XLSX) {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
          this.consumeValidLinksRows(rows);
          input.value = '';
          return;
        }
      } catch (err) {
        console.warn('xlsx parse failed, trying CSV fallback', err);
      }
    }

    const text = await file.text();
    const rows = this.parseCsv(text);
    this.consumeValidLinksRows(rows);
    input.value = '';
  }

  private consumeValidLinksRows(rows: any[][]) {
    if (!rows?.length) {
      this.validLinksSubject.next([]);
      return;
    }
    const header = (rows[0] || []).map((c: any) => String(c ?? '').trim().toLowerCase());
    const idx = header.findIndex(h => h === 'valid links');
    if (idx < 0) {
      console.warn('No "valid links" column found.');
      this.validLinksSubject.next([]);
      return;
    }
    const out: string[] = [];
    for (const row of rows.slice(1)) {
      const raw = String((row?.[idx] ?? '')).trim();
      if (raw && /^https?:\/\//i.test(raw)) out.push(raw);
    }
    this.validLinksSubject.next(this.dedupe(out));
  }

  private parseCsv(text: string): string[][] {
    const s = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let i = 0, cur = '', row: string[] = [], inQ = false;

    while (i < s.length) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cur += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        cur += ch; i++; continue;
      } else {
        if (ch === '"') { inQ = true; i++; continue; }
        if (ch === ',') { row.push(cur.trim()); cur = ''; i++; continue; }
        if (ch === '\r' || ch === '\n') {
          row.push(cur.trim()); cur = '';
          rows.push(row); row = [];
          if (ch === '\r' && s[i + 1] === '\n') i++;
          i++; continue;
        }
        cur += ch; i++; continue;
      }
    }
    row.push(cur.trim()); rows.push(row);
    return rows;
  }

  private updateMessageEdits(turnIndex: number, edits: GoldenEdit[]) {
    const list = this.messagesSubject.value.slice();
    const turn = { ...list[turnIndex] };
    const json = this.toAssistantJson(turn.json || {});
    json.edits = edits.slice();
    turn.json = json;
    list[turnIndex] = turn;
    this.messagesSubject.next(list);
  }

  private removeSingleEdit(turnIndex: number, edit: GoldenEdit) {
    const turn = this.messagesSubject.value[turnIndex];
    const edits = (turn?.json?.edits || []).slice();
    const idx = edits.findIndex(e =>
      e.find === edit.find &&
      e.before_context === edit.before_context &&
      e.after_context === edit.after_context
    );
    if (idx >= 0) {
      edits.splice(idx, 1);
      this.updateMessageEdits(turnIndex, edits);
    }
  }

  private persistThread(runId: string, no: number, html: string, messages: ChatTurn[]) {
    const thread: ChatThread = { html, messages };
    this.qa.saveChat(runId, no, thread);
  }

  private toAssistantJson(raw: any): ChatAssistantJson {
    const intents: ChatIntent[] = ['suggest', 'edit', 'both', 'clarify'];
    const intent: ChatIntent = intents.includes(raw?.intent) ? (raw.intent as ChatIntent) : 'suggest';

    const ideas = Array.isArray(raw?.ideas) ? raw.ideas.map((s: any) => String(s ?? '')) : [];
    const notes = Array.isArray(raw?.notes) ? raw.notes.map((s: any) => String(s ?? '')) : [];
    const targets = Array.isArray(raw?.targets) ? raw.targets.map((s: any) => String(s ?? '')) : [];

    const edits = Array.isArray(raw?.edits)
      ? raw.edits.map((e: any) => ({
          find: String(e?.find ?? ''),
          replace: String(e?.replace ?? ''),
          before_context: String(e?.before_context ?? ''),
          after_context: String(e?.after_context ?? ''),
          reason: e?.reason != null ? String(e.reason) : undefined,
        })).filter((e: any) => e.find && e.replace)
      : [];

    return { intent, ideas, edits, targets, notes };
  }

  trackBySnap = (_: number, s: SnapResult) => (s?.finalUrl || s?.url || String(s?.ts || '0'));
  trackByMsg = (_: number, m: ChatTurn) => m?.ts ?? _;

  /**
   * Extract all links from HTML including:
   * - Regular anchor hrefs
   * - Button URLs from various attributes and onclick handlers
   */
  private extractAllLinks(html: string): string[] {
    const anchorLinks = this.extractHttpLinks(html);
    const buttonLinks = this.extractButtonUrls(html);
    
    // Combine and dedupe
    const allLinks = [...anchorLinks, ...buttonLinks];
    return this.dedupe(allLinks);
  }

  /**
   * Extract HTTP(S) links from anchor tags
   */
  private extractHttpLinks(html: string): string[] {
    const out: string[] = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = (a.getAttribute('href') || '').trim();
        if (!href) continue;
        if (/^https?:\/\//i.test(href)) out.push(href);
      }
    } catch {
      const rx = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html))) out.push(m[1]);
    }
    return out;
  }

  /**
   * Extract URLs from button elements (all edge cases)
   */
  private extractButtonUrls(html: string): string[] {
    const urls: string[] = [];
    
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      
      // Find all buttons and elements with button-like attributes
      const buttons = Array.from(doc.querySelectorAll('button, [onclick], [data-href], [data-url], [data-link]'));
      
      for (const btn of buttons) {
        // Check data attributes
        const dataHref = btn.getAttribute('data-href') || '';
        const dataUrl = btn.getAttribute('data-url') || '';
        const dataLink = btn.getAttribute('data-link') || '';
        
        if (dataHref && /^https?:\/\//i.test(dataHref)) urls.push(dataHref);
        if (dataUrl && /^https?:\/\//i.test(dataUrl)) urls.push(dataUrl);
        if (dataLink && /^https?:\/\//i.test(dataLink)) urls.push(dataLink);
        
        // Check onclick attribute
        const onclick = btn.getAttribute('onclick') || '';
        if (onclick) {
          // Match various onclick patterns:
          // window.location = 'URL'
          // window.location.href = 'URL'
          // location.href = 'URL'
          // location = 'URL'
          // window.open('URL')
          const patterns = [
            /(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
            /window\.open\s*\(\s*["'](https?:\/\/[^"']+)["']/gi,
            /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi
          ];
          
          for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(onclick)) !== null) {
              urls.push(match[1]);
            }
          }
        }
      }
      
      // Also check for anchor tags styled as buttons (class contains 'btn' or 'button')
      const buttonStyleAnchors = Array.from(doc.querySelectorAll('a[href][class*="btn"], a[href][class*="button"]'));
      for (const a of buttonStyleAnchors) {
        const href = (a.getAttribute('href') || '').trim();
        if (href && /^https?:\/\//i.test(href)) {
          urls.push(href);
        }
      }
      
    } catch (error) {
      console.warn('Error parsing button URLs:', error);
      
      // Fallback: regex-based extraction
      const patterns = [
        /data-href\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
        /data-url\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
        /data-link\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
        /onclick\s*=\s*["'][^"']*(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
        /onclick\s*=\s*["'][^"']*window\.open\s*\(\s*["'](https?:\/\/[^"']+)["']/gi
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          urls.push(match[1]);
        }
      }
    }
    
    return urls;
  }

  private dedupe(list: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of list) {
      const k = u.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
    return out;
  }

  private captureOne(runId: string, url: string) {
    const key = url.toLowerCase();
    if (this.snapping.get(key)) return;
    this.snapping.set(key, true);

    this.qa.snapUrl(runId, url).subscribe({
      next: ({ snap, snaps }) => {
        this.snapsSubject.next(snaps);
        this.snapping.set(key, false);
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('snapshot error', err);
        const errorSnap: SnapResult = {
          url,
          ok: false,
          error: (err?.message || 'Capture failed'),
          ts: Date.now(),
        };
        const list = [errorSnap, ...this.snapsSubject.value];
        this.snapsSubject.next(list);
        this.qa.saveSnaps(runId, list);
        this.snapping.set(key, false);
        this.cdr.markForCheck();
      },
    });
  }

  private captureOneWithPromise(runId: string, url: string): Promise<void> {
    return new Promise((resolve) => {
      const key = url.toLowerCase();
      if (this.snapping.get(key)) {
        resolve();
        return;
      }
      
      this.snapping.set(key, true);

      this.qa.snapUrl(runId, url).subscribe({
        next: ({ snap, snaps }) => {
          this.snapsSubject.next(snaps);
          this.snapping.set(key, false);
          this.cdr.markForCheck();
          resolve();
        },
        error: (err) => {
          console.error('snapshot error', err);
          const errorSnap: SnapResult = {
            url,
            ok: false,
            error: (err?.message || 'Capture failed'),
            ts: Date.now(),
          };
          const list = [errorSnap, ...this.snapsSubject.value];
          this.snapsSubject.next(list);
          this.qa.saveSnaps(runId, list);
          this.snapping.set(key, false);
          this.cdr.markForCheck();
          resolve();
        },
      });
    });
  }

  async onApplySingle(turnIndex: number, edit: GoldenEdit, replacement: string) {
    if (this.applyingIndex !== null) return;
    this.applyingIndex = turnIndex;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    const patch: GoldenEdit = {
      ...edit,
      replace: (replacement ?? '').trim() || edit.replace,
    };

    try {
      const currentHtml = this.htmlSubject.value;
      const resp = await firstValueFrom(this.qa.applyChatEdits(runId, currentHtml, [patch]));
      const newHtml = resp?.html || currentHtml;
      const numChanges = Array.isArray((resp as any)?.changes) ? (resp as any).changes.length : 0;

      this.htmlSubject.next(newHtml);

      if (numChanges > 0) {
        this.removeSingleEdit(turnIndex, edit);
      }

      const noteText = numChanges > 0
        ? `Applied: "${patch.find}" → "${patch.replace}".`
        : `No matching text found.`;

      const appliedNote: ChatTurn = { role: 'assistant', text: noteText, json: null, ts: Date.now() };
      const msgs = [...this.messagesSubject.value, appliedNote];
      this.messagesSubject.next(msgs);
      this.persistThread(runId, no, newHtml, msgs);
    } catch (e) {
      console.error('apply single edit error', e);
    } finally {
      this.applyingIndex = null;
    }
  }

  onSkipSingle(turnIndex: number, editIndex: number) {
    const turn = this.messagesSubject.value[turnIndex];
    const edits = (turn?.json?.edits || []).slice();
    if (!edits.length) return;

    edits.splice(editIndex, 1);
    this.updateMessageEdits(turnIndex, edits);
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.persistThread(runId, no, this.htmlSubject.value, this.messagesSubject.value);
  }

  onClearEdits(turnIndex: number) {
    this.updateMessageEdits(turnIndex, []);
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.persistThread(runId, no, this.htmlSubject.value, this.messagesSubject.value);
  }

  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }

// Toggle edit mode for a snap
onEditSnap(snap: SnapResult): void {
  console.log('=== 🎯 onEditSnap CALLED ===');
  
  const snapKey = snap.finalUrl || snap.url;
  console.log('Snap key:', snapKey);
  console.log('Snap object:', snap);
  console.log('Current editingSnapUrl (before change):', this.editingSnapUrl);
  console.log('Current editInputValue (before change):', this.editInputValue);
  
  if (this.editingSnapUrl === snapKey) {
    // Closing edit mode
    console.log('❌ CLOSING edit mode');
    this.editingSnapUrl = null;
    this.editInputValue = '';
    console.log('✅ Edit mode closed');
    console.log('New editingSnapUrl:', this.editingSnapUrl);
    console.log('New editInputValue:', this.editInputValue);
  } else {
    // Opening edit mode
    console.log('✅ OPENING edit mode');
    console.log('Storing original URL in map:', snapKey);
    this.editingSnapUrl = snapKey;
    this.editInputValue = ''; // Reset input when opening
    console.log('New editingSnapUrl:', this.editingSnapUrl);
    console.log('New editInputValue:', this.editInputValue);
  }
  
  this.cdr.markForCheck();
  console.log('=== ✅ onEditSnap COMPLETE ===\n');
}

  // Check if snap is in edit mode
  isSnapInEditMode(snap: SnapResult): boolean {
    const snapKey = snap.finalUrl || snap.url;
    return this.editingSnapUrl === snapKey;
  }

  canReplace(snap: SnapResult): boolean {
  console.log('🔍 canReplace CHECK:');
  const currentSnapUrl = snap.finalUrl || snap.url;
  console.log('  - Current snap URL:', currentSnapUrl);
  console.log('  - editInputValue:', this.editInputValue);
  console.log('  - Has entry in map?', this.originalSnapUrls.has(currentSnapUrl));
  
  // Replace is enabled when:
  // 1. Input has value AND
  // 2. A retest was performed (entry exists in originalSnapUrls map)
  const hasValue = !!this.editInputValue?.trim();
  const hasMapEntry = this.originalSnapUrls.has(currentSnapUrl);
  const canReplace = hasValue && hasMapEntry;
  
  console.log('  - Has value?', hasValue);
  console.log('  - Has map entry?', hasMapEntry);
  console.log('  ✅ Can replace?', canReplace);
  
  return canReplace;
}


  // ✅ UPDATED: Replace button with confirmation and HTML URL replacement
onReplaceSnap(snap: SnapResult, inputElement: HTMLInputElement): void {
  console.log('=== 🔵 onReplaceSnap CALLED ===');
  console.log('Snap object:', snap);
  console.log('Input element:', inputElement);
  console.log('Input element value (raw):', inputElement.value);
  
  const newUrl = inputElement.value.trim();
  console.log('New URL (trimmed):', newUrl);
  console.log('Current editInputValue state:', this.editInputValue);
  console.log('Current originalSnapUrls Map:', Array.from(this.originalSnapUrls.entries()));
  
  if (!newUrl) {
    console.log('❌ Input is empty');
    const confirmed = confirm('Input field is empty. Do you want to close edit mode without replacing?');
    console.log('User confirmation (close without replace):', confirmed);
    
    if (confirmed) {
      console.log('Closing edit mode and clearing state...');
      this.editingSnapUrl = null;
      this.editInputValue = '';
      inputElement.value = '';
      console.log('State after clearing:', {
        editingSnapUrl: this.editingSnapUrl,
        editInputValue: this.editInputValue,
        inputElementValue: inputElement.value
      });
      this.cdr.markForCheck();
    } else {
      console.log('User cancelled, keeping edit mode open');
    }
    console.log('=== ❌ onReplaceSnap EXITED (empty input) ===\n');
    return;
  }
  
  const currentSnapUrl = snap.finalUrl || snap.url;
  console.log('Current snap URL:', currentSnapUrl);
  console.log('Snap details:', {
    url: snap.url,
    finalUrl: snap.finalUrl,
    ok: snap.ok,
    status: snap.status
  });
  
  // ✅ GET THE ORIGINAL URL (before retest)
  console.log('🔍 Looking up original URL from map...');
  console.log('  - Using key:', currentSnapUrl);
  const originalUrl = this.originalSnapUrls.get(currentSnapUrl) || currentSnapUrl;
  console.log('  - Found original URL:', originalUrl);
  console.log('  - Is it from map?', this.originalSnapUrls.has(currentSnapUrl));
  console.log('  - Map has', this.originalSnapUrls.size, 'entries');
  
  console.log('📋 REPLACEMENT SUMMARY:');
  console.log('  - Original URL (in HTML):', originalUrl);
  console.log('  - Current snap URL:', currentSnapUrl);
  console.log('  - New URL (replacement):', newUrl);
  console.log('  - Are they different?', originalUrl !== newUrl);
  
  let updatedSnapUrl: string;
  
  try {
    console.log('🟢 Calling replaceUrlInHtml...');
    this.replaceUrlInHtml(originalUrl, newUrl, snap);
    console.log('✅ replaceUrlInHtml completed successfully');
    
    // The snap has been updated with the new URL in replaceUrlInHtml
    // Get the updated snap to find its new URL
    const updatedSnap = this.snapsSubject.value.find(s => 
      s === snap || (s.url === newUrl || s.finalUrl === newUrl)
    );
    updatedSnapUrl = updatedSnap?.finalUrl || updatedSnap?.url || newUrl;
    console.log('Updated snap URL after replace:', updatedSnapUrl);
    
    this.showSuccess('✓ Replace successful! Link updated in HTML.');
    
    // Clean up the stored original URL from map
    console.log('🧹 Cleaning up: Deleting', currentSnapUrl, 'from originalSnapUrls map');
    const deleted = this.originalSnapUrls.delete(currentSnapUrl);
    console.log('Delete result:', deleted);
    console.log('Map size after deletion:', this.originalSnapUrls.size);
  } catch (error) {
    console.error('🔴 Replace failed with error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
    alert('Replace failed. Please use the editor for manual changes.');
    console.log('=== ❌ onReplaceSnap EXITED (error) ===\n');
    return;
  }
  
  // ✅ KEEP EDIT MODE OPEN but clear input and update tracking
  console.log('🔄 Updating edit mode state (keeping open):');
  console.log('  - Old editingSnapUrl:', this.editingSnapUrl);
  console.log('  - New editingSnapUrl:', updatedSnapUrl);
  
  this.editingSnapUrl = updatedSnapUrl;
  this.editInputValue = '';
  inputElement.value = '';
  
  console.log('State after update:', {
    editingSnapUrl: this.editingSnapUrl,
    editInputValue: this.editInputValue,
    inputElementValue: inputElement.value
  });
  
  this.cdr.markForCheck();
  console.log('Change detection marked');
  
  console.log('=== ✅ onReplaceSnap COMPLETE (edit mode still open) ===\n');
}

getOriginalUrl(snap: SnapResult): string {
  console.log('🔍 getOriginalUrl CHECK:');
  const currentSnapUrl = snap.finalUrl || snap.url;
  console.log('  - Current snap URL:', currentSnapUrl);
  
  // If there's an entry in the map, that's the original URL from HTML
  const originalUrl = this.originalSnapUrls.get(currentSnapUrl);
  console.log('  - Map has entry?', !!originalUrl);
  console.log('  - Original URL:', originalUrl || currentSnapUrl);
  
  return originalUrl || currentSnapUrl;
}

getLatestTestedUrl(snap: SnapResult): string | null {
  console.log('🔍 getLatestTestedUrl CHECK:');
  const currentSnapUrl = snap.finalUrl || snap.url;
  console.log('  - Current snap URL:', currentSnapUrl);
  
  // If there's an entry in the map, current URL is the "latest tested" URL
  const hasBeenRetested = this.originalSnapUrls.has(currentSnapUrl);
  console.log('  - Has been retested?', hasBeenRetested);
  
  if (hasBeenRetested) {
    console.log('  - Latest tested URL:', currentSnapUrl);
    return currentSnapUrl;
  }
  
  console.log('  - No retest performed yet');
  return null;
}

hasBeenRetested(snap: SnapResult): boolean {
  const currentSnapUrl = snap.finalUrl || snap.url;
  const result = this.originalSnapUrls.has(currentSnapUrl);
  console.log('🔍 hasBeenRetested:', result, 'for', currentSnapUrl);
  return result;
}

  // ✅ NEW: Replace URL in HTML with 1-to-1 mapping for duplicates
private replaceUrlInHtml(oldUrl: string, newUrl: string, snap: SnapResult): void {
  console.log('=== 🔧 replaceUrlInHtml CALLED ===');
  console.log('📥 INPUTS:');
  console.log('  - oldUrl:', oldUrl);
  console.log('  - newUrl:', newUrl);
  console.log('  - snap:', snap);
  
  const runId = this.ar.snapshot.paramMap.get('runId')!;
  const no = Number(this.ar.snapshot.paramMap.get('no')!);
  console.log('  - runId:', runId);
  console.log('  - no:', no);
  
  let html = this.htmlSubject.value;
  console.log('📄 HTML INFO:');
  console.log('  - HTML length:', html.length);
  console.log('  - HTML sample (first 200 chars):', html.substring(0, 200));
  
  // Try to find the URL with different protocols
  console.log('\n🔍 PROTOCOL DETECTION:');
  console.log('  - oldUrl starts with http:// ?', oldUrl.startsWith('http://'));
  console.log('  - oldUrl starts with https:// ?', oldUrl.startsWith('https://'));
  
  let fullOldUrl = oldUrl;
  if (!oldUrl.startsWith('http://') && !oldUrl.startsWith('https://')) {
    console.log('  ⚠️ No protocol in oldUrl, attempting to detect...');
    
    const httpsCheck = html.includes('https://' + oldUrl);
    const httpCheck = html.includes('http://' + oldUrl);
    console.log('  - HTML contains https://' + oldUrl + '?', httpsCheck);
    console.log('  - HTML contains http://' + oldUrl + '?', httpCheck);
    
    if (httpsCheck) {
      fullOldUrl = 'https://' + oldUrl;
      console.log('  ✅ Using https:// protocol');
    } else if (httpCheck) {
      fullOldUrl = 'http://' + oldUrl;
      console.log('  ✅ Using http:// protocol');
    } else {
      console.log('  ❌ No protocol match found, using as-is');
    }
  } else {
    console.log('  ✅ Protocol already present in oldUrl');
  }
  
  console.log('  - Full old URL:', fullOldUrl);
  
  // Check if URL exists in HTML
  const urlExistsInHtml = html.includes(fullOldUrl);
  console.log('\n🔍 URL EXISTENCE CHECK:');
  console.log('  - Does HTML contain fullOldUrl?', urlExistsInHtml);
  
  if (!urlExistsInHtml) {
    // Additional debugging - try to find similar URLs
    console.log('  ⚠️ Searching for similar URLs in HTML...');
    const urlParts = fullOldUrl.split('//')[1] || fullOldUrl;
    const similarMatches = html.match(new RegExp(urlParts.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
    console.log('  - Similar URL matches:', similarMatches);
  }
  
  // Add protocol to new URL if needed
  console.log('\n🔍 NEW URL PROTOCOL:');
  console.log('  - newUrl starts with http:// ?', newUrl.startsWith('http://'));
  console.log('  - newUrl starts with https:// ?', newUrl.startsWith('https://'));
  
  let fullNewUrl = newUrl;
  if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
    console.log('  ⚠️ No protocol in newUrl, adding based on oldUrl...');
    
    if (fullOldUrl.startsWith('https://')) {
      fullNewUrl = 'https://' + newUrl;
      console.log('  ✅ Added https:// protocol');
    } else if (fullOldUrl.startsWith('http://')) {
      fullNewUrl = 'http://' + newUrl;
      console.log('  ✅ Added http:// protocol');
    } else {
      console.log('  ⚠️ No protocol to copy, using as-is');
    }
  } else {
    console.log('  ✅ Protocol already present in newUrl');
  }
  
  console.log('  - Full new URL:', fullNewUrl);
  
  // Error if URL not found
  if (!html.includes(fullOldUrl)) {
    console.error('\n❌ CRITICAL ERROR: URL NOT FOUND IN HTML!');
    console.error('  - Searched for:', fullOldUrl);
    console.error('  - HTML length:', html.length);
    console.error('  - First 500 chars of HTML:', html.substring(0, 500));
    alert('URL not found in HTML. The link might have already been changed.');
    throw new Error('URL not found in HTML');
  }
  
  // Find which occurrence this snap represents
  console.log('\n📊 OCCURRENCE CALCULATION:');
  const allSnaps = this.snapsSubject.value;
  console.log('  - Total snaps:', allSnaps.length);
  console.log('  - All snap URLs:', allSnaps.map(s => s.finalUrl || s.url));
  
  const snapIndex = allSnaps.indexOf(snap);
  console.log('  - Current snap index:', snapIndex);
  
  if (snapIndex === -1) {
    console.error('  ❌ Snap not found in snaps array!');
  }
  
  // Count how many times this URL appears before this snap
  let occurrenceIndex = 0;
  console.log('  - Counting occurrences before current snap...');
  for (let i = 0; i < snapIndex; i++) {
    const snapUrl = allSnaps[i].finalUrl || allSnaps[i].url;
    const matches = snapUrl.toLowerCase() === oldUrl.toLowerCase();
    console.log(`    [${i}] ${snapUrl} === ${oldUrl}? ${matches}`);
    if (matches) {
      occurrenceIndex++;
    }
  }
  
  console.log('  ✅ Occurrence index to replace:', occurrenceIndex);
  
  // Count total occurrences in HTML
  const totalOccurrences = (html.match(new RegExp(fullOldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log('  - Total occurrences in HTML:', totalOccurrences);
  
  // Replace only the specific occurrence
  console.log('\n🔄 REPLACEMENT PROCESS:');
  const escapedUrl = fullOldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  console.log('  - Escaped regex pattern:', escapedUrl);
  
  const regex = new RegExp(escapedUrl, 'g');
  let count = 0;
  const replaced = html.replace(regex, (match) => {
    const isTarget = count === occurrenceIndex;
    console.log(`  - Occurrence #${count}: "${match}" - Replace? ${isTarget}`);
    
    if (isTarget) {
      console.log(`    ✅ REPLACING: "${match}" → "${fullNewUrl}"`);
      count++;
      return fullNewUrl;
    }
    console.log(`    ⏭️ SKIPPING (not target occurrence)`);
    count++;
    return match;
  });
  
  const htmlChanged = html !== replaced;
  const newUrlInHtml = replaced.includes(fullNewUrl);
  
  console.log('\n📊 REPLACEMENT RESULT:');
  console.log('  - HTML changed?', htmlChanged);
  console.log('  - New URL exists in replaced HTML?', newUrlInHtml);
  console.log('  - Original HTML length:', html.length);
  console.log('  - Replaced HTML length:', replaced.length);
  console.log('  - Length difference:', replaced.length - html.length);
  
  if (html === replaced) {
    console.error('\n❌ CRITICAL ERROR: NO REPLACEMENT WAS MADE!');
    console.error('  - Old URL:', fullOldUrl);
    console.error('  - New URL:', fullNewUrl);
    console.error('  - Total occurrences found:', totalOccurrences);
    console.error('  - Target occurrence index:', occurrenceIndex);
    alert('Replacement failed. No changes were made to the HTML.');
    throw new Error('No replacement was made');
  }
  
  // Update HTML
  console.log('\n💾 UPDATING STATE:');
  console.log('  - Updating htmlSubject...');
  this.htmlSubject.next(replaced);
  console.log('  ✅ htmlSubject updated');
  
  // Update the snap in the array
  console.log('  - Updating snap in array...');
  console.log('  - Old snap URL:', snap.finalUrl || snap.url);
  const updatedSnaps = allSnaps.map(s => {
    if (s === snap) {
      console.log('  - Found matching snap, updating...');
      return {
        ...s,
        url: fullNewUrl,
        finalUrl: fullNewUrl
      };
    }
    return s;
  });
  
  console.log('  - Updated snap URL:', fullNewUrl);
  this.snapsSubject.next(updatedSnaps);
  console.log('  ✅ snapsSubject updated');
  
  // Persist changes
  console.log('\n💾 PERSISTING TO STORAGE:');
  const thread: ChatThread = {
    html: replaced,
    messages: this.messagesSubject.value
  };
  console.log('  - Saving chat thread...');
  this.qa.saveChat(runId, no, thread);
  console.log('  ✅ Chat saved');
  
  console.log('  - Saving snaps...');
  this.qa.saveSnaps(runId, updatedSnaps);
  console.log('  ✅ Snaps saved');
  
  this.cdr.markForCheck();
  console.log('  ✅ Change detection marked');
  
  console.log('\n=== ✅ replaceUrlInHtml COMPLETE ===\n');
}
  // ✅ FIXED: Capture and replace with proper edit mode persistence
private captureAndReplace(runId: string, newUrl: string, oldSnap: SnapResult) {
  console.log('=== 🔄 captureAndReplace CALLED ===');
  console.log('📥 INPUTS:');
  console.log('  - runId:', runId);
  console.log('  - newUrl:', newUrl);
  console.log('  - oldSnap:', oldSnap);
  console.log('  - oldSnap URL:', oldSnap.finalUrl || oldSnap.url);
  
  const key = newUrl.toLowerCase();
  console.log('  - Snap key (lowercase):', key);
  console.log('  - Current snapping map:', Array.from(this.snapping.entries()));
  
  if (this.snapping.get(key)) {
    console.log('⏭️ Already snapping this URL, exiting');
    return;
  }
  
  console.log('✅ Setting snapping flag to true');
  this.snapping.set(key, true);

  // Find the index of the old snap
  console.log('\n🔍 FINDING OLD SNAP INDEX:');
  const currentSnaps = [...this.snapsSubject.value];
  console.log('  - Total snaps:', currentSnaps.length);
  console.log('  - All snap URLs:', currentSnaps.map(s => s.finalUrl || s.url));
  
  const oldIndex = currentSnaps.findIndex(s => s === oldSnap);
  console.log('  - Old snap index:', oldIndex);

  if (oldIndex === -1) {
    console.error('❌ Could not find snap to replace!');
    console.error('  - Looking for snap:', oldSnap);
    console.error('  - In array:', currentSnaps);
    this.snapping.set(key, false);
    console.log('  - Snapping flag cleared');
    console.log('=== ❌ captureAndReplace EXITED (snap not found) ===\n');
    return;
  }
  
  console.log('  ✅ Found old snap at index:', oldIndex);

  // Create loading placeholder
  console.log('\n🔄 CREATING LOADING PLACEHOLDER:');
  const loadingSnap: SnapResult = {
    url: newUrl,
    ts: Date.now(),
  } as SnapResult;
  console.log('  - Loading snap:', loadingSnap);
  
  currentSnaps[oldIndex] = loadingSnap;
  console.log('  - Replaced snap at index', oldIndex, 'with loading placeholder');
  
  this.snapsSubject.next(currentSnaps);
  console.log('  ✅ Updated snapsSubject with loading placeholder');
  
  this.cdr.markForCheck();
  console.log('  ✅ Change detection marked');

  // Make API call
  console.log('\n🌐 MAKING API CALL:');
  console.log('  - Calling qa.snapUrl with:', { runId, newUrl });
  
  this.qa.snapUrl(runId, newUrl).subscribe({
    next: ({ snap, snaps }) => {
      console.log('\n✅ API CALL SUCCESS:');
      console.log('  - Response snap:', snap);
      console.log('  - Response snaps array length:', snaps.length);
      console.log('  - Response snaps URLs:', snaps.map(s => s.finalUrl || s.url));
      
      // Find the new snap from API response
      console.log('\n🔍 FINDING NEW SNAP IN RESPONSE:');
      console.log('  - Looking for URL:', newUrl);
      
      const newSnap = snaps.find(s => 
        s.url.toLowerCase() === newUrl.toLowerCase() || 
        s.finalUrl?.toLowerCase() === newUrl.toLowerCase()
      );
      console.log('  - New snap found:', !!newSnap);
      console.log('  - New snap details:', newSnap);

      if (!newSnap) {
        console.error('❌ New snap not found in response!');
        console.error('  - Searched for:', newUrl.toLowerCase());
        console.error('  - In snaps:', snaps.map(s => ({ url: s.url, finalUrl: s.finalUrl })));
        this.snapping.set(key, false);
        console.log('  - Snapping flag cleared');
        console.log('=== ❌ captureAndReplace EXITED (new snap not found) ===\n');
        return;
      }
      
      console.log('  ✅ Found new snap:', newSnap.finalUrl || newSnap.url);

      // Get fresh copy and remove the loading placeholder
      console.log('\n🔄 UPDATING SNAPS ARRAY:');
      const updatedSnaps = this.snapsSubject.value.filter(s => s !== loadingSnap);
      console.log('  - Removed loading placeholder');
      console.log('  - Array length after filter:', updatedSnaps.length);
      
      // Insert new snap at the old position
      console.log('  - Inserting new snap at index:', oldIndex);
      updatedSnaps.splice(oldIndex, 0, newSnap);
      console.log('  - Array length after insert:', updatedSnaps.length);
      console.log('  - Updated snaps URLs:', updatedSnaps.map(s => s.finalUrl || s.url));
      
      this.snapsSubject.next(updatedSnaps);
      console.log('  ✅ snapsSubject updated');
      
      this.qa.saveSnaps(runId, updatedSnaps);
      console.log('  ✅ Snaps saved to storage');
      
      this.snapping.set(key, false);
      console.log('  ✅ Snapping flag cleared');
      
      // ✅ CRITICAL FIX: Update editingSnapUrl AND update map key
      console.log('\n🔄 UPDATING EDIT MODE STATE:');
      console.log('  - Current editingSnapUrl:', this.editingSnapUrl);
      console.log('  - Current originalSnapUrls Map:', Array.from(this.originalSnapUrls.entries()));
      
      if (this.editingSnapUrl) {
        // Use url instead of finalUrl if finalUrl is an error page
        const newSnapUrl = (newSnap.finalUrl && !newSnap.finalUrl.includes('chrome-error')) 
          ? newSnap.finalUrl 
          : newSnap.url;
        console.log('  - Edit mode is active, updating to new URL:', newSnapUrl);
        
        // ✅ UPDATE MAP: Transfer original URL from old key to new key
        const oldKey = this.editingSnapUrl;
        console.log('  - Old map key:', oldKey);
        console.log('  - New map key:', newSnapUrl);
        
        if (this.originalSnapUrls.has(oldKey)) {
          const originalUrl = this.originalSnapUrls.get(oldKey)!;
          console.log('  - Found entry in map with original URL:', originalUrl);
          console.log('  - Deleting old key from map...');
          this.originalSnapUrls.delete(oldKey);
          console.log('  - Setting new key in map...');
          this.originalSnapUrls.set(newSnapUrl, originalUrl);
          console.log('  ✅ Map key updated!');
          console.log('  - Updated map:', Array.from(this.originalSnapUrls.entries()));
        } else {
          console.log('  ⚠️ Old key not found in map, no transfer needed');
        }
        
        this.editingSnapUrl = newSnapUrl;
        console.log('  ✅ editingSnapUrl updated to:', this.editingSnapUrl);
      } else {
        console.log('  ⏭️ Edit mode not active, no update needed');
      }
      
      this.cdr.markForCheck();
      console.log('  ✅ Change detection marked');
      
      console.log('\n=== ✅ captureAndReplace SUCCESS ===\n');
    },
    error: (err) => {
      console.error('\n❌ API CALL FAILED:');
      console.error('  - Error:', err);
      console.error('  - Error message:', err?.message);
      console.error('  - Error stack:', err?.stack);
      
      // Show error at the same position
      console.log('\n🔄 CREATING ERROR SNAP:');
      const errorSnap: SnapResult = {
        url: newUrl,
        ok: false,
        error: err?.message || 'Capture failed',
        ts: Date.now(),
      };
      console.log('  - Error snap:', errorSnap);
      
      const errorSnaps = [...this.snapsSubject.value];
      console.log('  - Current snaps count:', errorSnaps.length);
      
      const loadingIndex = errorSnaps.findIndex(s => s === loadingSnap);
      console.log('  - Loading placeholder index:', loadingIndex);
      
      if (loadingIndex !== -1) {
        console.log('  - Replacing loading placeholder with error snap at index:', loadingIndex);
        errorSnaps[loadingIndex] = errorSnap;
      } else {
        console.warn('  ⚠️ Loading placeholder not found, error snap not inserted');
      }
      
      this.snapsSubject.next(errorSnaps);
      console.log('  ✅ snapsSubject updated with error snap');
      
      this.qa.saveSnaps(runId, errorSnaps);
      console.log('  ✅ Error snaps saved to storage');
      
      this.snapping.set(key, false);
      console.log('  ✅ Snapping flag cleared');
      
      // ✅ Keep edit mode open even on error
      console.log('\n🔄 UPDATING EDIT MODE STATE (ERROR):');
      console.log('  - Current editingSnapUrl:', this.editingSnapUrl);
      
      if (this.editingSnapUrl) {
        console.log('  - Edit mode is active, updating to error URL:', newUrl);
        this.editingSnapUrl = newUrl;
        console.log('  ✅ editingSnapUrl updated to:', this.editingSnapUrl);
      } else {
        console.log('  ⏭️ Edit mode not active, no update needed');
      }
      
      this.cdr.markForCheck();
      console.log('  ✅ Change detection marked');
      
      console.log('\n=== ❌ captureAndReplace ERROR HANDLED ===\n');
    },
  });
  
  console.log('🌐 API call initiated (async)');
  console.log('=== ⏳ captureAndReplace WAITING FOR API ===\n');
}
}