import type { Turn } from '@shared/assistant';
import { wordsOf } from '../transcript/turns';

const QUESTION_WORDS = new Set([
  'как',
  'что',
  'чем',
  'чего',
  'почему',
  'зачем',
  'когда',
  'где',
  'куда',
  'откуда',
  'какой',
  'какая',
  'какое',
  'какие',
  'каким',
  'какую',
  'каких',
  'сколько',
  'кто',
  'кого',
  'ли',
  'расскажите',
  'расскажи',
  'объясните',
  'объясни',
  'поясните',
  'поясни',
  'приведите',
  'опишите',
  'опиши',
  'сравните',
  'назовите',
  'перечислите',
  'how',
  'what',
  'why',
  'when',
  'where',
  'which',
  'who',
  'explain',
  'describe',
  'tell',
  'could',
  'would',
  'can',
]);

const MIN_WORDS_WITHOUT_CUE = 6;
const SUMMARY_MIN_WORDS = 25;
const SUMMARY_MIN_MS = 10_000;

/** «?», interrogative words or requests («расскажите», «объясните»…). */
export function hasQuestionCue(text: string): boolean {
  return text.includes('?') || wordsOf(text).some((w) => QUESTION_WORDS.has(w));
}

/** Long turns get a one-line gist on the «Реплики» tab. */
export function needsSummary(turn: Turn): boolean {
  return turn.words >= SUMMARY_MIN_WORDS || turn.tEnd - turn.tStart >= SUMMARY_MIN_MS;
}

/** Whether a closed turn is worth an LLM call: it may hold a question or deserves a summary. */
export function worthAnalyzing(turn: Turn): boolean {
  if (needsSummary(turn) || hasQuestionCue(turn.text)) return true;
  return turn.words >= MIN_WORDS_WITHOUT_CUE;
}
