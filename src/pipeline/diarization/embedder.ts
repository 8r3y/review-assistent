import { SpeakerEmbeddingExtractor } from 'sherpa-onnx-node';
import { PCM_SAMPLE_RATE } from '@shared/transcript';
import { normalize } from './clustering';

/** Speaker embeddings (ERes2Net via sherpa-onnx), L2-normalised. */
export class SpeakerEmbedder {
  private constructor(private readonly extractor: SpeakerEmbeddingExtractor) {}

  static create(modelPath: string): SpeakerEmbedder {
    return new SpeakerEmbedder(
      new SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1, debug: false }),
    );
  }

  /** @returns null when the audio is too short for the model. */
  embed(samples: Float32Array): Float32Array | null {
    const stream = this.extractor.createStream();
    stream.acceptWaveform({ sampleRate: PCM_SAMPLE_RATE, samples });
    stream.inputFinished();
    if (!this.extractor.isReady(stream)) return null;
    // External buffers are not allowed in Electron.
    return normalize(Float32Array.from(this.extractor.compute(stream, false)));
  }
}
