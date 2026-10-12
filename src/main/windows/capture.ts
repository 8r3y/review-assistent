import { BrowserWindow } from 'electron';
import { loadPage, preloadPath } from './load';

/** Hidden window that owns Web Audio / MediaRecorder for audio and video capture. */
export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath('capture'),
      sandbox: false,
      contextIsolation: true,
      // Hidden windows are throttled by default, which would starve the audio graph.
      backgroundThrottling: false,
    },
  });
  void loadPage(win, 'capture');
  return win;
}
