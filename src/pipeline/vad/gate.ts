export interface GateParams {
  enabled: boolean;
  preRollMs: number;
  closeAfterSilenceMs: number;
}

export interface GatedFrame {
  pcm: Int16Array;
  /** Session ms of the frame start. */
  t: number;
}

export interface GateOutput {
  frames: GatedFrame[];
  /** The gate closed on this frame: the STT stream should be finalized. */
  closed: boolean;
}

/**
 * Decides which audio goes to STT: speech, a pre-roll before it (the VAD decides with a delay and
 * must not clip the first word) and a tail after it. Short pauses keep the gate open.
 */
export class SttGate {
  private open = false;
  private silenceSince: number | null = null;
  private preRoll: GatedFrame[] = [];

  constructor(
    private readonly params: GateParams,
    private readonly frameMs: number,
  ) {}

  get isOpen(): boolean {
    return this.open || !this.params.enabled;
  }

  push(frame: GatedFrame, speaking: boolean): GateOutput {
    if (!this.params.enabled) return { frames: [frame], closed: false };

    if (speaking) {
      this.silenceSince = null;
      if (this.open) return { frames: [frame], closed: false };
      this.open = true;
      const frames = [...this.preRoll, frame];
      this.preRoll = [];
      return { frames, closed: false };
    }

    if (this.open) {
      this.silenceSince ??= frame.t;
      if (frame.t + this.frameMs - this.silenceSince < this.params.closeAfterSilenceMs) {
        return { frames: [frame], closed: false };
      }
      this.open = false;
      this.silenceSince = null;
      return { frames: [frame], closed: true };
    }

    this.preRoll.push(frame);
    const maxFrames = Math.ceil(this.params.preRollMs / this.frameMs);
    if (this.preRoll.length > maxFrames) this.preRoll.shift();
    return { frames: [], closed: false };
  }
}
