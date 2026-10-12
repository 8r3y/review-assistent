// Minimal typings for the parts of sherpa-onnx-node used by the pipeline (the package ships none).
declare module 'sherpa-onnx-node' {
  export interface OnlineStream {
    acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
    inputFinished(): void;
  }

  export class SpeakerEmbeddingExtractor {
    constructor(config: { model: string; numThreads?: number; debug?: boolean | number; provider?: string });
    readonly dim: number;
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    /** Pass enableExternalBuffer = false under Electron: external ArrayBuffers are not allowed there. */
    compute(stream: OnlineStream, enableExternalBuffer?: boolean): Float32Array;
  }

  export interface VadConfig {
    sileroVad: {
      model: string;
      threshold?: number;
      minSpeechDuration?: number;
      minSilenceDuration?: number;
      windowSize?: number;
      maxSpeechDuration?: number;
    };
    sampleRate: number;
    numThreads?: number;
    debug?: boolean;
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    reset(): void;
  }
}
