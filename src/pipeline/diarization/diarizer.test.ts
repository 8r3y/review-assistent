import { describe, expect, it } from 'vitest';
import { averageLinkage, normalize } from './clustering';
import { OnlineDiarizer } from './diarizer';

// Deterministic pseudo-random vectors: each speaker is a base direction plus per-segment noise.
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}
const DIM = 64;
const rand = rng(42);
const base = (): Float32Array => normalize(Float32Array.from({ length: DIM }, rand));
const voice = (b: Float32Array, noise = 0.6): Float32Array =>
  normalize(b.map((x) => x + ((rand() * noise) / Math.sqrt(DIM)) * 4));

describe('averageLinkage', () => {
  it('groups items above the threshold', () => {
    // 0,1 similar; 2 alone
    const sim = Float64Array.from([1, 0.8, 0.1, 0.8, 1, 0.2, 0.1, 0.2, 1]);
    expect(averageLinkage(sim, 3, 0.5)).toEqual([[0, 1], [2]]);
    expect(averageLinkage(sim, 3, 0.05)).toEqual([[0, 1, 2]]);
  });
});

describe('OnlineDiarizer', () => {
  it('separates speakers and keeps labels stable', () => {
    const [a, b, c] = [base(), base(), base()];
    const d = new OnlineDiarizer({ threshold: 0.3, minSegmentMs: 1500, maxHistory: 300 });
    const order = [a, b, a, b, c, a, b, c, a, b];
    const labels = order.map((v, i) => d.add(`s${i}`, voice(v), 3000).speaker);
    expect(labels).toEqual(['S1', 'S2', 'S1', 'S2', 'S3', 'S1', 'S2', 'S3', 'S1', 'S2']);
  });

  it('short segments join the nearest speaker instead of creating one', () => {
    const [a, b] = [base(), base()];
    const d = new OnlineDiarizer({ threshold: 0.3, minSegmentMs: 1500, maxHistory: 300 });
    d.add('1', voice(a), 3000);
    d.add('2', voice(b), 3000);
    expect(d.add('3', voice(b), 600).speaker).toBe('S2');
    expect(d.add('4', null, 300).speaker).toBe('S2'); // no embedding: previous speaker
  });

  it('relabels an earlier segment when later evidence merges it into another speaker', () => {
    const a = base();
    const d = new OnlineDiarizer({ threshold: 0.3, minSegmentMs: 1500, maxHistory: 300 });
    const outlier = normalize(a.map((x, i) => x + (i % 2 ? 0.25 : -0.25))); // same speaker, odd segment
    d.add('1', voice(a), 3000);
    const first = d.add('2', outlier, 3000);
    const later = [3, 4, 5, 6].map((i) => d.add(String(i), voice(a), 3000));
    const relabelled = later.flatMap((r) => r.relabels).filter((r) => r.segmentId === '2');
    const finalLabel = relabelled.at(-1)?.speaker ?? first.speaker;
    expect(finalLabel).toBe('S1');
  });
});

describe('OnlineDiarizer.setThreshold', () => {
  it('splits merged speakers and relabels history at the next long segment', () => {
    const a = base();
    // b is a "similar" voice: halfway between a and an independent direction.
    const b = normalize(a.map((x, i) => x + base()[i]!));
    const d = new OnlineDiarizer({ threshold: 0.1, minSegmentMs: 1500, maxHistory: 300 });
    ['a', 'b', 'a', 'b'].forEach((v, i) => d.add(String(i), voice(v === 'a' ? a : b, 0.2), 3000));
    d.setThreshold(0.9);
    const result = d.add('4', voice(a, 0.2), 3000);
    const relabelled = new Map(result.relabels.map((r) => [r.segmentId, r.speaker]));
    expect(result.speaker).toBe('S1');
    expect(relabelled.get('1')).toBe(relabelled.get('3'));
    expect(relabelled.get('1')).not.toBe('S1');
  });
});
