import { describe, expect, it } from 'vitest';
import { OffsetMap } from './offset-map';

describe('OffsetMap', () => {
  it('maps across gaps where audio was not sent', () => {
    const map = new OffsetMap();
    for (let t = 1000; t < 2000; t += 100) map.append(t, 100); // stream 0..1000
    for (let t = 5000; t < 5500; t += 100) map.append(t, 100); // stream 1000..1500
    expect(map.toSession(0)).toBe(1000);
    expect(map.toSession(950)).toBe(1950);
    expect(map.toSession(1000)).toBe(5000);
    expect(map.toSession(1250)).toBe(5250);
  });

  it('clamps times past the sent audio to the end of the last span', () => {
    const map = new OffsetMap();
    map.append(300, 200);
    expect(map.toSession(900)).toBe(500);
  });

  it('restarts stream time after reset (reconnect)', () => {
    const map = new OffsetMap();
    map.append(0, 1000);
    map.reset();
    map.append(8000, 1000);
    expect(map.toSession(500)).toBe(8500);
  });
});
