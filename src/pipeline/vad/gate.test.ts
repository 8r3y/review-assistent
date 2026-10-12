import { describe, expect, it } from 'vitest';
import { SttGate } from './gate';

const FRAME = 32;
const params = { enabled: true, preRollMs: 96, closeAfterSilenceMs: 320 };

function feed(gate: SttGate, pattern: boolean[]): { sent: number[]; closedAt: number[] } {
  const sent: number[] = [];
  const closedAt: number[] = [];
  pattern.forEach((speaking, i) => {
    const out = gate.push({ pcm: new Int16Array(1), t: i * FRAME }, speaking);
    sent.push(...out.frames.map((f) => f.t / FRAME));
    if (out.closed) closedAt.push(i);
  });
  return { sent, closedAt };
}

describe('SttGate', () => {
  it('sends nothing during silence', () => {
    expect(feed(new SttGate(params, FRAME), Array<boolean>(20).fill(false)).sent).toEqual([]);
  });

  it('flushes the pre-roll when speech starts', () => {
    const { sent } = feed(new SttGate(params, FRAME), [false, false, false, false, false, true, true]);
    expect(sent).toEqual([2, 3, 4, 5, 6]);
  });

  it('streams the tail and closes after closeAfterSilenceMs', () => {
    const pattern = [true, true, ...Array<boolean>(15).fill(false)];
    const { sent, closedAt } = feed(new SttGate(params, FRAME), pattern);
    expect(closedAt).toEqual([11]);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('a short pause keeps the gate open', () => {
    const pattern = [true, ...Array<boolean>(5).fill(false), true];
    const { sent, closedAt } = feed(new SttGate(params, FRAME), pattern);
    expect(closedAt).toEqual([]);
    expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('passes everything when disabled', () => {
    const { sent } = feed(new SttGate({ ...params, enabled: false }, FRAME), [false, false, true]);
    expect(sent).toEqual([0, 1, 2]);
  });
});
