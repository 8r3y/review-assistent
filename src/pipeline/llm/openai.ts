import { DEFAULT_ENDPOINTS, type LlmRoute } from '@shared/assistant';
import { ANALYZE_SYSTEM, ANSWER_SYSTEM, ownerContextBlock } from '../assistant/prompts';
import { ANALYSIS_STRICT_JSON_SCHEMA, AnalysisSchema } from './analysis-schema';
import { LlmError, type AnalysisResult, type AnswerRequest, type LlmBackend } from './provider';
import { isNetworkError, networkCause, retryingFetch } from './retry-fetch';

const ANALYZE_MAX_TOKENS = 8000;
const ANSWER_MAX_TOKENS = 8000;
/** Pauses before retrying 429/5xx (busy or overloaded); the SDK-based backends retry these too. */
const HTTP_RETRY_DELAYS_MS = [1000, 3000];
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const LABEL = 'OpenAI-совместимого API';

type Content =
  string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

interface ChatRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: Content }[];
  max_completion_tokens: number;
  reasoning_effort?: string;
  response_format?: object;
  stream?: boolean;
}

interface ChatChoice {
  message?: { content?: string | null; refusal?: string | null };
  delta?: { content?: string | null; refusal?: string | null };
  finish_reason?: string | null;
}

/**
 * Any OpenAI-compatible service (OpenAI, OpenRouter, vLLM, Ollama, LiteLLM…) through Chat Completions,
 * over plain fetch: no SDK, so gateways that speak only the core of the protocol still work.
 */
export class OpenAiBackend implements LlmBackend {
  private readonly base: string;
  private readonly fetch = retryingFetch();
  private readonly answerSystem: string;
  /** Models that rejected `reasoning_effort` (not reasoning models, or a gateway without it). */
  private readonly noEffort = new Set<string>();

  /** @param baseURL custom endpoint including the version path (…/v1); null → the official API. */
  constructor(
    private readonly apiKey: string,
    ownerContext: string,
    baseURL: string | null = null,
  ) {
    this.base = (baseURL ?? DEFAULT_ENDPOINTS.openai).replace(/\/+$/, '');
    const context = ownerContextBlock(ownerContext);
    this.answerSystem = context ? `${ANSWER_SYSTEM}\n\n${context}` : ANSWER_SYSTEM;
  }

  async analyze(message: string, route: LlmRoute, signal?: AbortSignal): Promise<AnalysisResult> {
    const response = await this.request(
      {
        model: route.model,
        messages: [
          { role: 'system', content: ANALYZE_SYSTEM },
          { role: 'user', content: message },
        ],
        max_completion_tokens: ANALYZE_MAX_TOKENS,
        reasoning_effort: route.effort,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'analysis', strict: true, schema: ANALYSIS_STRICT_JSON_SCHEMA },
        },
      },
      signal,
    );
    const body = (await response.json()) as { choices?: ChatChoice[] };
    const choice = body.choices?.[0];
    checkFinish(choice?.finish_reason, choice?.message?.refusal);
    const parsed = AnalysisSchema.safeParse(safeJson(choice?.message?.content ?? ''));
    if (!parsed.success) throw new LlmError('OpenAI-совместимый API вернул ответ не по схеме');
    return parsed.data;
  }

  async streamAnswer(
    request: AnswerRequest,
    route: LlmRoute,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const content: Content = [
      ...request.images.map((image) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      })),
      { type: 'text' as const, text: request.text },
    ];
    const response = await this.request(
      {
        model: route.model,
        messages: [
          { role: 'system', content: this.answerSystem },
          { role: 'user', content },
        ],
        max_completion_tokens: ANSWER_MAX_TOKENS,
        reasoning_effort: route.effort,
        stream: true,
      },
      signal,
    );
    let text = '';
    try {
      for await (const chunk of sseEvents(response)) {
        const error = (chunk as { error?: { message?: string } }).error;
        if (error) throw new LlmError(`Ошибка ${LABEL}: ${error.message ?? 'неизвестная'}`);
        const choice = (chunk as { choices?: ChatChoice[] }).choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          onText(delta);
        }
        checkFinish(choice?.finish_reason, choice?.delta?.refusal);
      }
    } catch (e) {
      throw mapError(e);
    }
    return text;
  }

  /** POSTs to /chat/completions, retrying 429/5xx and dropping `reasoning_effort` where it is rejected. */
  private async request(body: ChatRequest, signal?: AbortSignal): Promise<Response> {
    if (this.noEffort.has(body.model)) delete body.reasoning_effort;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(`${this.base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        throw mapError(e);
      }
      if (response.ok) return response;
      const message = await errorMessage(response);
      if (response.status === 400 && body.reasoning_effort && /reasoning/i.test(message)) {
        this.noEffort.add(body.model);
        delete body.reasoning_effort;
        continue;
      }
      if (RETRY_STATUSES.has(response.status) && attempt < HTTP_RETRY_DELAYS_MS.length && !signal?.aborted) {
        await new Promise((r) => setTimeout(r, HTTP_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw statusError(response.status, message);
    }
  }
}

/** Parsed `data:` payloads of a server-sent events stream, until `[DONE]`. */
async function* sseEvents(response: Response): AsyncGenerator<unknown> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const parsed = safeJson(data);
      if (parsed) yield parsed;
    }
  }
}

function checkFinish(reason: string | null | undefined, refusal: string | null | undefined): void {
  if (refusal) throw new LlmError('Модель отказалась отвечать на этот запрос');
  if (reason === 'content_filter') throw new LlmError('Запрос заблокирован фильтром содержимого');
  if (reason === 'length') throw new LlmError('Ответ обрезан по лимиту токенов');
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  const body = safeJson(text) as { error?: { message?: string } | string; message?: string } | null;
  const error = body?.error;
  return (typeof error === 'string' ? error : error?.message) ?? body?.message ?? (text.slice(0, 200) || '');
}

function statusError(status: number, message: string): LlmError {
  if (status === 401) return new LlmError(`Неверный API-ключ ${LABEL}`);
  if (status === 403) return new LlmError(`Ключ ${LABEL} не имеет доступа к модели`);
  if (status === 404) return new LlmError('Модель или эндпоинт не найдены — проверьте модель и адрес (…/v1)');
  if (status === 429) return new LlmError(`Лимит запросов ${LABEL} превышен`);
  if (status === 400) return new LlmError(`Запрос отклонён: ${message}`);
  return new LlmError(`Ошибка ${LABEL} ${status}: ${message}`);
}

function mapError(e: unknown): unknown {
  if (isNetworkError(e)) return new LlmError(`Нет соединения с ${LABEL}: ${networkCause(e)}`);
  return e;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
