import { SILENCE_DB } from './level';

const WINDOW_FRAMES = 156; // ~5 s of 32 ms frames
const FLOOR_PERCENTILE = 0.1;
const MIN_FLOOR_DB = -70;
/** p = 0.5 at floor + SPEECH_MARGIN_DB, ramping over ±RAMP_DB. */
const SPEECH_MARGIN_DB = 10;
const RAMP_DB = 6;

/** Fallback VAD: speech probability from level above an adaptive noise floor. */
export class EnergyVad {
  private history: number[] = [];

  probability(levelDb: number): number {
    this.history.push(levelDb);
    if (this.history.length > WINDOW_FRAMES) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const floor = Math.max(MIN_FLOOR_DB, sorted[Math.floor(sorted.length * FLOOR_PERCENTILE)] ?? SILENCE_DB);
    const x = (levelDb - (floor + SPEECH_MARGIN_DB)) / RAMP_DB;
    return Math.min(1, Math.max(0, 0.5 + x / 2));
  }
}
