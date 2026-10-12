import type { Question } from '@shared/assistant';

export interface QuestionsNav {
  currentId: string | null;
  /** 1-based position of the current question among visible ones; 0 when there are none. */
  index: number;
  total: number;
}

/** Leave the overlay on the question the owner picked for this long before auto-switching. */
const MANUAL_HOLD_MS = 30_000;

/**
 * Which question the overlay shows. New questions take over automatically unless the owner is
 * reading something they navigated to recently or an answer is streaming.
 */
export class QuestionsView {
  private questions: Question[] = [];
  private currentId: string | null = null;
  private lastManualAt = -Infinity;

  constructor(private readonly manualHoldMs = MANUAL_HOLD_MS) {}

  list(): Question[] {
    return this.questions;
  }

  current(): Question | null {
    return this.questions.find((q) => q.id === this.currentId) ?? null;
  }

  nav(): QuestionsNav {
    const visible = this.visible();
    const index = visible.findIndex((q) => q.id === this.currentId);
    return { currentId: index >= 0 ? this.currentId : null, index: index + 1, total: visible.length };
  }

  /** @param focus the owner asked for this question (hotkey) — show it now. */
  upsert(question: Question, focus: boolean, now: number): void {
    const i = this.questions.findIndex((q) => q.id === question.id);
    const isNew = i < 0;
    if (isNew) this.questions.push(question);
    else this.questions[i] = question;

    if (focus) {
      this.currentId = question.id;
      this.lastManualAt = now;
    } else if (isNew && question.status !== 'dismissed' && this.mayAutoSwitch(now)) {
      this.currentId = question.id;
    }
    if (this.current()?.status === 'dismissed' || (!this.currentId && this.visible().length > 0)) {
      this.moveOffDismissed(i < 0 ? this.questions.length - 1 : i);
    }
  }

  /** Moves among visible questions; stays at the ends. */
  step(delta: number, now: number): void {
    const visible = this.visible();
    if (visible.length === 0) return;
    const index = visible.findIndex((q) => q.id === this.currentId);
    const next = Math.min(visible.length - 1, Math.max(0, (index < 0 ? visible.length - 1 : index) + delta));
    this.currentId = visible[next]!.id;
    this.lastManualAt = now;
  }

  select(id: string, now: number): void {
    if (!this.visible().some((q) => q.id === id)) return;
    this.currentId = id;
    this.lastManualAt = now;
  }

  reset(): void {
    this.questions = [];
    this.currentId = null;
    this.lastManualAt = -Infinity;
  }

  private visible(): Question[] {
    return this.questions.filter((q) => q.status !== 'dismissed');
  }

  private mayAutoSwitch(now: number): boolean {
    const current = this.current();
    if (!current || current.status === 'dismissed') return true;
    if (current.status === 'answering') return false;
    return now - this.lastManualAt >= this.manualHoldMs;
  }

  /** The current question was dismissed: show the next visible one, else the previous. */
  private moveOffDismissed(fromIndex: number): void {
    const after = this.questions.slice(fromIndex + 1).find((q) => q.status !== 'dismissed');
    const before = this.questions
      .slice(0, Math.max(0, fromIndex))
      .reverse()
      .find((q) => q.status !== 'dismissed');
    this.currentId = (after ?? before)?.id ?? null;
  }
}
