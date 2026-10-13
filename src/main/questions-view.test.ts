import { describe, expect, it } from 'vitest';
import type { Question, QuestionStatus } from '@shared/assistant';
import { QuestionsView } from './questions-view';

const q = (id: string, status: QuestionStatus = 'open'): Question => ({
  id,
  text: id,
  askedBy: 'S1',
  tStart: 0,
  tEnd: 0,
  sourceSegmentIds: [],
  status,
  answer: null,
  updatedAt: 0,
});

describe('QuestionsView', () => {
  it('switches to new questions and counts them', () => {
    const view = new QuestionsView(30_000);
    view.upsert(q('q1'), false, 0);
    view.upsert(q('q2'), false, 1000);
    expect(view.nav()).toEqual({ currentId: 'q2', index: 2, total: 2 });
  });

  it('navigates within bounds', () => {
    const view = new QuestionsView(30_000);
    ['q1', 'q2', 'q3'].forEach((id) => view.upsert(q(id), false, 0));
    view.step(-1, 10);
    view.step(-1, 20);
    view.step(-1, 30);
    expect(view.nav()).toEqual({ currentId: 'q1', index: 1, total: 3 });
    view.step(5, 40);
    expect(view.nav().currentId).toBe('q3');
  });

  it('does not auto-switch right after manual navigation or while answering', () => {
    const view = new QuestionsView(30_000);
    view.upsert(q('q1'), false, 0);
    view.upsert(q('q2'), false, 0);
    view.step(-1, 1000); // owner went back to q1
    view.upsert(q('q3'), false, 5000);
    expect(view.nav()).toEqual({ currentId: 'q1', index: 1, total: 3 });

    view.upsert(q('q1', 'answering'), false, 40_000);
    view.upsert(q('q4'), false, 41_000); // hold expired, but q1 is answering
    expect(view.nav().currentId).toBe('q1');

    view.upsert(q('q1', 'answered'), false, 42_000);
    view.upsert(q('q5'), false, 43_000);
    expect(view.nav().currentId).toBe('q5');
  });

  it('focus always wins', () => {
    const view = new QuestionsView(30_000);
    view.upsert(q('q1'), false, 0);
    view.upsert(q('q2'), false, 0);
    view.step(-1, 100);
    view.upsert(q('q2'), true, 200);
    expect(view.nav().currentId).toBe('q2');
  });

  it('dismissing the current question moves to a neighbour and hides it from the count', () => {
    const view = new QuestionsView(30_000);
    ['q1', 'q2', 'q3'].forEach((id) => view.upsert(q(id), false, 0));
    view.step(-1, 10); // q2
    view.upsert(q('q2', 'dismissed'), false, 20);
    expect(view.nav()).toEqual({ currentId: 'q3', index: 2, total: 2 });
    view.upsert(q('q3', 'dismissed'), false, 30);
    expect(view.nav()).toEqual({ currentId: 'q1', index: 1, total: 1 });
  });
});
