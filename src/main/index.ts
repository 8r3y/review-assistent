import { app } from 'electron';
import { AppController } from './controller';
import { registerIpc } from './ipc';
import { OS, applyStartupSwitches } from './platform';

if (!applyStartupSwitches()) {
  // Relaunching through XWayland.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: AppController | null = null;

  app.on('second-instance', () => controller?.showControl());
  // macOS: a click on the Dock icon.
  app.on('activate', () => controller?.showControl());

  void app.whenReady().then(() => {
    if (OS === 'win32') app.setAppUserModelId('ru.nsstms.review-assistent');
    controller = new AppController();
    registerIpc(controller);
    controller.start();
  });

  app.on('before-quit', () => controller?.shutdown());

  // The app lives in the tray; closing windows does not quit it.
  app.on('window-all-closed', () => {});
}
