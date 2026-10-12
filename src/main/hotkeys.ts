import { globalShortcut } from 'electron';
import type { HotkeyAction, HotkeyBindings, HotkeyStatus } from '@shared/ipc';

export type HotkeyHandlers = Partial<Record<HotkeyAction, () => void>>;

/**
 * Registers global shortcuts. Only actions with a handler are registered, so shortcuts
 * of not-yet-implemented features are not taken away from other apps.
 */
export function registerHotkeys(bindings: HotkeyBindings, handlers: HotkeyHandlers): HotkeyStatus[] {
  globalShortcut.unregisterAll();
  return (Object.entries(bindings) as [HotkeyAction, string][]).map(([action, accelerator]) => {
    const handler = handlers[action];
    if (!handler) return { action, accelerator, available: false, registered: false };
    let registered = false;
    try {
      registered = globalShortcut.register(accelerator, handler);
    } catch {
      // Invalid accelerator string.
    }
    return { action, accelerator, available: true, registered };
  });
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll();
}
