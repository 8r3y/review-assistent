// Messages between the main process and the pipeline utility process.
import type { AssistantSettings, LlmProviderId, Question, Turn } from './assistant';
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
  keyterms: string[];
}

export interface AssistantConfig {
  /** API keys per provider; a task whose provider has no key is unavailable (turns are still built). */
  keys: Record<LlmProviderId, string | null>;
  /** Custom base URL per provider (an API-compatible gateway); null → the official endpoint. */
  endpoints: Record<LlmProviderId, string | null>;
  settings: AssistantSettings;
  /** The owner's notes about themselves/their work, used for answers. */
  ownerContext: string;
  /** Owner phrases that make a question of the last remote turns and answer it. */
  triggerPhrases: string[];
}

export interface PipelineSessionConfig {
  sessionId: string;
  startedAtWall: number;
  dir: string;
  vad: VadConfig;
  gate: GateConfig;
  diarization: DiarizationConfig;
  stt: SttConfig;
  assistant: AssistantConfig;
}

export type MainToPipeline =
  | { type: 'ping'; at: number }
  | { type: 'shutdown' }
  | { type: 'session:start'; config: PipelineSessionConfig }
  | { type: 'session:stop' }
  | { type: 'diarization:set-threshold'; threshold: number }
  /** questionId null: extend the last question with the remote phrases said since, then answer it. */
  | { type: 'assistant:answer'; questionId: string | null }
  /** Makes a question of the remote phrases said since the previous mark and answers it. */
  | { type: 'assistant:mark-question' }
  | { type: 'assistant:set-triggers'; phrases: string[] }
  /** Extends the last question (or marks a new one) and answers it with this screenshot. */
  | { type: 'assistant:screenshot'; file: string; png: string }
  | { type: 'assistant:dismiss'; questionId: string }
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
  | { type: 'turns'; upserts: Turn[]; removed: string[] }
  /** focus: the owner asked for this question (hotkey, trigger phrase), the overlay should switch to it. */
  | { type: 'question'; question: Question; focus: boolean }
  | { type: 'assistant-error'; message: string }
  | { type: 'session:stopped' };
