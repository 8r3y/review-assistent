import type { Turn } from '@shared/assistant';

const SUMMARY_MIN_WORDS = 25;
const SUMMARY_MIN_MS = 10_000;

/** Long turns get a one-line gist on the «Реплики» tab. */
export function needsSummary(turn: Turn): boolean {
  return turn.words >= SUMMARY_MIN_WORDS || turn.tEnd - turn.tStart >= SUMMARY_MIN_MS;
}
