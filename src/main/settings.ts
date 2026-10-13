import { app, type Rectangle } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_MODELS,
  DEFAULT_TRIGGER_PHRASES,
  type AssistantSettings,
  type LlmProviderId,
  type LlmRoute,
  type LlmTask,
} from '@shared/assistant';
import type { AudioSettings, HotkeyBindings, OverlayMode, SttSettings, VideoSettings } from '@shared/ipc';
import type { DiarizationConfig, GateConfig, VadConfig } from '@shared/pipeline-protocol';

export interface Settings {
  overlay: { bounds: Rectangle | null; opacity: number; mode: OverlayMode };
  hotkeys: HotkeyBindings;
  audio: AudioSettings;
  video: VideoSettings;
  stt: SttSettings;
  vad: Omit<VadConfig, 'modelPath'>;
  gate: GateConfig;
  diarization: Omit<DiarizationConfig, 'modelPath'>;
  assistant: AssistantSettings;
  /** Last model used per task and provider, restored when switching back to that provider. */
  assistantModels: Record<LlmTask, Partial<Record<LlmProviderId, string>>>;
  /** Custom API base URL per provider (gateways such as new-api); absent → official endpoint. */
  assistantEndpoints: Partial<Record<LlmProviderId, string>>;
  /** Owner phrases that make a question of the last remote turns and answer it; empty → off. */
  triggerPhrases: string[];
}

export const DEFAULT_HOTKEYS: HotkeyBindings = {
  'session.toggle': 'CommandOrControl+Alt+S',
  'overlay.toggleVisible': 'CommandOrControl+Alt+O',
  'overlay.toggleMode': 'CommandOrControl+Alt+T',
  'overlay.opacityDown': 'CommandOrControl+Alt+[',
  'overlay.opacityUp': 'CommandOrControl+Alt+]',
  'overlay.scrollUp': 'CommandOrControl+Alt+PageUp',
  'overlay.scrollDown': 'CommandOrControl+Alt+PageDown',
  'video.toggle': 'CommandOrControl+Alt+V',
  screenshot: 'CommandOrControl+Alt+P',
  'question.answer': 'CommandOrControl+Alt+A',
  'question.mark': 'CommandOrControl+Alt+Q',
  'question.prev': 'CommandOrControl+Alt+Up',
  'question.next': 'CommandOrControl+Alt+Down',
  'question.dismiss': 'CommandOrControl+Alt+X',
};

const DEFAULTS: Settings = {
  overlay: { bounds: null, opacity: 0.85, mode: 'interactive' },
  hotkeys: DEFAULT_HOTKEYS,
  audio: { micDeviceId: null, recordAudio: true },
  video: { sourceId: null, sourceName: null },
  stt: {
    model: 'nova-3',
    language: 'ru',
    // The Russian model drops English words it was not prompted with («между Kafka и RabbitMQ» → «между и»).
    keyterms: ['Kafka', 'RabbitMQ', 'Kubernetes', 'Docker', 'PostgreSQL', 'Redis', 'gRPC', 'GraphQL'],
  },
  vad: { onThreshold: 0.5, offThreshold: 0.35, minSpeechMs: 250, minSilenceMs: 600 },
  // Pre-roll must exceed minSpeechMs: the VAD confirms speech that late.
  gate: { enabled: true, preRollMs: 500, closeAfterSilenceMs: 1500 },
  // Tuned on a recorded call (ERes2Net embeddings); raise it if different voices get merged.
  diarization: { threshold: 0.3, minSegmentMs: 1500 },
  assistant: {
    // Question detection runs on every relevant turn: keep it fast.
    analyze: { provider: 'anthropic', model: DEFAULT_MODELS.anthropic.analyze, effort: 'low' },
    answer: { provider: 'anthropic', model: DEFAULT_MODELS.anthropic.answer, effort: 'low' },
  },
  assistantModels: { analyze: {}, answer: {} },
  assistantEndpoints: {},
  triggerPhrases: DEFAULT_TRIGGER_PHRASES,
};

/** Settings written before per-task providers stored flat Claude-only fields. */
interface LegacyAssistant {
  analyzeModel?: string;
  answerModel?: string;
  analyzeEffort?: LlmRoute['effort'];
  answerEffort?: LlmRoute['effort'];
}

function loadAssistant(stored: Partial<AssistantSettings> & LegacyAssistant = {}): AssistantSettings {
  const legacy = (task: 'analyze' | 'answer'): Partial<LlmRoute> => {
    const model = task === 'analyze' ? stored.analyzeModel : stored.answerModel;
    const effort = task === 'analyze' ? stored.analyzeEffort : stored.answerEffort;
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  };
  return {
    analyze: { ...DEFAULTS.assistant.analyze, ...legacy('analyze'), ...stored.analyze },
    answer: { ...DEFAULTS.assistant.answer, ...legacy('answer'), ...stored.answer },
  };
}

const SAVE_DELAY_MS = 500;

/** Settings persisted as JSON in userData; writes are debounced and atomic. */
export class SettingsStore {
  private data: Settings;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file = join(app.getPath('userData'), 'settings.json')) {
    this.data = this.load();
  }

  get(): Settings {
    return this.data;
  }

  update(patch: (current: Settings) => Settings): void {
    this.data = patch(this.data);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  private load(): Settings {
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Settings>;
      return {
        overlay: { ...DEFAULTS.overlay, ...stored.overlay },
        // Only known actions: renamed or removed ones from older versions are dropped.
        hotkeys: Object.fromEntries(
          Object.entries(DEFAULTS.hotkeys).map(([action, accelerator]) => [
            action,
            (stored.hotkeys as Partial<HotkeyBindings> | undefined)?.[action as keyof HotkeyBindings] ??
              accelerator,
          ]),
        ) as HotkeyBindings,
        assistant: loadAssistant(stored.assistant),
        assistantEndpoints: { ...stored.assistantEndpoints },
        triggerPhrases: Array.isArray(stored.triggerPhrases)
          ? stored.triggerPhrases.filter((p): p is string => typeof p === 'string')
          : DEFAULTS.triggerPhrases,
        assistantModels: {
          analyze: { ...stored.assistantModels?.analyze },
          answer: { ...stored.assistantModels?.answer },
        },
        audio: { ...DEFAULTS.audio, ...stored.audio },
        video: { ...DEFAULTS.video, ...stored.video },
        stt: { ...DEFAULTS.stt, ...stored.stt },
        vad: { ...DEFAULTS.vad, ...stored.vad },
        gate: { ...DEFAULTS.gate, ...stored.gate },
        diarization: { ...DEFAULTS.diarization, ...stored.diarization },
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }
}
