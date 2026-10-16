import { BrowserWindow, MessageChannelMain, app, shell } from 'electron';
import { join } from 'node:path';
import {
  MAX_STT_KEYTERMS,
  type AppState,
  type AudioSettings,
  type DiarizationSettings,
  type EventChannel,
  type EventMap,
  type OverlayMode,
  type SttSettings,
  type VideoSource,
  type VideoStartOptions,
} from '@shared/ipc';
import {
  DEFAULT_MODELS,
  type LlmProviderId,
  type LlmRoute,
  type LlmTask,
  type Question,
  type Turn,
} from '@shared/assistant';
import type { PipelineToMain } from '@shared/pipeline-protocol';
import { parseCommaList } from '@shared/text';
import type { Segment } from '@shared/transcript';
import { checkDeepgramSettings } from './deepgram-check';
import { CaptureHost, captureScreenshot, installDisplayMediaHandler, listVideoSources } from './capture-host';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { readOwnerContext, writeOwnerContext } from './owner-context';
import { PipelineHost } from './pipeline-host';
import { QuestionsView } from './questions-view';
import { SecretStore, type SecretName } from './secrets';
import { SessionManager } from './session';
import { SettingsStore } from './settings';
import { AppStore } from './state';
import { TrayController } from './tray';
import { createCaptureWindow } from './windows/capture';
import { createControlWindow } from './windows/control';
import { OverlayWindow, clampOpacity } from './windows/overlay';

const OPACITY_STEP = 0.1;
const PIPELINE_STOP_TIMEOUT_MS = 8000;
/** Assistant errors (bad key, refusal…) stay visible this long. */
const ASSISTANT_ERROR_MS = 12_000;
/** Full HD at 30 fps keeps screen text readable while the encoder stays light. */
const VIDEO_OPTIONS: VideoStartOptions = {
  maxWidth: 1920,
  maxHeight: 1080,
  maxFrameRate: 30,
  bitrate: 6_000_000,
};
const LLM_SECRETS: Record<LlmProviderId, SecretName> = {
  anthropic: 'anthropicApiKey',
  google: 'googleApiKey',
};

/** Wires windows, hotkeys, tray, session, capture and pipeline around the shared AppStore. */
export class AppController {
  private readonly settings = new SettingsStore();
  private readonly secrets = new SecretStore();
  private readonly session = new SessionManager();
  private readonly pipeline = new PipelineHost((alive) => this.setPipelineAlive(alive));
  readonly store: AppStore;
  private overlay!: OverlayWindow;
  private control!: BrowserWindow;
  private capture!: CaptureHost;
  private tray!: TrayController;
  private quitting = false;
  private readonly turns = new Map<string, Turn>();
  private readonly questions = new QuestionsView();
  private assistantErrorTimer: NodeJS.Timeout | null = null;

  constructor() {
    const { overlay, audio, video, stt, diarization, assistant } = this.settings.get();
    this.store = new AppStore({
      session: { status: 'idle', startedAt: null, dir: null },
      capture: { status: 'idle', error: null },
      audio,
      diarization: { threshold: diarization.threshold },
      stt: {
        ...stt,
        hasKey: this.secrets.has('deepgramApiKey'),
        status: { mic: 'off', system: 'off' },
        error: null,
      },
      overlay: { visible: true, mode: overlay.mode, opacity: clampOpacity(overlay.opacity) },
      video: { ...video, status: 'idle', startedAt: null, error: null },
      assistant: {
        ...assistant,
        keys: this.llmKeyFlags(),
        endpoints: this.llmEndpoints(),
        triggerPhrases: this.settings.get().triggerPhrases,
        error: null,
      },
      questions: this.questions.nav(),
      hotkeys: [],
      pipeline: { alive: false },
    });
    this.store.subscribe((state) => broadcast('app:state', state));
    this.pipeline.onMessage((message) => this.handlePipeline(message));
  }

  start(): void {
    installDisplayMediaHandler();
    const { overlay } = this.settings.get();
    this.overlay = new OverlayWindow({
      ...overlay,
      onBoundsChanged: (bounds) => this.settings.update((s) => ({ ...s, overlay: { ...s.overlay, bounds } })),
    });
    this.overlay.win.once('ready-to-show', () => this.overlay.setVisible(this.store.get().overlay.visible));
    this.control = createControlWindow(() => this.quitting);
    this.capture = new CaptureHost(createCaptureWindow());
    this.tray = new TrayController({
      showControl: () => this.showControl(),
      toggleSession: () => this.toggleSession(),
      setOverlayVisible: (visible) => this.setOverlayVisible(visible),
      setOverlayMode: (mode) => this.setOverlayMode(mode),
      setOverlayOpacity: (opacity) => this.setOverlayOpacity(opacity),
      setRecordAudio: (recordAudio) => this.setAudioSettings({ recordAudio }),
      toggleVideo: () => this.toggleVideo(),
      answerQuestion: () => this.answerQuestion(null),
      openSessionsFolder: () => void shell.openPath(SessionManager.rootDir()),
      openCurrentSessionFolder: () => {
        const dir = this.store.get().session.dir;
        if (dir) void shell.openPath(dir);
      },
      quit: () => this.quit(),
    });
    this.store.subscribe((state) => this.tray.update(state));
    this.registerHotkeys();
    this.tray.update(this.store.get());
    this.pipeline.start();
  }

  shutdown(): void {
    this.quitting = true;
    unregisterHotkeys();
    void this.session.stop();
    this.pipeline.stop();
    this.settings.flush();
    this.tray?.destroy();
  }

  getState(): AppState {
    return this.store.get();
  }

  getTranscript(): Segment[] {
    return this.session.transcript;
  }

  isCaptureSender(sender: Electron.WebContents): boolean {
    return this.capture.isCaptureSender(sender);
  }

  appendAudioChunk(chunk: ArrayBuffer): void {
    this.session.appendAudio(chunk);
  }

  appendVideoChunk(chunk: ArrayBuffer): void {
    this.session.appendVideo(chunk);
  }

  listVideoSources(): Promise<VideoSource[]> {
    return listVideoSources();
  }

  setVideoSource(source: { id: string; name: string } | null): void {
    const video = { sourceId: source?.id ?? null, sourceName: source?.name ?? null };
    this.settings.update((s) => ({ ...s, video }));
    this.store.update((s) => ({ ...s, video: { ...s.video, ...video } }));
  }

  async startVideo(): Promise<void> {
    const { session, video } = this.store.get();
    if (video.status !== 'idle') return;
    if (session.status !== 'running') {
      this.setVideoState({ error: 'Видео пишется во время сессии — сначала начните сессию' });
      return;
    }
    const source = video.sourceId ? { id: video.sourceId, name: video.sourceName } : null;
    this.setVideoState({ status: 'starting', error: null });
    this.session.beginVideo(video.sourceName ?? 'Основной экран');
    try {
      const { startedAt, mimeType } = await this.capture.startVideo(source, VIDEO_OPTIONS);
      if (this.store.get().session.status !== 'running') {
        // The session is stopping: it closed the video file before the recorder came up.
        await this.capture.stopVideo();
        this.setVideoState({ status: 'idle', startedAt: null });
        return;
      }
      this.session.setVideoStarted(startedAt, mimeType);
      this.setVideoState({ status: 'recording', startedAt });
    } catch (e) {
      await this.session.endVideo({ discard: true });
      this.setVideoState({
        status: 'idle',
        startedAt: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async stopVideo(): Promise<void> {
    if (this.store.get().video.status !== 'recording') return;
    this.setVideoState({ status: 'stopping' });
    await this.capture.stopVideo();
    await this.session.endVideo();
    this.setVideoState({ status: 'idle', startedAt: null });
  }

  toggleVideo(): void {
    const status = this.store.get().video.status;
    if (status === 'recording') void this.stopVideo();
    else if (status === 'idle') void this.startVideo();
  }

  /**
   * Captures the source picked for video and attaches it to the last question (taking in the remote
   * phrases said since, as the extend hotkey does), then answers again.
   */
  async takeScreenshot(): Promise<void> {
    if (!this.requireRunningSession()) return;
    const { sourceId, sourceName } = this.store.get().video;
    try {
      const png = await captureScreenshot(sourceId ? { id: sourceId, name: sourceName } : null);
      const file = this.session.saveScreenshot(png);
      if (!file) return;
      this.pipeline.send({ type: 'assistant:screenshot', file, png: png.toString('base64') });
    } catch (e) {
      this.setAssistantError(e instanceof Error ? e.message : String(e));
    }
  }

  /** The capture window already stopped the recorder: the source went away. */
  async onVideoEnded(): Promise<void> {
    if (this.store.get().video.status !== 'recording') return;
    await this.session.endVideo();
    this.setVideoState({
      status: 'idle',
      startedAt: null,
      error: 'Источник видео закрыт — запись остановлена',
    });
  }

  private setVideoState(patch: Partial<AppState['video']>): void {
    this.store.update((s) => ({ ...s, video: { ...s.video, ...patch } }));
  }

  showControl(): void {
    if (this.control.isMinimized()) this.control.restore();
    this.control.show();
    this.control.focus();
  }

  async startSession(): Promise<void> {
    if (this.store.get().session.status !== 'idle') return;
    const { audio, stt, vad, gate, diarization, assistant } = this.settings.get();
    const info = this.session.start({ recordAudio: audio.recordAudio });
    this.turns.clear();
    this.questions.reset();
    broadcast('transcript:reset');
    this.setAssistantError(null);
    this.setVideoState({ error: null });
    this.store.update((s) => ({ ...s, questions: this.questions.nav() }));
    this.store.update((s) => ({
      ...s,
      session: { status: 'starting', startedAt: info.clock.startedAtWall, dir: info.dir },
      capture: { status: 'starting', error: null },
      stt: { ...s.stt, error: null },
    }));

    const apiKey = this.secrets.get('deepgramApiKey');
    this.pipeline.send({
      type: 'session:start',
      config: {
        sessionId: info.id,
        startedAtWall: info.clock.startedAtWall,
        dir: info.dir,
        vad: { ...vad, modelPath: modelPath('silero_vad.onnx') },
        gate,
        diarization: { ...diarization, modelPath: modelPath('speaker_eres2net_base_16k.onnx') },
        stt: { provider: 'deepgram', apiKey, ...stt },
        assistant: {
          keys: { anthropic: this.secrets.get('anthropicApiKey'), google: this.secrets.get('googleApiKey') },
          endpoints: this.llmEndpoints(),
          settings: assistant,
          ownerContext: readOwnerContext(),
          triggerPhrases: this.settings.get().triggerPhrases,
        },
      },
    });
    if (!apiKey) {
      this.store.update((s) => ({
        ...s,
        stt: { ...s.stt, error: 'Нет API-ключа Deepgram — транскрибация выключена' },
      }));
    }

    const { port1, port2 } = new MessageChannelMain();
    this.pipeline.send({ type: 'audio-port' }, [port2]);
    try {
      const recordingStartedAt = await this.capture.start(
        { micDeviceId: audio.micDeviceId, recordAudio: audio.recordAudio },
        port1,
      );
      if (recordingStartedAt !== null) this.session.setRecordingStartedAt(recordingStartedAt);
      this.store.update((s) => ({
        ...s,
        session: { ...s.session, status: 'running' },
        capture: { status: 'running', error: null },
      }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.stopSession({ openFolder: false });
      this.store.update((s) => ({ ...s, capture: { status: 'error', error } }));
    }
  }

  /** @param openFolder show the finished session's files (not when the session failed to start). */
  async stopSession({ openFolder = true } = {}): Promise<void> {
    const { status, dir } = this.store.get().session;
    if (status === 'idle' || status === 'stopping') return;
    this.store.update((s) => ({ ...s, session: { ...s.session, status: 'stopping' } }));
    await this.stopVideo();
    await this.capture.stop();
    const stopped = this.pipeline.waitFor('session:stopped', PIPELINE_STOP_TIMEOUT_MS);
    this.pipeline.send({ type: 'session:stop' });
    await stopped;
    // Muxing the videos with the call audio happens here and can take a few seconds.
    const warnings = await this.session.stop();
    broadcast('audio:activity', {
      mic: { levelDb: -100, speech: false },
      system: { levelDb: -100, speech: false },
    });
    this.store.update((s) => ({
      ...s,
      session: { status: 'idle', startedAt: null, dir: null },
      capture: { status: 'idle', error: warnings.join('; ') || null },
      video: { ...s.video, status: 'idle', startedAt: null },
      stt: { ...s.stt, status: { mic: 'off', system: 'off' } },
    }));
    // After the files are finalized: the videos are complete by now.
    if (openFolder && dir) void shell.openPath(dir);
  }

  toggleSession(): void {
    const status = this.store.get().session.status;
    if (status === 'running') void this.stopSession();
    else if (status === 'idle') void this.startSession();
  }

  setAudioSettings(patch: Partial<AudioSettings>): void {
    const audio = { ...this.settings.get().audio, ...patch };
    this.settings.update((s) => ({ ...s, audio }));
    this.store.update((s) => ({ ...s, audio }));
  }

  setDiarizationSettings(patch: Partial<DiarizationSettings>): void {
    const diarization = { ...this.settings.get().diarization, ...patch };
    this.settings.update((s) => ({ ...s, diarization }));
    this.store.update((s) => ({ ...s, diarization: { threshold: diarization.threshold } }));
    if (patch.threshold !== undefined) {
      this.pipeline.send({ type: 'diarization:set-threshold', threshold: diarization.threshold });
    }
  }

  getTurns(): Turn[] {
    return [...this.turns.values()];
  }

  getQuestions(): Question[] {
    return this.questions.list();
  }

  /** null → extend the last question with the remote phrases said since its mark and answer again. */
  answerQuestion(questionId: string | null): void {
    if (!this.requireRunningSession()) return;
    this.pipeline.send({ type: 'assistant:answer', questionId });
  }

  markQuestion(): void {
    if (!this.requireRunningSession()) return;
    this.pipeline.send({ type: 'assistant:mark-question' });
  }

  dismissQuestion(questionId: string | null): void {
    const id = questionId ?? this.questions.current()?.id;
    if (id && this.requireRunningSession()) this.pipeline.send({ type: 'assistant:dismiss', questionId: id });
  }

  selectQuestion(questionId: string): void {
    this.questions.select(questionId, Date.now());
    this.store.update((s) => ({ ...s, questions: this.questions.nav() }));
  }

  stepQuestion(delta: number): void {
    this.questions.step(delta, Date.now());
    this.store.update((s) => ({ ...s, questions: this.questions.nav() }));
  }

  setAssistantRoute(task: LlmTask, patch: Partial<LlmRoute>): void {
    const { assistant, assistantModels } = this.settings.get();
    const current = assistant[task];
    const route: LlmRoute = { ...current, ...patch };
    if (patch.provider && patch.provider !== current.provider && !patch.model) {
      route.model = assistantModels[task][patch.provider] ?? DEFAULT_MODELS[patch.provider][task];
    }
    // Remember the model per provider so switching providers back and forth does not lose it.
    const models = {
      ...assistantModels,
      [task]: { ...assistantModels[task], [current.provider]: current.model, [route.provider]: route.model },
    };
    this.settings.update((s) => ({
      ...s,
      assistant: { ...s.assistant, [task]: route },
      assistantModels: models,
    }));
    this.store.update((s) => ({ ...s, assistant: { ...s.assistant, [task]: route } }));
  }

  setAssistantKey(provider: LlmProviderId, key: string | null): void {
    this.secrets.set(LLM_SECRETS[provider], key?.trim() || null);
    this.store.update((s) => ({ ...s, assistant: { ...s.assistant, keys: this.llmKeyFlags() } }));
  }

  /** @returns an error message for an invalid URL; empty or null restores the official endpoint. */
  setAssistantEndpoint(provider: LlmProviderId, url: string | null): string | null {
    const value = url?.trim() || null;
    if (value) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return 'Некорректный адрес';
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        return 'Адрес должен начинаться с https://';
    }
    this.settings.update((s) => {
      const endpoints = { ...s.assistantEndpoints };
      if (value) endpoints[provider] = value;
      else delete endpoints[provider];
      return { ...s, assistantEndpoints: endpoints };
    });
    this.store.update((s) => ({ ...s, assistant: { ...s.assistant, endpoints: this.llmEndpoints() } }));
    return null;
  }

  private llmEndpoints(): Record<LlmProviderId, string | null> {
    const stored = this.settings.get().assistantEndpoints;
    return { anthropic: stored.anthropic ?? null, google: stored.google ?? null };
  }

  private llmKeyFlags(): Record<LlmProviderId, boolean> {
    return { anthropic: this.secrets.has('anthropicApiKey'), google: this.secrets.has('googleApiKey') };
  }

  setTriggerPhrases(text: string): string[] {
    const triggerPhrases = parseCommaList(text);
    this.settings.update((s) => ({ ...s, triggerPhrases }));
    this.store.update((s) => ({ ...s, assistant: { ...s.assistant, triggerPhrases } }));
    this.pipeline.send({ type: 'assistant:set-triggers', phrases: triggerPhrases });
    return triggerPhrases;
  }

  getOwnerContext(): string {
    return readOwnerContext();
  }

  setOwnerContext(text: string): void {
    writeOwnerContext(text);
  }

  setSttSettings(patch: Partial<SttSettings>): void {
    const stt = { ...this.settings.get().stt, ...patch };
    this.settings.update((s) => ({ ...s, stt }));
    this.store.update((s) => ({ ...s, stt: { ...s.stt, ...stt } }));
  }

  /** @returns an error (nothing saved) when there are too many terms or Deepgram rejects them. */
  async setSttKeyterms(text: string): Promise<string | null> {
    const keyterms = parseCommaList(text);
    if (keyterms.length > MAX_STT_KEYTERMS) {
      return `Терминов ${keyterms.length} — максимум ${MAX_STT_KEYTERMS}: длинный список ухудшает распознавание`;
    }
    const stt = { ...this.settings.get().stt, keyterms };
    const apiKey = this.secrets.get('deepgramApiKey');
    const error = apiKey && keyterms.length > 0 ? await checkDeepgramSettings(apiKey, stt) : null;
    if (error) return error;
    this.setSttSettings({ keyterms });
    return null;
  }

  setSttKey(key: string | null): void {
    this.secrets.set('deepgramApiKey', key?.trim() || null);
    this.store.update((s) => ({ ...s, stt: { ...s.stt, hasKey: this.secrets.has('deepgramApiKey') } }));
  }

  setOverlayVisible(visible: boolean): void {
    this.overlay.setVisible(visible);
    this.store.update((s) => ({ ...s, overlay: { ...s.overlay, visible } }));
  }

  setOverlayMode(mode: OverlayMode): void {
    this.overlay.setMode(mode);
    this.store.update((s) => ({ ...s, overlay: { ...s.overlay, mode } }));
    this.settings.update((s) => ({ ...s, overlay: { ...s.overlay, mode } }));
  }

  setOverlayOpacity(opacity: number): void {
    const value = this.overlay.setOpacity(opacity);
    this.store.update((s) => ({ ...s, overlay: { ...s.overlay, opacity: value } }));
    this.settings.update((s) => ({ ...s, overlay: { ...s.overlay, opacity: value } }));
  }

  quit(): void {
    this.quitting = true;
    app.quit();
  }

  private handlePipeline(message: PipelineToMain): void {
    switch (message.type) {
      case 'activity':
        broadcast('audio:activity', message.activity);
        break;
      case 'partial':
        broadcast('transcript:partial', message.partial);
        break;
      case 'final':
        this.session.addSegment(message.segment);
        broadcast('transcript:final', message.segment);
        break;
      case 'turns':
        for (const id of message.removed) this.turns.delete(id);
        for (const turn of message.upserts) this.turns.set(turn.id, turn);
        broadcast('turns:changed', message.upserts, message.removed);
        break;
      case 'question':
        this.questions.upsert(message.question, message.focus, Date.now());
        broadcast('questions:changed', message.question);
        if (message.question.answer?.error) this.setAssistantError(message.question.answer.error);
        this.store.update((s) => ({ ...s, questions: this.questions.nav() }));
        break;
      case 'assistant-error':
        this.setAssistantError(message.message);
        break;
      case 'relabel':
        this.session.relabelSegment(message.segmentId, message.speaker);
        broadcast('transcript:relabel', message.segmentId, message.speaker);
        break;
      case 'retract':
        this.session.retractSegment(message.segmentId);
        broadcast('transcript:retract', message.segmentId);
        break;
      case 'stt-status':
        this.store.update((s) => ({
          ...s,
          stt: {
            ...s.stt,
            status: { ...s.stt.status, [message.channel]: message.status },
            error: message.error ?? (message.status === 'open' ? null : s.stt.error),
          },
        }));
        break;
    }
  }

  private registerHotkeys(): void {
    const overlay = (): AppState['overlay'] => this.store.get().overlay;
    const hotkeys = registerHotkeys(this.settings.get().hotkeys, {
      'session.toggle': () => this.toggleSession(),
      'overlay.toggleVisible': () => this.setOverlayVisible(!overlay().visible),
      'overlay.toggleMode': () =>
        this.setOverlayMode(overlay().mode === 'interactive' ? 'passthrough' : 'interactive'),
      'overlay.opacityDown': () => this.setOverlayOpacity(overlay().opacity - OPACITY_STEP),
      'overlay.opacityUp': () => this.setOverlayOpacity(overlay().opacity + OPACITY_STEP),
      'overlay.scrollUp': () => broadcast('overlay:scroll', -1),
      'overlay.scrollDown': () => broadcast('overlay:scroll', 1),
      'video.toggle': () => this.toggleVideo(),
      screenshot: () => void this.takeScreenshot(),
      'question.answer': () => this.answerQuestion(null),
      'question.mark': () => this.markQuestion(),
      'question.prev': () => this.stepQuestion(-1),
      'question.next': () => this.stepQuestion(1),
      'question.dismiss': () => this.dismissQuestion(null),
    });
    this.store.update((s) => ({ ...s, hotkeys }));
  }

  private requireRunningSession(): boolean {
    if (this.store.get().session.status === 'running') return true;
    this.setAssistantError('Сессия не запущена');
    return false;
  }

  private setAssistantError(error: string | null): void {
    if (this.assistantErrorTimer) clearTimeout(this.assistantErrorTimer);
    this.assistantErrorTimer = error
      ? setTimeout(() => this.setAssistantError(null), ASSISTANT_ERROR_MS)
      : null;
    if (this.store.get().assistant.error === error) return;
    this.store.update((s) => ({ ...s, assistant: { ...s.assistant, error } }));
  }

  private setPipelineAlive(alive: boolean): void {
    if (this.store.get().pipeline.alive === alive) return;
    this.store.update((s) => ({ ...s, pipeline: { alive } }));
  }
}

function modelPath(file: string): string {
  const base = app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');
  return join(base, 'models', file);
}

function broadcast<C extends EventChannel>(channel: C, ...args: Parameters<EventMap[C]>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isCrashed()) continue;
    try {
      win.webContents.send(channel, ...args);
    } catch {
      // The frame is being torn down (app shutdown or reload).
    }
  }
}
