import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { LLM_PROVIDERS, type Effort, type LlmProviderId, type LlmRoute } from '@shared/assistant';
import type { InvokeChannel, InvokeMap } from '@shared/ipc';
import type { AppController } from './controller';

type Handlers = {
  [C in InvokeChannel]: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<InvokeMap[C]>
  ) => ReturnType<InvokeMap[C]> | Promise<ReturnType<InvokeMap[C]>>;
};

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const isEffort = (value: unknown): value is Effort =>
  value === 'low' || value === 'medium' || value === 'high';
const isProvider = (value: unknown): value is LlmProviderId => LLM_PROVIDERS.some((p) => p.id === value);

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
    'stt:set-keyterms': (_e, text) => app.setSttKeyterms(asString(text) ?? ''),
    'diarization:set-settings': (_e, patch) => {
      const threshold = Number(patch.threshold);
      if (Number.isFinite(threshold)) {
        app.setDiarizationSettings({ threshold: Math.min(0.9, Math.max(0.05, threshold)) });
      }
    },
    'stt:set-key': (_e, key) => app.setSttKey(asString(key) ?? null),
    'transcript:get': () => app.getTranscript(),
    'turns:get': () => app.getTurns(),
    'questions:get': () => app.getQuestions(),
    'questions:answer': (_e, id) => app.answerQuestion(asString(id) ?? null),
    'questions:dismiss': (_e, id) => app.dismissQuestion(asString(id) ?? null),
    'questions:select': (_e, id) => {
      const questionId = asString(id);
      if (questionId) app.selectQuestion(questionId);
    },
    'questions:step': (_e, delta) => app.stepQuestion(Math.sign(Number(delta)) || 0),
    'assistant:set-route': (_e, task, patch) => {
      if (task !== 'analyze' && task !== 'answer') return;
      const next: Partial<LlmRoute> = {};
      const model = asString(patch.model)?.trim();
      if (isProvider(patch.provider)) next.provider = patch.provider;
      if (model) next.model = model;
      if (isEffort(patch.effort)) next.effort = patch.effort;
      app.setAssistantRoute(task, next);
    },
    'assistant:set-endpoint': (_e, provider, url) =>
      isProvider(provider)
        ? app.setAssistantEndpoint(provider, asString(url) ?? null)
        : 'Неизвестный провайдер',
    'assistant:set-key': (_e, provider, key) => {
      if (isProvider(provider)) app.setAssistantKey(provider, asString(key) ?? null);
    },
    'assistant:set-triggers': (_e, text) => app.setTriggerPhrases(asString(text) ?? ''),
    'assistant:get-context': () => app.getOwnerContext(),
    'assistant:set-context': (_e, text) => app.setOwnerContext(asString(text) ?? ''),
    'video:list-sources': () => app.listVideoSources(),
    'video:set-source': (_e, source) => {
      const id = asString(source?.id);
      app.setVideoSource(id ? { id, name: asString(source?.name) ?? '' } : null);
    },
    'video:pick-source': () => app.pickVideoSource(),
    'video:start': () => app.startVideo(),
    'video:stop': () => app.stopVideo(),
    'screenshot:take': () => app.takeScreenshot(),
    'capture:audio-chunk': (event, chunk) => {
      if (app.isCaptureSender(event.sender) && chunk instanceof ArrayBuffer) app.appendAudioChunk(chunk);
    },
    'capture:video-chunk': (event, chunk) => {
      if (app.isCaptureSender(event.sender) && chunk instanceof ArrayBuffer) app.appendVideoChunk(chunk);
    },
    'capture:video-ended': (event) => {
      if (app.isCaptureSender(event.sender)) void app.onVideoEnded();
    },
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      (handler as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(event, ...args),
    );
  }
}
