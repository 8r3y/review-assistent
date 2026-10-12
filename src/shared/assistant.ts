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

export type QuestionStatus = 'open' | 'answering' | 'answered' | 'closed' | 'dismissed';

export interface Clarification {
  turnId: string;
  speaker: SpeakerId;
  text: string;
}

export interface Answer {
  text: string;
  done: boolean;
  error: string | null;
}

export interface Question {
  id: string;
  /** Consolidated wording, rewritten as the question unfolds over several phrases. */
  text: string;
  askedBy: SpeakerId;
  tStart: number;
  tEnd: number;
  sourceTurnIds: string[];
  clarifications: Clarification[];
  status: QuestionStatus;
  answer: Answer | null;
  /** Session ms of the last change. */
  updatedAt: number;
}

export type QuestionOpKind = 'create' | 'update' | 'clarify' | 'close';

/** An operation the analyzer asks to apply to the question list. */
export interface QuestionOp {
  op: QuestionOpKind;
  questionId: string | null;
  text: string | null;
  turnIds: string[];
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
