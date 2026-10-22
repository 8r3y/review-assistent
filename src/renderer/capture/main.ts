// Hidden capture window. Main drives it through window.captureControl (executeJavaScript).
import type {
  CaptureControl,
  CaptureStartOptions,
  CaptureStartResult,
  ScreenshotResult,
  VideoStartOptions,
  VideoStartResult,
} from '@shared/ipc';
import { AudioCapture } from './audio-capture';
import { SessionSource } from './session-source';
import { VideoCapture } from './video-capture';

let pcmPort: MessagePort | null = null;
let capture: AudioCapture | null = null;
let video: VideoCapture | null = null;
const sessionSource = new SessionSource();

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'capture:port') return;
  pcmPort?.close();
  pcmPort = event.ports[0] ?? null;
});

const control: CaptureControl = {
  async start(options: CaptureStartOptions): Promise<CaptureStartResult> {
    await control.stop();
    if (!pcmPort) return { error: 'Нет канала к pipeline', recordingStartedAt: null };
    const next = new AudioCapture(pcmPort);
    try {
      const recordingStartedAt = await next.start(options);
      capture = next;
      return { error: null, recordingStartedAt };
    } catch (e) {
      await next.stop();
      return { error: describeError(e), recordingStartedAt: null };
    }
  },
  async stop(): Promise<void> {
    const current = capture;
    capture = null;
    await Promise.all([control.stopVideo(), current?.stop()]);
    sessionSource.close();
  },
  async startVideo(options: VideoStartOptions): Promise<VideoStartResult> {
    await control.stopVideo();
    const next = new VideoCapture(() => {
      if (video !== next) return;
      void control.stopVideo().then(() => window.api.invoke('capture:video-ended'));
    });
    try {
      const source = options.sessionSource ? await sessionSource.track(options) : null;
      const { startedAt, mimeType } = await next.start(options, source);
      video = next;
      return { error: null, startedAt, mimeType };
    } catch (e) {
      await next.stop();
      return { error: describeVideoError(e), startedAt: null, mimeType: null };
    }
  },
  async stopVideo(): Promise<void> {
    const current = video;
    video = null;
    await current?.stop();
  },
  async screenshot(options, maxSize): Promise<ScreenshotResult> {
    try {
      return { error: null, png: await sessionSource.screenshot(options, maxSize) };
    } catch (e) {
      return { error: describeVideoError(e), png: null };
    }
  },
  async pickSource(options): Promise<{ error: string | null }> {
    try {
      await sessionSource.reopen(options);
      return { error: null };
    } catch (e) {
      return { error: describeVideoError(e) };
    }
  },
};

declare global {
  interface Window {
    captureControl: CaptureControl;
  }
}
window.captureControl = control;

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
        return 'Доступ к микрофону или захвату звука запрещён';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Выбранный микрофон не найден';
      case 'NotReadableError':
        return 'Микрофон занят другим приложением или недоступен';
    }
    return `${e.name}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function describeVideoError(e: unknown): string {
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
    return 'Источник видео не найден — выберите экран или окно заново';
  }
  if (e instanceof DOMException && e.name === 'NotReadableError')
    return 'Не удалось захватить источник видео';
  return e instanceof Error ? e.message : String(e);
}
