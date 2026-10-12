import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeMap } from '@shared/ipc';
import type { AppController } from './controller';

type Handlers = {
  [C in InvokeChannel]: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<InvokeMap[C]>
  ) => ReturnType<InvokeMap[C]> | Promise<ReturnType<InvokeMap[C]>>;
};

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export function registerIpc(app: AppController): void {
  const handlers: Handlers = {
    'app:get-state': () => app.getState(),
    'session:start': () => app.startSession(),
    'session:stop': () => app.stopSession(),
    'overlay:set-visible': (_e, visible) => app.setOverlayVisible(Boolean(visible)),
    'overlay:set-mode': (_e, mode) =>
      app.setOverlayMode(mode === 'passthrough' ? 'passthrough' : 'interactive'),
    'overlay:set-opacity': (_e, opacity) => {
      if (Number.isFinite(opacity)) app.setOverlayOpacity(opacity);
    },
    'audio:set-settings': (_e, patch) => {
      const next: Parameters<AppController['setAudioSettings']>[0] = {};
      if ('micDeviceId' in patch) next.micDeviceId = asString(patch.micDeviceId) || null;
      if ('recordAudio' in patch) next.recordAudio = Boolean(patch.recordAudio);
      app.setAudioSettings(next);
    },
    'stt:set-settings': (_e, patch) => {
      const next: Parameters<AppController['setSttSettings']>[0] = {};
      const model = asString(patch.model)?.trim();
      const language = asString(patch.language)?.trim();
      if (model) next.model = model;
      if (language) next.language = language;
      app.setSttSettings(next);
    },
    'diarization:set-settings': (_e, patch) => {
      const threshold = Number(patch.threshold);
      if (Number.isFinite(threshold)) {
        app.setDiarizationSettings({ threshold: Math.min(0.9, Math.max(0.05, threshold)) });
      }
    },
    'stt:set-key': (_e, key) => app.setSttKey(asString(key) ?? null),
    'transcript:get': () => app.getTranscript(),
    'capture:audio-chunk': (event, chunk) => {
      if (app.isCaptureSender(event.sender) && chunk instanceof ArrayBuffer) app.appendAudioChunk(chunk);
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      (handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args),
    );
  }
}
