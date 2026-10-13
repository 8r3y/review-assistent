import {
  desktopCapturer,
  session,
  type BrowserWindow,
  type DesktopCapturerSource,
  type MessagePortMain,
} from 'electron';
import type {
  CaptureStartOptions,
  CaptureStartResult,
  VideoSource,
  VideoStartOptions,
  VideoStartResult,
} from '@shared/ipc';

const STOP_TIMEOUT_MS = 5000;

/** The source the next video-only getDisplayMedia() request records; set by CaptureHost.startVideo. */
let pendingVideoSource: { id: string; name: string | null } | null = null;

/**
 * Answers getDisplayMedia() without a picker:
 * - audio requests get system audio (WASAPI loopback on Windows); the capture window drops their video track;
 * - video-only requests get the screen or window picked for recording.
 */
export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const resolve = request.audioRequested
        ? desktopCapturer.getSources({ types: ['screen'], thumbnailSize: NO_THUMBNAIL }).then((sources) => {
            const screen = sources[0];
            if (!screen) throw new Error('no screen source');
            return { video: screen, audio: 'loopback' as const };
          })
        : findVideoSource(pendingVideoSource).then((video) => {
            if (!video) throw new Error('video source not found');
            return { video };
          });
      resolve.then(callback).catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

const NO_THUMBNAIL = { width: 0, height: 0 };
const THUMBNAIL = { width: 320, height: 180 };

/** Screens and other apps' windows; this app's own windows are left out. */
export async function listVideoSources(): Promise<VideoSource[]> {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL });
  return sources
    .filter((s) => !isOwnWindow(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    }));
}

/** Screenshots are scaled down to fit this box (the model downsizes larger images anyway). */
const SCREENSHOT_SIZE = { width: 1920, height: 1200 };

/**
 * Captures the screen or window picked for video (null → the primary screen) as PNG.
 * Rejects with a user-facing message.
 */
export async function captureScreenshot(source: { id: string; name: string | null } | null): Promise<Buffer> {
  const found = await findVideoSource(source, SCREENSHOT_SIZE);
  if (!found) throw new Error('Источник для скриншота не найден — выберите экран или окно заново');
  if (found.thumbnail.isEmpty()) throw new Error('Не удалось снять источник — окно свёрнуто?');
  return found.thumbnail.toPNG();
}

/**
 * Finds the source by id; a window that was reopened has a new id, so it is matched by title.
 * null → the primary screen. Every candidate's thumbnail is captured at `thumbnailSize`.
 */
async function findVideoSource(
  wanted: { id: string; name: string | null } | null,
  thumbnailSize = NO_THUMBNAIL,
): Promise<DesktopCapturerSource | null> {
  // Only sources of the wanted kind: full-size thumbnails of every window would be slow.
  const kind = wanted?.id.startsWith('window:') ? 'window' : 'screen';
  const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize });
  if (!wanted) return sources[0] ?? null;
  return (
    sources.find((s) => s.id === wanted.id) ??
    sources.find((s) => s.name === wanted.name && !isOwnWindow(s.id)) ??
    null
  );
}

/** desktopCapturer ids are `window:HANDLE:1` for this process's windows. */
function isOwnWindow(id: string): boolean {
  return id.startsWith('window:') && id.endsWith(':1');
}

/** Drives the hidden capture window (audio graph, PCM frames, audio and video recorders). */
export class CaptureHost {
  constructor(private readonly win: BrowserWindow) {}

  isCaptureSender(sender: Electron.WebContents): boolean {
    return !this.win.isDestroyed() && sender === this.win.webContents;
  }

  /**
   * Hands the PCM port to the page, then starts capture. Rejects with a user-facing message.
   * @returns wall-clock ms when audio recording started, if it did.
   */
  async start(options: CaptureStartOptions, pcmPort: MessagePortMain): Promise<number | null> {
    this.win.webContents.postMessage('capture:port', null, [pcmPort]);
    // executeJavaScript with userGesture=true: getDisplayMedia may require transient activation.
    const result = (await this.win.webContents.executeJavaScript(
      `window.captureControl.start(${JSON.stringify(options)})`,
      true,
    )) as CaptureStartResult;
    if (result.error) throw new Error(result.error);
    return result.recordingStartedAt;
  }

  /**
   * Starts recording a screen or window (null → the primary screen). Rejects with a user-facing message.
   * @returns when the recorder started and its mime type.
   */
  async startVideo(
    source: { id: string; name: string | null } | null,
    options: VideoStartOptions,
  ): Promise<{ startedAt: number; mimeType: string }> {
    pendingVideoSource = source;
    const result = (await this.win.webContents.executeJavaScript(
      `window.captureControl.startVideo(${JSON.stringify(options)})`,
      true,
    )) as VideoStartResult;
    if (result.error || result.startedAt === null || !result.mimeType) {
      throw new Error(result.error ?? 'Запись видео не запустилась');
    }
    return { startedAt: result.startedAt, mimeType: result.mimeType };
  }

  async stopVideo(): Promise<void> {
    if (this.win.isDestroyed()) return;
    await Promise.race([
      this.win.webContents.executeJavaScript('window.captureControl.stopVideo()', true),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
  }

  async stop(): Promise<void> {
    if (this.win.isDestroyed()) return;
    await Promise.race([
      this.win.webContents.executeJavaScript('window.captureControl.stop()', true),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
  }
}
