import { describe, expect, it } from 'vitest';
import type { LlmRoute } from '@shared/assistant';
import { ClaudeBackend } from './claude';

const route: LlmRoute = { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' };

/** Captures the request the backend would send instead of calling the API. */
function capture(backend: ClaudeBackend): { params: () => Record<string, unknown> } {
  let params: Record<string, unknown> = {};
  const client = (backend as unknown as { client: { beta: { messages: unknown }; baseURL: string } }).client;
  client.beta.messages = {
    parse: async (p: Record<string, unknown>) => {
      params = p;
      return { stop_reason: 'end_turn', parsed_output: { summaries: [], question: null } };
    },
  };
  return { params: () => params };
}

const baseURL = (backend: ClaudeBackend): string =>
  (backend as unknown as { client: { baseURL: string } }).client.baseURL;

describe('ClaudeBackend endpoint', () => {
  it('uses the official API with server-side fallbacks by default', async () => {
    const backend = new ClaudeBackend('k', '');
    expect(baseURL(backend)).toBe('https://api.anthropic.com');
    const req = capture(backend);
    await backend.analyze('{}', route);
    expect(req.params()).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
  });

  it('uses a custom endpoint exactly as given and skips Anthropic-only beta parameters', async () => {
    const backend = new ClaudeBackend('k', '', 'https://api.fastypass.com:8444');
    expect(baseURL(backend)).toBe('https://api.fastypass.com:8444');
    const req = capture(backend);
    await backend.analyze('{}', route);
    expect(req.params()).not.toHaveProperty('fallbacks');
    expect(req.params()).not.toHaveProperty('betas');
    expect(req.params()).toMatchObject({ model: 'claude-opus-5-5' });
  });
});
