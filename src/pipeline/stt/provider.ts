import type { SttStatus } from '@shared/transcript';

export interface SttWord {
  text: string;
  /** Session ms. */
  tStart: number;
  tEnd: number;
  confidence: number;
  /** Diarization label (0-based), null when diarization is off. */
  speaker: number | null;
}

export interface SttResult {
  isFinal: boolean;
  text: string;
  /** Session ms of the start of the result. */
  tStart: number;
  words: SttWord[];
}

export interface SttStreamOptions {
  sampleRate: number;
  language: string;
  model: string;
  /** Terms to prompt the model with. */
  keyterms: string[];
  diarize: boolean;
  onResult: (result: SttResult) => void;
  onStatus: (status: SttStatus, error: string | null) => void;
}

/**
 * A realtime STT stream. Implementations own reconnection and map their stream time to session
 * time, so results always carry session ms.
 */
export interface SttStream {
  /** @param sessionT session ms of the first sample. */
  write(pcm: Int16Array, sessionT: number): void;
  /** Flush pending audio into final results (called when the VAD gate closes). */
  finalize(): void;
  close(): Promise<void>;
}

export interface SttProvider {
  createStream(options: SttStreamOptions): SttStream;
}
