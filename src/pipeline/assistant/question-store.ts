import type { Answer, Question, QuestionStatus } from '@shared/assistant';
import { OWNER, type Segment } from '@shared/transcript';

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

  /**
   * @param segments phrases the question was made of, possibly none (a screenshot alone);
   * owner-only → the owner asks.
   * @param at session ms of the mark, the question's time when there are no phrases.
   */
  create(text: string, worded: boolean, segments: readonly Segment[], at: number, now: number): Question {
    const q: Question = {
      id: `q${++this.counter}`,
      text,
      worded,
      askedBy: segments.findLast((s) => s.speaker !== OWNER)?.speaker ?? OWNER,
      tStart: segments[0]?.tStart ?? at,
      tEnd: segments.length > 0 ? Math.max(...segments.map((s) => s.tEnd)) : at,
      sourceSegmentIds: segments.map((s) => s.id),
      screenshots: [],
      status: 'open',
      answer: null,
      updatedAt: now,
    };
    this.questions.set(q.id, q);
    return q;
  }

  /** Adds phrases said after the question was made and replaces its wording. */
  extend(
    id: string,
    text: string,
    worded: boolean,
    segments: readonly Segment[],
    now: number,
  ): Question | null {
    const q = this.questions.get(id);
    if (!q) return null;
    q.text = text;
    q.worded = worded;
    for (const s of segments) {
      if (q.sourceSegmentIds.includes(s.id)) continue;
      q.sourceSegmentIds.push(s.id);
      q.tStart = Math.min(q.tStart, s.tStart);
      q.tEnd = Math.max(q.tEnd, s.tEnd);
    }
    if (q.askedBy === OWNER) q.askedBy = segments.findLast((s) => s.speaker !== OWNER)?.speaker ?? OWNER;
    q.updatedAt = now;
    return q;
  }

  addScreenshot(id: string, file: string, now: number): Question | null {
    const q = this.questions.get(id);
    if (!q) return null;
    q.screenshots.push(file);
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
