import { app, type Rectangle } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AudioSettings, HotkeyBindings, OverlayMode, SttSettings } from '@shared/ipc';
import type { DiarizationConfig, GateConfig, VadConfig } from '@shared/pipeline-protocol';

export interface Settings {
  overlay: { bounds: Rectangle | null; opacity: number; mode: OverlayMode };
  hotkeys: HotkeyBindings;
  audio: AudioSettings;
  stt: SttSettings;
  vad: Omit<VadConfig, 'modelPath'>;
  gate: GateConfig;
  diarization: Omit<DiarizationConfig, 'modelPath'>;
}

export const DEFAULT_HOTKEYS: HotkeyBindings = {
  'session.toggle': 'CommandOrControl+Alt+S',
  'overlay.toggleVisible': 'CommandOrControl+Alt+O',
  'overlay.toggleMode': 'CommandOrControl+Alt+T',
  'overlay.opacityDown': 'CommandOrControl+Alt+[',
  'overlay.opacityUp': 'CommandOrControl+Alt+]',
  'video.toggle': 'CommandOrControl+Alt+V',
  screenshot: 'CommandOrControl+Alt+P',
  marker: 'CommandOrControl+Alt+M',
  'summarize.now': 'CommandOrControl+Alt+Y',
};

const DEFAULTS: Settings = {
  overlay: { bounds: null, opacity: 0.85, mode: 'interactive' },
  hotkeys: DEFAULT_HOTKEYS,
  audio: { micDeviceId: null, recordAudio: true },
  stt: { model: 'nova-3', language: 'ru' },
  vad: { onThreshold: 0.5, offThreshold: 0.35, minSpeechMs: 250, minSilenceMs: 600 },
  // Pre-roll must exceed minSpeechMs: the VAD confirms speech that late.
  gate: { enabled: true, preRollMs: 500, closeAfterSilenceMs: 1500 },
  // Tuned on a recorded call (ERes2Net embeddings); raise it if different voices get merged.
  diarization: { threshold: 0.3, minSegmentMs: 1500 },
};

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
        hotkeys: { ...DEFAULTS.hotkeys, ...stored.hotkeys },
        audio: { ...DEFAULTS.audio, ...stored.audio },
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
