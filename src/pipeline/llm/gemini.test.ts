import { ApiError, FinishReason, type GenerateContentResponse } from '@google/genai';
import { describe, expect, it } from 'vitest';
import type { LlmRoute } from '@shared/assistant';
import { GeminiBackend } from './gemini';
import { LlmError } from './provider';

const route: LlmRoute = { provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'low' };

/** A backend whose SDK calls are replaced by canned responses. */
function backend(models: {
  generateContent?: (params: unknown) => Promise<Partial<GenerateContentResponse>>;
  generateContentStream?: (params: unknown) => Promise<AsyncGenerator<Partial<GenerateContentResponse>>>;
}): { backend: GeminiBackend; calls: unknown[] } {
  const calls: unknown[] = [];
  const b = new GeminiBackend('test-key', 'Я backend-разработчик');
  const wrap =
    <T>(fn?: (p: unknown) => T) =>
    (p: unknown): T => {
      calls.push(p);
      return fn!(p);
    };
  (b as unknown as { ai: { models: unknown } }).ai.models = {
    generateContent: wrap(models.generateContent),
    generateContentStream: wrap(models.generateContentStream),
  };
  return { backend: b, calls };
}

const response = (text: string, finishReason = FinishReason.STOP): Partial<GenerateContentResponse> =>
  ({ text, candidates: [{ finishReason }] }) as Partial<GenerateContentResponse>;

describe('GeminiBackend', () => {
  it('requests JSON with the analysis schema and the route thinking level, and validates the result', async () => {
    const result = {
      summaries: [],
      ops: [{ op: 'create', questionId: null, text: 'Вопрос?', turnIds: ['t1'] }],
    };
    const { backend: b, calls } = backend({ generateContent: async () => response(JSON.stringify(result)) });
    await expect(b.analyze('{}', route)).resolves.toEqual(result);
    const config = (calls[0] as { model: string; config: Record<string, unknown> }).config;
    expect((calls[0] as { model: string }).model).toBe('gemini-3.5-flash-lite');
    expect(config.responseMimeType).toBe('application/json');
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  it('rejects output that does not match the schema', async () => {
    const { backend: b } = backend({ generateContent: async () => response('{"ops": "nope"}') });
    await expect(b.analyze('{}', route)).rejects.toThrow('Gemini вернул ответ не по схеме');
  });

  it('maps blocked and truncated responses to user-facing errors', async () => {
    const blocked = backend({ generateContent: async () => response('', FinishReason.SAFETY) });
    await expect(blocked.backend.analyze('{}', route)).rejects.toBeInstanceOf(LlmError);
    const truncated = backend({ generateContent: async () => response('{', FinishReason.MAX_TOKENS) });
    await expect(truncated.backend.analyze('{}', route)).rejects.toThrow('обрезан');
  });

  it('maps API errors', async () => {
    const { backend: b } = backend({
      generateContent: async () => {
        throw new ApiError({ message: 'models/x is not found', status: 404 });
      },
    });
    await expect(b.analyze('{}', route)).rejects.toThrow('Модель Gemini не найдена');
  });

  it('streams answer deltas with the owner context in the system instruction', async () => {
    async function* chunks(): AsyncGenerator<Partial<GenerateContentResponse>> {
      yield response('Коротко: ');
      yield response('да.');
    }
    const { backend: b, calls } = backend({ generateContentStream: async () => chunks() });
    const deltas: string[] = [];
    await expect(b.streamAnswer('Q', route, (d) => deltas.push(d))).resolves.toBe('Коротко: да.');
    expect(deltas).toEqual(['Коротко: ', 'да.']);
    const system = (calls[0] as { config: { systemInstruction: string } }).config.systemInstruction;
    expect(system).toContain('Я backend-разработчик');
  });
});

describe('GeminiBackend network errors', () => {
  it('reports the connection failure with its cause instead of hiding other errors', async () => {
    const tls = new TypeError('fetch failed', {
      cause: new Error('Client network socket disconnected before secure TLS connection was established'),
    });
    const net = backend({
      generateContent: async () => {
        throw tls;
      },
    });
    await expect(net.backend.analyze('{}', route)).rejects.toThrow(
      'Нет соединения с Google AI: соединение оборвано (TLS)',
    );

    const bug = backend({
      generateContent: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'x')");
      },
    });
    await expect(bug.backend.analyze('{}', route)).rejects.not.toBeInstanceOf(LlmError);
  });
});
