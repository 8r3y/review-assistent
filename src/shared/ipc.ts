// IPC contracts shared by main, preload and renderer. Types only plus channel name lists.
import type { AssistantSettings, LlmProviderId, LlmRoute, LlmTask, Question, Turn } from './assistant';
import type { PlatformInfo } from './platform';
import type { AudioActivity, ChannelId, PartialText, Segment, SpeakerId, SttStatus } from './transcript';

export type OverlayMode = 'interactive' | 'passthrough';

export type SessionStatus = 'idle' | 'starting' | 'running' | 'stopping';

export type CaptureStatus = 'idle' | 'starting' | 'running' | 'error';

export type VideoStatus = 'idle' | 'starting' | 'recording' | 'stopping';

/** A screen or window that can be recorded. */
export interface VideoSource {
  /** desktopCapturer id: `screen:N:0` or `window:HANDLE:0`. */
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** PNG data URL preview. */
  thumbnail: string;
}

export interface VideoSettings {
  /** null → the primary screen. */
  sourceId: string | null;
  /** Remembered to find a window again after it was reopened (window ids change). */
  sourceName: string | null;
}

export type HotkeyAction =
  | 'session.toggle'
  | 'overlay.toggleVisible'
  | 'overlay.toggleMode'
  | 'overlay.opacityDown'
  | 'overlay.opacityUp'
  | 'overlay.scrollUp'
  | 'overlay.scrollDown'
  | 'video.toggle'
  | 'screenshot'
  | 'question.answer'
  | 'question.mark'
  | 'question.prev'
  | 'question.next'
  | 'question.dismiss';

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
  /** Terms the model should hear (Deepgram keyterm prompting), e.g. English tech words in Russian speech. */
  keyterms: string[];
}

/** More terms dilute the prompting: on a test call 80 terms recognized worse than none. */
export const MAX_STT_KEYTERMS = 50;

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
  video: VideoSettings & {
    status: VideoStatus;
    /** Wall-clock ms when the current recording started. */
    startedAt: number | null;
    error: string | null;
  };
  assistant: AssistantSettings & {
    keys: Record<LlmProviderId, boolean>;
    endpoints: Record<LlmProviderId, string | null>;
    /** Owner phrases that make a question of the last remote turns and answer it. */
    triggerPhrases: string[];
    error: string | null;
  };
  /** The question shown in the overlay and targeted by hotkeys. */
  questions: { currentId: string | null; index: number; total: number };
  hotkeys: HotkeyStatus[];
  pipeline: { alive: boolean };
  platform: PlatformInfo;
}

/** Options the capture window starts with. */
export interface CaptureStartOptions {
  micDeviceId: string | null;
  recordAudio: boolean;
}

/** Options the capture window starts a video recording with. */
export interface VideoStartOptions {
  /** Upper bounds; the source is downscaled, never upscaled. */
  maxWidth: number;
  maxHeight: number;
  maxFrameRate: number;
  bitrate: number;
  /**
   * Portal mode: record the screen stream kept open for the session (picked once in the portal dialog)
   * instead of opening the source picked in the control panel.
   */
  sessionSource: boolean;
}

/** Height of the overlay's top handle bar, px. In passthrough mode the overlay accepts mouse input only there. */
export const OVERLAY_HANDLE_HEIGHT = 28;

/** Width of the overlay's scrollbar, px. In passthrough mode the overlay also accepts mouse input over it. */
export const OVERLAY_SCROLLBAR_WIDTH = 14;

/** renderer → main request/response channels. */
export interface InvokeMap {
  'app:get-state': () => AppState;
  'session:start': () => void;
  'session:stop': () => void;
  'overlay:set-visible': (visible: boolean) => void;
  'overlay:set-mode': (mode: OverlayMode) => void;
  'overlay:set-opacity': (opacity: number) => void;
  'audio:set-settings': (patch: Partial<AudioSettings>) => void;
  'stt:set-settings': (patch: Partial<Omit<SttSettings, 'keyterms'>>) => void;
  /** Comma-separated terms, checked with Deepgram first. Resolves with an error (nothing saved) or null. */
  'stt:set-keyterms': (text: string) => string | null;
  /** Applies to the running session too. */
  'diarization:set-settings': (patch: Partial<DiarizationSettings>) => void;
  /** null removes the stored key. */
  'stt:set-key': (key: string | null) => void;
  'transcript:get': () => Segment[];
  'turns:get': () => Turn[];
  'questions:get': () => Question[];
  /** An id re-answers that question; null extends the last question with the phrases said since. */
  'questions:answer': (questionId: string | null) => void;
  'questions:dismiss': (questionId: string) => void;
  'questions:select': (questionId: string) => void;
  /** -1 previous, +1 next. */
  'questions:step': (delta: number) => void;
  /** Switching the provider without a model picks that provider's default model for the task. */
  'assistant:set-route': (task: LlmTask, patch: Partial<LlmRoute>) => void;
  /** null removes the stored key. */
  'assistant:set-key': (provider: LlmProviderId, key: string | null) => void;
  /** null or empty → the official endpoint. Resolves with an error message for an invalid URL. */
  'assistant:set-endpoint': (provider: LlmProviderId, url: string | null) => string | null;
  /** Comma-separated phrases; applies to the running session too. Resolves with the saved list. */
  'assistant:set-triggers': (text: string) => string[];
  'assistant:get-context': () => string;
  'assistant:set-context': (context: string) => void;
  /** Screens and windows with previews, for the source picker. */
  'video:list-sources': () => VideoSource[];
  'video:set-source': (source: { id: string; name: string } | null) => void;
  /** Portal mode: pick another source for the running session in the system dialog. */
  'video:pick-source': () => void;
  /** Recording needs a running session. */
  'video:start': () => void;
  'video:stop': () => void;
  /** Screenshot of the picked source into the last question, which is answered again. */
  'screenshot:take': () => void;
  /** Capture window only: a MediaRecorder chunk of audio.webm. */
  'capture:audio-chunk': (chunk: ArrayBuffer) => void;
  /** Capture window only: a MediaRecorder chunk of the current video file. */
  'capture:video-chunk': (chunk: ArrayBuffer) => void;
  /** Capture window only: the recorded source went away (window closed, display unplugged). */
  'capture:video-ended': () => void;
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
  /** A new session started: drop the previous transcript, turns and questions. */
  'transcript:reset': () => void;
  'turns:changed': (upserts: Turn[], removed: string[]) => void;
  'questions:changed': (question: Question) => void;
  /** Scroll the overlay by a page: -1 up, +1 down. */
  'overlay:scroll': (direction: -1 | 1) => void;
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
  'stt:set-keyterms',
  'diarization:set-settings',
  'stt:set-key',
  'transcript:get',
  'turns:get',
  'questions:get',
  'questions:answer',
  'questions:dismiss',
  'questions:select',
  'questions:step',
  'assistant:set-route',
  'assistant:set-key',
  'assistant:set-endpoint',
  'assistant:set-triggers',
  'assistant:get-context',
  'assistant:set-context',
  'video:list-sources',
  'video:set-source',
  'video:pick-source',
  'video:start',
  'video:stop',
  'screenshot:take',
  'capture:audio-chunk',
  'capture:video-chunk',
  'capture:video-ended',
] as const satisfies readonly InvokeChannel[];

export const EVENT_CHANNELS = [
  'app:state',
  'audio:activity',
  'transcript:partial',
  'transcript:final',
  'transcript:retract',
  'transcript:relabel',
  'transcript:reset',
  'turns:changed',
  'questions:changed',
  'overlay:scroll',
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

export interface VideoStartResult {
  /** User-facing error message, or null on success. */
  error: string | null;
  /** Wall-clock ms when the video recorder started. */
  startedAt: number | null;
  /** MediaRecorder mime type, e.g. `video/webm;codecs=h264`. */
  mimeType: string | null;
}

export interface ScreenshotResult {
  /** User-facing error message, or null on success. */
  error: string | null;
  /** Base64 PNG. */
  png: string | null;
}

/** Control API the capture page exposes on `window.captureControl`; main drives it via executeJavaScript. */
export interface CaptureControl {
  start(options: CaptureStartOptions): Promise<CaptureStartResult>;
  /** Stops audio and video. */
  stop(): Promise<void>;
  /** Records the source main's display-media handler picks for a video-only request. */
  startVideo(options: VideoStartOptions): Promise<VideoStartResult>;
  stopVideo(): Promise<void>;
  /** Portal mode: a PNG frame of the session's screen stream, scaled down to fit `maxSize`. */
  screenshot(
    options: VideoStartOptions,
    maxSize: { width: number; height: number },
  ): Promise<ScreenshotResult>;
  /** Portal mode: reopens the session's screen stream, the user picks the source again. */
  pickSource(options: VideoStartOptions): Promise<{ error: string | null }>;
}
