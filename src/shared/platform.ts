// What the OS the app runs on can and cannot do; shared so the UI can explain the limits.
import type { HotkeyAction, HotkeyStatus } from './ipc';

export type OsId = 'win32' | 'darwin' | 'linux';

export interface PlatformInfo {
  os: OsId;
  /**
   * Linux in a Wayland session: screens and windows are picked in the system (portal) dialog,
   * once per session; the app runs through XWayland so the overlay can stay on top.
   */
  portalCapture: boolean;
  /** The overlay is hidden from screen sharing and recordings (not on Linux; partly on macOS). */
  captureProtection: 'full' | 'partial' | 'none';
  /** API keys are stored with a fixed key (Linux without a keyring) instead of the OS keychain. */
  weakSecrets: boolean;
}

const MAC_SYMBOLS: Record<string, string> = {
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
};

const KEY_LABELS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };

/** Electron accelerator → what the user presses: `Ctrl+Alt+↑` or `⌃⌥↑` on macOS. */
export function formatAccelerator(accelerator: string, os: OsId): string {
  const parts = accelerator.split('+').map((part) => KEY_LABELS[part] ?? part);
  if (os === 'darwin') return parts.map((part) => MAC_SYMBOLS[part] ?? part).join('');
  return parts.map((part) => (part === 'CommandOrControl' || part === 'CmdOrCtrl' ? 'Ctrl' : part)).join('+');
}

/** The formatted shortcut of an action, or null when it is not registered. */
export function hotkeyLabel(hotkeys: HotkeyStatus[], action: HotkeyAction, os: OsId): string | null {
  const hotkey = hotkeys.find((h) => h.action === action && h.registered);
  return hotkey ? formatAccelerator(hotkey.accelerator, os) : null;
}
