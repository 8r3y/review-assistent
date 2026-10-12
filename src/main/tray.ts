import { Menu, Tray, nativeImage, type NativeImage } from 'electron';

export interface TrayActions {
  showControl: () => void;
  toggleSession: () => void;
  toggleOverlay: () => void;
  quit: () => void;
}

export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(createDotIcon());
  tray.setToolTip('Review Assistent');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: actions.showControl },
      { label: 'Старт/стоп сессии', click: actions.toggleSession },
      { label: 'Показать/скрыть оверлей', click: actions.toggleOverlay },
      { type: 'separator' },
      { label: 'Выход', click: actions.quit },
    ]),
  );
  tray.on('click', actions.showControl);
  return tray;
}

/** 16×16 accent-coloured dot, drawn in code so the app ships without icon assets for now. */
function createDotIcon(): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
      const alpha = Math.round(Math.min(1, Math.max(0, r - d + 0.5)) * 255);
      const i = (y * size + x) * 4;
      // BGRA
      buffer[i] = 0xf0;
      buffer[i + 1] = 0x8a;
      buffer[i + 2] = 0x3b;
      buffer[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}
