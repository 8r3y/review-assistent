// Hidden capture window. Main drives it through window.captureControl (executeJavaScript).
import type { CaptureControl, CaptureStartOptions, CaptureStartResult } from '@shared/ipc';
import { AudioCapture } from './audio-capture';

let pcmPort: MessagePort | null = null;
let capture: AudioCapture | null = null;

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'capture:port') return;
  pcmPort?.close();
  pcmPort = event.ports[0] ?? null;
});

const control: CaptureControl = {
  async start(options: CaptureStartOptions): Promise<CaptureStartResult> {
    await control.stop();
    if (!pcmPort) return { error: 'Нет канала к pipeline', recordingStartedAt: null };
    const next = new AudioCapture(pcmPort);
    try {
      const recordingStartedAt = await next.start(options);
      capture = next;
      return { error: null, recordingStartedAt };
    } catch (e) {
      await next.stop();
      return { error: describeError(e), recordingStartedAt: null };
    }
  },
  async stop(): Promise<void> {
    const current = capture;
    capture = null;
    await current?.stop();
  },
};

declare global {
  interface Window {
    captureControl: CaptureControl;
  }
}
window.captureControl = control;

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
        return 'Доступ к микрофону или захвату звука запрещён';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Выбранный микрофон не найден';
      case 'NotReadableError':
        return 'Микрофон занят другим приложением или недоступен';
    }
    return `${e.name}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
