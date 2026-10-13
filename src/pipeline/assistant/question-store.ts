import type { Answer, Question, QuestionStatus } from '@shared/assistant';
import type { Segment } from '@shared/transcript';

/** Question list of a session; questions are made and extended only on the owner's command. */
export class QuestionStore {
  private readonly questions = new Map<string, Question>();
  private counter = 0;

  list(): Question[] {
    return [...this.questions.values()];
  }

  get(id: string): Question | undefined {
    return this.questions.get(id);
  }

  /** @param segments remote phrases the question was made of, non-empty. */
  create(text: string, segments: readonly Segment[], now: number): Question {
    const q: Question = {
      id: `q${++this.counter}`,
      text,
      askedBy: segments.at(-1)!.speaker,
      tStart: Math.min(...segments.map((s) => s.tStart)),
      tEnd: Math.max(...segments.map((s) => s.tEnd)),
      sourceSegmentIds: segments.map((s) => s.id),
      status: 'open',
      answer: null,
      updatedAt: now,
    };
    this.questions.set(q.id, q);
    return q;
  }

  /** Adds phrases said after the question was made and replaces its wording. */
  extend(id: string, text: string, segments: readonly Segment[], now: number): Question | null {
    const q = this.questions.get(id);
    if (!q) return null;
    q.text = text;
    for (const s of segments) {
      if (q.sourceSegmentIds.includes(s.id)) continue;
      q.sourceSegmentIds.push(s.id);
      q.tStart = Math.min(q.tStart, s.tStart);
      q.tEnd = Math.max(q.tEnd, s.tEnd);
    }
    q.updatedAt = now;
    return q;
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
}
