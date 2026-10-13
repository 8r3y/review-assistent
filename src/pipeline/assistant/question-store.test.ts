import { describe, expect, it } from 'vitest';
import type { Segment } from '@shared/transcript';
import { QuestionStore } from './question-store';

const seg = (id: string, text: string, tStart: number): Segment => ({
  id,
  channel: 'system',
  speaker: 'S1',
  text,
  tStart,
  tEnd: tStart + 2000,
  wall: '',
  words: [],
});

describe('QuestionStore', () => {
  it('creates a question from remote phrases and extends it with later ones', () => {
    const store = new QuestionStore();
    const q = store.create('Про очереди', true, [seg('s1', 'Расскажите про очереди.', 1000)], 2900, 3000);
    expect(q).toMatchObject({
      id: 'q1',
      askedBy: 'S1',
      tStart: 1000,
      tEnd: 3000,
      sourceSegmentIds: ['s1'],
      status: 'open',
    });
    store.extend(
      'q1',
      'Про очереди и потери',
      true,
      [seg('s1', '', 1000), seg('s2', 'А если брокер упал?', 5000)],
      8000,
    );
    expect(store.get('q1')).toMatchObject({
      text: 'Про очереди и потери',
      sourceSegmentIds: ['s1', 's2'],
      tEnd: 7000,
      updatedAt: 8000,
    });
    expect(store.create('Ещё', true, [seg('s3', 'Ещё вопрос', 9000)], 9400, 9500).id).toBe('q2');
  });

  it('a question without phrases (a screenshot alone) is asked by the owner at the mark', () => {
    const store = new QuestionStore();
    const q = store.create('Вопрос по скриншоту', false, [], 4000, 4100);
    expect(q).toMatchObject({ askedBy: 'owner', tStart: 4000, tEnd: 4000, worded: false });
    store.extend(q.id, 'Что не так в коде?', true, [seg('s1', 'Что не так?', 5000)], 6000);
    expect(store.get(q.id)).toMatchObject({ askedBy: 'S1', worded: true, tStart: 4000, tEnd: 7000 });
  });

  it('answers move the status', () => {
    const store = new QuestionStore();
    store.create('Про очереди', true, [seg('s1', 'Про очереди?', 0)], 0, 0);
    store.setAnswer('q1', { text: 'Отв', done: false, error: null }, 1);
    expect(store.get('q1')!.status).toBe('answering');
    store.setAnswer('q1', { text: 'Ответ', done: true, error: null }, 2);
    expect(store.get('q1')!.status).toBe('answered');
    expect(store.setStatus('nope', 'dismissed', 3)).toBeNull();
  });
});
