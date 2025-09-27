import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, firstValueFrom, map, shareReplay } from 'rxjs';
import { FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  QaService,
  ChatTurn,
  ChatThread,
  GoldenEdit,
  ChatAssistantJson,
  ChatIntent,
  SnapResult, // for finalize/snapshots
} from '../../services/qa.service';
import { HtmlPreviewComponent } from '../../components/html-preview/html-preview.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

type AssistantPayload = {
  assistantText: string;
  json: ChatAssistantJson;
};

@Component({
  selector: 'app-use-variant-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HtmlPreviewComponent,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  templateUrl: './use-variant-page.component.html',
  styleUrls: ['./use-variant-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UseVariantPageComponent {
  private ar = inject(ActivatedRoute);
  private qa = inject(QaService);

  readonly templateId$ = this.ar.paramMap.pipe(map(p => p.get('id')!), shareReplay(1));
  readonly runId$      = this.ar.paramMap.pipe(map(p => p.get('runId')!), shareReplay(1));
  readonly no$         = this.ar.paramMap.pipe(map(p => Number(p.get('no')!)), shareReplay(1));

  // current HTML used for the LEFT preview and chat operations
  private htmlSubject = new BehaviorSubject<string>('');
  readonly html$ = this.htmlSubject.asObservable();

  // chat state
  private messagesSubject = new BehaviorSubject<ChatTurn[]>([]);
  readonly messages$ = this.messagesSubject.asObservable();

  input = new FormControl<string>('', { nonNullable: true });
  loadingVariant = true;
  sending = false;

  // Only the clicked message shows spinner
  applyingIndex: number | null = null;

  // Per-message manual edit forms (kept hidden by default / optional)
  private editForms = new Map<number, FormGroup>();

  // ---------------- Finalize / Screenshots state (non-disruptive) ----------------
  private snapsSubject = new BehaviorSubject<SnapResult[]>([]);
  readonly snaps$ = this.snapsSubject.asObservable();

  // track per-URL loading states so UI can show per-card spinners when you wire it up
  private snapping = new Map<string, boolean>();
  get isFinalizing() { return this._isFinalizing; }
  private _isFinalizing = false;

  constructor() {
    // Load variant and chat thread (rehydrate)
    this.runId$.subscribe(async (runId) => {
      const templateId = this.ar.snapshot.paramMap.get('id')!;
      const no = Number(this.ar.snapshot.paramMap.get('no')!);

      // 1) Chat cache (has currentHtml + thread)
      const cachedThread = this.qa.getChatCached(runId, no);
      if (cachedThread?.html) {
        this.htmlSubject.next(cachedThread.html);
        this.messagesSubject.next(cachedThread.messages || []);
        this.loadingVariant = false;

        // also rehydrate snaps cache (so finalize section shows persisted items)
        this.snapsSubject.next(this.qa.getSnapsCached(templateId, no, runId));
        return;
      }

      // 2) Variants run cache (localStorage)
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

        // hydrate snaps cache
        this.snapsSubject.next(this.qa.getSnapsCached(templateId, no, runId));

        this.loadingVariant = false;
        return;
      }

      // 3) Fallback → backend (may 404 after server restarts)
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
      } catch {
        const intro: ChatTurn = {
          role: 'assistant',
          text: 'I couldn’t restore this variant from the server. If you go back and reopen it from the Variants list, I’ll pick it up.',
          json: null,
          ts: Date.now(),
        };
        this.messagesSubject.next([intro]);
      } finally {
        // hydrate snaps cache even if thread not found (in case user finalized earlier)
        this.snapsSubject.next(this.qa.getSnapsCached(templateId, no, runId));
        this.loadingVariant = false;
      }
    });
  }

  onSnapUrl(raw: string) {
    const url = (raw || '').trim();
    if (!url) return;
    const templateId = this.ar.snapshot.paramMap.get('id')!;
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.captureOne(templateId, no, runId, url);
  }

  trackBySnap = (_: number, s: SnapResult) => (s.finalUrl || s.url || String(s.ts));

  async onSend() {
    const message = (this.input.value || '').trim();
    if (!message || this.sending) return;
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

      this.input.setValue('');
    } catch (e) {
      console.error('chat send error', e);
    } finally {
      this.sending = false;
    }
  }

  /** Apply ALL edits in a given assistant message (uses each edit's current `replace`). */
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

      // Clear edits from this message after apply-all (they've been processed)
      this.updateMessageEdits(turnIndex, []);

      const noteText = numChanges > 0
        ? `Applied ${numChanges} change(s).`
        : `No matching text found.`;

      const appliedNote: ChatTurn = { role: 'assistant', text: noteText, json: null, ts: Date.now() };
      const msgs = [...this.messagesSubject.value, appliedNote];
      this.messagesSubject.next(msgs);
      this.persistThread(runId, no, newHtml, msgs);
    } catch (e) {
      console.error('apply edits error', e);
    } finally {
      this.applyingIndex = null;
    }
  }

  onFinalize() {
    // Scroll to the section
    const el = document.getElementById('finalize');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Kick off screenshot captures (idempotent; safe to call again)
    const templateId = this.ar.snapshot.paramMap.get('id')!;
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    if (!runId || this._isFinalizing) {
      // still ensure cache is visible
      this.snapsSubject.next(this.qa.getSnapsCached(templateId, no, runId));
      return;
    }

    this._isFinalizing = true;

    // 1) seed from cache so UI can show previous results immediately
    const cached = this.qa.getSnapsCached(templateId, no, runId);
    this.snapsSubject.next(cached || []);

    // 2) extract unique https? links from current HTML
    const html = this.htmlSubject.value || '';
    const urls = this.extractHttpLinks(html);

    // 3) fire each capture independently; each result updates the list immediately
    urls.forEach((u) => this.captureOne(templateId, no, runId, u));
  }

  /** Optionally call this to re-test a single URL (e.g., if user edits/pastes a new link). */
  onRetestUrl(url: string) {
    const templateId = this.ar.snapshot.paramMap.get('id')!;
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    if (!runId || !url) return;
    this.captureOne(templateId, no, runId, url);
  }

  /** Quick query to know if a specific URL is loading (for per-card spinners if you add them). */
  isSnapping(url: string): boolean {
    return !!this.snapping.get(url.toLowerCase());
  }

  /** Apply a SINGLE edit with an optional user-edited replacement from the input field. */
  async onApplySingle(turnIndex: number, edit: GoldenEdit, replacement: string) {
    if (this.applyingIndex !== null) return;
    this.applyingIndex = turnIndex;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    // keep contexts but override the replace text from the input box
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

      // If matched, remove the applied edit from the list in that message
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

  /** Skip (remove) a single proposed edit from a message without applying. */
  onSkipSingle(turnIndex: number, editIndex: number) {
    const turn = this.messagesSubject.value[turnIndex];
    const edits = (turn?.json?.edits || []).slice();
    if (!edits.length) return;

    edits.splice(editIndex, 1);
    this.updateMessageEdits(turnIndex, edits);
    // optional: persist immediately
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.persistThread(runId, no, this.htmlSubject.value, this.messagesSubject.value);
  }

  /** Clear all proposed edits from a specific assistant message. */
  onClearEdits(turnIndex: number) {
    this.updateMessageEdits(turnIndex, []);
    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    this.persistThread(runId, no, this.htmlSubject.value, this.messagesSubject.value);
  }

  // Manual patch (explicit find/before/after/replace) — optional/hidden
  getEditForm(i: number, _m: ChatTurn): FormGroup {
    let fg = this.editForms.get(i);
    if (!fg) {
      fg = new FormGroup({
        before:  new FormControl<string>('', []),
        find:    new FormControl<string>('', [Validators.required, Validators.minLength(1)]),
        after:   new FormControl<string>('', []),
        replace: new FormControl<string>('', [Validators.required, Validators.minLength(1)]),
        reason:  new FormControl<string>('Manual patch', []),
      });
      this.editForms.set(i, fg);
    }
    return fg;
  }

  async onApplyManual(i: number) {
    if (this.applyingIndex !== null) return;
    this.applyingIndex = i;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);
    const fg = this.getEditForm(i, this.messagesSubject.value[i]);

    if (fg.invalid) { fg.markAllAsTouched(); this.applyingIndex = null; return; }

    const edit: GoldenEdit = {
      before_context: fg.value.before || '',
      find: fg.value.find!,
      after_context: fg.value.after || '',
      replace: fg.value.replace!,
      reason: fg.value.reason || 'Manual patch',
    };

    try {
      const currentHtml = this.htmlSubject.value;

      const resp = await firstValueFrom(this.qa.applyChatEdits(runId, currentHtml, [edit]));
      const newHtml = resp?.html || currentHtml;
      const numChanges = Array.isArray((resp as any)?.changes) ? (resp as any).changes.length : 0;

      this.htmlSubject.next(newHtml);

      const noteText = numChanges > 0
        ? `Applied manual patch: "${edit.find}" → "${edit.replace}".`
        : `Manual patch matched 0 places. Try a smaller word/phrase and add a bit of surrounding context.`;

      const appliedNote: ChatTurn = { role: 'assistant', text: noteText, json: null, ts: Date.now() };
      const msgs = [...this.messagesSubject.value, appliedNote];
      this.messagesSubject.next(msgs);
      this.persistThread(runId, no, newHtml, msgs);
    } catch (e) {
      console.error('manual apply error', e);
    } finally {
      this.applyingIndex = null;
    }
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

  // Stable key so adding messages doesn’t shuffle indices
  trackByMsg = (_: number, m: ChatTurn) => m.ts;

  // ----------------------------- helpers: finalize -----------------------------
  private extractHttpLinks(html: string): string[] {
    const out: string[] = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = (a.getAttribute('href') || '').trim();
        if (!href) continue;
        // only http(s) links; skip mailto:, tel:, anchors, etc.
        if (/^https?:\/\//i.test(href)) {
          out.push(href);
        }
      }
    } catch {
      // fallback: very simple regex scan if DOMParser fails
      const rx = /href\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
      let m: RegExpExecArray | null;
      while ((m = rx.exec(html))) out.push(m[1]);
    }
    // dedupe while preserving order
    const seen = new Set<string>();
    return out.filter(u => (seen.has(u.toLowerCase()) ? false : (seen.add(u.toLowerCase()), true)));
  }

  private captureOne(templateId: string, no: number, runId: string, url: string) {
    const key = url.toLowerCase();
    if (this.snapping.get(key)) return; // already in progress
    this.snapping.set(key, true);

    this.qa.snapUrl(templateId, no, runId, url).subscribe({
      next: ({ snap, snaps }) => {
        // snaps already persisted in service; reflect latest list to UI
        this.snapsSubject.next(snaps);
        this.snapping.set(key, false);
      },
      error: (err) => {
        console.error('snapshot error', err);
        // push a synthetic error entry so UI can reflect failure
        const errorSnap: SnapResult = {
          url,
          ok: false,
          error: (err?.message || 'Capture failed'),
          ts: Date.now(),
        };
        const list = [errorSnap, ...this.snapsSubject.value];
        this.snapsSubject.next(list);

        // persist error list scoped to template+variant+run
        this.qa.saveSnaps(templateId, no, runId, list);
        this.snapping.set(key, false);
      },
    });
  }
}
