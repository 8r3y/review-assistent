import type { LlmRoute } from '@shared/assistant';

export interface AnalysisResult {
  summaries: { turnId: string; summary: string }[];
  /** Wording of the marked question; null when none was asked for or none was found. */
  question: string | null;
}

/** A screenshot of the owner's screen attached to an answer request. */
export interface AnswerImage {
  mediaType: 'image/png';
  /** Base64. */
  data: string;
}

export interface AnswerRequest {
  text: string;
  /** Oldest first. */
  images: AnswerImage[];
}

/** What the assistant engine needs. Messages are built by assistant/prompts.ts. */
export interface LlmProvider {
  analyze(message: string, signal?: AbortSignal): Promise<AnalysisResult>;
  /** Streams answer text through `onText` (deltas); resolves with the full answer. */
  streamAnswer(
    request: AnswerRequest,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

/** One vendor's API; the route (model, effort) comes with every call. */
export interface LlmBackend {
  analyze(message: string, route: LlmRoute, signal?: AbortSignal): Promise<AnalysisResult>;
  streamAnswer(
    request: AnswerRequest,
    route: LlmRoute,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
}

/** A user-facing failure (bad key, refusal…) as opposed to a bug. */
export class LlmError extends Error {}
