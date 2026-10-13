import type { Question, Turn } from '@shared/assistant';
import type { PipelineToMain } from '@shared/pipeline-protocol';
import { OWNER, type Segment, type SpeakerId } from '@shared/transcript';
import { LlmError, type AnalysisResult, type LlmProvider } from '../llm/provider';
import { buildTurns } from '../transcript/turns';
import { TurnAnalyzer } from './analyzer';
import { needsSummary } from './prefilter';
import { buildAnswerMessage, buildQuestionMessage, buildSummaryMessage } from './prompts';
import { QuestionStore } from './question-store';
import { TriggerMatcher } from './triggers';

/** Context window of turns sent with each request. */
const ANALYZE_CONTEXT_MS = 180_000;
const ANSWER_CONTEXT_MS = 300_000;
/** A question takes remote phrases since the previous mark, but never older than this. */
const MARK_WINDOW_MS = 120_000;
/** On a mark, a remote phrase still being recognized is awaited this long at most. */
const SETTLE_MAX_MS = 1500;
const SETTLE_POLL_MS = 100;
const ANSWER_UPDATE_MS = 120;
const TICK_MS = 500;

export interface EngineDeps {
  send: (message: PipelineToMain) => void;
  /** Appends a record to the session's questions.jsonl. */
  persist: (record: object) => void;
  now: () => number;
  provider: LlmProvider | null;
  /** Shown when `provider` is null (e.g. which API key is missing). */
  unavailable: string | null;
  /** Owner phrases («хороший вопрос»…) that mark a question. */
  triggerPhrases: string[];
}

/**
 * Builds turns from the transcript and asks the LLM for gists of long turns.
 *
 * Questions are sequential: each mark (hotkey or trigger phrase) makes a question of the remote phrases
 * said since the previous mark and answers it right away. Extending takes the phrases said since into
 * the last question and answers again. A phrase belongs to the mark it started before.
 */
export class AssistantEngine {
  private readonly segments = new Map<string, Segment>();
  private turns: Turn[] = [];
  private turnKeys = new Map<string, string>();
  private readonly summaries = new Map<string, string>();
  private readonly analyzedClosed = new Set<string>();
  private readonly triggers: TriggerMatcher;
  private readonly store = new QuestionStore();
  private readonly analyzer: TurnAnalyzer | null;
  private readonly answering = new Map<string, AbortController>();
  private readonly timer: NodeJS.Timeout;
  /** Session ms of the last mark: remote phrases starting from here belong to the next question. */
  private boundary = 0;
  /** The last question and where its phrases start, for extending it. */
  private last: { id: string; from: number } | null = null;
  private marks: Promise<void> = Promise.resolve();
  /** Start of a remote phrase that is still being recognized. */
  private remotePending: number | null = null;
  /** Start of the owner phrase that last fired a trigger: partials repeat it. */
  private triggeredAt: number | null = null;
  private stopped = false;

  constructor(private readonly deps: EngineDeps) {
    this.triggers = new TriggerMatcher(deps.triggerPhrases);
    const provider = deps.provider;
    this.analyzer = provider
      ? new TurnAnalyzer({
          buildMessage: (ids) => this.buildSummaryMessage(ids),
          analyze: (message) => provider.analyze(message),
          onResult: (result) => this.applySummaries(result),
          onError: (e) => this.reportError(e),
        })
      : null;
    this.timer = setInterval(() => {
      if (this.turns.at(-1)?.closed === false) this.refresh();
    }, TICK_MS);
  }

  addSegment(segment: Segment): void {
    this.segments.set(segment.id, segment);
    if (segment.speaker !== OWNER) this.remotePending = null;
    this.refresh();
  }

  relabel(segmentId: string, speaker: SpeakerId): void {
    const segment = this.segments.get(segmentId);
    if (!segment) return;
    this.segments.set(segmentId, { ...segment, speaker });
    this.refresh();
  }

  retract(segmentId: string): void {
    if (this.segments.delete(segmentId)) this.refresh();
  }

  setTriggerPhrases(phrases: string[]): void {
    this.triggers.setPhrases(phrases);
  }

  /** Interim recognition of a remote phrase; an empty text means nothing is pending. */
  remotePartial(text: string, tStart: number): void {
    this.remotePending = text.trim() ? tStart : null;
  }

  /** The owner's phrase so far (partial or final). A trigger phrase at its start marks a question. */
  ownerSpeech(text: string, tStart: number): void {
    if (!this.deps.provider || tStart === this.triggeredAt || !this.triggers.matches(text)) return;
    this.triggeredAt = tStart;
    void this.mark(tStart, { quiet: true });
  }

  /**
   * Makes a question of the remote phrases said since the previous mark and answers it.
   * @param at session ms of the mark (default: now); `quiet` skips the error when there is nothing new.
   */
  mark(at = this.deps.now(), { quiet = false } = {}): Promise<void> {
    return this.serial((provider) => this.makeQuestion(provider, at, quiet));
  }

  /**
   * Adds the remote phrases said since the last mark to the last question and answers it again;
   * without a last question, marks a new one.
   */
  extend(): Promise<void> {
    const at = this.deps.now();
    return this.serial(async (provider) => {
      const last = this.last && this.store.get(this.last.id);
      if (!this.last || !last || last.status === 'dismissed') return this.makeQuestion(provider, at, false);
      const { from } = this.last;
      await this.settle(at);
      if (this.remotePhrases(this.boundary, at).length > 0) {
        const phrases = this.remotePhrases(from, at);
        const text = await this.wordQuestion(provider, phrases, from, at, last.text);
        if (!text || this.stopped) return;
        this.boundary = at;
        const question = this.store.extend(last.id, text, phrases, this.deps.now());
        if (question) this.publish(question, true);
      }
      void this.answer(last.id);
    });
  }

  /** Streams a short answer to the question, replacing the previous one. */
  async answer(questionId: string): Promise<void> {
    const provider = this.requireProvider();
    const question = this.store.get(questionId);
    if (!provider || !question) return;

    this.answering.get(question.id)?.abort();
    const controller = new AbortController();
    this.answering.set(question.id, controller);
    let text = '';
    let lastSent = 0;
    const publish = (done: boolean, error: string | null = null): void => {
      const q = this.store.setAnswer(question.id, { text, done, error }, this.deps.now());
      if (q) this.deps.send({ type: 'question', question: q, focus: false });
    };
    publish(false);

    try {
      const message = buildAnswerMessage({
        question,
        phrases: question.sourceSegmentIds
          .map((id) => this.segments.get(id))
          .filter((s): s is Segment => s !== undefined),
        turns: this.recentTurns(ANSWER_CONTEXT_MS),
      });
      text = await provider.streamAnswer(
        message,
        (delta) => {
          text += delta;
          if (Date.now() - lastSent >= ANSWER_UPDATE_MS) {
            lastSent = Date.now();
            publish(false);
          }
        },
        controller.signal,
      );
      publish(true);
    } catch (e) {
      if (controller.signal.aborted) return;
      publish(true, describe(e));
      if (!text) {
        const q = this.store.setStatus(question.id, 'open', this.deps.now());
        if (q) this.deps.send({ type: 'question', question: q, focus: false });
      }
    } finally {
      if (this.answering.get(question.id) === controller) this.answering.delete(question.id);
      const q = this.store.get(question.id);
      if (q) this.deps.persist({ type: 'question', ...q });
    }
  }

  dismiss(questionId: string): void {
    this.answering.get(questionId)?.abort();
    const q = this.store.setStatus(questionId, 'dismissed', this.deps.now());
    if (!q) return;
    this.deps.send({ type: 'question', question: q, focus: false });
    this.deps.persist({ type: 'question', ...q });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.analyzer?.stop();
    for (const controller of this.answering.values()) controller.abort();
  }

  /** Runs marks one after another so each sees the boundary the previous one left. */
  private serial(task: (provider: LlmProvider) => Promise<void>): Promise<void> {
    const run = this.marks.then(() => {
      if (this.stopped) return;
      const provider = this.requireProvider();
      return provider ? task(provider) : undefined;
    });
    this.marks = run.catch(() => {});
    return run;
  }

  private async makeQuestion(provider: LlmProvider, at: number, quiet: boolean): Promise<void> {
    await this.settle(at);
    const from = Math.max(this.boundary, at - MARK_WINDOW_MS);
    const phrases = this.remotePhrases(from, at);
    if (phrases.length === 0) {
      if (!quiet) this.error('После прошлого вопроса собеседник ничего не сказал');
      return;
    }
    const text = await this.wordQuestion(provider, phrases, from, at, null);
    if (!text || this.stopped) return;
    this.boundary = at;
    const question = this.store.create(text, phrases, this.deps.now());
    this.last = { id: question.id, from };
    this.publish(question, true);
    void this.answer(question.id);
  }

  /** Waits (briefly) for a remote phrase that started before the mark to be recognized. */
  private async settle(at: number): Promise<void> {
    const deadline = Date.now() + SETTLE_MAX_MS;
    while (this.remotePending !== null && this.remotePending < at && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, SETTLE_POLL_MS));
    }
  }

  /** Remote phrases that started within [from, to), oldest first. */
  private remotePhrases(from: number, to: number): Segment[] {
    return [...this.segments.values()]
      .filter((s) => s.speaker !== OWNER && s.tStart >= from && s.tStart < to)
      .sort((a, b) => a.tStart - b.tStart);
  }

  private async wordQuestion(
    provider: LlmProvider,
    phrases: Segment[],
    from: number,
    at: number,
    previousWording: string | null,
  ): Promise<string | null> {
    // Earlier turns, plus the owner's own words in between (e.g. «you mean X?»); the phrases go separately.
    const context = this.turns.filter(
      (t) => t.tEnd >= from - ANALYZE_CONTEXT_MS && t.tStart < at && (t.speaker === OWNER || t.tStart < from),
    );
    try {
      const result = await provider.analyze(buildQuestionMessage({ phrases, context, previousWording }));
      const text = result.question?.trim();
      if (text) return text;
      this.error('Не удалось сформулировать вопрос');
    } catch (e) {
      this.reportError(e);
    }
    return null;
  }

  private publish(question: Question, focus: boolean): void {
    this.deps.send({ type: 'question', question, focus });
    this.deps.persist({ type: 'question', ...question });
  }

  private refresh(): void {
    this.turns = buildTurns([...this.segments.values()], this.deps.now()).map((t) => ({
      ...t,
      summary: this.summaries.get(t.id) ?? null,
    }));
    this.publishTurns();
    this.analyzer?.enqueue(this.turnsToSummarize());
  }

  private publishTurns(): void {
    const next = new Map<string, string>();
    const upserts: Turn[] = [];
    for (const turn of this.turns) {
      const key = JSON.stringify(turn);
      next.set(turn.id, key);
      if (this.turnKeys.get(turn.id) !== key) upserts.push(turn);
    }
    const removed = [...this.turnKeys.keys()].filter((id) => !next.has(id));
    this.turnKeys = next;
    if (upserts.length > 0 || removed.length > 0) this.deps.send({ type: 'turns', upserts, removed });
  }

  /** Closed long turns that still need a gist. */
  private turnsToSummarize(): string[] {
    const ids: string[] = [];
    for (const turn of this.turns) {
      if (!turn.closed || this.analyzedClosed.has(turn.id)) continue;
      this.analyzedClosed.add(turn.id);
      if (needsSummary(turn)) ids.push(turn.id);
    }
    return ids;
  }

  private buildSummaryMessage(turnIds: string[]): string | null {
    const summarize = turnIds.filter((id) => {
      const turn = this.turns.find((t) => t.id === id);
      return turn && turn.closed && !this.summaries.has(id) && needsSummary(turn);
    });
    if (summarize.length === 0) return null;
    return buildSummaryMessage(this.recentTurns(ANALYZE_CONTEXT_MS, summarize), summarize);
  }

  private applySummaries(result: AnalysisResult): void {
    let changed = false;
    for (const { turnId, summary } of result.summaries) {
      if (!summary.trim() || !this.turns.some((t) => t.id === turnId)) continue;
      this.summaries.set(turnId, summary.trim());
      this.deps.persist({ type: 'summary', turnId, summary: summary.trim() });
      changed = true;
    }
    if (!changed) return;
    this.turns = this.turns.map((t) => ({ ...t, summary: this.summaries.get(t.id) ?? null }));
    this.publishTurns();
  }

  /** Turns that ended within `windowMs`, plus any explicitly needed ones. */
  private recentTurns(windowMs: number, include: string[] = []): Turn[] {
    const since = this.deps.now() - windowMs;
    return this.turns.filter((t) => t.tEnd >= since || include.includes(t.id));
  }

  private requireProvider(): LlmProvider | null {
    if (!this.deps.provider) this.error(this.deps.unavailable ?? 'Ассистент недоступен');
    return this.deps.provider;
  }

  private reportError(e: unknown): void {
    this.error(describe(e));
  }

  private error(message: string): void {
    this.deps.send({ type: 'assistant-error', message });
  }
}

function describe(e: unknown): string {
  if (e instanceof LlmError) return e.message;
  return `Ошибка ассистента: ${e instanceof Error ? e.message : String(e)}`;
}
