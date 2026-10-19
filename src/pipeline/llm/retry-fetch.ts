/** Pauses before each retry of a request that failed at the network level. */
export const NETWORK_RETRY_DELAYS_MS = [250, 750, 1500];

/**
 * fetch() rejects with TypeError("fetch failed") when the connection breaks: a pooled keep-alive
 * socket closed by a proxy/VPN ("other side closed"), or a TLS handshake cut off midway. Such
 * failures are frequent on unstable routes to foreign APIs and a fresh connection usually works.
 */
export function isNetworkError(e: unknown): e is TypeError {
  return e instanceof TypeError && /fetch failed/i.test(e.message);
}

type Fetch = typeof fetch;

/**
 * Wraps fetch with retries on network-level failures only. HTTP error statuses are returned as
 * usual (the SDKs handle those). Request bodies here are strings, so re-sending is safe.
 */
export function retryingFetch(
  base: Fetch = fetch,
  delays: readonly number[] = NETWORK_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Fetch {
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await base(input, init);
      } catch (e) {
        if (!isNetworkError(e) || attempt >= delays.length || init?.signal?.aborted) throw e;
        await sleep(delays[attempt]!);
      }
    }
  };
}

/** Short user-facing reason of a network failure. */
export function networkCause(e: TypeError): string {
  const cause = e.cause instanceof Error ? e.cause.message : '';
  if (/TLS|socket disconnected|ECONNRESET/i.test(cause)) return 'соединение оборвано (TLS)';
  if (/ENOTFOUND|EAI_AGAIN/i.test(cause)) return 'адрес не найден (DNS)';
  if (/ETIMEDOUT|timeout/i.test(cause)) return 'таймаут';
  return cause || e.message;
}
