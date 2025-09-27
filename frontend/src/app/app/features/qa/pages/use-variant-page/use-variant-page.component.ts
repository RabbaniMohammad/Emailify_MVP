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

  // Per-message manual edit forms (shown only if you reveal in the template)
  private editForms = new Map<number, FormGroup>();

  constructor() {
    // Load variant and chat thread (rehydrate)
    this.runId$.subscribe(async (runId) => {
      const no = Number(this.ar.snapshot.paramMap.get('no')!);

      // 1) Chat cache (has currentHtml + thread)
      const cachedThread = this.qa.getChatCached(runId, no);
      if (cachedThread?.html) {
        this.htmlSubject.next(cachedThread.html);
        this.messagesSubject.next(cachedThread.messages || []);
        this.loadingVariant = false;
        return;
      }

      // 2) Variants run cache (localStorage)
      const run = this.qa.getVariantsRunById(runId);
      const item = run?.items?.find(it => it.no === no) || null;
      if (item?.html) {
        this.htmlSubject.next(item.html);

        const intro: ChatTurn = {
          role: 'assistant',
          text: 'Hi! I can suggest ideas or make targeted changes. Ask about any line. If you want edits but auto-apply misses, use the Manual patch below.',
          json: null,
          ts: Date.now(),
        };
        const thread: ChatThread = { html: item.html, messages: [intro] };
        this.messagesSubject.next(thread.messages);
        this.qa.saveChat(runId, no, thread);

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
          text: 'Hi! I can suggest ideas or make targeted changes. Ask about any line. If you want edits but auto-apply misses, use the Manual patch below.',
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
        this.loadingVariant = false;
      }
    });
  }

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

  async onApplyEdits(turnIndex: number) {
    if (this.applyingIndex !== null) return;
    this.applyingIndex = turnIndex;

    const runId = this.ar.snapshot.paramMap.get('runId')!;
    const no = Number(this.ar.snapshot.paramMap.get('no')!);

    const turn = this.messagesSubject.value[turnIndex];
    const edits = turn?.json?.edits || [];
    if (!edits.length) { this.applyingIndex = null; return; }

    try {
      const currentHtml = this.htmlSubject.value;

      // ✅ correct signature: (runId, html, edits)
      const resp = await firstValueFrom(this.qa.applyChatEdits(runId, currentHtml, edits));
      const newHtml = resp?.html || currentHtml;
      const numChanges = Array.isArray((resp as any)?.changes) ? (resp as any).changes.length : 0;

      this.htmlSubject.next(newHtml);

      const noteText = numChanges > 0
        ? `Applied ${edits.length} edit(s) (${numChanges} change(s) matched).`
        : `No matching text found. If you want, open the Manual patch and enter the smallest exact “find” plus surrounding text.`;

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

  // Manual patch (explicit find/before/after/replace) — kept but blank by default
  getEditForm(i: number, _m: ChatTurn): FormGroup {
    let fg = this.editForms.get(i);
    if (!fg) {
      // ⬇️ BLANK defaults; customers won’t see anything prefilled
      fg = new FormGroup({
        before:  new FormControl<string>('', []), // not required: we allow apply without showing these to customers
        find:    new FormControl<string>('', [Validators.required, Validators.minLength(1)]),
        after:   new FormControl<string>('', []), // not required
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

      // ✅ correct signature: (runId, html, edits)
      const resp = await firstValueFrom(this.qa.applyChatEdits(runId, currentHtml, [edit]));
      const newHtml = resp?.html || currentHtml;
      const numChanges = Array.isArray((resp as any)?.changes) ? (resp as any).changes.length : 0;

      this.htmlSubject.next(newHtml);

      const noteText = numChanges > 0
        ? `Applied manual patch: "${edit.find}" → "${edit.replace}".`
        : `Manual patch matched 0 places. Try a smaller “find” (word/short phrase) and add 10–40 chars of context from the original.`;

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
}
