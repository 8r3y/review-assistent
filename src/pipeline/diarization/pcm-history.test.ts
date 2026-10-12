import { describe, expect, it } from 'vitest';
import { PcmHistory } from './pcm-history';

const SR = 1000; // 1 sample per ms keeps the arithmetic readable
const chunk = (start: number, length: number): Int16Array => Int16Array.from({ length }, (_, i) => start + i);

describe('PcmHistory', () => {
  it('cuts a range across chunks', () => {
    const h = new PcmHistory(SR, 10_000);
    h.push(chunk(0, 100), 0);
    h.push(chunk(100, 100), 100);
    const s = h.slice(90, 110);
    expect(Array.from(s, (x) => Math.round(x * 32768))).toEqual(Array.from({ length: 20 }, (_, i) => 90 + i));
  });

  it('drops audio older than maxMs', () => {
    const h = new PcmHistory(SR, 50);
    h.push(chunk(0, 100), 0);
    h.push(chunk(100, 100), 100);
    h.push(chunk(200, 100), 200);
    expect(h.slice(0, 100).length).toBe(0);
    expect(h.slice(100, 300).length).toBe(200);
  });
});
