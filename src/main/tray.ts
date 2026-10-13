import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { AppState, HotkeyAction, OverlayMode } from '@shared/ipc';

export interface TrayActions {
  showControl: () => void;
  toggleSession: () => void;
  answerQuestion: () => void;
  setOverlayVisible: (visible: boolean) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  setOverlayOpacity: (opacity: number) => void;
  setRecordAudio: (record: boolean) => void;
  toggleVideo: () => void;
  openSessionsFolder: () => void;
  openCurrentSessionFolder: () => void;
  quit: () => void;
}

const OPACITY_PRESETS = [0.4, 0.6, 0.8, 1];
const IDLE_COLOR = { r: 0x3b, g: 0x8a, b: 0xf0 };
const RECORDING_COLOR = { r: 0xe5, g: 0x48, b: 0x4d };

/** Tray icon whose menu mirrors the main controls; rebuilt when the relevant state changes. */
export class TrayController {
  private readonly tray: Tray;
  private readonly icons = { idle: createDotIcon(IDLE_COLOR), recording: createDotIcon(RECORDING_COLOR) };
  private lastKey = '';

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.icons.idle);
    this.tray.on('click', actions.showControl);
  }

  update(state: AppState): void {
    const { session, overlay, audio, video, capture, stt, hotkeys } = state;
    const key = JSON.stringify([
      session,
      overlay,
      audio.recordAudio,
      video.status,
      video.sourceName,
      capture.error,
      stt.error,
      hotkeys,
    ]);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const recording = session.status === 'running';
    this.tray.setImage(recording ? this.icons.recording : this.icons.idle);
    this.tray.setToolTip(`Review Assistent — ${SESSION_LABELS[session.status]}`);
    this.tray.setContextMenu(Menu.buildFromTemplate(this.template(state)));
  }

  destroy(): void {
    this.tray.destroy();
  }

  private template({
    session,
    overlay,
    audio,
    video,
    capture,
    stt,
    hotkeys,
  }: AppState): MenuItemConstructorOptions[] {
    const a = this.actions;
    // Shows the configured global shortcut next to the item; the menu does not register it.
    const shortcut = (
      action: HotkeyAction,
    ): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> => {
      const hotkey = hotkeys.find((h) => h.action === action && h.registered);
      return hotkey ? { accelerator: hotkey.accelerator, registerAccelerator: false } : {};
    };
    const busy = session.status === 'starting' || session.status === 'stopping';
    const running = session.status === 'running';
    const problem = capture.error ?? (running ? stt.error : null);
    return [
      { label: 'Открыть окно', click: a.showControl },
      { type: 'separator' },
      {
        label: running ? 'Остановить сессию' : busy ? SESSION_LABELS[session.status] : 'Начать сессию',
        enabled: !busy,
        ...shortcut('session.toggle'),
        click: a.toggleSession,
      },
      ...(problem ? [{ label: `⚠ ${truncate(problem, 60)}`, enabled: false }] : []),
      {
        label: 'Дополнить последний вопрос и ответить',
        enabled: running,
        ...shortcut('question.answer'),
        click: a.answerQuestion,
      },
      {
        label:
          video.status === 'recording'
            ? 'Остановить видеозапись'
            : `Записывать видео: ${truncate(video.sourceName ?? 'основной экран', 40)}`,
        enabled: running && (video.status === 'idle' || video.status === 'recording'),
        ...shortcut('video.toggle'),
        click: a.toggleVideo,
      },
      {
        label: 'Записывать аудио',
        type: 'checkbox',
        checked: audio.recordAudio,
        enabled: session.status === 'idle',
        click: (item) => a.setRecordAudio(item.checked),
      },
      {
        label: 'Открыть папку текущей сессии',
        enabled: session.dir !== null,
        click: a.openCurrentSessionFolder,
      },
      { label: 'Открыть папку сессий', click: a.openSessionsFolder },
      { type: 'separator' },
      {
        label: 'Показывать оверлей',
        type: 'checkbox',
        checked: overlay.visible,
        ...shortcut('overlay.toggleVisible'),
        click: (item) => a.setOverlayVisible(item.checked),
      },
      {
        label: 'Сквозной режим (клики насквозь)',
        type: 'checkbox',
        checked: overlay.mode === 'passthrough',
        ...shortcut('overlay.toggleMode'),
        click: (item) => a.setOverlayMode(item.checked ? 'passthrough' : 'interactive'),
      },
      {
        label: 'Непрозрачность оверлея',
        submenu: OPACITY_PRESETS.map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: 'radio' as const,
          checked: Math.abs(overlay.opacity - value) < 0.05,
          click: () => a.setOverlayOpacity(value),
        })),
      },
      { type: 'separator' },
      { label: 'Выход', click: a.quit },
    ];
  }
}

const SESSION_LABELS: Record<AppState['session']['status'], string> = {
  idle: 'ожидание',
  starting: 'запуск…',
  running: 'идёт запись',
  stopping: 'остановка…',
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 16×16 coloured dot, drawn in code so the app ships without icon assets for now. */
function createDotIcon(color: { r: number; g: number; b: number }): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const alpha = Math.round(Math.min(1, Math.max(0, r - d + 0.5)) * 255);
      const i = (y * size + x) * 4;
      // BGRA
      buffer[i] = color.b;
      buffer[i + 1] = color.g;
      buffer[i + 2] = color.r;
      buffer[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}
