import { app, safeStorage, systemPreferences } from 'electron';
import type { OsId, PlatformInfo } from '@shared/platform';

export const OS = process.platform as OsId;
export const IS_MAC = OS === 'darwin';
export const IS_LINUX = OS === 'linux';

/** Set to 1 to run as a native Wayland client (the overlay then cannot stay on top or keep its position). */
const NATIVE_WAYLAND_ENV = 'REVIEW_ASSISTENT_WAYLAND';

function waylandSession(): boolean {
  return (
    IS_LINUX && (process.env['XDG_SESSION_TYPE'] === 'wayland' || Boolean(process.env['WAYLAND_DISPLAY']))
  );
}

/**
 * Chromium switches that must be set before `ready`. On Linux in a Wayland session:
 * - screen capture goes through PipeWire (the XDG portal), XWayland cannot see Wayland windows;
 * - global shortcuts go through the GlobalShortcuts portal;
 * - the app relaunches itself through XWayland: a Wayland client cannot keep the overlay on top or move it.
 *   Ozone is picked before this script runs, so the switch only works on the command line.
 * @returns false when the process is relaunching and must not start the app.
 */
export function applyStartupSwitches(): boolean {
  if (!waylandSession()) return true;
  const features = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch(
    'enable-features',
    [features, 'WebRTCPipeWireCapturer', 'GlobalShortcutsPortal'].filter(Boolean).join(','),
  );
  if (app.commandLine.hasSwitch('ozone-platform') || process.env[NATIVE_WAYLAND_ENV] === '1') return true;
  if (!app.isPackaged) {
    // electron-vite would lose the relaunched process; `npm run dev` passes the switch itself.
    console.warn('[platform] Wayland session: start with --ozone-platform=x11 for an always-on-top overlay');
    return true;
  }
  // An AppImage is mounted only while its first process runs: relaunch the image itself.
  const execPath = process.env['APPIMAGE'] ?? process.execPath;
  app.relaunch({ execPath, args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
  return false;
}

/** Call after `ready` (the Linux keyring backend is known only then). */
export function platformInfo(): PlatformInfo {
  return {
    os: OS,
    portalCapture: waylandSession(),
    captureProtection: OS === 'win32' ? 'full' : IS_MAC ? 'partial' : 'none',
    weakSecrets: IS_LINUX && safeStorage.getSelectedStorageBackend() === 'basic_text',
  };
}

/**
 * macOS asks for the microphone once; afterwards it is changed only in System Settings.
 * @returns a user-facing error, or null when access is granted (always on other systems).
 */
export async function ensureMicrophoneAccess(): Promise<string | null> {
  if (!IS_MAC) return null;
  if (await systemPreferences.askForMediaAccess('microphone')) return null;
  return 'Нет доступа к микрофону: Системные настройки → Конфиденциальность и безопасность → Микрофон';
}

/** A hint for an empty screen capture on macOS, where it usually means a missing permission. */
export function screenAccessHint(): string | null {
  if (!IS_MAC || systemPreferences.getMediaAccessStatus('screen') === 'granted') return null;
  return 'Нет доступа к записи экрана: Системные настройки → Конфиденциальность и безопасность → Запись экрана и системного аудио, затем перезапустите приложение';
}
