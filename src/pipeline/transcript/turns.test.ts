import { describe, expect, it } from 'vitest';
import type { Segment } from '@shared/transcript';
import { buildTurns } from './turns';

let n = 0;
const seg = (speaker: string, text: string, tStart: number, tEnd: number): Segment => ({
  id: `s${++n}`,
  channel: speaker === 'owner' ? 'mic' : 'system',
  speaker,
  text,
  tStart,
  tEnd,
  wall: '',
  words: [],
});

describe('buildTurns', () => {
  it('joins consecutive phrases of one speaker across short pauses', () => {
    const turns = buildTurns(
      [seg('S1', 'Расскажите, пожалуйста,', 0, 1500), seg('S1', 'как устроена очередь задач?', 2500, 5000)],
      5500,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ text: 'Расскажите, пожалуйста, как устроена очередь задач?', words: 6 });
    expect(turns[0]!.closed).toBe(false);
  });

  it('a backchannel of another speaker does not break the turn', () => {
    const turns = buildTurns(
      [
        seg('S1', 'Мы используем брокер', 0, 2000),
        seg('owner', 'Угу.', 2100, 2400),
        seg('S1', 'и ретраи', 2600, 3500),
      ],
      4000,
    );
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([['S1', 'Мы используем брокер и ретраи']]);
  });

  it('substantial speech of another speaker closes the turn', () => {
    const turns = buildTurns(
      [
        seg('S1', 'Как вы тестируете?', 0, 2000),
        seg('owner', 'Юнит-тестами и интеграционными тестами', 2500, 5000),
      ],
      5200,
    );
    expect(turns.map((t) => [t.speaker, t.closed])).toEqual([
      ['S1', true],
      ['owner', false],
    ]);
  });

  it('a long pause closes the last turn and starts a new one for the same speaker', () => {
    const turns = buildTurns(
      [seg('S1', 'Первый вопрос.', 0, 1000), seg('S1', 'Второй вопрос.', 6000, 7000)],
      7200,
    );
    expect(turns).toHaveLength(2);
    expect(turns[0]!.closed).toBe(true);
    expect(buildTurns([seg('S1', 'Вопрос?', 0, 1000)], 5000)[0]!.closed).toBe(true);
  });

  it('sorts segments that arrive out of order across channels', () => {
    const late = seg('S1', 'раньше', 0, 1000);
    const early = seg('owner', 'позже сказанная фраза', 1500, 3000);
    expect(buildTurns([early, late], 3500).map((t) => t.speaker)).toEqual(['S1', 'owner']);
  });
});
