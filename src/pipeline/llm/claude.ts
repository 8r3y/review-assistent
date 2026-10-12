import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { LlmRoute } from '@shared/assistant';
import { ANALYZE_SYSTEM, ANSWER_SYSTEM, ownerContextBlock } from '../assistant/prompts';
import { AnalysisSchema } from './analysis-schema';
import { LlmError, type AnalysisResult, type LlmBackend } from './provider';
import { retryingFetch } from './retry-fetch';

/** On a policy refusal the API re-runs the request on a fallback model chosen by refusal category. */
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
/** Gateways speak the Messages API but may reject Anthropic-only beta parameters. */
const NO_FALLBACK = {};
const ANALYZE_MAX_TOKENS = 8000;
const ANSWER_MAX_TOKENS = 8000;

/** Claude via the Anthropic SDK. Static instructions go first with cache breakpoints. */
export class ClaudeBackend implements LlmBackend {
  private readonly client: Anthropic;
  private readonly answerSystem: Anthropic.Beta.BetaTextBlockParam[];
  private readonly fallback: typeof FALLBACK | typeof NO_FALLBACK;

  /** @param baseURL custom endpoint (e.g. a new-api gateway), used exactly as given; null → official API. */
  constructor(apiKey: string, ownerContext: string, baseURL: string | null = null) {
    // The SDK retries connection errors too; the wrapper adds quick retries on a fresh socket first.
    this.client = new Anthropic({ apiKey, fetch: retryingFetch(), ...(baseURL ? { baseURL } : {}) });
    this.fallback = baseURL ? NO_FALLBACK : FALLBACK;
    const context = ownerContextBlock(ownerContext);
    this.answerSystem = [
      { type: 'text', text: ANSWER_SYSTEM },
      ...(context ? [{ type: 'text' as const, text: context }] : []),
    ];
    this.answerSystem.at(-1)!.cache_control = { type: 'ephemeral' };
  }

  async analyze(message: string, route: LlmRoute, signal?: AbortSignal): Promise<AnalysisResult> {
    const response = await this.call(() =>
      this.client.beta.messages.parse(
        {
          ...this.fallback,
          model: route.model,
          max_tokens: ANALYZE_MAX_TOKENS,
          output_config: { effort: route.effort, format: betaZodOutputFormat(AnalysisSchema) },
          system: [{ type: 'text', text: ANALYZE_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: message }],
        },
        { signal },
      ),
    );
    checkStop(response.stop_reason);
    if (!response.parsed_output) throw new LlmError('Claude вернул ответ не по схеме');
    return response.parsed_output;
  }

  async streamAnswer(
    message: string,
    route: LlmRoute,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const stream = this.client.beta.messages.stream(
      {
        ...this.fallback,
        model: route.model,
        max_tokens: ANSWER_MAX_TOKENS,
        output_config: { effort: route.effort },
        system: this.answerSystem,
        messages: [{ role: 'user', content: message }],
      },
      { signal },
    );
    stream.on('text', onText);
    const final = await this.call(() => stream.finalMessage());
    checkStop(final.stop_reason);
    return final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  }

  /** Maps SDK errors to user-facing messages; the SDK already retries 429/5xx/connection errors. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new LlmError('Неверный API-ключ Claude');
      if (e instanceof Anthropic.PermissionDeniedError)
        throw new LlmError('Ключ Claude не имеет доступа к модели');
      if (e instanceof Anthropic.NotFoundError)
        throw new LlmError('Модель Claude не найдена — проверьте настройки');
      if (e instanceof Anthropic.RateLimitError) throw new LlmError('Лимит запросов Claude превышен');
      if (e instanceof Anthropic.BadRequestError) throw new LlmError(`Claude отклонил запрос: ${e.message}`);
      if (e instanceof Anthropic.APIConnectionError) throw new LlmError('Нет соединения с Claude');
      if (e instanceof Anthropic.APIError)
        throw new LlmError(`Ошибка Claude ${e.status ?? ''}: ${e.message}`);
      throw e;
    }
  }
}

function checkStop(reason: string | null): void {
  if (reason === 'refusal') throw new LlmError('Claude отказался отвечать на этот запрос');
  if (reason === 'max_tokens') throw new LlmError('Ответ Claude обрезан по лимиту токенов');
}
