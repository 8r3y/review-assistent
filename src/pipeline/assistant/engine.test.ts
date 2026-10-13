import { afterEach, describe, expect, it } from 'vitest';
import type { Question } from '@shared/assistant';
import type { PipelineToMain } from '@shared/pipeline-protocol';
import type { Segment } from '@shared/transcript';
import type { AnalysisResult, LlmProvider } from '../llm/provider';
import { AssistantEngine } from './engine';

const seg = (id: string, speaker: string, text: string, tStart: number, tEnd: number): Segment => ({
  id,
  channel: speaker === 'owner' ? 'mic' : 'system',
  speaker,
  text,
  tStart,
  tEnd,
  wall: '',
  words: [],
});
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

let engine: AssistantEngine | null = null;
afterEach(() => engine?.stop());

/** The fake LLM words a question as the texts of the phrases it got, joined. */
function setup(summaries: AnalysisResult['summaries'] = []): {
  sent: PipelineToMain[];
  calls: Record<string, unknown>[];
  setNow: (t: number) => void;
} {
  const sent: PipelineToMain[] = [];
  const calls: Record<string, unknown>[] = [];
  let now = 0;
  const provider: LlmProvider = {
    analyze: async (m) => {
      const request = JSON.parse(m) as { phrases?: { text: string }[] };
      calls.push(request);
      return {
        summaries: request.phrases ? [] : summaries,
        question: request.phrases ? request.phrases.map((p) => p.text).join(' ') : null,
      };
    },
    streamAnswer: async (_m, onText) => {
      onText('Ответ.');
      return 'Ответ.';
    },
  };
  engine = new AssistantEngine({
    send: (m) => sent.push(m),
    persist: () => {},
    now: () => now,
    provider,
    unavailable: null,
    triggerPhrases: ['хороший вопрос'],
  });
  return { sent, calls, setNow: (t) => (now = t) };
}

/** Latest state of every question, in order of creation. */
const questions = (sent: PipelineToMain[]): Question[] => [
  ...new Map(
    sent.flatMap((m) => (m.type === 'question' ? [[m.question.id, m.question] as const] : [])),
  ).values(),
];
const phrasesOf = (call: Record<string, unknown>): string[] =>
  (call.phrases as { text: string }[]).map((p) => p.text);

describe('AssistantEngine', () => {
  it('only summarizes long turns in the background and never makes questions on its own', async () => {
    const { sent, calls, setNow } = setup([{ turnId: 's1', summary: 'Про очереди' }]);
    const long =
      'Расскажите, как у вас устроены очереди и что происходит с сообщениями, когда потребитель падает посреди обработки и потом поднимается снова?';
    setNow(16_000);
    engine!.addSegment(seg('s1', 'S1', long, 0, 15_000));
    setNow(20_000);
    engine!.addSegment(seg('s2', 'owner', 'Сейчас подумаю', 16_000, 17_000));
    await flush();
    expect(calls).toEqual([expect.objectContaining({ summarize: ['s1'] })]);
    expect(questions(sent)).toHaveLength(0);
  });

  it('each mark takes only the remote phrases said since the previous mark', async () => {
    const { sent, calls, setNow } = setup();
    engine!.addSegment(seg('s1', 'S1', 'Как вы управляете техдолгом?', 0, 3000));
    setNow(5000);
    await engine!.mark();
    engine!.addSegment(seg('s2', 'S1', 'Балансирую между фичами и долгом.', 6000, 9000));
    engine!.addSegment(seg('s3', 'S1', 'Расскажи о сложном решении.', 10_000, 12_000));
    setNow(13_000);
    await engine!.mark();
    engine!.addSegment(seg('s4', 'S1', 'В каком году была война?', 14_000, 16_000));
    setNow(17_000);
    await engine!.mark();
    await flush();

    expect(calls.map(phrasesOf)).toEqual([
      ['Как вы управляете техдолгом?'],
      ['Балансирую между фичами и долгом.', 'Расскажи о сложном решении.'],
      ['В каком году была война?'],
    ]);
    expect(questions(sent).map((q) => [q.id, q.sourceSegmentIds, q.status])).toEqual([
      ['q1', ['s1'], 'answered'],
      ['q2', ['s2', 's3'], 'answered'],
      ['q3', ['s4'], 'answered'],
    ]);
  });

  it('a phrase belongs to the mark it started before, even if recognized after it', async () => {
    const { calls, setNow } = setup();
    engine!.addSegment(seg('s1', 'S1', 'Расскажите про очереди', 0, 2000));
    engine!.remotePartial('А если брокер', 2500);
    setNow(3000);
    const marked = engine!.mark();
    engine!.addSegment(seg('s2', 'S1', 'А если брокер упал?', 2500, 3500));
    await marked;
    expect(calls.map(phrasesOf)).toEqual([['Расскажите про очереди', 'А если брокер упал?']]);
  });

  it('extend adds the phrases said since the mark to the last question and answers again', async () => {
    const { sent, calls, setNow } = setup();
    engine!.addSegment(seg('s1', 'S1', 'Расскажите про очереди', 0, 2000));
    setNow(3000);
    await engine!.mark();
    engine!.addSegment(seg('s2', 'S1', 'И про ретраи', 4000, 5000));
    setNow(6000);
    await engine!.extend();
    await flush();

    expect(calls.at(-1)).toMatchObject({ previousWording: 'Расскажите про очереди' });
    expect(phrasesOf(calls.at(-1)!)).toEqual(['Расскажите про очереди', 'И про ретраи']);
    expect(questions(sent)).toEqual([
      expect.objectContaining({ id: 'q1', sourceSegmentIds: ['s1', 's2'], status: 'answered' }),
    ]);

    // Nothing new: the answer is just regenerated, the next mark finds nothing.
    await engine!.extend();
    expect(calls).toHaveLength(2);
    setNow(7000);
    await engine!.mark();
    expect(sent.at(-1)).toEqual({
      type: 'assistant-error',
      message: 'После прошлого вопроса собеседник ничего не сказал',
    });
  });

  it('a trigger phrase marks once per owner phrase and ignores an empty window quietly', async () => {
    const { sent, calls, setNow } = setup();
    engine!.addSegment(seg('s1', 'S1', 'А что с очередями', 0, 1000));
    setNow(1500);
    engine!.ownerSpeech('Хороший', 1200);
    engine!.ownerSpeech('Хороший вопрос', 1200);
    engine!.ownerSpeech('Хороший вопрос, давайте разберём', 1200);
    await flush();
    expect(calls).toHaveLength(1);
    expect(questions(sent)).toEqual([
      expect.objectContaining({ text: 'А что с очередями', status: 'answered' }),
    ]);

    setNow(9000);
    engine!.ownerSpeech('Хороший вопрос', 8000);
    await flush();
    expect(calls).toHaveLength(1);
    expect(sent.some((m) => m.type === 'assistant-error')).toBe(false);
  });

  it('reports a missing key instead of failing', async () => {
    const sent: PipelineToMain[] = [];
    engine = new AssistantEngine({
      send: (m) => sent.push(m),
      persist: () => {},
      now: () => 0,
      provider: null,
      unavailable: 'Нет API-ключа: Gemini (Google AI) для ответов',
      triggerPhrases: [],
    });
    await engine.mark();
    expect(sent).toContainEqual({
      type: 'assistant-error',
      message: 'Нет API-ключа: Gemini (Google AI) для ответов',
    });
  });
});
