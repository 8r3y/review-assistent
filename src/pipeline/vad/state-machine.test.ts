import { describe, expect, it } from 'vitest';
import { VadStateMachine, type VadEvent } from './state-machine';

const FRAME = 32;
const params = { onThreshold: 0.5, offThreshold: 0.35, minSpeechMs: 250, minSilenceMs: 600 };

function run(probs: number[]): VadEvent[] {
  const vad = new VadStateMachine(params);
  return probs.flatMap((p, i) => vad.push(p, i * FRAME, FRAME) ?? []);
}

const frames = (count: number, p: number): number[] => Array<number>(count).fill(p);

describe('VadStateMachine', () => {
  it('ignores speech bursts shorter than minSpeechMs', () => {
    expect(run([...frames(5, 0), ...frames(7, 0.9), ...frames(30, 0)])).toEqual([]);
  });

  it('reports speech start at the first speech frame once minSpeechMs is reached', () => {
    expect(run([...frames(5, 0), ...frames(8, 0.9)])).toEqual([{ type: 'speechStart', t: 5 * FRAME }]);
  });

  it('keeps speaking through dips between the thresholds and short pauses', () => {
    const events = run([...frames(10, 0.9), ...frames(40, 0.4), ...frames(10, 0.1), ...frames(10, 0.9)]);
    expect(events).toEqual([{ type: 'speechStart', t: 0 }]);
  });

  it('reports speech end at the first silent frame once minSilenceMs is reached', () => {
    const events = run([...frames(10, 0.9), ...frames(19, 0.1)]);
    expect(events).toEqual([
      { type: 'speechStart', t: 0 },
      { type: 'speechEnd', t: 10 * FRAME },
    ]);
  });

  it('flush closes an open interval', () => {
    const vad = new VadStateMachine(params);
    for (let i = 0; i < 10; i++) vad.push(0.9, i * FRAME, FRAME);
    expect(vad.flush(1000)).toEqual({ type: 'speechEnd', t: 1000 });
    expect(vad.flush(1100)).toBeNull();
  });
});
