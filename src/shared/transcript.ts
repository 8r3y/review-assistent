// Transcript and audio types shared by pipeline, main and renderers. All times are session ms.

export type ChannelId = 'mic' | 'system';
export const CHANNELS: readonly ChannelId[] = ['mic', 'system'];

/** 'owner' is the user (mic channel); remote speakers are 'S1', 'S2', … from diarization. */
export type SpeakerId = string;
export const OWNER: SpeakerId = 'owner';

export interface Word {
  text: string;
  tStart: number;
  tEnd: number;
  confidence: number;
}

export interface Segment {
  id: string;
  channel: ChannelId;
  speaker: SpeakerId;
  text: string;
  tStart: number;
  tEnd: number;
  /** Wall-clock ISO time of tStart. */
  wall: string;
  words: Word[];
}

export interface PartialText {
  channel: ChannelId;
  speaker: SpeakerId | null;
  text: string;
  tStart: number;
}

export interface ChannelActivity {
  /** RMS level, dBFS (−100…0). */
  levelDb: number;
  speech: boolean;
}

export type AudioActivity = Record<ChannelId, ChannelActivity>;

export type SttStatus = 'off' | 'connecting' | 'open' | 'reconnecting' | 'error';

export const PCM_SAMPLE_RATE = 16000;
/** Samples per PCM frame sent from capture to pipeline (= one Silero VAD window, 32 ms). */
export const PCM_FRAME_SAMPLES = 512;
export const PCM_FRAME_MS = (PCM_FRAME_SAMPLES / PCM_SAMPLE_RATE) * 1000;

/** Message on the capture → pipeline MessagePort. `pcm` is Int16 mono @16 kHz, PCM_FRAME_SAMPLES long. */
export interface PcmMessage {
  channel: ChannelId;
  pcm: ArrayBuffer;
}

export function speakerLabel(speaker: SpeakerId): string {
  return speaker === OWNER ? 'Я' : speaker;
}
