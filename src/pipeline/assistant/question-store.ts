import type { Answer, Question, QuestionOp, QuestionStatus, Turn } from '@shared/assistant';
import { OWNER } from '@shared/transcript';

/**
 * Question list of a session. A pure state holder: the analyzer proposes operations, the store
 * validates them against known turns and questions (LLM output is never trusted blindly).
 */
export class QuestionStore {
  private readonly questions = new Map<string, Question>();
  private counter = 0;

  list(): Question[] {
    return [...this.questions.values()];
  }

  get(id: string): Question | undefined {
    return this.questions.get(id);
  }

  /** Open questions updated within `windowMs` — the owner may be clarifying them. */
  hasRecentOpen(now: number, windowMs: number): boolean {
    return this.list().some((q) => isActive(q.status) && now - q.updatedAt <= windowMs);
  }

  /** @returns questions that changed, in order of first change. */
  apply(ops: readonly QuestionOp[], turns: ReadonlyMap<string, Turn>, now: number): Question[] {
    const changed = new Map<string, Question>();
    const touch = (q: Question): void => {
      q.updatedAt = now;
      this.questions.set(q.id, q);
      changed.set(q.id, q);
    };

    for (const op of ops) {
      const opTurns = op.turnIds.map((id) => turns.get(id)).filter((t): t is Turn => t !== undefined);
      const existing = op.questionId ? this.questions.get(op.questionId) : undefined;
      switch (op.op) {
        case 'create': {
          const text = op.text?.trim();
          const remote = opTurns.filter((t) => t.speaker !== OWNER);
          if (!text || remote.length === 0) break;
          const duplicate = this.list().find(
            (q) => q.status !== 'dismissed' && q.sourceTurnIds.some((id) => op.turnIds.includes(id)),
          );
          if (duplicate) {
            this.extend(duplicate, text, opTurns);
            touch(duplicate);
            break;
          }
          touch({
            id: `q${++this.counter}`,
            text,
            askedBy: remote[0]!.speaker,
            tStart: Math.min(...opTurns.map((t) => t.tStart)),
            tEnd: Math.max(...opTurns.map((t) => t.tEnd)),
            sourceTurnIds: opTurns.map((t) => t.id),
            clarifications: [],
            status: 'open',
            answer: null,
            updatedAt: now,
          });
          break;
        }
        case 'update':
          if (!existing || existing.status === 'dismissed') break;
          this.extend(existing, op.text?.trim() || null, opTurns);
          touch(existing);
          break;
        case 'clarify': {
          if (!existing || existing.status === 'dismissed') break;
          const known = new Set(existing.clarifications.map((c) => c.turnId));
          const added = opTurns.filter((t) => !known.has(t.id) && !existing.sourceTurnIds.includes(t.id));
          if (added.length === 0) break;
          for (const t of added) {
            existing.clarifications.push({
              turnId: t.id,
              speaker: t.speaker,
              text: added.length === 1 && op.text?.trim() ? op.text.trim() : t.text,
            });
          }
          touch(existing);
          break;
        }
        case 'close':
          if (!existing || existing.status !== 'open') break;
          existing.status = 'closed';
          touch(existing);
          break;
      }
    }
    return [...changed.values()];
  }

  setStatus(id: string, status: QuestionStatus, now: number): Question | null {
    const q = this.questions.get(id);
    if (!q) return null;
    q.status = status;
    q.updatedAt = now;
    return q;
  }

  setAnswer(id: string, answer: Answer, now: number): Question | null {
    const q = this.questions.get(id);
    if (!q) return null;
    q.answer = answer;
    q.status = answer.done ? 'answered' : 'answering';
    q.updatedAt = now;
    return q;
  }

  private extend(q: Question, text: string | null, turns: Turn[]): void {
    if (text) q.text = text;
    for (const t of turns) {
      if (q.sourceTurnIds.includes(t.id)) continue;
      q.sourceTurnIds.push(t.id);
      q.tStart = Math.min(q.tStart, t.tStart);
      q.tEnd = Math.max(q.tEnd, t.tEnd);
    }
  }
}

function isActive(status: QuestionStatus): boolean {
  return status === 'open' || status === 'answering' || status === 'answered';
}
