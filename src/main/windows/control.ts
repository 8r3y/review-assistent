import { BrowserWindow } from 'electron';
import { loadPage, preloadPath } from './load';

/** Main UI window. Closing it hides to the tray; the app quits from the tray menu. */
export function createControlWindow(isQuitting: () => boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'Review Assistent',
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath('control'), sandbox: false, contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    win.hide();
  });
  void loadPage(win, 'control');
  return win;
}
