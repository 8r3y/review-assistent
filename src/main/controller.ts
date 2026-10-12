import { BrowserWindow, MessageChannelMain, app, shell } from 'electron';
import { join } from 'node:path';
import type {
  AppState,
  AudioSettings,
  DiarizationSettings,
  EventChannel,
  EventMap,
  OverlayMode,
  SttSettings,
} from '@shared/ipc';
import type { PipelineToMain } from '@shared/pipeline-protocol';
import type { Segment } from '@shared/transcript';
import { CaptureHost, installDisplayMediaHandler } from './capture-host';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { PipelineHost } from './pipeline-host';
import { SecretStore } from './secrets';
import { SessionManager } from './session';
import { SettingsStore } from './settings';
import { AppStore } from './state';
import { TrayController } from './tray';
import { createCaptureWindow } from './windows/capture';
import { createControlWindow } from './windows/control';
import { OverlayWindow, clampOpacity } from './windows/overlay';

const OPACITY_STEP = 0.1;
const PIPELINE_STOP_TIMEOUT_MS = 8000;

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

  constructor() {
    const { overlay, audio, stt, diarization } = this.settings.get();
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

  showControl(): void {
    if (this.control.isMinimized()) this.control.restore();
    this.control.show();
    this.control.focus();
  }

  async startSession(): Promise<void> {
    if (this.store.get().session.status !== 'idle') return;
    const { audio, stt, vad, gate, diarization } = this.settings.get();
    const info = this.session.start({ recordAudio: audio.recordAudio });
    broadcast('transcript:reset');
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
      await this.stopSession();
      this.store.update((s) => ({ ...s, capture: { status: 'error', error } }));
    }
  }

  async stopSession(): Promise<void> {
    const status = this.store.get().session.status;
    if (status === 'idle' || status === 'stopping') return;
    this.store.update((s) => ({ ...s, session: { ...s.session, status: 'stopping' } }));
    await this.capture.stop();
    const stopped = this.pipeline.waitFor('session:stopped', PIPELINE_STOP_TIMEOUT_MS);
    this.pipeline.send({ type: 'session:stop' });
    await stopped;
    const warning = await this.session.stop();
    broadcast('audio:activity', {
      mic: { levelDb: -100, speech: false },
      system: { levelDb: -100, speech: false },
    });
    this.store.update((s) => ({
      ...s,
      session: { status: 'idle', startedAt: null, dir: null },
      capture: { status: 'idle', error: warning },
      stt: { ...s.stt, status: { mic: 'off', system: 'off' } },
    }));
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

  setSttSettings(patch: Partial<SttSettings>): void {
    const stt = { ...this.settings.get().stt, ...patch };
    this.settings.update((s) => ({ ...s, stt }));
    this.store.update((s) => ({ ...s, stt: { ...s.stt, ...stt } }));
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
    });
    this.store.update((s) => ({ ...s, hotkeys }));
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
