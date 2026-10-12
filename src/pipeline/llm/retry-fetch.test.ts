import { describe, expect, it } from 'vitest';
import { retryingFetch } from './retry-fetch';

const networkError = (): TypeError =>
  new TypeError('fetch failed', { cause: new Error('other side closed') });
const noSleep = async (): Promise<void> => {};

function flaky(
  failures: number,
  error: () => unknown = networkError,
): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const f = (async () => {
    calls++;
    if (calls <= failures) throw error();
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  return { fetch: f, calls: () => calls };
}

describe('retryingFetch', () => {
  it('retries network failures with a fresh request', async () => {
    const base = flaky(3);
    const res = await retryingFetch(base.fetch, [1, 1, 1], noSleep)('https://x');
    expect(res.status).toBe(200);
    expect(base.calls()).toBe(4);
  });

  it('gives up after the configured attempts', async () => {
    const base = flaky(5);
    await expect(retryingFetch(base.fetch, [1, 1], noSleep)('https://x')).rejects.toThrow('fetch failed');
    expect(base.calls()).toBe(3);
  });

  it('does not retry other errors or aborted requests', async () => {
    const bug = flaky(1, () => new TypeError('Invalid URL'));
    await expect(retryingFetch(bug.fetch, [1], noSleep)('x')).rejects.toThrow('Invalid URL');
    expect(bug.calls()).toBe(1);

    const controller = new AbortController();
    controller.abort();
    const aborted = flaky(1);
    await expect(
      retryingFetch(aborted.fetch, [1], noSleep)('https://x', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(aborted.calls()).toBe(1);
  });
});
