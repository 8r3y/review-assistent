import type { BrowserWindow } from 'electron';
import { join } from 'node:path';

export type PageName = 'overlay' | 'control' | 'capture';

export function preloadPath(page: PageName): string {
  return join(__dirname, '../preload', `${page}.js`);
}

/** Loads a renderer page from the Vite dev server in development or from disk in production. */
export function loadPage(win: BrowserWindow, page: PageName): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) return win.loadURL(`${devUrl}/${page}/index.html`);
  return win.loadFile(join(__dirname, '../renderer', page, 'index.html'));
}
