import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { SessionClock } from '@shared/clock';
import type { PipelineSessionConfig, PipelineToMain } from '@shared/pipeline-protocol';
import {
  PCM_FRAME_MS,
  PCM_FRAME_SAMPLES,
  PCM_SAMPLE_RATE,
  type AudioActivity,
  type ChannelId,
  type PcmMessage,
  type Segment,
} from '@shared/transcript';
import { ChannelProcessor } from './channel';
import { OnlineDiarizer } from './diarization/diarizer';
import { SpeakerEmbedder } from './diarization/embedder';
import { PcmHistory } from './diarization/pcm-history';
import { DeepgramProvider } from './stt/deepgram';
import type { SttProvider } from './stt/provider';
import { LeakFilter } from './transcript/dedup';
import { SileroVad } from './vad/silero';
import { SILENCE_DB } from './vad/level';

type Send = (message: PipelineToMain) => void;

/** System-channel audio kept for speaker embeddings; STT finals arrive well within this. */
const PCM_HISTORY_MS = 120_000;

/** One recording session inside the pipeline process. */
export class PipelineSession {
  private readonly channels = new Map<ChannelId, ChannelProcessor>();
  private readonly leakFilter = new LeakFilter();
  private readonly transcript: WriteStream;
  private readonly clock: SessionClock;
  private readonly stt: SttProvider | null;
  private readonly embedder: SpeakerEmbedder | null;
  private readonly diarizer: OnlineDiarizer;
  private readonly systemAudio = new PcmHistory(PCM_SAMPLE_RATE, PCM_HISTORY_MS);
  private stopped = false;

  constructor(
    private readonly config: PipelineSessionConfig,
    private readonly send: Send,
  ) {
    this.clock = SessionClock.fromWallStart(config.startedAtWall);
    this.transcript = createWriteStream(join(config.dir, 'transcript.jsonl'), { flags: 'a' });
    this.stt = config.stt.apiKey ? new DeepgramProvider(config.stt.apiKey) : null;
    this.embedder = this.loadEmbedder();
    this.diarizer = new OnlineDiarizer({
      threshold: config.diarization.threshold,
      minSegmentMs: config.diarization.minSegmentMs,
      maxHistory: 300,
    });
  }

  handlePcm(message: PcmMessage): void {
    if (this.stopped || !(message?.pcm instanceof ArrayBuffer)) return;
    const pcm = new Int16Array(message.pcm);
    if (pcm.length !== PCM_FRAME_SAMPLES) return;
    this.channel(message.channel, this.clock.now()).push(pcm);
  }

  setDiarizationThreshold(threshold: number): void {
    this.diarizer.setThreshold(threshold);
  }

  activity(): AudioActivity {
    const silent = { levelDb: SILENCE_DB, speech: false };
    return {
      mic: this.channels.get('mic')?.activity ?? silent,
      system: this.channels.get('system')?.activity ?? silent,
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all([...this.channels.values()].map((c) => c.close()));
    await new Promise<void>((resolve) => this.transcript.end(resolve));
  }

  private loadEmbedder(): SpeakerEmbedder | null {
    try {
      return SpeakerEmbedder.create(this.config.diarization.modelPath);
    } catch (e) {
      this.log('warn', `Speaker embeddings unavailable (${String(e)}), using STT diarization`);
      return null;
    }
  }

  private loadVad(): SileroVad | null {
    try {
      return SileroVad.create(this.config.vad.modelPath, this.config.vad.onThreshold);
    } catch (e) {
      this.log('warn', `Silero VAD unavailable (${String(e)}), using energy VAD`);
      return null;
    }
  }

  private channel(channel: ChannelId, arrivedAt: number): ChannelProcessor {
    let processor = this.channels.get(channel);
    if (processor) return processor;
    const isSystem = channel === 'system';
    processor = new ChannelProcessor({
      channel,
      originMs: Math.max(0, arrivedAt - PCM_FRAME_MS),
      vad: this.config.vad,
      gate: this.config.gate,
      silero: this.loadVad(),
      stt: this.stt,
      sttModel: this.config.stt.model,
      sttLanguage: this.config.stt.language,
      sttDiarize: isSystem && !this.embedder,
      toIso: (ms) => this.clock.toIso(ms),
      callbacks: {
        onPartial: (partial) => this.send({ type: 'partial', partial }),
        onFinal: (segment) => this.publish(segment),
        onSttStatus: (status, error) => this.send({ type: 'stt-status', channel, status, error }),
        onVadEvent: () => {},
        onFrame: isSystem && this.embedder ? (pcm, t) => this.systemAudio.push(pcm, t) : undefined,
        onError: (message) => this.log('error', message),
      },
    });
    this.channels.set(channel, processor);
    return processor;
  }

  private publish(segment: Segment): void {
    const decision = this.leakFilter.push(segment);
    for (const segmentId of decision.retract) {
      this.send({ type: 'retract', segmentId });
      this.write({ type: 'retract', segmentId });
    }
    if (!decision.accept) return;
    const final = segment.channel === 'system' ? this.diarize(segment) : segment;
    this.send({ type: 'final', segment: final });
    this.write({ type: 'segment', ...final });
  }

  /** Assigns the speaker from the local diarizer and publishes corrections of earlier segments. */
  private diarize(segment: Segment): Segment {
    if (!this.embedder) return segment;
    let embedding: Float32Array | null = null;
    try {
      embedding = this.embedder.embed(this.systemAudio.slice(segment.tStart, segment.tEnd));
    } catch (e) {
      this.log('error', `speaker embedding failed: ${String(e)}`);
    }
    const result = this.diarizer.add(segment.id, embedding, segment.tEnd - segment.tStart);
    for (const relabel of result.relabels) {
      this.send({ type: 'relabel', ...relabel });
      this.write({ type: 'relabel', ...relabel });
    }
    return { ...segment, speaker: result.speaker };
  }

  private write(record: object): void {
    this.transcript.write(`${JSON.stringify(record)}\n`);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.send({ type: 'log', level, message });
  }
}
