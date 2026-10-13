import {
  PCM_FRAME_MS,
  PCM_SAMPLE_RATE,
  type ChannelActivity,
  type ChannelId,
  type PartialText,
  type Segment,
  type SttStatus,
} from '@shared/transcript';
import type { GateConfig, VadConfig } from '@shared/pipeline-protocol';
import type { SttProvider, SttStream } from './stt/provider';
import { TranscriptAssembler } from './transcript/assembler';
import { EnergyVad } from './vad/energy';
import { SttGate } from './vad/gate';
import { SILENCE_DB, int16ToFloat32, rmsDb } from './vad/level';
import type { SileroVad } from './vad/silero';
import { VadStateMachine, type VadEvent } from './vad/state-machine';

export interface ChannelCallbacks {
  onPartial: (partial: PartialText) => void;
  onFinal: (segment: Segment) => void;
  onSttStatus: (status: SttStatus, error: string | null) => void;
  onVadEvent: (event: VadEvent) => void;
  /** Every frame with its session time (used to keep audio for speaker embeddings). */
  onFrame?: (pcm: Int16Array, t: number) => void;
  onError: (message: string) => void;
}

export interface ChannelOptions {
  channel: ChannelId;
  /** Session ms when the first frame arrived (minus its duration) — the channel's time origin. */
  originMs: number;
  vad: VadConfig;
  gate: GateConfig;
  silero: SileroVad | null;
  stt: SttProvider | null;
  sttModel: string;
  sttLanguage: string;
  sttKeyterms: string[];
  /** Ask the STT provider for diarization (when local diarization is unavailable). */
  sttDiarize: boolean;
  toIso: (sessionMs: number) => string;
  callbacks: ChannelCallbacks;
}

/**
 * Per-channel audio path: PCM frames → VAD → gate → STT stream → transcript assembler.
 * Frame time is derived from the sample count, so it does not drift with message latency.
 */
export class ChannelProcessor {
  private frameIndex = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly vad: VadStateMachine;
  private readonly energy = new EnergyVad();
  private readonly gate: SttGate;
  private readonly stream: SttStream | null;
  private readonly assembler: TranscriptAssembler;
  private levelDb = SILENCE_DB;
  private sileroFailed = false;

  constructor(private readonly options: ChannelOptions) {
    this.vad = new VadStateMachine(options.vad);
    this.gate = new SttGate(options.gate, PCM_FRAME_MS);
    this.assembler = new TranscriptAssembler(options.channel, options.toIso);
    this.stream =
      options.stt?.createStream({
        sampleRate: PCM_SAMPLE_RATE,
        model: options.sttModel,
        language: options.sttLanguage,
        keyterms: options.sttKeyterms,
        diarize: options.sttDiarize,
        onResult: (result) => {
          const out = this.assembler.push(result);
          if (out.partial) options.callbacks.onPartial(out.partial);
          for (const segment of out.finals) options.callbacks.onFinal(segment);
        },
        onStatus: options.callbacks.onSttStatus,
      }) ?? null;
    if (!this.stream) options.callbacks.onSttStatus('off', null);
  }

  get activity(): ChannelActivity {
    return { levelDb: this.levelDb, speech: this.vad.isSpeaking };
  }

  /** Frames are processed strictly in order. */
  push(pcm: Int16Array): void {
    const t = this.options.originMs + this.frameIndex * PCM_FRAME_MS;
    this.frameIndex++;
    this.queue = this.queue
      .then(() => this.process(pcm, t))
      .catch((e: unknown) => {
        this.options.callbacks.onError(`${this.options.channel}: ${String(e)}`);
      });
  }

  async close(): Promise<void> {
    await this.queue;
    const end = this.vad.flush(this.options.originMs + this.frameIndex * PCM_FRAME_MS);
    if (end) this.options.callbacks.onVadEvent(end);
    await this.stream?.close();
  }

  private process(pcm: Int16Array, t: number): void {
    this.options.callbacks.onFrame?.(pcm, t);
    const samples = int16ToFloat32(pcm);
    this.levelDb = rmsDb(samples);
    const p = this.speechProbability(samples);
    const event = this.vad.push(p, t, PCM_FRAME_MS);
    if (event) this.options.callbacks.onVadEvent(event);

    if (!this.stream) return;
    const out = this.gate.push({ pcm, t }, this.vad.isSpeaking);
    for (const frame of out.frames) this.stream.write(frame.pcm, frame.t);
    if (out.closed) this.stream.finalize();
  }

  private speechProbability(samples: Float32Array): number {
    const energyP = this.energy.probability(this.levelDb);
    if (!this.options.silero || this.sileroFailed) return energyP;
    try {
      return this.options.silero.probability(samples);
    } catch (e) {
      this.sileroFailed = true;
      this.options.callbacks.onError(`Silero VAD failed, falling back to energy VAD: ${String(e)}`);
      return energyP;
    }
  }
}
