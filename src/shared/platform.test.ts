import { describe, expect, it } from 'vitest';
import { formatAccelerator, hotkeyLabel } from './platform';

describe('formatAccelerator', () => {
  it('shows Ctrl on Windows and Linux', () => {
    expect(formatAccelerator('CommandOrControl+Alt+S', 'win32')).toBe('Ctrl+Alt+S');
    expect(formatAccelerator('CommandOrControl+Alt+Up', 'linux')).toBe('Ctrl+Alt+↑');
  });

  it('uses modifier symbols on macOS', () => {
    expect(formatAccelerator('Control+Alt+S', 'darwin')).toBe('⌃⌥S');
    expect(formatAccelerator('CommandOrControl+Shift+Down', 'darwin')).toBe('⌘⇧↓');
    expect(formatAccelerator('Control+Alt+PageUp', 'darwin')).toBe('⌃⌥PageUp');
  });
});

describe('hotkeyLabel', () => {
  const hotkeys = [
    { action: 'session.toggle' as const, accelerator: 'Control+Alt+S', available: true, registered: true },
    { action: 'question.mark' as const, accelerator: 'Control+Alt+Q', available: true, registered: false },
  ];

  it('formats a registered shortcut', () => {
    expect(hotkeyLabel(hotkeys, 'session.toggle', 'darwin')).toBe('⌃⌥S');
  });

  it('is null for a shortcut taken by another app or missing', () => {
    expect(hotkeyLabel(hotkeys, 'question.mark', 'darwin')).toBeNull();
    expect(hotkeyLabel(hotkeys, 'screenshot', 'darwin')).toBeNull();
  });
});
