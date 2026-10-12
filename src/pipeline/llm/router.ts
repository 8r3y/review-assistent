import { LLM_PROVIDERS, type LlmProviderId, type LlmTask } from '@shared/assistant';
import type { AssistantConfig } from '@shared/pipeline-protocol';
import { ClaudeBackend } from './claude';
import { GeminiBackend } from './gemini';
import type { LlmBackend, LlmProvider } from './provider';

const TASK_NAMES: Record<LlmTask, string> = { analyze: 'поиска вопросов', answer: 'ответов' };

export interface LlmSetup {
  provider: LlmProvider | null;
  /** Why the assistant is unavailable (missing key), for the UI. */
  unavailable: string | null;
}

/** Builds the engine-facing provider from per-task routes; one backend per vendor, created lazily. */
export function createLlm(config: AssistantConfig): LlmSetup {
  const { settings, keys, endpoints, ownerContext } = config;
  const missing = (['analyze', 'answer'] as const).filter((task) => !keys[settings[task].provider]);
  if (missing.length > 0) {
    const parts = missing.map((task) => `${providerLabel(settings[task].provider)} для ${TASK_NAMES[task]}`);
    return { provider: null, unavailable: `Нет API-ключа: ${parts.join(', ')}` };
  }

  const backends = new Map<LlmProviderId, LlmBackend>();
  const backend = (id: LlmProviderId): LlmBackend => {
    let b = backends.get(id);
    if (!b) {
      const key = keys[id]!;
      const endpoint = endpoints[id];
      b =
        id === 'anthropic'
          ? new ClaudeBackend(key, ownerContext, endpoint)
          : new GeminiBackend(key, ownerContext, endpoint);
      backends.set(id, b);
    }
    return b;
  };
  const analyze = backend(settings.analyze.provider);
  const answer = backend(settings.answer.provider);
  return {
    provider: {
      analyze: (message, signal) => analyze.analyze(message, settings.analyze, signal),
      streamAnswer: (message, onText, signal) =>
        answer.streamAnswer(message, settings.answer, onText, signal),
    },
    unavailable: null,
  };
}

function providerLabel(id: LlmProviderId): string {
  return LLM_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
