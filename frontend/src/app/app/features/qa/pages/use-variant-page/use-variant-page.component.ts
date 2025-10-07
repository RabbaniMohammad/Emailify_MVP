import { Component, ChangeDetectionStrategy, ChangeDetectorRef, inject, AfterViewInit, OnInit, OnDestroy, HostListener  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay, combineLatest, Subscription } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
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
  ],
  templateUrl: './use-variant-page.component.html',
  styleUrls: ['./use-variant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UseVariantPageComponent implements AfterViewInit, OnInit, OnDestroy {
  private ar = inject(ActivatedRoute);
  private qa = inject(QaService);
  private cdr = inject(ChangeDetectorRef);
  private snackBar = inject(MatSnackBar);

  readonly templateId$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));
  readonly runId$      = this.ar.paramMap.pipe(map(p => p.get('runId')!), shareReplay(1));
  readonly no$         = this.ar.paramMap.pipe(map(p => Number(p.get('no')!)), shareReplay(1));

  private htmlSubject = new BehaviorSubject<string>('');
  readonly html$ = this.htmlSubject.asObservable();

  private messagesSubject = new BehaviorSubject<ChatTurn[]>([]);
  readonly messages$ = this.messagesSubject.asObservable();

  private editorOpenSubject = new BehaviorSubject<boolean>(false);
  readonly editorOpen$ = this.editorOpenSubject.asObservable();

  input = new FormControl<string>('', { nonNullable: true });
  loadingVariant = true;
  sending = false;

  applyingIndex: number | null = null;

  private snapsSubject = new BehaviorSubject<SnapResult[]>([]);
  readonly snaps$ = this.snapsSubject.asObservable();

  private snapping = new Map<string, boolean>();
  get isFinalizing() { return this._isFinalizing; }
  private _isFinalizing = false;

  private validLinksSubject = new BehaviorSubject<string[]>([]);
  readonly validLinks$ = this.validLinksSubject.asObservable();

  private htmlLinks$ = this.html$.pipe(map(html => this.extractHttpLinks(html)));

  @ViewChild('chatMessages') private chatMessagesRef!: ElementRef;
  private scrollAnimation: number | null = null;
  private loadingTimeout?: number;

  selectedImage: SnapResult | null = null;
  
  // Editor state persistence
  private editorStateKey = '';
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
    
    // Set up editor state key and restore state
    combineLatest([this.runId$, this.no$]).subscribe(([runId, no]) => {
      this.editorStateKey = `editor_state_${runId}_${no}`;
      
      // Restore editor state if it was open
      const wasEditorOpen = this.restoreEditorState();
      if (wasEditorOpen) {
        this.editorOpenSubject.next(true);
        this.cdr.markForCheck();
      }
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
    this.cdr.markForCheck();
  }

  closeEditor(): void {
    this.editorOpenSubject.next(false);
    this.saveEditorState(false);
    this.cdr.markForCheck();
  }

  // Handle editor close event from child component
  onEditorClose(): void {
    this.closeEditor();
  }

  // Handle save from editor WITHOUT closing
  onEditorSave(newHtml: string): void {
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    // Update HTML
    this.htmlSubject.next(newHtml);

    // Save thread with updated HTML
    const thread: ChatThread = {
      html: newHtml,
      messages: this.messagesSubject.value
    };
    this.qa.saveChat(runId, no, thread);

    // DON'T close editor - keep it open for more edits
    // this.closeEditor(); // ← REMOVED - this was causing the issue
    
    // Show success message
    this.showSuccess('Template updated successfully!');
    
    // Mark for check to update the preview
    this.cdr.markForCheck();
  }

  // Save editor state to sessionStorage
  private saveEditorState(isOpen: boolean): void {
    try {
      if (this.editorStateKey) {
        sessionStorage.setItem(this.editorStateKey, isOpen.toString());
      }
    } catch (error) {
      console.warn('Failed to save editor state:', error);
    }
  }

  // Restore editor state from sessionStorage
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

  // Optional: Toggle editor state
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

  onFinalize() {
    const el = document.getElementById('finalize');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    if (!runId || this._isFinalizing) {
      this.snapsSubject.next(this.qa.getSnapsCached(runId));
      return;
    }

    this._isFinalizing = true;
    const cached = this.qa.getSnapsCached(runId);
    this.snapsSubject.next(cached || []);

    const html = this.htmlSubject.value || '';
    const urls = this.extractHttpLinks(html);
    urls.forEach((u) => this.captureOne(runId, u));
  }

  onRetestUrl(url: string) {
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    if (!runId || !url) return;
    this.captureOne(runId, url);
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
    return this.dedupe(out);
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
      },
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
}