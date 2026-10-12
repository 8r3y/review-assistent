import { describe, expect, it } from 'vitest';
import type { ChannelId, Segment } from '@shared/transcript';
import { LeakFilter } from './dedup';

let id = 0;
const seg = (channel: ChannelId, text: string, tStart: number, tEnd: number): Segment => ({
  id: `${channel}-${++id}`,
  channel,
  speaker: channel === 'mic' ? 'owner' : 'S1',
  text,
  tStart,
  tEnd,
  wall: '',
  words: [],
});

describe('LeakFilter', () => {
  it('drops a mic segment that repeats a simultaneous system segment', () => {
    const filter = new LeakFilter();
    filter.push(seg('system', 'Давайте обсудим план на следующую неделю.', 1000, 4000));
    expect(filter.push(seg('mic', 'давайте обсудим план на неделю', 1200, 4100)).accept).toBe(false);
  });

  it('retracts an already published mic segment when the system segment arrives later', () => {
    const filter = new LeakFilter();
    const mic = seg('mic', 'давайте обсудим план на неделю', 1200, 4100);
    expect(filter.push(mic).accept).toBe(true);
    const decision = filter.push(seg('system', 'Давайте обсудим план на следующую неделю.', 1000, 4000));
    expect(decision).toEqual({ accept: true, retract: [mic.id] });
  });

  it('keeps the owner speech that differs from the system channel', () => {
    const filter = new LeakFilter();
    filter.push(seg('system', 'Давайте обсудим план на следующую неделю.', 1000, 4000));
    expect(filter.push(seg('mic', 'Согласен, но сначала закроем баги', 3000, 5000)).accept).toBe(true);
  });

  it('keeps short answers unless they match exactly', () => {
    const filter = new LeakFilter();
    filter.push(seg('system', 'Да, конечно, давайте.', 1000, 2000));
    expect(filter.push(seg('mic', 'Да.', 1500, 1800)).accept).toBe(true);
  });

  it('ignores segments far apart in time', () => {
    const filter = new LeakFilter();
    filter.push(seg('system', 'Давайте обсудим план на следующую неделю.', 1000, 4000));
    expect(filter.push(seg('mic', 'давайте обсудим план на неделю', 9000, 11000)).accept).toBe(true);
  });
});
