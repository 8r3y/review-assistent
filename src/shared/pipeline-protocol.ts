// Messages between the main process and the pipeline utility process.
import type { AudioActivity, ChannelId, PartialText, Segment, SpeakerId, SttStatus } from './transcript';

export interface VadConfig {
  /** Path to silero_vad.onnx; the energy VAD is used if it cannot be loaded. */
  modelPath: string;
  onThreshold: number;
  offThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
}

export interface GateConfig {
  /** Send only speech (plus pre-roll and tail) to STT. */
  enabled: boolean;
  preRollMs: number;
  /** Keep streaming this long after speech ends before closing the gate. */
  closeAfterSilenceMs: number;
}

export interface DiarizationConfig {
  /** Speaker embedding model; STT-provider diarization is used if it cannot be loaded. */
  modelPath: string;
  /** Average-linkage cosine threshold; lower merges more voices into one speaker. */
  threshold: number;
  /** Shorter segments never create a new speaker. */
  minSegmentMs: number;
}

export interface SttConfig {
  provider: 'deepgram';
  /** null → STT disabled (capture and VAD still run). */
  apiKey: string | null;
  model: string;
  language: string;
}

export interface PipelineSessionConfig {
  sessionId: string;
  startedAtWall: number;
  dir: string;
  vad: VadConfig;
  gate: GateConfig;
  diarization: DiarizationConfig;
  stt: SttConfig;
}

export type MainToPipeline =
  | { type: 'ping'; at: number }
  | { type: 'shutdown' }
  | { type: 'session:start'; config: PipelineSessionConfig }
  | { type: 'session:stop' }
  | { type: 'diarization:set-threshold'; threshold: number }
  /** Carries the capture → pipeline MessagePort in `ports[0]`. */
  | { type: 'audio-port' };

export type PipelineToMain =
  | { type: 'pong'; at: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'activity'; activity: AudioActivity }
  | { type: 'stt-status'; channel: ChannelId; status: SttStatus; error: string | null }
  | { type: 'partial'; partial: PartialText }
  | { type: 'final'; segment: Segment }
  | { type: 'retract'; segmentId: string }
  /** Re-clustering changed the speaker of an earlier segment. */
  | { type: 'relabel'; segmentId: string; speaker: SpeakerId }
  | { type: 'session:stopped' };
