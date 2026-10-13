// Turns (реплики), questions and answers shared by pipeline, main and renderers. Times are session ms.
import type { ChannelId, SpeakerId } from './transcript';

/** Continuous speech of one speaker built from consecutive segments. */
export interface Turn {
  /** Id of the first segment: stable while the turn grows. */
  id: string;
  channel: ChannelId;
  speaker: SpeakerId;
  text: string;
  tStart: number;
  tEnd: number;
  segmentIds: string[];
  words: number;
  /** Another speaker took over or the speaker paused long enough. */
  closed: boolean;
  /** One-line gist from the LLM, for long turns. */
  summary: string | null;
}

export type QuestionStatus = 'open' | 'answering' | 'answered' | 'dismissed';

export interface Answer {
  text: string;
  done: boolean;
  error: string | null;
}

/**
 * A question the owner marked (hotkey or trigger phrase). It covers the remote phrases between the
 * previous mark and this one; extending it adds the phrases said since.
 */
export interface Question {
  id: string;
  /** Wording the LLM made of the source phrases. */
  text: string;
  askedBy: SpeakerId;
  tStart: number;
  tEnd: number;
  /** Remote transcript segments the question was made of. */
  sourceSegmentIds: string[];
  status: QuestionStatus;
  answer: Answer | null;
  /** Session ms of the last change. */
  updatedAt: number;
}

export type Effort = 'low' | 'medium' | 'high';

export type LlmProviderId = 'anthropic' | 'google';

export const LLM_PROVIDERS: { id: LlmProviderId; label: string }[] = [
  { id: 'anthropic', label: 'Claude (Anthropic)' },
  { id: 'google', label: 'Gemini (Google AI)' },
];

/** Which provider, model and reasoning effort serve one task. */
export interface LlmRoute {
  provider: LlmProviderId;
  model: string;
  effort: Effort;
}

export type LlmTask = 'analyze' | 'answer';

/** Question detection and answers are routed independently (e.g. a fast model for detection). */
export type AssistantSettings = Record<LlmTask, LlmRoute>;

/** Official API endpoints, used when no custom endpoint (gateway/proxy) is set. */
export const DEFAULT_ENDPOINTS: Record<LlmProviderId, string> = {
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
};

/** Model suggested when a task is switched to a provider. */
export const DEFAULT_MODELS: Record<LlmProviderId, Record<LlmTask, string>> = {
  anthropic: { analyze: 'claude-opus-5-5', answer: 'claude-opus-5-5' },
  // 3.5 Flash-Lite answers analysis requests in ~1–2 s (3.1 Flash-Lite took 10–30 s under load);
  // 3.8 Flash is the strongest Flash model.
  google: { analyze: 'gemini-3.5-flash-lite', answer: 'gemini-3.8-flash' },
};

/** Owner phrases that make a question of the last remote turns and answer it right away. */
export const DEFAULT_TRIGGER_PHRASES = [
  'хороший вопрос',
  'отличный вопрос',
  'интересный вопрос',
  'понял ваш вопрос',
  'понял вопрос',
  'дайте подумать',
  'good question',
  'great question',
  'let me think',
];

/** Splits the comma-separated list typed in settings into trimmed phrases, without empty ones and repeats. */
export function parseTriggerPhrases(text: string): string[] {
  const phrases = text
    .split(',')
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
  const seen = new Set<string>();
  return phrases.filter((p) => {
    const key = p.toLowerCase().replace(/ё/g, 'е');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
