import type { Question, Turn } from '@shared/assistant';
import { formatSessionTime } from '@shared/clock';
import { OWNER } from '@shared/transcript';

// Static system prompts: identical bytes on every call so they stay cacheable.

export const ANALYZE_SYSTEM = `You watch a live call transcript for the user ("owner") and maintain the list of questions that other participants ask the owner.

The transcript arrives as turns: continuous speech of one speaker. Speaker "owner" is the user; "S1", "S2"… are other participants. Speech recognition is imperfect: fix obvious recognition errors when you reformulate, never invent content.

Return JSON with two arrays.

1. "summaries": for every turn listed in "summarize", one short line (≤ 15 words, the language of the turn) with its gist.

2. "ops": changes to the question list, only where the transcript clearly calls for them:
- "create": another participant asks the owner something — a question, a request to explain, describe, compare or give an example, possibly spread over several phrases or turns. "text" is one self-contained, concise wording of the whole question in the language of the conversation; "turnIds" are the turns it comes from. Rhetorical questions, small talk ("how are you?"), questions to someone else and the owner's own questions are not questions to answer.
- "update": a participant continues, expands or rephrases an open question. "questionId" is the question, "text" the improved complete wording, "turnIds" the new turns.
- "clarify": a turn narrows down or explains an open question without being part of it — e.g. the owner asks "you mean X?" and the participant confirms. "text" is a short note of what was clarified, "turnIds" the turns.
- "close": the participant withdraws the question or moves on so it no longer needs an answer.
Prefer "update" over a second "create" when new turns belong to an existing question. Use null for fields that do not apply. Return empty arrays when nothing changes.

If "forceQuestionFrom" is present, the owner explicitly marked those turns as a question: you must return a "create" (or an "update" of the question they belong to) covering them.`;

export const ANSWER_SYSTEM = `You help the user ("owner") during a live call: you write the answer the owner can say to a question just asked.

Answer briefly: the gist first, then at most 3–5 short points or sentences the owner can glance at while talking. No preamble, no restating the question, no meta comments. Answer in the language of the question. Speak as the owner, in first person where it fits. Use the owner's context when it is relevant; do not make up facts about the owner — if the answer depends on details you do not have, give the general answer and mark what to fill in.`;

const RECENT_TURNS = 40;

function turnLine(t: Turn): Record<string, unknown> {
  return {
    id: t.id,
    speaker: t.speaker,
    at: formatSessionTime(t.tStart),
    text: t.text,
    ...(t.closed ? {} : { inProgress: true }),
  };
}

function questionLine(q: Question): Record<string, unknown> {
  return {
    id: q.id,
    text: q.text,
    status: q.status,
    turnIds: q.sourceTurnIds,
    ...(q.clarifications.length > 0 ? { clarifications: q.clarifications.map((c) => c.text) } : {}),
  };
}

export interface AnalyzeInput {
  turns: Turn[];
  questions: Question[];
  /** Turns that triggered this call; the ones needing a summary are listed separately. */
  newTurnIds: string[];
  summarizeTurnIds: string[];
  forceQuestionFrom: string[] | null;
}

export function buildAnalyzeMessage(input: AnalyzeInput): string {
  const payload = {
    turns: input.turns.slice(-RECENT_TURNS).map(turnLine),
    openQuestions: input.questions
      .filter((q) => q.status !== 'dismissed' && q.status !== 'closed')
      .map(questionLine),
    newTurns: input.newTurnIds,
    summarize: input.summarizeTurnIds,
    ...(input.forceQuestionFrom ? { forceQuestionFrom: input.forceQuestionFrom } : {}),
  };
  return JSON.stringify(payload);
}

export interface AnswerInput {
  question: Question;
  turns: Turn[];
}

export function buildAnswerMessage({ question, turns }: AnswerInput): string {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const lines = [
    `Question (asked by ${question.askedBy}): ${question.text}`,
    '',
    'Original phrasing:',
    ...question.sourceTurnIds
      .map((id) => byId.get(id))
      .filter((t): t is Turn => !!t)
      .map((t) => `- ${t.text}`),
  ];
  if (question.clarifications.length > 0) {
    lines.push(
      '',
      'Clarifications:',
      ...question.clarifications.map((c) => `- ${speakerName(c.speaker)}: ${c.text}`),
    );
  }
  lines.push(
    '',
    'Recent conversation:',
    ...turns
      .slice(-RECENT_TURNS)
      .map((t) => `[${formatSessionTime(t.tStart)}] ${speakerName(t.speaker)}: ${t.text}`),
  );
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
