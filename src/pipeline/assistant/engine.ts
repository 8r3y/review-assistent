import type { Question, Turn } from '@shared/assistant';
import type { PipelineToMain } from '@shared/pipeline-protocol';
import { OWNER, type Segment, type SpeakerId } from '@shared/transcript';
import { LlmError, type AnalysisResult, type LlmProvider } from '../llm/provider';
import { buildTurns } from '../transcript/turns';
import { TurnAnalyzer } from './analyzer';
import { needsSummary, worthAnalyzing } from './prefilter';
import { buildAnalyzeMessage, buildAnswerMessage } from './prompts';
import { QuestionStore } from './question-store';

/** A long remote turn is analyzed before it ends after this many new words. */
const OPEN_TURN_ANALYZE_WORDS = 40;
/** Owner turns are analyzed (as clarifications) only while a question was active this recently. */
const CLARIFY_WINDOW_MS = 180_000;
/** Context window of turns sent with each request. */
const ANALYZE_CONTEXT_MS = 180_000;
const ANSWER_CONTEXT_MS = 300_000;
/** «Это вопрос» takes the last remote turns spoken within this window. */
const MARK_WINDOW_MS = 60_000;
const MARK_MAX_TURNS = 2;
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
}

/**
 * Builds turns from the transcript, asks the LLM for turn gists and question operations, keeps the
 * question list and streams answers on demand.
 */
export class AssistantEngine {
  private readonly segments = new Map<string, Segment>();
  private turns: Turn[] = [];
  private turnKeys = new Map<string, string>();
  private readonly summaries = new Map<string, string>();
  private readonly analyzedClosed = new Set<string>();
  private readonly analyzedWords = new Map<string, number>();
  private readonly store = new QuestionStore();
  private readonly analyzer: TurnAnalyzer | null;
  private readonly answering = new Map<string, AbortController>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly deps: EngineDeps) {
    const provider = deps.provider;
    this.analyzer = provider
      ? new TurnAnalyzer({
          buildMessage: (ids, forced) => this.buildAnalyzeMessage(ids, forced),
          analyze: (message) => provider.analyze(message),
          onResult: (result, forced) => this.applyAnalysis(result, forced),
          onError: (e) => this.reportError(e),
        })
      : null;
    this.timer = setInterval(() => {
      if (this.turns.at(-1)?.closed === false) this.refresh();
    }, TICK_MS);
  }

  addSegment(segment: Segment): void {
    this.segments.set(segment.id, segment);
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

  /** «Это вопрос»: the last remote turns become a question (created or extended). */
  async markQuestion(): Promise<Question | null> {
    if (!this.analyzer) {
      this.error(this.deps.unavailable ?? 'Ассистент недоступен');
      return null;
    }
    const turnIds = this.lastRemoteTurnIds();
    if (turnIds.length === 0) {
      this.error('Нет недавних реплик собеседника, из которых можно составить вопрос');
      return null;
    }
    await this.analyzer.force(turnIds);
    return this.store.list().find((q) => q.sourceTurnIds.some((id) => turnIds.includes(id))) ?? null;
  }

  /** Streams a short answer; with no question id, the last remote turns are turned into one first. */
  async answer(questionId: string | null): Promise<void> {
    const provider = this.deps.provider;
    if (!provider) {
      this.error(this.deps.unavailable ?? 'Ассистент недоступен');
      return;
    }
    const question = questionId ? this.store.get(questionId) : await this.markQuestion();
    if (!question) return;

    this.answering.get(question.id)?.abort();
    const controller = new AbortController();
    this.answering.set(question.id, controller);
    const focus = questionId === null;
    let text = '';
    let lastSent = 0;
    const publish = (done: boolean, error: string | null = null): void => {
      const q = this.store.setAnswer(question.id, { text, done, error }, this.deps.now());
      if (q) this.deps.send({ type: 'question', question: q, focus: focus && !done && text === '' });
    };
    publish(false);

    try {
      const message = buildAnswerMessage({
        question,
        turns: this.recentTurns(ANSWER_CONTEXT_MS, question.sourceTurnIds),
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
    clearInterval(this.timer);
    this.analyzer?.stop();
    for (const controller of this.answering.values()) controller.abort();
  }

  private refresh(): void {
    const now = this.deps.now();
    this.turns = buildTurns([...this.segments.values()], now).map((t) => ({
      ...t,
      summary: this.summaries.get(t.id) ?? null,
    }));
    this.publishTurns();
    this.analyzer?.enqueue(this.turnsToAnalyze(now));
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

  private turnsToAnalyze(now: number): string[] {
    const ids: string[] = [];
    for (const turn of this.turns) {
      if (turn.speaker === OWNER) {
        if (!turn.closed || this.analyzedClosed.has(turn.id)) continue;
        this.analyzedClosed.add(turn.id);
        if (this.store.hasRecentOpen(now, CLARIFY_WINDOW_MS) || needsSummary(turn)) ids.push(turn.id);
      } else if (turn.closed) {
        if (this.analyzedClosed.has(turn.id)) continue;
        this.analyzedClosed.add(turn.id);
        if (worthAnalyzing(turn)) ids.push(turn.id);
      } else if (turn.words - (this.analyzedWords.get(turn.id) ?? 0) >= OPEN_TURN_ANALYZE_WORDS) {
        this.analyzedWords.set(turn.id, turn.words);
        ids.push(turn.id);
      }
    }
    return ids;
  }

  private buildAnalyzeMessage(turnIds: string[], forced: string[] | null): string | null {
    const known = turnIds.filter((id) => this.turns.some((t) => t.id === id));
    if (known.length === 0) return null;
    const summarize = known.filter((id) => {
      const turn = this.turns.find((t) => t.id === id)!;
      return turn.closed && !this.summaries.has(id) && needsSummary(turn);
    });
    return buildAnalyzeMessage({
      turns: this.recentTurns(ANALYZE_CONTEXT_MS, known),
      questions: this.store.list(),
      newTurnIds: known,
      summarizeTurnIds: summarize,
      forceQuestionFrom: forced,
    });
  }

  private applyAnalysis(result: AnalysisResult, forced: string[] | null): void {
    let summariesChanged = false;
    for (const { turnId, summary } of result.summaries) {
      if (!summary.trim() || !this.turns.some((t) => t.id === turnId)) continue;
      this.summaries.set(turnId, summary.trim());
      this.deps.persist({ type: 'summary', turnId, summary: summary.trim() });
      summariesChanged = true;
    }
    if (summariesChanged) {
      this.turns = this.turns.map((t) => ({ ...t, summary: this.summaries.get(t.id) ?? null }));
      this.publishTurns();
    }

    const byId = new Map(this.turns.map((t) => [t.id, t]));
    for (const question of this.store.apply(result.ops, byId, this.deps.now())) {
      const focus = forced !== null && question.sourceTurnIds.some((id) => forced.includes(id));
      this.deps.send({ type: 'question', question, focus });
      this.deps.persist({ type: 'question', ...question });
    }
  }

  /** Turns that ended within `windowMs`, plus any explicitly needed ones. */
  private recentTurns(windowMs: number, include: string[]): Turn[] {
    const since = this.deps.now() - windowMs;
    return this.turns.filter((t) => t.tEnd >= since || include.includes(t.id));
  }

  private lastRemoteTurnIds(): string[] {
    const since = this.deps.now() - MARK_WINDOW_MS;
    return this.turns
      .filter((t) => t.speaker !== OWNER && t.tEnd >= since)
      .slice(-MARK_MAX_TURNS)
      .map((t) => t.id);
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
