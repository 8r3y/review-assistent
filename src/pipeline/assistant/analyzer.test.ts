import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../llm/provider';
import { TurnAnalyzer } from './analyzer';

const EMPTY: AnalysisResult = { summaries: [], ops: [] };

function deferred(): { promise: Promise<AnalysisResult>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<AnalysisResult>((r) => (resolve = () => r(EMPTY)));
  return { promise, resolve };
}

describe('TurnAnalyzer', () => {
  it('keeps one call in flight and batches turns queued meanwhile', async () => {
    const calls: string[] = [];
    const gates: (() => void)[] = [];
    const analyzer = new TurnAnalyzer({
      buildMessage: (ids) => ids.join(','),
      analyze: (message) => {
        calls.push(message);
        const d = deferred();
        gates.push(d.resolve);
        return d.promise;
      },
      onResult: () => {},
      onError: () => {},
    });
    analyzer.enqueue(['t1']);
    analyzer.enqueue(['t2']);
    analyzer.enqueue(['t3']);
    await Promise.resolve();
    expect(calls).toEqual(['t1']);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['t1', 't2,t3']);
    gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(analyzer.idle).toBe(true);
  });

  it('force resolves after its request is applied and reports it as forced', async () => {
    const forcedSeen: (string[] | null)[] = [];
    const analyzer = new TurnAnalyzer({
      buildMessage: (ids) => ids.join(','),
      analyze: async () => EMPTY,
      onResult: (_r, forced) => forcedSeen.push(forced),
      onError: () => {},
    });
    await analyzer.force(['t9']);
    expect(forcedSeen).toEqual([['t9']]);
  });

  it('reports errors and keeps going', async () => {
    const errors: unknown[] = [];
    let first = true;
    const results: string[] = [];
    const analyzer = new TurnAnalyzer({
      buildMessage: (ids) => ids.join(','),
      analyze: async (m) => {
        if (first) {
          first = false;
          throw new Error('boom');
        }
        results.push(m);
        return EMPTY;
      },
      onResult: () => {},
      onError: (e) => errors.push(e),
    });
    analyzer.enqueue(['a']);
    await new Promise((r) => setTimeout(r, 0));
    analyzer.enqueue(['b']);
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    expect(results).toEqual(['b']);
  });
});
