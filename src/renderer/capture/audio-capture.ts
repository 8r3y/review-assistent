import type { CaptureStartOptions } from '@shared/ipc';
import { PCM_SAMPLE_RATE, type ChannelId, type PcmMessage } from '@shared/transcript';
import workletUrl from './pcm-worklet.ts?worker&url';
import { startChunkedRecorder, type ChunkedRecorder } from './recorder';

const RECORDER_BITRATE = 96_000;

/**
 * Captures system audio (loopback via getDisplayMedia) and the microphone.
 * - STT path: a 16 kHz AudioContext (Chromium resamples) → worklet → Int16 frames → pipeline port.
 * - Recording path: a native-rate context merging mic (L) and system (R) → MediaRecorder → main.
 */
export class AudioCapture {
  private streams: MediaStream[] = [];
  private contexts: AudioContext[] = [];
  private recorder: ChunkedRecorder | null = null;

  constructor(private readonly port: MessagePort) {}

  /** @returns wall-clock ms when audio recording started, or null when not recording. */
  async start(options: CaptureStartOptions): Promise<number | null> {
    const system = await captureSystemAudio();
    this.streams.push(system);
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.micDeviceId ? { exact: options.micDeviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.streams.push(mic);

    await this.startPcm({ mic, system });
    return options.recordAudio ? this.startRecorder(mic, system) : null;
  }

  async stop(): Promise<void> {
    await this.recorder?.stop();
    this.recorder = null;
    for (const stream of this.streams) for (const track of stream.getTracks()) track.stop();
    this.streams = [];
    await Promise.all(this.contexts.map((ctx) => ctx.close()));
    this.contexts = [];
  }

  private async startPcm(sources: Record<ChannelId, MediaStream>): Promise<void> {
    const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    this.contexts.push(ctx);
    await ctx.audioWorklet.addModule(workletUrl);
    for (const [channel, stream] of Object.entries(sources) as [ChannelId, MediaStream][]) {
      const node = new AudioWorkletNode(ctx, 'pcm-frames', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent<ArrayBuffer | { error: string }>) => {
        if (!(event.data instanceof ArrayBuffer)) {
          console.error(`[capture] ${channel}: ${event.data.error}`);
          return;
        }
        const message: PcmMessage = { channel, pcm: event.data };
        // Electron's MessagePortMain cannot receive transferred ArrayBuffers (data arrives as null): copy.
        this.port.postMessage(message);
      };
      ctx.createMediaStreamSource(stream).connect(node);
    }
    await ctx.resume();
  }

  private async startRecorder(mic: MediaStream, system: MediaStream): Promise<number> {
    const ctx = new AudioContext();
    this.contexts.push(ctx);
    const merger = ctx.createChannelMerger(2);
    ctx.createMediaStreamSource(mic).connect(merger, 0, 0);
    ctx.createMediaStreamSource(system).connect(merger, 0, 1);
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 2;
    merger.connect(destination);

    this.recorder = await startChunkedRecorder(
      destination.stream,
      { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: RECORDER_BITRATE },
      (chunk) => window.api.invoke('capture:audio-chunk', chunk),
    );
    return this.recorder.startedAt;
  }
}

async function captureSystemAudio(): Promise<MediaStream> {
  // Main answers with the primary screen + 'loopback' audio; only the audio track is kept.
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  if (stream.getAudioTracks().length === 0) throw new Error('Системный звук недоступен');
  return stream;
}
