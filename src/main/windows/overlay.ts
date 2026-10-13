import { BrowserWindow, screen, type Rectangle } from 'electron';
import { OVERLAY_HANDLE_HEIGHT, OVERLAY_SCROLLBAR_WIDTH, type OverlayMode } from '@shared/ipc';
import { loadPage, preloadPath } from './load';

export const MIN_OPACITY = 0.2;
export const MAX_OPACITY = 1;
const DEFAULT_SIZE = { width: 760, height: 200 };
const HOVER_POLL_MS = 100;

export interface OverlayOptions {
  bounds: Rectangle | null;
  opacity: number;
  mode: OverlayMode;
  onBoundsChanged: (bounds: Rectangle) => void;
}

/**
 * Transparent always-on-top overlay excluded from screen capture (WDA_EXCLUDEFROMCAPTURE on Windows).
 * In passthrough mode clicks go through the window, except over the top handle bar (to drag it) and the
 * scrollbar on the right edge (to scroll a long answer).
 */
export class OverlayWindow {
  readonly win: BrowserWindow;
  private mode: OverlayMode;
  private hoverTimer: NodeJS.Timeout | null = null;
  private ignoringMouse = false;

  constructor(options: OverlayOptions) {
    this.mode = options.mode;
    this.win = new BrowserWindow({
      ...(options.bounds && isOnScreen(options.bounds) ? options.bounds : defaultBounds()),
      minWidth: 320,
      minHeight: 80,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: true,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      webPreferences: { preload: preloadPath('overlay'), sandbox: false, contextIsolation: true },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setContentProtection(true);
    this.win.setOpacity(clampOpacity(options.opacity));

    const saveBounds = (): void => options.onBoundsChanged(this.win.getBounds());
    this.win.on('moved', saveBounds);
    this.win.on('resized', saveBounds);
    this.win.on('closed', () => this.stopHoverPolling());

    this.applyMode();
    void loadPage(this.win, 'overlay');
  }

  setVisible(visible: boolean): void {
    if (visible) this.win.showInactive();
    else this.win.hide();
  }

  setMode(mode: OverlayMode): void {
    this.mode = mode;
    this.applyMode();
  }

  setOpacity(opacity: number): number {
    const value = clampOpacity(opacity);
    this.win.setOpacity(value);
    return value;
  }

  private applyMode(): void {
    if (this.mode === 'interactive') {
      this.stopHoverPolling();
      this.setIgnoreMouse(false);
      return;
    }
    this.setIgnoreMouse(true);
    this.startHoverPolling();
  }

  /** Passthrough: accept mouse input only while the cursor is over the handle bar or the scrollbar. */
  private startHoverPolling(): void {
    if (this.hoverTimer) return;
    this.hoverTimer = setInterval(() => {
      if (this.win.isDestroyed() || !this.win.isVisible()) return;
      const cursor = screen.getCursorScreenPoint();
      const b = this.win.getContentBounds();
      const inside =
        cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height;
      const overHandle = cursor.y < b.y + OVERLAY_HANDLE_HEIGHT;
      const overScrollbar = cursor.x >= b.x + b.width - OVERLAY_SCROLLBAR_WIDTH;
      this.setIgnoreMouse(!(inside && (overHandle || overScrollbar)));
    }, HOVER_POLL_MS);
  }

  private stopHoverPolling(): void {
    if (this.hoverTimer) clearInterval(this.hoverTimer);
    this.hoverTimer = null;
  }

  private setIgnoreMouse(ignore: boolean): void {
    if (this.ignoringMouse === ignore || this.win.isDestroyed()) return;
    this.ignoringMouse = ignore;
    this.win.setIgnoreMouseEvents(ignore, { forward: true });
  }
}

export function clampOpacity(value: number): number {
  return Math.round(Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, value)) * 100) / 100;
}

function defaultBounds(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    ...DEFAULT_SIZE,
    x: Math.round(workArea.x + (workArea.width - DEFAULT_SIZE.width) / 2),
    y: Math.round(workArea.y + workArea.height - DEFAULT_SIZE.height - 40),
  };
}

function isOnScreen(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const visibleW = Math.min(bounds.x + bounds.width, w.x + w.width) - Math.max(bounds.x, w.x);
    const visibleH = Math.min(bounds.y + bounds.height, w.y + w.height) - Math.max(bounds.y, w.y);
    return visibleW >= 100 && visibleH >= OVERLAY_HANDLE_HEIGHT;
  });
}
