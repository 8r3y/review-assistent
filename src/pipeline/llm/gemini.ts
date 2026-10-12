import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponse,
} from '@google/genai';
import type { Effort, LlmRoute } from '@shared/assistant';
import { ANALYZE_SYSTEM, ANSWER_SYSTEM, ownerContextBlock } from '../assistant/prompts';
import { ANALYSIS_JSON_SCHEMA, AnalysisSchema } from './analysis-schema';
import { LlmError, type AnalysisResult, type LlmBackend } from './provider';
import { isNetworkError, retryingFetch } from './retry-fetch';

const RETRY = { attempts: 3, initialDelay: 0.5, maxDelay: 4 };
const ANALYZE_MAX_TOKENS = 8000;
const ANSWER_MAX_TOKENS = 8000;

/** Gemini 3 controls reasoning depth with thinking levels. */
const THINKING: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const BLOCKED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

/** Gemini via the Google Gen AI SDK (Gemini API key). Gemini caches repeated prefixes implicitly. */
export class GeminiBackend implements LlmBackend {
  private readonly ai: GoogleGenAI;
  private readonly answerSystem: string;

  /** @param baseUrl custom endpoint (an API-compatible gateway), used exactly as given; null → official API. */
  constructor(apiKey: string, ownerContext: string, baseUrl: string | null = null) {
    // The SDK retries 408/429/5xx ("model is experiencing high demand") only when asked, and never
    // retries broken connections: those are retried by the fetch wrapper.
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: { retryOptions: RETRY, fetch: retryingFetch(), ...(baseUrl ? { baseUrl } : {}) },
    });
    const context = ownerContextBlock(ownerContext);
    this.answerSystem = context ? `${ANSWER_SYSTEM}\n\n${context}` : ANSWER_SYSTEM;
  }

  async analyze(message: string, route: LlmRoute, signal?: AbortSignal): Promise<AnalysisResult> {
    const response = await this.call(() =>
      this.ai.models.generateContent({
        model: route.model,
        contents: [{ role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction: ANALYZE_SYSTEM,
          responseMimeType: 'application/json',
          responseJsonSchema: ANALYSIS_JSON_SCHEMA,
          thinkingConfig: { thinkingLevel: THINKING[route.effort] },
          maxOutputTokens: ANALYZE_MAX_TOKENS,
          abortSignal: signal,
        },
      }),
    );
    checkFinish(response);
    const parsed = AnalysisSchema.safeParse(safeJson(response.text ?? ''));
    if (!parsed.success) throw new LlmError('Gemini вернул ответ не по схеме');
    return parsed.data;
  }

  async streamAnswer(
    message: string,
    route: LlmRoute,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.call(async () => {
      const stream = await this.ai.models.generateContentStream({
        model: route.model,
        contents: [{ role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction: this.answerSystem,
          thinkingConfig: { thinkingLevel: THINKING[route.effort] },
          maxOutputTokens: ANSWER_MAX_TOKENS,
          abortSignal: signal,
        },
      });
      let text = '';
      for await (const chunk of stream) {
        checkFinish(chunk);
        const delta = chunk.text;
        if (!delta) continue;
        text += delta;
        onText(delta);
      }
      return text;
    });
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (e instanceof ApiError) {
        if (e.status === 400 && /api key/i.test(e.message)) throw new LlmError('Неверный API-ключ Google AI');
        if (e.status === 401 || e.status === 403)
          throw new LlmError('Ключ Google AI не имеет доступа к модели');
        if (e.status === 404) throw new LlmError('Модель Gemini не найдена — проверьте настройки');
        if (e.status === 429) throw new LlmError('Лимит запросов Google AI превышен');
        throw new LlmError(`Ошибка Google AI ${e.status}: ${e.message}`);
      }
      if (isNetworkError(e)) throw new LlmError(`Нет соединения с Google AI: ${networkCause(e)}`);
      throw e;
    }
  }
}

function checkFinish(response: GenerateContentResponse): void {
  if (response.promptFeedback?.blockReason) throw new LlmError('Gemini заблокировал запрос');
  const reason = response.candidates?.[0]?.finishReason;
  if (reason && BLOCKED.has(reason)) throw new LlmError('Gemini отказался отвечать на этот запрос');
  if (reason === FinishReason.MAX_TOKENS) throw new LlmError('Ответ Gemini обрезан по лимиту токенов');
}

function networkCause(e: TypeError): string {
  const cause = e.cause instanceof Error ? e.cause.message : '';
  if (/TLS|socket disconnected|ECONNRESET/i.test(cause)) return 'соединение оборвано (TLS)';
  if (/ENOTFOUND|EAI_AGAIN/i.test(cause)) return 'адрес не найден (DNS)';
  if (/ETIMEDOUT|timeout/i.test(cause)) return 'таймаут';
  return cause || e.message;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
