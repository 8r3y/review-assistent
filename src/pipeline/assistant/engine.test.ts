import { afterEach, describe, expect, it } from 'vitest';
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
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let engine: AssistantEngine | null = null;
afterEach(() => engine?.stop());

function setup(analyze: (message: string) => AnalysisResult): {
  sent: PipelineToMain[];
  analyzeCalls: string[];
  setNow: (t: number) => void;
} {
  const sent: PipelineToMain[] = [];
  const analyzeCalls: string[] = [];
  let now = 0;
  const provider: LlmProvider = {
    analyze: async (m) => {
      analyzeCalls.push(m);
      return analyze(m);
    },
    streamAnswer: async (_m, onText) => {
      onText('Ответ: ');
      onText('используйте подтверждения.');
      return 'Ответ: используйте подтверждения.';
    },
  };
  engine = new AssistantEngine({
    send: (m) => sent.push(m),
    persist: () => {},
    now: () => now,
    provider,
    unavailable: null,
  });
  return { sent, analyzeCalls, setNow: (t) => (now = t) };
}

const questions = (sent: PipelineToMain[]) => sent.flatMap((m) => (m.type === 'question' ? [m] : []));

describe('AssistantEngine', () => {
  it('analyzes a closed remote turn and publishes the question', async () => {
    const { sent, analyzeCalls, setNow } = setup(() => ({
      summaries: [],
      ops: [{ op: 'create', questionId: null, text: 'Как устроены очереди?', turnIds: ['s1'] }],
    }));
    setNow(2500);
    engine!.addSegment(seg('s1', 'S1', 'Расскажите, как у вас устроены очереди?', 0, 2000));
    await flush();
    expect(analyzeCalls).toHaveLength(0); // turn still open

    setNow(6500);
    engine!.addSegment(seg('s2', 'owner', 'Хороший вопрос, сейчас расскажу подробно', 3000, 6000));
    await flush();
    expect(analyzeCalls).toHaveLength(1);
    expect(JSON.parse(analyzeCalls[0]!).newTurns).toEqual(['s1']);
    expect(questions(sent).at(-1)).toMatchObject({
      question: { id: 'q1', text: 'Как устроены очереди?' },
      focus: false,
    });
  });

  it('answer without a question marks the last remote turn, focuses it and streams the answer', async () => {
    const { sent, analyzeCalls, setNow } = setup((m) => {
      const forced = JSON.parse(m).forceQuestionFrom as string[];
      return {
        summaries: [],
        ops: [{ op: 'create', questionId: null, text: 'Про очереди', turnIds: forced }],
      };
    });
    setNow(1500);
    engine!.addSegment(seg('s1', 'S1', 'А что с очередями', 0, 1000));
    await engine!.answer(null);
    expect(JSON.parse(analyzeCalls.at(-1)!).forceQuestionFrom).toEqual(['s1']);
    const qs = questions(sent);
    expect(qs.some((m) => m.focus)).toBe(true);
    expect(qs.at(-1)!.question).toMatchObject({
      status: 'answered',
      answer: { text: 'Ответ: используйте подтверждения.', done: true, error: null },
    });
  });

  it('reports a missing key instead of failing', async () => {
    const sent: PipelineToMain[] = [];
    engine = new AssistantEngine({
      send: (m) => sent.push(m),
      persist: () => {},
      now: () => 0,
      provider: null,
      unavailable: 'Нет API-ключа: Gemini (Google AI) для ответов',
    });
    await engine.answer(null);
    expect(sent).toContainEqual({
      type: 'assistant-error',
      message: 'Нет API-ключа: Gemini (Google AI) для ответов',
    });
  });
});
