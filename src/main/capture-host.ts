import { desktopCapturer, session, type BrowserWindow, type MessagePortMain } from 'electron';
import type { CaptureStartOptions, CaptureStartResult } from '@shared/ipc';

const STOP_TIMEOUT_MS = 5000;

/**
 * Lets getDisplayMedia() return system audio (WASAPI loopback on Windows) without a picker.
 * The capture window drops the video track right away.
 */
export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screen = sources[0];
          if (!screen) throw new Error('no screen source');
          callback({ video: screen, audio: 'loopback' });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

/** Drives the hidden capture window (audio graph, PCM frames, MediaRecorder). */
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

  async stop(): Promise<void> {
    if (this.win.isDestroyed()) return;
    await Promise.race([
      this.win.webContents.executeJavaScript('window.captureControl.stop()', true),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
  }
}
