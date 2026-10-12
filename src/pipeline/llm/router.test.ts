import { describe, expect, it } from 'vitest';
import type { AssistantSettings } from '@shared/assistant';
import { createLlm } from './router';

const settings: AssistantSettings = {
  analyze: { provider: 'google', model: 'gemini-3.5-flash-lite', effort: 'low' },
  answer: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
};

const NO_ENDPOINTS = { anthropic: null, google: null };

describe('createLlm', () => {
  it('names the missing key per task', () => {
    const setup = createLlm({
      keys: { anthropic: 'k', google: null },
      settings,
      ownerContext: '',
      endpoints: NO_ENDPOINTS,
    });
    expect(setup.provider).toBeNull();
    expect(setup.unavailable).toBe('Нет API-ключа: Gemini (Google AI) для поиска вопросов');
  });

  it('builds a provider when every routed vendor has a key', () => {
    const setup = createLlm({
      keys: { anthropic: 'k1', google: 'k2' },
      settings,
      ownerContext: 'notes',
      endpoints: NO_ENDPOINTS,
    });
    expect(setup.unavailable).toBeNull();
    expect(setup.provider).not.toBeNull();
  });

  it('needs only the keys of providers actually routed', () => {
    const allGoogle: AssistantSettings = { ...settings, answer: { ...settings.answer, provider: 'google' } };
    const setup = createLlm({
      keys: { anthropic: null, google: 'k' },
      settings: allGoogle,
      ownerContext: '',
      endpoints: NO_ENDPOINTS,
    });
    expect(setup.unavailable).toBeNull();
  });
});
