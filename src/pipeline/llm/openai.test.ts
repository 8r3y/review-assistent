import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmRoute } from '@shared/assistant';
import { OpenAiBackend } from './openai';
import { LlmError } from './provider';

const route: LlmRoute = { provider: 'openai', model: 'gpt-5-mini', effort: 'low' };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Stubs global fetch with queued responses and records the requests. */
function stubFetch(...responses: Response[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    return responses.shift() ?? new Response('{}', { status: 500 });
  });
  return calls;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const sse = (...events: unknown[]): Response =>
  new Response(events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''));

afterEach(() => vi.unstubAllGlobals());

describe('OpenAiBackend', () => {
  it('requests strict JSON from the custom endpoint and validates it', async () => {
    const calls = stubFetch(
      json({ choices: [{ message: { content: '{"summaries":[],"question":"Зачем Kafka?"}' } }] }),
    );
    const backend = new OpenAiBackend('sk', '', 'https://gw.example.com/v1/');
    await expect(backend.analyze('{}', route)).resolves.toEqual({ summaries: [], question: 'Зачем Kafka?' });
    expect(calls[0]!.url).toBe('https://gw.example.com/v1/chat/completions');
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk');
    expect(calls[0]!.body).toMatchObject({
      model: 'gpt-5-mini',
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
  });

  it('drops reasoning_effort for a model that rejects it, and remembers that', async () => {
    const ok = (): Response =>
      json({ choices: [{ message: { content: '{"summaries":[],"question":null}' } }] });
    const calls = stubFetch(
      json({ error: { message: 'Unrecognized request argument supplied: reasoning_effort' } }, 400),
      ok(),
      ok(),
    );
    const backend = new OpenAiBackend('sk', '');
    await backend.analyze('{}', route);
    await backend.analyze('{}', route);
    expect(calls.map((c) => 'reasoning_effort' in c.body)).toEqual([true, false, false]);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('streams the answer with images and stops at [DONE]', async () => {
    const calls = stubFetch(
      sse(
        { choices: [{ delta: { content: 'Коротко: ' } }] },
        { choices: [{ delta: { content: 'да.' }, finish_reason: 'stop' }] },
        '[DONE]',
      ),
    );
    const deltas: string[] = [];
    const text = await new OpenAiBackend('sk', 'Я бэкендер').streamAnswer(
      { text: 'Q', images: [{ mediaType: 'image/png', data: 'UE5H' }] },
      route,
      (d) => deltas.push(d),
    );
    expect(text).toBe('Коротко: да.');
    expect(deltas).toEqual(['Коротко: ', 'да.']);
    const messages = calls[0]!.body.messages as { role: string; content: unknown }[];
    expect(messages[0]!.content).toContain('Я бэкендер');
    expect(messages[1]!.content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,UE5H' } },
      { type: 'text', text: 'Q' },
    ]);
    expect(calls[0]!.body.stream).toBe(true);
  });

  it('maps HTTP errors to user-facing messages', async () => {
    stubFetch(json({ error: { message: 'bad key' } }, 401));
    await expect(new OpenAiBackend('sk', '').analyze('{}', route)).rejects.toThrow(LlmError);
    stubFetch(json({ error: { message: 'no such model' } }, 404));
    await expect(new OpenAiBackend('sk', '').analyze('{}', route)).rejects.toThrow(/эндпоинт не найдены/);
  });
});
