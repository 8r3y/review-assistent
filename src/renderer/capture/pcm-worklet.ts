// AudioWorklet: mono Float32 at the context rate (16 kHz) → Int16 frames of PCM_FRAME_SAMPLES.
// Runs in AudioWorkletGlobalScope, which TypeScript's DOM lib does not describe.

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_SAMPLES = 512;

class PcmFrameProcessor extends AudioWorkletProcessor {
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;

  constructor() {
    super();
    if (sampleRate !== 16000) this.port.postMessage({ error: `unexpected sample rate ${sampleRate}` });
  }

  process(inputs: Float32Array[][]): boolean {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]!));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-frames', PcmFrameProcessor);
