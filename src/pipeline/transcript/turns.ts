import type { Turn } from '@shared/assistant';
import type { Segment } from '@shared/transcript';

export interface TurnParams {
  /** A pause of the same speaker shorter than this keeps the turn going. */
  pauseCloseMs: number;
  /** Other-speaker interjections shorter than this … */
  backchannelMaxMs: number;
  /** … and with at most this many words do not break the current turn. */
  backchannelMaxWords: number;
}

export const DEFAULT_TURN_PARAMS: TurnParams = {
  pauseCloseMs: 4000,
  backchannelMaxMs: 1500,
  backchannelMaxWords: 3,
};

const BACKCHANNEL_WORDS = new Set([
  'угу',
  'ага',
  'да',
  'ну',
  'так',
  'понятно',
  'ясно',
  'хорошо',
  'окей',
  'ок',
  'mhm',
  'uh-huh',
  'yeah',
  'yes',
  'ok',
  'okay',
  'right',
]);

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean);
}

/** «Угу», «да-да», short interjections that should not break someone else's turn. */
export function isBackchannel(segment: Segment, params: TurnParams = DEFAULT_TURN_PARAMS): boolean {
  const words = wordsOf(segment.text);
  if (words.length === 0) return true;
  if (words.every((w) => BACKCHANNEL_WORDS.has(w))) return true;
  return (
    segment.tEnd - segment.tStart < params.backchannelMaxMs && words.length <= params.backchannelMaxWords
  );
}

/**
 * Groups segments into turns. Pure: recomputed after every change (new segment, speaker relabel,
 * retraction), so turns always reflect the current transcript.
 * @param nowMs current session time: the last turn closes once its speaker has paused long enough.
 */
export function buildTurns(
  segments: readonly Segment[],
  nowMs: number,
  params = DEFAULT_TURN_PARAMS,
): Turn[] {
  const sorted = [...segments].sort((a, b) => a.tStart - b.tStart);
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const segment of sorted) {
    if (
      current &&
      segment.speaker === current.speaker &&
      segment.tStart - current.tEnd < params.pauseCloseMs
    ) {
      current.text = `${current.text} ${segment.text}`;
      current.tEnd = Math.max(current.tEnd, segment.tEnd);
      current.segmentIds.push(segment.id);
      current.words += wordsOf(segment.text).length;
      continue;
    }
    if (current && segment.speaker !== current.speaker && isBackchannel(segment, params)) continue;
    if (current) current.closed = true;
    current = {
      id: segment.id,
      channel: segment.channel,
      speaker: segment.speaker,
      text: segment.text,
      tStart: segment.tStart,
      tEnd: segment.tEnd,
      segmentIds: [segment.id],
      words: wordsOf(segment.text).length,
      closed: false,
      summary: null,
    };
    turns.push(current);
  }
  if (current && nowMs - current.tEnd >= params.pauseCloseMs) current.closed = true;
  return turns;
}
