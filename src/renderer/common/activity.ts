import type { AudioActivity } from '@shared/transcript';

export const SILENT_ACTIVITY: AudioActivity = {
  mic: { levelDb: -100, speech: false },
  system: { levelDb: -100, speech: false },
};

/** dBFS → 0…1 for meters (−60 dB is empty). */
export function levelFraction(levelDb: number): number {
  return Math.min(1, Math.max(0, (levelDb + 60) / 60));
}
