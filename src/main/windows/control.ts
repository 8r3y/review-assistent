import { BrowserWindow, app } from 'electron';
import { loadPage, preloadPath } from './load';

/** Main UI window. Minimizing or closing it hides it to the tray; the app quits from the tray menu. */
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
  // A hidden window has no taskbar button, so the app lives only in the tray until reopened
  // (showControl restores the minimized state).
  win.on('minimize', () => win.hide());
  win.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    win.hide();
  });
  // macOS: the Dock icon (and Cmd+Tab) only while the window is open, the menu bar icon always.
  win.on('show', () => void app.dock?.show());
  win.on('hide', () => app.dock?.hide());
  void loadPage(win, 'control');
  return win;
}
