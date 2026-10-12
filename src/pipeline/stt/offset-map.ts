interface Span {
  /** Start of the span in STT stream time, ms. */
  stt: number;
  /** Start of the span in session time, ms. */
  session: number;
  duration: number;
}

const CONTIGUITY_TOLERANCE_MS = 1;

/**
 * Maps STT stream time to session time. The stream only receives gated audio (and restarts at 0 on
 * reconnect), so stream time drifts from session time; every sent chunk is recorded here.
 */
export class OffsetMap {
  private spans: Span[] = [];
  private cursor = 0;

  /** Records `duration` ms of audio sent to the stream that started at session time `sessionT`. */
  append(sessionT: number, duration: number): void {
    const last = this.spans.at(-1);
    if (last && Math.abs(last.session + last.duration - sessionT) <= CONTIGUITY_TOLERANCE_MS) {
      last.duration += duration;
    } else {
      this.spans.push({ stt: this.cursor, session: sessionT, duration });
    }
    this.cursor += duration;
  }

  toSession(sttMs: number): number {
    const spans = this.spans;
    if (spans.length === 0) return sttMs;
    let lo = 0;
    let hi = spans.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (spans[mid]!.stt <= sttMs) lo = mid;
      else hi = mid - 1;
    }
    const span = spans[lo]!;
    const within = Math.min(Math.max(0, sttMs - span.stt), span.duration);
    return span.session + within;
  }

  /** New stream connection: stream time starts from 0 again. */
  reset(): void {
    this.spans = [];
    this.cursor = 0;
  }
}
