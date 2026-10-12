import { describe, expect, it } from 'vitest';
import { SessionClock, formatSessionTime } from './clock';

describe('SessionClock', () => {
  it('measures session time from the monotonic source and maps it to wall-clock', () => {
    let mono = 1000;
    const clock = SessionClock.start(
      () => Date.UTC(2026, 9, 12, 10, 0, 0),
      () => mono,
    );
    mono = 3500;
    expect(clock.now()).toBe(2500);
    expect(clock.toIso(2500)).toBe('2026-10-12T10:00:02.500Z');
  });
});

describe('formatSessionTime', () => {
  it.each([
    [0, '0:00'],
    [59_999, '0:59'],
    [61_000, '1:01'],
    [3_723_000, '1:02:03'],
    [-5, '0:00'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatSessionTime(ms)).toBe(expected);
  });
});
