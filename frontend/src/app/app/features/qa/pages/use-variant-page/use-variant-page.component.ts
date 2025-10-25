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

// import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, AfterViewInit, OnInit, OnDestroy, HostListener  } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { ActivatedRoute, Router  } from '@angular/router';





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
    FormsModule
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

  // ✅ NEW: Subject line generation
  private subjectsSubject = new BehaviorSubject<string[] | null>(null);
  readonly subjects$ = this.subjectsSubject.asObservable();
  subjectsLoading = false;
  private subjectsTimeoutId?: number;
  private subjectsAborted = false;
  private subjectsSub?: Subscription;
  private readonly SUBJECTS_TIMEOUT = 60000; // 60 seconds
  currentSubject: string = ''; // Store current subject input value

  input = new FormControl<string>('', { nonNullable: true });
  loadingVariant = true;
  sending = false;

  applyingIndex: number | null = null;

  editInputValue: string = '';

  // Add these AFTER the existing subjects (around line 94)
  private templateModalOpenSubject!: BehaviorSubject<boolean>;
  readonly templateModalOpen$!: Observable<boolean>;
  private templateModalKey = '';

  get isTemplateModalOpen(): boolean { 
    return this.templateModalOpenSubject.value; 
  }

  private snapsSubject = new BehaviorSubject<SnapResult[]>([]);
  readonly snaps$ = this.snapsSubject.asObservable();

  private snapping = new Map<string, boolean>();
  
  private finalizingSubject = new BehaviorSubject<boolean>(false);
  readonly finalizing$ = this.finalizingSubject.asObservable();

  // Template grammar check state
  private grammarCheckLoadingSubject = new BehaviorSubject<boolean>(false);
  readonly grammarCheckLoading$ = this.grammarCheckLoadingSubject.asObservable();
  
  private finalizeClickedInSession = false;
  
  // Track which snap is in edit mode
  private editingSnapUrl: string | null = null;
  
  // Track if returning from campaign page
  private returningFromCampaign = false;
  
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
  // private modalOverflowSub?: Subscription;
  
  // Removed constructor preloading - subscription handles all data loading


readonly linkChecks$ = combineLatest([this.validLinks$, this.htmlLinks$]).pipe(
  map(([fileLinks, htmlLinks]) => {
    // ✅ ONLY show validation if file was uploaded (has valid links)
    if (!fileLinks || fileLinks.length === 0) {
      return []; // Return empty array if no file uploaded
    }

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

private grammarCheckResultSubject = new BehaviorSubject<{
  hasErrors: boolean;
  mistakes: Array<{ word: string; suggestion: string; context: string }>;
  count: number;
  message: string;
} | null>(null);
readonly grammarCheckResult$ = this.grammarCheckResultSubject.asObservable();

get isGrammarChecking(): boolean {
  return this.grammarCheckLoadingSubject.value;
}

ngOnInit() {
  console.log('');
  console.log('🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣');
  console.log('🟣 [use-variant] ====== ngOnInit CALLED ======');
  console.log('🟣 [use-variant] Timestamp:', new Date().toISOString());
  console.log('🟣 [use-variant] htmlSubject.value length:', this.htmlSubject.value.length);
  console.log('🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣🟣');
  console.log('');
  
  window.scrollTo(0, 0);
  
  combineLatest([this.runId$, this.no$]).subscribe(([runId, no]) => {
    this.editorStateKey = `editor_state_${runId}_${no}`;
    this.draftMessageKey = `draft_message_${runId}_${no}`;
    this.templateModalKey = `template_modal_${runId}_${no}`;
  });
  
  this.input.valueChanges.subscribe(value => {
    this.saveDraft(value);
  });
}

ngOnDestroy(): void {
  console.log('');
  console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
  console.log('🔴 [use-variant] ====== ngOnDestroy CALLED ======');
  console.log('🔴 [use-variant] Timestamp:', new Date().toISOString());
  console.log('🔴 [use-variant] htmlSubject.value length at destroy:', this.htmlSubject.value.length);
  console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
  console.log('');
  
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
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔵 [use-variant] ====== CONSTRUCTOR CALLED ======');
  console.log('🔵 [use-variant] Timestamp:', new Date().toISOString());
  console.log('🔵 [use-variant] CONSTRUCTOR params:', { runId, no });
  console.log('🔵 [use-variant] htmlSubject initial value length:', this.htmlSubject.value.length);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // ✅ DON'T PRELOAD IN CONSTRUCTOR - Let subscription handle it
  console.log('🔵 [use-variant] CONSTRUCTOR: Skipping preload, letting subscription handle data loading');
  console.log('🔵 [use-variant] CONSTRUCTOR: runId:', runId, 'no:', no);

  if (runId && no) {
    // ✅ INITIALIZE TEMPLATE MODAL STATE FIRST
    this.templateModalKey = `template_modal_${runId}_${no}`;
    
    // ✅ CHECK: Are we returning from campaign page?
    const returnFromCampaignKey = `return_to_modal_${runId}_${no}`;
    this.returningFromCampaign = sessionStorage.getItem(returnFromCampaignKey) === 'true';
    
    // ✅ CLEAR THE FLAG IMMEDIATELY (before any other logic uses it)
    if (this.returningFromCampaign) {
      sessionStorage.removeItem(returnFromCampaignKey);
      console.log('🔄 [use-variant] Detected return from campaign - flag saved to instance variable');
    }
    
    const wasModalOpen = this.restoreTemplateModalState();
    this.templateModalOpenSubject = new BehaviorSubject<boolean>(wasModalOpen);
    
    // ✅ IMMEDIATELY HIDE NAVBAR IF MODAL WAS OPEN (before Angular renders)
    if (wasModalOpen || this.returningFromCampaign) {
      document.body.classList.add('modal-open');
      document.body.style.overflow = 'hidden';
      console.log('🔄 [use-variant] Modal should be open - hiding navbar immediately');
    }
    
    this.editorStateKey = `editor_state_${runId}_${no}`;
    this.draftMessageKey = `draft_message_${runId}_${no}`;
    
    const wasEditorOpen = this.restoreEditorState();
    this.editorOpenSubject = new BehaviorSubject<boolean>(wasEditorOpen);
    
    // ✅ AUTO-RECOVERY: Only if modal was open AND NOT returning from campaign
    if (wasModalOpen && !this.returningFromCampaign) {
      const cachedResult = this.qa.getGrammarCheckCached(runId, Number(no));
      
      if (cachedResult) {
        console.log('🔄 [use-variant] Page refresh detected - restoring cached results without API call');
        // Restore cached results without making API call
        this.grammarCheckResultSubject.next(cachedResult);
        this.grammarCheckLoadingSubject.next(false);
      } else {
        console.log('🔄 [use-variant] Page refresh detected but NO cached results - will restart validation');
        // Delay to ensure component is fully initialized
        setTimeout(() => {
          this.autoRestartValidationAfterRefresh();
        }, 500);
      }
    }
    
    // ✅ CAMPAIGN RETURN: Load cached results immediately in constructor
    if (this.returningFromCampaign) {
      const cachedResult = this.qa.getGrammarCheckCached(runId, Number(no));
      if (cachedResult) {
        console.log('🔄 [use-variant] Campaign return - loading cached results in constructor');
        this.grammarCheckResultSubject.next(cachedResult);
        this.grammarCheckLoadingSubject.next(false);
      }
    }
    
    const savedDraft = this.restoreDraft();
    if (savedDraft) {
      this.input.setValue(savedDraft);
    }
  } else {
    this.templateModalOpenSubject = new BehaviorSubject<boolean>(false);
    this.editorOpenSubject = new BehaviorSubject<boolean>(false);
  }

  // ✅ CREATE OBSERVABLES
  this.templateModalOpen$ = this.templateModalOpenSubject.asObservable();
  this.editorOpen$ = this.editorOpenSubject.asObservable();

  // Timeout safety
  this.loadingTimeout = window.setTimeout(() => {
    if (this.loadingVariant) {
      this.loadingVariant = false;
      this.cdr.markForCheck();
    }
  }, 10000);

  // Subscribe to runId changes
  this.runId$.subscribe(async (runId) => {
    console.log('� [use-variant] ====== SUBSCRIPTION TRIGGERED ======');
    console.log('🟢 [use-variant] SUBSCRIPTION runId:', runId);
    console.log('🟢 [use-variant] SUBSCRIPTION htmlSubject.value length BEFORE:', this.htmlSubject.value.length);
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
    console.log('🟢 [use-variant] variantNo:', no);
    console.log('🟢 [use-variant] htmlSubject current length:', this.htmlSubject.value.length);
    console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');

    // ✅ PRIORITY 0: Check for return from visual editor FIRST (before anything else!)
    const returnKey = `visual_editor_return_use_variant`;
    const returnFlag = sessionStorage.getItem(returnKey);

    if (returnFlag === 'true') {
      const editedKey = `visual_editor_edited_html`;
      const editedHtml = sessionStorage.getItem(editedKey);
      
      if (editedHtml) {
        console.log('✅ [RETURN FROM EDITOR] Edited HTML received, length:', editedHtml.length);
        
        // Update HTML
        this.htmlSubject.next(editedHtml);
        
        // ✅ CRITICAL: Restore cached data BEFORE updating thread
        const cachedThread = this.qa.getChatCached(runId, no);
        const messages = cachedThread?.messages || this.messagesSubject.value;
        
        console.log('✅ [RETURN FROM EDITOR] Messages to preserve:', messages.length);
        
        // Update chat thread with preserved messages
        const thread: ChatThread = { html: editedHtml, messages };
        this.qa.saveChat(runId, no, thread);
        
        console.log('✅ [RETURN FROM EDITOR] Saved edited HTML to localStorage cache');
        
        // ✅ VERIFY save worked
        const verifyThread = this.qa.getChatCached(runId, no);
        if (verifyThread?.html === editedHtml) {
          console.log('✅ [RETURN FROM EDITOR] VERIFIED: Edited HTML successfully saved to cache');
        } else {
          console.error('❌ [RETURN FROM EDITOR] FAILED: Cache verification failed!');
        }
        
        // ✅ Restore messages to UI
        if (messages.length > 0) {
          this.messagesSubject.next(messages);
        }
        
        // ✅ CRITICAL: Restore screenshots from cache
        this.snapsSubject.next(await this.qa.getSnapsCached(runId));
        
        // ✅ Restore grammar check results
        const cachedGrammar = this.qa.getGrammarCheckCached(runId, no);
        if (cachedGrammar) {
          this.grammarCheckResultSubject.next(cachedGrammar);
        } else {
          // Clear grammar check (force re-check with new HTML)
          this.grammarCheckResultSubject.next(null);
          this.qa.clearGrammarCheck(runId, no);
        }
        
        // ✅ Restore other cached data
        this.validLinksSubject.next(this.qa.getValidLinks(runId));
        
        const cachedSubjects = this.qa.getSubjectsCached(runId);
        if (cachedSubjects?.length) {
          this.subjectsSubject.next(cachedSubjects);
          this.subjectsLoading = false;
        }
        
        // ✅ CLOSE template modal
        this.templateModalOpenSubject.next(false);
        this.saveTemplateModalState(false);
        document.body.style.overflow = 'auto';
        
        // Cleanup
        sessionStorage.removeItem(returnKey);
        sessionStorage.removeItem(editedKey);
        
        // Stop loading
        this.loadingVariant = false;
        if (this.loadingTimeout) {
          clearTimeout(this.loadingTimeout);
          this.loadingTimeout = undefined;
        }
        
        this.cdr.detectChanges(); // ✅ FORCE update
        
        // ✅ CRITICAL: Return early - don't run priority checks
        return;
      }
    }

    // ✅ PRIORITY 0.5: Check sessionStorage for synthetic runs (skip/bypass original & golden templates)
    const syntheticKey = `synthetic_run_${runId}`;
    const syntheticRaw = sessionStorage.getItem(syntheticKey);
    
    if (syntheticRaw) {
      try {
        console.log('⚡ [use-variant] PRIORITY 0.5: Found synthetic run in sessionStorage for runId:', runId);
        const syntheticRun = JSON.parse(syntheticRaw);
        const item = syntheticRun.items?.find((it: any) => it.no === no);
        
        if (item?.html) {
          console.log('✅ [use-variant] Loading synthetic run, HTML length:', item.html.length);
          
          // ✅ CRITICAL: Check if already saved to localStorage (with edited HTML!)
          const cachedThread = this.qa.getChatCached(runId, no);
          let htmlToUse = item.html; // Default to synthetic run HTML
          
          if (!cachedThread?.html) {
            // First time loading synthetic run - create intro message
            const intro: ChatTurn = {
              role: 'assistant',
              text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n• Please use editor if replacement didn't happen\n\nWhat would you like to improve?",
              json: null,
              ts: Date.now(),
            };
            const thread: ChatThread = { html: item.html, messages: [intro] };
            this.messagesSubject.next(thread.messages);
            this.qa.saveChat(runId, no, thread);
            console.log('✅ [use-variant] First time - using synthetic run HTML');
          } else {
            // ✅ Already cached - USE CACHED HTML (which may be edited!)
            htmlToUse = cachedThread.html;
            this.messagesSubject.next(cachedThread.messages || []);
            console.log('✅ [use-variant] Cache exists - using cached HTML, length:', htmlToUse.length);
          }
          
          // ✅ Use the correct HTML (cached if available, synthetic if not)
          this.htmlSubject.next(htmlToUse);
          this.snapsSubject.next(await this.qa.getSnapsCached(runId));
          this.validLinksSubject.next(this.qa.getValidLinks(runId));
          
          // ✅ RESTORE cached data
          const cachedSubjects = this.qa.getSubjectsCached(runId);
          if (cachedSubjects?.length) {
            this.subjectsSubject.next(cachedSubjects);
            this.subjectsLoading = false;
          }
          
          const cachedGrammar = this.qa.getGrammarCheckCached(runId, no);
          if (cachedGrammar) {
            this.grammarCheckResultSubject.next(cachedGrammar);
          }
          
          this.loadingVariant = false;
          if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = undefined;
          }
          
          console.log('✅ [use-variant] Synthetic run loaded successfully');
          this.cdr.detectChanges(); // ✅ FORCE update
          this.positionChatAtBottom();
          return;
        }
      } catch (error) {
        console.error('❌ Error loading synthetic run:', error);
        // Fall through to normal loading
      }
    }

    try {
      // ✅ PRIORITY 1: Check localStorage cache (fastest)
      console.log('⚡ [use-variant] PRIORITY 1: Checking localStorage for runId:', runId, 'no:', no);
      const cachedThread = this.qa.getChatCached(runId, no);
      if (cachedThread?.html) {
        console.log('✅ [use-variant] PRIORITY 1: Found in localStorage, loading template');
        this.htmlSubject.next(cachedThread.html);
        this.messagesSubject.next(cachedThread.messages || []);
        this.snapsSubject.next(await this.qa.getSnapsCached(runId));
        this.validLinksSubject.next(this.qa.getValidLinks(runId));
        
        // ✅ RESTORE GRAMMAR CHECK RESULTS
        const cachedGrammar = this.qa.getGrammarCheckCached(runId, no);
        if (cachedGrammar) {
          this.grammarCheckResultSubject.next(cachedGrammar);
        }
        
        // ✅ RESTORE SUBJECT GENERATION RESULTS
        const cachedSubjects = this.qa.getSubjectsCached(runId);
        if (cachedSubjects?.length) {
          this.subjectsSubject.next(cachedSubjects);
          this.subjectsLoading = false;
        }

        this.loadingVariant = false;
        if (this.loadingTimeout) {
          clearTimeout(this.loadingTimeout);
          this.loadingTimeout = undefined;
        }
        console.log('🎯 [use-variant] localStorage restore complete. HTML in subject:', this.htmlSubject.value?.length || 0, 'chars');
        this.cdr.markForCheck();
        this.positionChatAtBottom();
        return;
      }

      // ✅ PRIORITY 2: Check memory cache (variants run)
      const run = await this.qa.getVariantsRunById(runId);
      const item = run?.items?.find(it => it.no === no) || null;
      if (item?.html) {
        this.htmlSubject.next(item.html);

        const intro: ChatTurn = {
          role: 'assistant',
          text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n•Please use editor is replacement won't happen\n\nWhat would you like to improve?",
          json: null,
          ts: Date.now(),
        };
        const thread: ChatThread = { html: item.html, messages: [intro] };
        this.messagesSubject.next(thread.messages);
        
        // ✅ SAVE TO localStorage
        this.qa.saveChat(runId, no, thread);
        
        this.snapsSubject.next(await this.qa.getSnapsCached(runId));
        this.validLinksSubject.next(this.qa.getValidLinks(runId));

        // ✅ RESTORE SUBJECT GENERATION RESULTS
        const cachedSubjects = this.qa.getSubjectsCached(runId);
        if (cachedSubjects?.length) {
          this.subjectsSubject.next(cachedSubjects);
          this.subjectsLoading = false;
        }
        
        // ✅ RESTORE GRAMMAR CHECK RESULTS
        const cachedGrammar = this.qa.getGrammarCheckCached(runId, no);
        if (cachedGrammar) {
          this.grammarCheckResultSubject.next(cachedGrammar);
        }
        
        this.loadingVariant = false;
        if (this.loadingTimeout) {
          clearTimeout(this.loadingTimeout);
          this.loadingTimeout = undefined;
        }
        this.cdr.markForCheck();
        this.positionChatAtBottom();
        return;
      }

      // ✅ PRIORITY 3: Fallback to API
      try {
        const status = await firstValueFrom(this.qa.getVariantsStatus(runId));
        const fromApi = status.items.find(it => it.no === no) || null;
        const html = fromApi?.html || '';
        this.htmlSubject.next(html);

        const intro: ChatTurn = {
          role: 'assistant',
          text: "Hi! I'm here to help refine your email template. Here's what I can do:\n\n• Design Ideas – Ask for layout, color, or content suggestions\n\n• SEO Tips – Get recommendations for better deliverability and engagement\n\n• Targeted Replacements – Request specific text changes (e.g., \"Replace 'technology' with 'innovation'\")\n\n• Please use editor is replacement didn't happen\n\nWhat would you like to improve?",
          json: null,
          ts: Date.now(),
        };
        const thread: ChatThread = { html, messages: [intro] };
        this.messagesSubject.next(thread.messages);
        
        // ✅ SAVE TO localStorage
        this.qa.saveChat(runId, no, thread);
        
        this.snapsSubject.next(await this.qa.getSnapsCached(runId));
        this.validLinksSubject.next(this.qa.getValidLinks(runId));
      } catch (apiError) {
        console.error('❌ Failed to load from API:', apiError);
        const intro: ChatTurn = {
          role: 'assistant',
          text: "I couldn't restore this variant from the server. If you go back and reopen it from the Variants list, I'll pick it up.",
          json: null,
          ts: Date.now(),
        };
        this.messagesSubject.next([intro]);
        this.snapsSubject.next([]);
        this.validLinksSubject.next([]);
      }

    } catch (error) {
      console.error('❌ Error during component initialization:', error);
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
    
    // ✅ Handle modal overflow states
    if (this.templateModalOpenSubject.value) {
      document.body.style.overflow = 'hidden';
    }
  });
}


// ============================================
// NAVIGATION & REFRESH GUARDS
// ============================================

/**
 * Handle page refresh (F5) - Show browser confirmation dialog
 */
@HostListener('window:beforeunload', ['$event'])
handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (this.isFinalizing) {
    const message = '⚠️ Screenshot capture is in progress and will be lost if you leave.';
    event.preventDefault();
    event.returnValue = message;
    return;
  }
}

/**
 * Handle navigation away - Show custom confirmation
 */
canDeactivate(): boolean {
  if (!this.isFinalizing) {
    return true;
  }

  const confirmed = confirm(
    '⚠️ Screenshot capture is in progress and will be lost if you leave.\n\nAre you sure you want to leave? All progress will be lost.'
  );

  if (confirmed) {
    // Clean up if user confirms
    this.finalizingSubject.next(false);
  }

  return confirmed;
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

  // ============================================
// TEMPLATE MODAL METHODS
// ============================================

openTemplateModal(): void {
  if (this.isFinalizing) return;
  
  // ✅ CHECK: Block if has links but not finalized
  if (!this.canSubmitTemplate()) {
    const message = this.getSubmitBlockMessage();
    alert(message);
    
    // Scroll to finalize section
    const el = document.getElementById('finalize');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  
  // ✅ SMART CHECK: Only reset if no cached results exist
  const runId = this.ar.snapshot.paramMap.get('runId');
  const no = this.ar.snapshot.paramMap.get('no');
  
  let shouldValidate = true;
  
  if (runId && no) {
    const cachedResult = this.qa.getGrammarCheckCached(runId, Number(no));
    if (cachedResult) {
      console.log('✅ [modal] Found cached grammar results - using cache instead of API call');
      // Restore cached results without making API call
      this.grammarCheckResultSubject.next(cachedResult);
      this.grammarCheckLoadingSubject.next(false);
      shouldValidate = false;
    } else {
      console.log('✅ [modal] No cached results - will validate from scratch');
      this.grammarCheckLoadingSubject.next(false);
      this.grammarCheckResultSubject.next(null);
    }
  }
  
  this.templateModalOpenSubject.next(true);
  this.saveTemplateModalState(true);
  document.body.style.overflow = 'hidden';
  
  // ✅ HIDE TOOLBAR WHEN MODAL IS OPEN
  document.body.classList.add('modal-open');
  console.log('✅ [modal] Added modal-open class to body, toolbar should be hidden');
  console.log('✅ [modal] Body classes:', document.body.className);
  
  // ✅ ONLY AUTO-TRIGGER VALIDATION IF NO CACHED RESULTS
  if (shouldValidate) {
    setTimeout(() => {
      this.checkTemplateGrammar();
    }, 300);
  }
  
  this.cdr.markForCheck();
}

closeTemplateModal(): void {
  // ✅ CLEAR GRAMMAR CHECK STATE AND STORAGE
  const runId = this.ar.snapshot.paramMap.get('runId');
  const no = this.ar.snapshot.paramMap.get('no');
  
  if (runId && no) {
    this.qa.clearGrammarCheck(runId, Number(no));
  }
  
  // Clean up state
  this.grammarCheckLoadingSubject.next(false);
  this.grammarCheckResultSubject.next(null);
  
  this.templateModalOpenSubject.next(false);
  this.saveTemplateModalState(false);
  document.body.style.overflow = 'auto';
  
  // ✅ SHOW TOOLBAR WHEN MODAL IS CLOSED
  document.body.classList.remove('modal-open');
  
  this.cdr.markForCheck();
}

proceedToCampaignSubmit(): void {
  // ✅ SAVE FLAG: Reopen modal when returning from campaign page
  const runId = this.ar.snapshot.paramMap.get('runId');
  const no = this.ar.snapshot.paramMap.get('no');
  
  if (runId && no) {
    sessionStorage.setItem(`return_to_modal_${runId}_${no}`, 'true');
    console.log('✅ [campaign] Set flag to reopen modal on return');
  }
  
  // ✅ CLOSE MODAL WITHOUT CLEARING CACHE (keep results for when user returns)
  this.templateModalOpenSubject.next(false);
  this.saveTemplateModalState(false);
  document.body.style.overflow = 'auto';
  document.body.classList.remove('modal-open');
  console.log('✅ [campaign] Closed modal but KEPT cached results for return');
  
  // Navigate to campaign setup page
  const id = this.ar.snapshot.paramMap.get('id');
  
  if (id && runId && no) {
    this.router.navigate(['/qa', id, 'use', runId, no, 'campaign']);
  }
}

/**
 * Check if we should reopen modal after returning from campaign page
 */
private checkAndReopenModalAfterCampaign(): void {
  // Use instance variable set in constructor
  if (!this.returningFromCampaign) return;
  
  console.log('✅ [campaign return] Reopening modal (data already loaded in constructor)');
  
  // Reopen modal after a short delay to ensure page is ready
  setTimeout(() => {
    // Open modal (data already loaded in constructor!)
    this.templateModalOpenSubject.next(true);
    // Don't call saveTemplateModalState here - let it stay closed in storage
    document.body.style.overflow = 'hidden';
    document.body.classList.add('modal-open');
    console.log('✅ [campaign return] Modal reopened with cached results');
    
    this.cdr.markForCheck();
  }, 300);
}

/**
 * Check if template has any valid links to capture
 */
hasValidLinks(): boolean {
  const html = this.htmlSubject.value;
  if (!html) return false;
  
  const links = this.extractAllLinks(html);
  
  // Filter out invalid/placeholder links
  const validLinks = links.filter(url => {
    const trimmed = url.trim().toLowerCase();
    // Exclude empty, hash, javascript:, mailto:, tel:, and single-char links
    return trimmed && 
           trimmed !== '#' && 
           trimmed !== 'javascript:void(0)' &&
           !trimmed.startsWith('mailto:') &&
           !trimmed.startsWith('tel:') &&
           trimmed.length > 1;
  });
  
  return validLinks.length > 0;
}


/**
 * Check if template can be submitted
 * Returns true if:
 * - Template has no valid links (nothing to finalize)
 * - OR template has been finalized (has snapshots)
 */
canSubmitTemplate(): boolean {
  const snaps = this.snapsSubject.value;
  
  // If no valid links exist, allow submission
  if (!this.hasValidLinks()) {
    return true;
  }
  
  // If has valid links, must be finalized (has snaps)
  return snaps.length > 0;
}

/**
 * Get message for why template can't be submitted
 */
getSubmitBlockMessage(): string {
  if (!this.hasValidLinks()) {
    return '';
  }
  
  const linkCount = this.getValidLinkCount();
  return `Please finalize the template first.\n\n${linkCount} link${linkCount > 1 ? 's' : ''} detected but not yet captured.`;
}

/**
 * Get count of valid extractable links
 */
getValidLinkCount(): number {
  const html = this.htmlSubject.value;
  if (!html) return 0;
  
  const links = this.extractAllLinks(html);
  return links.filter(url => {
    const trimmed = url.trim().toLowerCase();
    return trimmed && 
           trimmed !== '#' && 
           trimmed !== 'javascript:void(0)' &&
           !trimmed.startsWith('mailto:') &&
           !trimmed.startsWith('tel:') &&
           trimmed.length > 1;
  }).length;
}
// ============================================
// CAMPAIGN MODAL METHODS
// ============================================

// ============================================
// GRAMMAR CHECK
// ============================================

async checkTemplateGrammar(): Promise<void> {
  const html = this.htmlSubject.value;
  
  if (!html || !html.trim()) {
    this.grammarCheckResultSubject.next({
      hasErrors: false,
      mistakes: [],
      count: 0,
      message: 'No content to check'
    });
    return;
  }

  // Set loading state
  this.grammarCheckLoadingSubject.next(true);
  this.cdr.markForCheck();

  try {
    const response = await firstValueFrom(
      this.qa.checkTemplateGrammar(html)
    );

    // ✅ CREATE RESULT OBJECT
    const result = {
      hasErrors: response.hasErrors || false,
      mistakes: response.mistakes || [],
      count: response.count || 0,
      message: response.message || 'Check complete'
    };

    // ✅ UPDATE STATE
    this.grammarCheckResultSubject.next(result);

    // ✅ SAVE TO LOCALSTORAGE
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.qa.saveGrammarCheck(runId, no, result);

  } catch (error) {
    console.error('❌ Grammar check failed:', error);
    
    this.grammarCheckResultSubject.next({
      hasErrors: false,
      mistakes: [],
      count: 0,
      message: 'Check failed. Please try again.'
    });
  } finally {
    this.grammarCheckLoadingSubject.next(false);
    this.cdr.markForCheck();
  }
}
// Manual retry method
retryGrammarCheck(): void {
  this.checkTemplateGrammar();
}

/**
 * Auto-restart validation after page refresh if modal was open
 */
private autoRestartValidationAfterRefresh(): void {
  console.log('🔄 [use-variant] Auto-restarting validation after refresh');
  
  // Reset loading state and result
  this.grammarCheckLoadingSubject.next(false);
  this.grammarCheckResultSubject.next(null);
  
  // Ensure modal stays open
  this.templateModalOpenSubject.next(true);
  document.body.style.overflow = 'hidden';
  
  // Trigger fresh validation
  setTimeout(() => {
    this.checkTemplateGrammar();
  }, 300);
  
  this.cdr.markForCheck();
}

/**
 * Browser beforeunload warning to prevent refresh during validation
 */
@HostListener('window:beforeunload', ['$event'])
unloadNotification($event: BeforeUnloadEvent): void {
  // ✅ Warn if grammar check is loading OR modal is open
  if (this.grammarCheckLoadingSubject.value || this.templateModalOpenSubject.value) {
    $event.preventDefault();
    $event.returnValue = 'Validation in progress. Refreshing will lose results. Continue?';
  }
}

private saveTemplateModalState(isOpen: boolean): void {
  try {
    if (this.templateModalKey) {
      sessionStorage.setItem(this.templateModalKey, isOpen.toString());
    }
  } catch (error) {
  }
}

private restoreTemplateModalState(): boolean {
  try {
    if (this.templateModalKey) {
      const saved = sessionStorage.getItem(this.templateModalKey);
      return saved === 'true';
    }
  } catch (error) {
  }
  return false;
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
    }
  }

  private restoreEditorState(): boolean {
    try {
      if (this.editorStateKey) {
        const saved = sessionStorage.getItem(this.editorStateKey);
        return saved === 'true';
      }
    } catch (error) {
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
    }
  }

  private restoreDraft(): string {
    try {
      if (this.draftMessageKey) {
        return sessionStorage.getItem(this.draftMessageKey) || '';
      }
    } catch (error) {
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
        
        // ✅ CHECK: Should we reopen modal after returning from campaign page?
        this.checkAndReopenModalAfterCampaign();
        
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
  const el = document.getElementById('finalize');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const runId = this.ar.snapshot.paramMap.get('runId')!;
  if (!runId) {
    return;
  }

  const isAlreadyFinalizing = this.finalizingSubject.value;
  if (isAlreadyFinalizing) {
    return;
  }

  this.finalizingSubject.next(true);
  this.cdr.markForCheck();

  try {
    // ✅ ALWAYS clear existing snaps when finalizing (start from scratch)
    const existingSnaps = this.snapsSubject.value;
    this.snapsSubject.next([]);
    // Save empty snaps to storage
    this.qa.saveSnaps(runId, []);
    this.cdr.markForCheck();

    const html = this.htmlSubject.value || '';
    const urls = this.extractAllLinks(html);
    if (urls.length === 0) {
      this.finalizingSubject.next(false);
      this.cdr.markForCheck();
      return;
    }

    // ⚡ PERFORMANCE FIX: Process in batches of 2 to prevent CPU overload
    const BATCH_SIZE = 2;
    let fulfilled = 0;
    let rejected = 0;
    
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((url) => this.captureOneWithPromise(runId, url));
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, batchIndex) => {
        const urlIndex = i + batchIndex;
        if (result.status === 'fulfilled') {
          fulfilled++;
        } else {
          rejected++;
          console.error(`  ❌ [${urlIndex + 1}] Failed:`, urls[urlIndex], result.reason);
        }
      });
      
      // Small delay between batches to prevent browser freeze
      if (i + BATCH_SIZE < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.finalizingSubject.next(false);
    this.cdr.markForCheck();
    
  } catch (error) {
    console.error('\n❌ FINALIZE ERROR:');
    console.error('  - Error:', error);
    console.error('  - Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('  - Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    this.finalizingSubject.next(false);
    this.cdr.markForCheck();
    
  }
}

onRetestUrl(snap: SnapResult, newUrl?: string) {
  const url = this.getValidSnapUrl(snap);
  const runId = this.ar.snapshot.paramMap.get('runId')!;
  if (!runId || !url) return;
  
  let targetUrl = newUrl?.trim() || url;
  
  if (newUrl !== undefined) {
    this.editInputValue = newUrl.trim();
    
    // ✅ Store original URL mapping BEFORE retest using SNAP KEY
    if (newUrl.trim()) {
      const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
      
      // Get the TRUE original URL (from map if exists, or current if first time)
      const trueOriginalUrl = this.originalSnapUrls.get(snapKey) || url;  // ✅ Get by snap key!
      
      // ✅ Store mapping: snapKey → originalURL
      this.originalSnapUrls.set(snapKey, trueOriginalUrl);  // ✅ Store by snap key!
    }
  }
  
  if (newUrl !== undefined && !newUrl.trim()) {
    const confirmed = confirm('Input field is empty. It will only test the original link');
    if (!confirmed) return;
    targetUrl = url;
  }
  
  this.captureAndReplace(runId, targetUrl, snap);
}
  // ✅ NEW: Handle Enter key in edit input field
// ✅ NEW: Handle Enter key in edit input field
onEditInputKeyDown(event: KeyboardEvent, snap: SnapResult, inputElement: HTMLInputElement): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    const newUrl = inputElement.value.trim();
    this.onRetestUrl(snap, newUrl || undefined);
  }
}

isSnapping(snap: SnapResult): boolean {
  const key = this.getSnapKey(snap);
  return !!this.snapping.get(key);
}

// Add new helper method
private getSnapKey(snap: SnapResult): string {
  const url = this.getValidSnapUrl(snap).toLowerCase();
  const ts = snap.ts || 0;
  return `${url}_${ts}`;
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

  /**
 * Navigate to Visual Editor with grammar mistakes
 */
navigateToVisualEditorWithGrammar(): void {
  const templateId = this.ar.snapshot.paramMap.get('id');
  const runId = this.ar.snapshot.paramMap.get('runId');
  const no = this.ar.snapshot.paramMap.get('no');
  
  if (!templateId || !runId || !no) {
    alert('Missing required parameters');
    return;
  }
  
  const html = this.htmlSubject.value;
  if (!html) {
    alert('No template HTML found');
    return;
  }
  
  console.log('🔍 [OPEN EDITOR] Template ID:', templateId);
  console.log('🔍 [OPEN EDITOR] Run ID:', runId);
  console.log('🔍 [OPEN EDITOR] Variant No:', no);
  console.log('🔍 [OPEN EDITOR] HTML length:', html.length);
  console.log('🔍 [OPEN EDITOR] HTML preview (first 500 chars):', html.substring(0, 500));
  console.log('🔍 [OPEN EDITOR] HTML source:', this.htmlSubject.value === html ? 'htmlSubject' : 'unknown');
  
  const grammarResult = this.grammarCheckResultSubject.value;
  if (!grammarResult || !grammarResult.hasErrors) {
    alert('No grammar errors to fix');
    return;
  }
  
  console.log('🔍 [OPEN EDITOR] Grammar errors:', grammarResult.mistakes.length);
  
  // ✅ Save template HTML for editing
  const htmlKey = `visual_editor_${templateId}_golden_html`;
  sessionStorage.setItem(htmlKey, html);
  console.log('✅ [OPEN EDITOR] Saved to sessionStorage:', htmlKey);
  
  // ✅ Save snapshot for comparison
  const snapshotKey = `visual_editor_${templateId}_snapshot_html`;
  sessionStorage.setItem(snapshotKey, html);
  
  // ✅ Set editing mode to "use-variant"
  const modeKey = `visual_editor_${templateId}_editing_mode`;
  sessionStorage.setItem(modeKey, 'use-variant');
  
  // ✅ Save use-variant metadata for return
  const metaKey = `visual_editor_${templateId}_use_variant_meta`;
  sessionStorage.setItem(metaKey, JSON.stringify({ runId, no }));
  
  // ✅ Convert grammar mistakes to failed edits format
  const failedEdits = grammarResult.mistakes.map(mistake => ({
    find: mistake.word,
    replace: mistake.suggestion,
    before_context: '',
    after_context: '',
    reason: `Context: ${mistake.context}`,
    status: 'not_found',
    diagnostics: {}
  }));
  
  // ✅ Save as failed edits for widget
  const failedKey = `visual_editor_${templateId}_failed_edits`;
  sessionStorage.setItem(failedKey, JSON.stringify(failedEdits));
  
  // Navigate
  this.router.navigate(['/visual-editor', templateId]);
}

async onValidLinksUpload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input?.files?.[0];
  if (!file) return;

  const runId = this.ar.snapshot.paramMap.get('runId')!;
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
        
        // ✅ Save to storage after upload
        this.qa.saveValidLinks(runId, this.validLinksSubject.value);
        
        input.value = '';
        return;
      }
    } catch (err) {
    }
  }

  const text = await file.text();
  const rows = this.parseCsv(text);
  this.consumeValidLinksRows(rows);
  
  // ✅ Save to storage after upload
  this.qa.saveValidLinks(runId, this.validLinksSubject.value);
  
  input.value = '';
}
  private consumeValidLinksRows(rows: any[][]) {
    if (!rows?.length) {
      this.snackBar.open('No data found in the uploaded file', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['snackbar-error']
      });
      this.validLinksSubject.next([]);
      return;
    }
    const header = (rows[0] || []).map((c: any) => String(c ?? '').trim().toLowerCase());
    const idx = header.findIndex(h => h === 'valid_links');
    if (idx < 0) {
      this.snackBar.open('Missing "valid_links" column. Please ensure your file has a column named "valid_links"', 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
        panelClass: ['snackbar-error']
      });
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
  const deduped = this.dedupe(allLinks);
  
  // ✅ FILTER OUT INVALID/PLACEHOLDER LINKS
  return deduped.filter(url => {
    const trimmed = url.trim().toLowerCase();
    return trimmed && 
           trimmed !== '#' && 
           trimmed !== 'javascript:void(0)' &&
           !trimmed.startsWith('mailto:') &&
           !trimmed.startsWith('tel:') &&
           trimmed.length > 1;
  });
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
// Toggle edit mode for a snap
onEditSnap(snap: SnapResult): void {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  
  if (this.editingSnapUrl === snapKey) {
    this.editingSnapUrl = null;
    this.editInputValue = '';
  } else {
    this.editingSnapUrl = snapKey;  // ✅ Store snap key!
    this.editInputValue = '';
  }
  
  this.cdr.markForCheck();
}

/**
 * Cancel edit mode without making changes
 */
onCancelEdit(snap: SnapResult): void {
  this.editingSnapUrl = null;
  this.editInputValue = '';
  this.cdr.markForCheck();
}

/**
 * Get the valid URL from a snap (ignoring chrome-error URLs)
 */
private getValidSnapUrl(snap: SnapResult): string {
  // If snap failed or finalUrl is chrome-error, use the original requested URL
  if (!snap.ok || (snap.finalUrl && snap.finalUrl.includes('chrome-error'))) {
    return snap.url;
  }
  // Otherwise use finalUrl (redirect result) or url
  return snap.finalUrl || snap.url;
}

 // Check if snap is in edit mode
// Check if snap is in edit mode
isSnapInEditMode(snap: SnapResult): boolean {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  return this.editingSnapUrl === snapKey;  // ✅ Compare snap keys!
}

canReplace(snap: SnapResult): boolean {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  const hasValue = !!this.editInputValue?.trim();
  const hasMapEntry = this.originalSnapUrls.has(snapKey);  // ✅ Check by snap key!
  return hasValue && hasMapEntry;
}


  // ✅ UPDATED: Replace button with confirmation and HTML URL replacement
// ✅ UPDATED: Replace button with confirmation and HTML URL replacement
onReplaceSnap(snap: SnapResult, inputElement: HTMLInputElement): void {
  const newUrl = inputElement.value.trim();
  
  if (!newUrl) {
    const confirmed = confirm('Input field is empty. Do you want to close edit mode without replacing?');
    if (confirmed) {
      this.editingSnapUrl = null;
      this.editInputValue = '';
      inputElement.value = '';
      this.cdr.markForCheck();
    }
    return;
  }
  
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  const currentSnapUrl = this.getValidSnapUrl(snap);
  const originalUrl = this.originalSnapUrls.get(snapKey) || currentSnapUrl;  // ✅ Get by snap key!
  
  try {
    this.replaceUrlInHtml(originalUrl, newUrl, snap);
    this.showSuccess('✓ Replace successful! Link updated in HTML.');
    
    // ✅ Clean up using snap key
    this.originalSnapUrls.delete(snapKey);  // ✅ Delete by snap key!
  } catch (error) {
    alert('Replace failed. Please use the editor for manual changes.');
    return;
  }
  
  this.editingSnapUrl = null;
  this.editInputValue = '';
  inputElement.value = '';
  this.cdr.markForCheck();
}
getOriginalUrl(snap: SnapResult): string {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  const currentSnapUrl = this.getValidSnapUrl(snap);
  const originalUrl = this.originalSnapUrls.get(snapKey);  // ✅ Get by snap key!
  return originalUrl || currentSnapUrl;
}

getLatestTestedUrl(snap: SnapResult): string | null {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  const currentSnapUrl = this.getValidSnapUrl(snap);
  const hasBeenRetested = this.originalSnapUrls.has(snapKey);  // ✅ Check by snap key!
  
  if (hasBeenRetested) {
    return currentSnapUrl;
  }
  
  return null;
}

hasBeenRetested(snap: SnapResult): boolean {
  const snapKey = this.getSnapKey(snap);  // ✅ Use snap key!
  return this.originalSnapUrls.has(snapKey);  // ✅ Check by snap key!
}
  // ✅ NEW: Replace URL in HTML with 1-to-1 mapping for duplicates
private replaceUrlInHtml(oldUrl: string, newUrl: string, snap: SnapResult): void {
  const runId = this.ar.snapshot.paramMap.get('runId')!;
  const no = Number(this.ar.snapshot.paramMap.get('no')!);
  let html = this.htmlSubject.value;
  // Try to find the URL with different protocols
  let fullOldUrl = oldUrl;
  if (!oldUrl.startsWith('http://') && !oldUrl.startsWith('https://')) {
    const httpsCheck = html.includes('https://' + oldUrl);
    const httpCheck = html.includes('http://' + oldUrl);
    if (httpsCheck) {
      fullOldUrl = 'https://' + oldUrl;
    } else if (httpCheck) {
      fullOldUrl = 'http://' + oldUrl;
    } else {
    }
  } else {
  }
  
  // Check if URL exists in HTML
  const urlExistsInHtml = html.includes(fullOldUrl);
  if (!urlExistsInHtml) {
    // Additional debugging - try to find similar URLs
    const urlParts = fullOldUrl.split('//')[1] || fullOldUrl;
    const similarMatches = html.match(new RegExp(urlParts.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  }
  
  // Add protocol to new URL if needed
  let fullNewUrl = newUrl;
  if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
    if (fullOldUrl.startsWith('https://')) {
      fullNewUrl = 'https://' + newUrl;
    } else if (fullOldUrl.startsWith('http://')) {
      fullNewUrl = 'http://' + newUrl;
    } else {
    }
  } else {
  }
  
  // Error if URL not found
  if (!html.includes(fullOldUrl)) {
    console.error('\n❌ CRITICAL ERROR: URL NOT FOUND IN HTML!');
    console.error('  - Searched for:', fullOldUrl);
    console.error('  - HTML length:', html.length);
    alert('URL not found in HTML. The link might have already been changed.');
    throw new Error('URL not found in HTML');
  }
  
  // Find which occurrence this snap represents
  const allSnaps = this.snapsSubject.value;
  const snapIndex = allSnaps.indexOf(snap);
  if (snapIndex === -1) {
  }
  
  // Count how many times this URL appears before this snap
  let occurrenceIndex = 0;
  for (let i = 0; i < snapIndex; i++) {
    const snapUrl = allSnaps[i].finalUrl || allSnaps[i].url;
    const matches = snapUrl.toLowerCase() === oldUrl.toLowerCase();
    if (matches) {
      occurrenceIndex++;
    }
  }
  
  // Count total occurrences in HTML
  const totalOccurrences = (html.match(new RegExp(fullOldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  // Replace only the specific occurrence
  const escapedUrl = fullOldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedUrl, 'g');
  let count = 0;
  const replaced = html.replace(regex, (match) => {
    const isTarget = count === occurrenceIndex;
    if (isTarget) {
      count++;
      return fullNewUrl;
    }
    count++;
    return match;
  });
  
  const htmlChanged = html !== replaced;
  const newUrlInHtml = replaced.includes(fullNewUrl);
  
  if (html === replaced) {
    console.error('\n❌ CRITICAL ERROR: NO REPLACEMENT WAS MADE!');
    console.error('  - New URL:', fullNewUrl);
    console.error('  - Total occurrences found:', totalOccurrences);
    console.error('  - Target occurrence index:', occurrenceIndex);
    alert('Replacement failed. No changes were made to the HTML.');
    throw new Error('No replacement was made');
  }
  
  // Update HTML
  this.htmlSubject.next(replaced);
  // Update the snap in the array
  const updatedSnaps = allSnaps.map(s => {
    if (s === snap) {
      return {
        ...s,
        url: fullNewUrl,
        finalUrl: fullNewUrl
      };
    }
    return s;
  });
  
  this.snapsSubject.next(updatedSnaps);
  // Persist changes
  const thread: ChatThread = {
    html: replaced,
    messages: this.messagesSubject.value
  };
  this.qa.saveChat(runId, no, thread);
  // ✅ SAVE TO IndexedDB (non-blocking)
  this.qa.saveChatThreadToCache(runId, no, thread).catch(err => 
    console.error('Failed to cache to IndexedDB:', err)
  );
  
  this.qa.saveSnaps(runId, updatedSnaps);
  this.cdr.markForCheck();
}
  // ✅ FIXED: Capture and replace with proper edit mode persistence
// ✅ FIXED: Capture and replace with proper edit mode persistence
// ✅ FIXED: Capture and replace with proper edit mode persistence
private captureAndReplace(runId: string, newUrl: string, oldSnap: SnapResult) {
  const snapKey = this.getSnapKey(oldSnap);  // ✅ Use snap key!
  
  if (this.snapping.get(snapKey)) return;
  this.snapping.set(snapKey, true);

  const currentSnaps = [...this.snapsSubject.value];
  const oldIndex = currentSnaps.findIndex(s => s === oldSnap);

  if (oldIndex === -1) {
    this.snapping.set(snapKey, false);
    return;
  }

  const loadingSnap: SnapResult = {
    url: newUrl,
    ts: oldSnap.ts,  // ✅ Preserve timestamp
  } as SnapResult;
  
  currentSnaps[oldIndex] = loadingSnap;
  this.snapsSubject.next(currentSnaps);
  this.cdr.markForCheck();

  this.qa.snapUrl(runId, newUrl).subscribe({
    next: ({ snap, snaps }) => {
      const matchingSnaps = snaps.filter(s => 
        s.url.toLowerCase() === newUrl.toLowerCase() || 
        s.finalUrl?.toLowerCase() === newUrl.toLowerCase()
      );
      
      const newSnap = matchingSnaps.length > 0 
        ? matchingSnaps.reduce((latest, current) => 
            current.ts > latest.ts ? current : latest
          )
        : null;

      if (!newSnap) {
        this.snapping.set(snapKey, false);
        return;
      }

      const updatedSnaps = this.snapsSubject.value.filter(s => s !== loadingSnap);
      updatedSnaps.splice(oldIndex, 0, newSnap);
      this.snapsSubject.next(updatedSnaps);
      this.qa.saveSnaps(runId, updatedSnaps);
      this.snapping.set(snapKey, false);
      
      // ✅ CRITICAL: Transfer map entry from old snap key to new snap key
      const newSnapKey = this.getSnapKey(newSnap);  // ✅ Use snap key!
      
      // ✅ Transfer the mapping to new snap key
      if (this.originalSnapUrls.has(snapKey)) {  // ✅ Check by snap key!
        const originalUrl = this.originalSnapUrls.get(snapKey)!;  // ✅ Get by snap key!
        this.originalSnapUrls.set(newSnapKey, originalUrl);  // ✅ Store by new snap key!
        
        // ✅ Only delete old key if different from new key
        if (snapKey !== newSnapKey) {
          this.originalSnapUrls.delete(snapKey);  // ✅ Delete by snap key!
        }
      }
      
      // ✅ Update editingSnapUrl using SNAP KEYS if in edit mode
      if (this.editingSnapUrl === snapKey) {  // ✅ Compare old snap key
        this.editingSnapUrl = newSnapKey;  // ✅ Update to new snap key
      }
      
      this.cdr.markForCheck();
    },
    error: (err) => {
      const errorSnap: SnapResult = {
        url: newUrl,
        ok: false,
        error: err?.message || 'Capture failed',
        ts: oldSnap.ts,
      };
      
      const errorSnaps = [...this.snapsSubject.value];
      const loadingIndex = errorSnaps.findIndex(s => s === loadingSnap);
      
      if (loadingIndex !== -1) {
        errorSnaps[loadingIndex] = errorSnap;
      }
      
      this.snapsSubject.next(errorSnaps);
      this.qa.saveSnaps(runId, errorSnaps);
      this.snapping.set(snapKey, false);
      
      this.editingSnapUrl = null;
      this.editInputValue = '';
      
      this.cdr.markForCheck();
    },
  });
}
}