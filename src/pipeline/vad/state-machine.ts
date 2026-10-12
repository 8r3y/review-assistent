export interface VadParams {
  /** silence → speech when p ≥ onThreshold for minSpeechMs. */
  onThreshold: number;
  /** speech → silence when p < offThreshold for minSilenceMs. */
  offThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
}

export type VadEvent = { type: 'speechStart'; t: number } | { type: 'speechEnd'; t: number };

/**
 * Turns per-frame speech probabilities into debounced speech/silence events with hysteresis.
 * Event times point at where speech actually started/ended, not when the decision was made.
 */
export class VadStateMachine {
  private speaking = false;
  private speechSince: number | null = null;
  private silenceSince: number | null = null;

  constructor(private readonly params: VadParams) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** @param t frame start, session ms. */
  push(p: number, t: number, frameMs: number): VadEvent | null {
    const frameEnd = t + frameMs;
    if (!this.speaking) {
      if (p < this.params.onThreshold) {
        this.speechSince = null;
        return null;
      }
      this.speechSince ??= t;
      if (frameEnd - this.speechSince < this.params.minSpeechMs) return null;
      this.speaking = true;
      this.silenceSince = null;
      return { type: 'speechStart', t: this.speechSince };
    }

    if (p >= this.params.offThreshold) {
      this.silenceSince = null;
      return null;
    }
    this.silenceSince ??= t;
    if (frameEnd - this.silenceSince < this.params.minSilenceMs) return null;
    this.speaking = false;
    this.speechSince = null;
    return { type: 'speechEnd', t: this.silenceSince };
  }

  /** Closes an open speech interval, e.g. at session end. */
  flush(t: number): VadEvent | null {
    if (!this.speaking) return null;
    this.speaking = false;
    return { type: 'speechEnd', t: this.silenceSince ?? t };
  }
}
