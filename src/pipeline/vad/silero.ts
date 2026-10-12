import { Vad } from 'sherpa-onnx-node';
import { PCM_FRAME_SAMPLES, PCM_SAMPLE_RATE } from '@shared/transcript';

const BUFFER_SECONDS = 30;

/**
 * Silero VAD via sherpa-onnx. One instance per channel: it keeps recurrent state between frames.
 * sherpa-onnx exposes a per-window speech decision rather than a probability; its own debouncing
 * is minimised so that VadStateMachine applies the configured hysteresis.
 */
export class SileroVad {
  private constructor(private readonly vad: Vad) {}

  static create(modelPath: string, threshold: number): SileroVad {
    const vad = new Vad(
      {
        sileroVad: {
          model: modelPath,
          threshold,
          minSpeechDuration: 0.05,
          minSilenceDuration: 0.05,
          windowSize: PCM_FRAME_SAMPLES,
        },
        sampleRate: PCM_SAMPLE_RATE,
        numThreads: 1,
        debug: false,
      },
      BUFFER_SECONDS,
    );
    return new SileroVad(vad);
  }

  /** @param frame PCM_FRAME_SAMPLES float samples. @returns 1 for speech, 0 for silence. */
  probability(frame: Float32Array): number {
    if (frame.length !== PCM_FRAME_SAMPLES) throw new Error(`Silero expects ${PCM_FRAME_SAMPLES} samples`);
    this.vad.acceptWaveform(frame);
    // Detected segments are not used; drop them so the internal buffer does not grow.
    while (!this.vad.isEmpty()) this.vad.pop();
    return this.vad.isDetected() ? 1 : 0;
  }
}
