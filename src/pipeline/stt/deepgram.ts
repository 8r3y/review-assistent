import { OffsetMap } from './offset-map';
import type { SttProvider, SttResult, SttStream, SttStreamOptions } from './provider';

const ENDPOINT = 'wss://api.deepgram.com/v1/listen';
/** Deepgram closes idle streams after ~10 s without audio. */
const KEEPALIVE_MS = 4000;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000];
/** Audio buffered while disconnected; older audio is dropped. */
const MAX_BUFFER_MS = 30_000;
const CLOSE_TIMEOUT_MS = 3000;

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
}

export interface DeepgramResults {
  type: 'Results';
  start: number;
  duration: number;
  is_final: boolean;
  channel: { alternatives: { transcript: string; words: DeepgramWord[] }[] };
}

export function buildDeepgramUrl(
  options: Pick<SttStreamOptions, 'sampleRate' | 'language' | 'model' | 'diarize'>,
): string {
  const params = new URLSearchParams({
    model: options.model,
    language: options.language,
    encoding: 'linear16',
    sample_rate: String(options.sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
    diarize: String(options.diarize),
  });
  return `${ENDPOINT}?${params}`;
}

/** Converts a Deepgram `Results` message (stream seconds) into an SttResult (session ms). */
export function parseDeepgramResults(
  msg: DeepgramResults,
  toSession: (streamMs: number) => number,
): SttResult {
  const alt = msg.channel.alternatives[0];
  const words = (alt?.words ?? []).map((w) => ({
    text: w.punctuated_word ?? w.word,
    tStart: toSession(w.start * 1000),
    tEnd: toSession(w.end * 1000),
    confidence: w.confidence,
    speaker: w.speaker ?? null,
  }));
  return {
    isFinal: msg.is_final,
    text: alt?.transcript ?? '',
    tStart: words[0]?.tStart ?? toSession(msg.start * 1000),
    words,
  };
}

export class DeepgramProvider implements SttProvider {
  constructor(private readonly apiKey: string) {}

  createStream(options: SttStreamOptions): SttStream {
    return new DeepgramStream(this.apiKey, options);
  }
}

class DeepgramStream implements SttStream {
  private ws: WebSocket | null = null;
  private readonly map = new OffsetMap();
  private pending: { pcm: Int16Array; sessionT: number }[] = [];
  private pendingMs = 0;
  private lastSentAt = 0;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private closing = false;

  constructor(
    private readonly apiKey: string,
    private readonly options: SttStreamOptions,
  ) {
    this.connect();
  }

  write(pcm: Int16Array, sessionT: number): void {
    if (this.closing) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(pcm, sessionT);
      return;
    }
    const ms = (pcm.length / this.options.sampleRate) * 1000;
    this.pending.push({ pcm, sessionT });
    this.pendingMs += ms;
    while (this.pendingMs > MAX_BUFFER_MS && this.pending.length > 0) {
      const dropped = this.pending.shift()!;
      this.pendingMs -= (dropped.pcm.length / this.options.sampleRate) * 1000;
    }
  }

  finalize(): void {
    this.sendJson({ type: 'Finalize' });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.clearTimers();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws?.close();
      this.options.onStatus('off', null);
      return;
    }
    // CloseStream makes Deepgram flush final results and then close the socket.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, CLOSE_TIMEOUT_MS);
      ws.addEventListener('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.sendJson({ type: 'CloseStream' });
    });
    this.options.onStatus('off', null);
  }

  private connect(): void {
    this.options.onStatus(this.failures === 0 ? 'connecting' : 'reconnecting', null);
    const ws = new WebSocket(buildDeepgramUrl(this.options), ['token', this.apiKey]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;

    ws.addEventListener('open', () => {
      opened = true;
      this.failures = 0;
      this.map.reset();
      this.options.onStatus('open', null);
      const pending = this.pending;
      this.pending = [];
      this.pendingMs = 0;
      for (const chunk of pending) this.send(chunk.pcm, chunk.sessionT);
      this.keepAliveTimer = setInterval(() => {
        if (Date.now() - this.lastSentAt >= KEEPALIVE_MS) this.sendJson({ type: 'KeepAlive' });
      }, KEEPALIVE_MS / 2);
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let msg: { type?: string };
      try {
        msg = JSON.parse(event.data) as { type?: string };
      } catch {
        return;
      }
      if (msg.type === 'Results') {
        this.options.onResult(parseDeepgramResults(msg as DeepgramResults, (ms) => this.map.toSession(ms)));
      }
    });

    ws.addEventListener('close', (event) => {
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
      if (this.ws === ws) this.ws = null;
      if (this.closing) return;
      this.failures++;
      const reason = opened
        ? `соединение закрыто (${event.code})`
        : 'не удалось подключиться: проверьте API-ключ, модель и язык';
      const delay = RECONNECT_DELAYS_MS[Math.min(this.failures - 1, RECONNECT_DELAYS_MS.length - 1)]!;
      this.options.onStatus(this.failures >= 3 && !opened ? 'error' : 'reconnecting', reason);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  private send(pcm: Int16Array, sessionT: number): void {
    this.map.append(sessionT, (pcm.length / this.options.sampleRate) * 1000);
    this.ws!.send(pcm as Int16Array<ArrayBuffer>);
    this.lastSentAt = Date.now();
  }

  private sendJson(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private clearTimers(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.keepAliveTimer = null;
    this.reconnectTimer = null;
  }
}
