import type { Question, Turn } from '@shared/assistant';
import { formatSessionTime } from '@shared/clock';
import { OWNER, type Segment } from '@shared/transcript';

// Static system prompts: identical bytes on every call so they stay cacheable.

export const ANALYZE_SYSTEM = `You help the user ("owner") during a live call. Speaker "owner" is the user; "S1", "S2"… are other participants. Speech recognition is imperfect: fix obvious recognition errors, never invent content.

Return JSON with "summaries" and "question".

"summaries": for every turn id listed in "summarize", one short line (≤ 15 words, the language of the turn) with its gist. Empty array when "summarize" is absent or empty.

"question": only when "phrases" is present. The owner marked the moment a participant asked them a question; "phrases" are what the participants said since the owner's previous mark, oldest first. Write one self-contained, concise wording of the question the participant just asked, in the language of the conversation:
- the question is usually at the end of "phrases"; earlier phrases may be answers, comments or small talk — use them only if the question starts there, continues there or refers to them;
- never merge unrelated questions: if "phrases" hold several, word the last one (with any part of it asked earlier);
- "previousWording", if present, is how this question was worded before more phrases were added: keep its meaning and extend it with the new phrases;
- "context" holds earlier turns of the conversation for reference only — never take the question from there.
If "phrases" contain no question or request to the owner, word their main point as a question anyway. Without "phrases", "question" is null.`;

export const ANSWER_SYSTEM = `You help the user ("owner") during a live call: you write the answer the owner can say to a question just asked.

Answer briefly: the gist first, then at most 3–5 short points or sentences the owner can glance at while talking. No preamble, no restating the question, no meta comments. Answer in the language of the question. Speak as the owner, in first person where it fits. Use the owner's context when it is relevant; do not make up facts about the owner — if the answer depends on details you do not have, give the general answer and mark what to fill in.`;

const RECENT_TURNS = 40;

type Line = { speaker: string; tStart: number; text: string };

function line(t: Line & { id?: string }): Record<string, unknown> {
  return { ...(t.id ? { id: t.id } : {}), speaker: t.speaker, at: formatSessionTime(t.tStart), text: t.text };
}

/** Background request: gists of long turns. */
export function buildSummaryMessage(turns: Turn[], summarizeTurnIds: string[]): string {
  return JSON.stringify({
    turns: turns.slice(-RECENT_TURNS).map((t) => line(t)),
    summarize: summarizeTurnIds,
  });
}

export interface QuestionInput {
  /** Remote phrases since the previous mark, oldest first. */
  phrases: Segment[];
  /** Earlier turns, for reference. */
  context: Turn[];
  /** Wording before the question was extended. */
  previousWording: string | null;
}

/** On the owner's mark: word the question asked in `phrases`. */
export function buildQuestionMessage(input: QuestionInput): string {
  return JSON.stringify({
    context: input.context.slice(-RECENT_TURNS).map((t) => line(t)),
    phrases: input.phrases.map((s) => line(s)),
    ...(input.previousWording ? { previousWording: input.previousWording } : {}),
  });
}

export interface AnswerInput {
  question: Question;
  /** The question's source phrases. */
  phrases: Segment[];
  turns: Turn[];
}

export function buildAnswerMessage({ question, phrases, turns }: AnswerInput): string {
  const lines = [
    `Question (asked by ${question.askedBy}): ${question.text}`,
    '',
    'Original phrasing:',
    ...phrases.map((s) => `- ${s.text}`),
    '',
    'Recent conversation:',
    ...turns
      .slice(-RECENT_TURNS)
      .map((t) => `[${formatSessionTime(t.tStart)}] ${speakerName(t.speaker)}: ${t.text}`),
  ];
  return lines.join('\n');
}

/** The owner's own notes (about themselves, the project…) as a stable, cacheable system block. */
export function ownerContextBlock(context: string): string | null {
  const trimmed = context.trim();
  return trimmed
    ? `Owner's context (notes the owner wrote about themselves and their work):\n\n${trimmed}`
    : null;
}

function speakerName(speaker: string): string {
  return speaker === OWNER ? 'owner' : speaker;
}
