import { describe, expect, it } from 'vitest';
import type { Turn } from '@shared/assistant';
import { QuestionStore } from './question-store';

const turn = (id: string, speaker: string, text: string, tStart: number): Turn => ({
  id,
  channel: speaker === 'owner' ? 'mic' : 'system',
  speaker,
  text,
  tStart,
  tEnd: tStart + 2000,
  segmentIds: [id],
  words: text.split(' ').length,
  closed: true,
  summary: null,
});

const turns = new Map(
  [
    turn('t1', 'S1', 'Расскажите про очереди.', 0),
    turn('t2', 'S1', 'Особенно если брокер теряет сообщения.', 3000),
    turn('t3', 'owner', 'То есть про at-least-once?', 6000),
    turn('t4', 'owner', 'Я думаю, что…', 9000),
  ].map((t) => [t.id, t]),
);

describe('QuestionStore', () => {
  it('creates a question from remote turns and extends it with later phrases', () => {
    const store = new QuestionStore();
    const [created] = store.apply(
      [{ op: 'create', questionId: null, text: 'Как устроены очереди?', turnIds: ['t1'] }],
      turns,
      100,
    );
    expect(created).toMatchObject({ id: 'q1', askedBy: 'S1', status: 'open', sourceTurnIds: ['t1'] });

    const [updated] = store.apply(
      [
        {
          op: 'update',
          questionId: 'q1',
          text: 'Как сделать очередь надёжной при потере сообщений брокером?',
          turnIds: ['t2'],
        },
      ],
      turns,
      200,
    );
    expect(updated).toMatchObject({ sourceTurnIds: ['t1', 't2'], tEnd: 5000, updatedAt: 200 });
    expect(updated!.text).toContain('потере сообщений');
  });

  it('adds the owner clarification once', () => {
    const store = new QuestionStore();
    store.apply([{ op: 'create', questionId: null, text: 'Вопрос про очереди', turnIds: ['t1'] }], turns, 0);
    const op = {
      op: 'clarify' as const,
      questionId: 'q1',
      text: 'Уточнение: at-least-once',
      turnIds: ['t3'],
    };
    expect(store.apply([op], turns, 1)[0]!.clarifications).toEqual([
      { turnId: 't3', speaker: 'owner', text: 'Уточнение: at-least-once' },
    ]);
    expect(store.apply([op], turns, 2)).toEqual([]);
  });

  it('ignores invalid operations from the model', () => {
    const store = new QuestionStore();
    expect(
      store.apply(
        [
          { op: 'create', questionId: null, text: 'Вопрос владельца', turnIds: ['t4'] }, // owner only
          { op: 'create', questionId: null, text: '', turnIds: ['t1'] }, // empty text
          { op: 'update', questionId: 'q99', text: 'нет такого', turnIds: [] },
          { op: 'create', questionId: null, text: 'Несуществующая реплика', turnIds: ['nope'] },
        ],
        turns,
        0,
      ),
    ).toEqual([]);
  });

  it('a repeated create for the same turns extends the existing question', () => {
    const store = new QuestionStore();
    store.apply([{ op: 'create', questionId: null, text: 'Про очереди', turnIds: ['t1'] }], turns, 0);
    store.apply(
      [{ op: 'create', questionId: null, text: 'Про очереди и потери', turnIds: ['t1', 't2'] }],
      turns,
      1,
    );
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ text: 'Про очереди и потери', sourceTurnIds: ['t1', 't2'] });
  });

  it('close affects only open questions; answers move status', () => {
    const store = new QuestionStore();
    store.apply([{ op: 'create', questionId: null, text: 'Про очереди', turnIds: ['t1'] }], turns, 0);
    store.setAnswer('q1', { text: 'Отв', done: false, error: null }, 1);
    expect(store.get('q1')!.status).toBe('answering');
    expect(store.apply([{ op: 'close', questionId: 'q1', text: null, turnIds: [] }], turns, 2)).toEqual([]);
    store.setAnswer('q1', { text: 'Ответ', done: true, error: null }, 3);
    expect(store.get('q1')!.status).toBe('answered');
    expect(store.hasRecentOpen(100, 1000)).toBe(true);
    expect(store.hasRecentOpen(10_000, 1000)).toBe(false);
  });
});
