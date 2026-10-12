import { app } from 'electron';
import { AppController } from './controller';
import { registerIpc } from './ipc';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let controller: AppController | null = null;

  app.on('second-instance', () => controller?.showControl());

  void app.whenReady().then(() => {
    app.setAppUserModelId('ru.nsstms.review-assistent');
    controller = new AppController();
    registerIpc(controller);
    controller.start();
  });

  app.on('before-quit', () => controller?.shutdown());

  // The app lives in the tray; closing windows does not quit it.
  app.on('window-all-closed', () => {});
}
