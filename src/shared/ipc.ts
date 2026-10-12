// IPC contracts shared by main, preload and renderer. Types only plus channel name lists.
import type { AudioActivity, ChannelId, PartialText, Segment, SpeakerId, SttStatus } from './transcript';

export type OverlayMode = 'interactive' | 'passthrough';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'stopping';

export type CaptureStatus = 'idle' | 'starting' | 'running' | 'error';

export type HotkeyAction =
  | 'session.toggle'
  | 'overlay.toggleVisible'
  | 'overlay.toggleMode'
  | 'overlay.opacityDown'
  | 'overlay.opacityUp'
  | 'video.toggle'
  | 'screenshot'
  | 'marker'
  | 'summarize.now';

export type HotkeyBindings = Record<HotkeyAction, string>;

export interface HotkeyStatus {
  action: HotkeyAction;
  accelerator: string;
  /** The feature behind the action is implemented; unavailable actions are not registered. */
  available: boolean;
  registered: boolean;
}

export interface AudioSettings {
  /** null → system default microphone. */
  micDeviceId: string | null;
  /** Record a stereo audio.webm (L = mic, R = system) into the session folder. */
  recordAudio: boolean;
}

export interface SttSettings {
  model: string;
  language: string;
}

export interface DiarizationSettings {
  /** Voice similarity needed to treat two phrases as one speaker (0…1); higher splits more speakers. */
  threshold: number;
}

export interface AppState {
  session: { status: SessionStatus; startedAt: number | null; dir: string | null };
  capture: { status: CaptureStatus; error: string | null };
  audio: AudioSettings;
  diarization: DiarizationSettings;
  stt: SttSettings & {
    hasKey: boolean;
    status: Record<ChannelId, SttStatus>;
    error: string | null;
  };
  overlay: { visible: boolean; mode: OverlayMode; opacity: number };
  hotkeys: HotkeyStatus[];
  pipeline: { alive: boolean };
}

/** Options the capture window starts with. */
export interface CaptureStartOptions {
  micDeviceId: string | null;
  recordAudio: boolean;
}

/** Height of the overlay's top handle bar, px. In passthrough mode the overlay accepts mouse input only there. */
export const OVERLAY_HANDLE_HEIGHT = 28;

/** renderer → main request/response channels. */
export interface InvokeMap {
  'app:get-state': () => AppState;
  'session:start': () => void;
  'session:stop': () => void;
  'overlay:set-visible': (visible: boolean) => void;
  'overlay:set-mode': (mode: OverlayMode) => void;
  'overlay:set-opacity': (opacity: number) => void;
  'audio:set-settings': (patch: Partial<AudioSettings>) => void;
  'stt:set-settings': (patch: Partial<SttSettings>) => void;
  /** Applies to the running session too. */
  'diarization:set-settings': (patch: Partial<DiarizationSettings>) => void;
  /** null removes the stored key. */
  'stt:set-key': (key: string | null) => void;
  'transcript:get': () => Segment[];
  /** Capture window only: a MediaRecorder chunk of audio.webm. */
  'capture:audio-chunk': (chunk: ArrayBuffer) => void;
}

/** main → renderer push events. */
export interface EventMap {
  'app:state': (state: AppState) => void;
  'audio:activity': (activity: AudioActivity) => void;
  'transcript:partial': (partial: PartialText) => void;
  'transcript:final': (segment: Segment) => void;
  'transcript:retract': (segmentId: string) => void;
  /** Diarization re-clustering changed the speaker of a published segment. */
  'transcript:relabel': (segmentId: string, speaker: SpeakerId) => void;
  /** A new session started: drop the previous transcript. */
  'transcript:reset': () => void;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;

export const INVOKE_CHANNELS = [
  'app:get-state',
  'session:start',
  'session:stop',
  'overlay:set-visible',
  'overlay:set-mode',
  'overlay:set-opacity',
  'audio:set-settings',
  'stt:set-settings',
  'diarization:set-settings',
  'stt:set-key',
  'transcript:get',
  'capture:audio-chunk',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'app:state',
  'audio:activity',
  'transcript:partial',
  'transcript:final',
  'transcript:retract',
  'transcript:relabel',
  'transcript:reset',
] as const satisfies readonly EventChannel[];

export interface RendererApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: Parameters<InvokeMap[C]>
  ): Promise<Awaited<ReturnType<InvokeMap[C]>>>;
  on<C extends EventChannel>(channel: C, listener: EventMap[C]): () => void;
}

export interface CaptureStartResult {
  /** User-facing error message, or null on success. */
  error: string | null;
  /** Wall-clock ms when the audio recorder started, if recording. */
  recordingStartedAt: number | null;
}

/** Control API the capture page exposes on `window.captureControl`; main drives it via executeJavaScript. */
export interface CaptureControl {
  start(options: CaptureStartOptions): Promise<CaptureStartResult>;
  stop(): Promise<void>;
}
