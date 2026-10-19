import * as z from 'zod/v4';

/** Shape of an analysis response: turn gists and the marked question's wording (see ANALYZE_SYSTEM). */
export const AnalysisSchema = z.object({
  summaries: z.array(z.object({ turnId: z.string(), summary: z.string() })),
  question: z.string().nullable(),
});

/** The same schema as plain JSON Schema, limited to keywords every provider's structured output accepts. */
export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: { turnId: { type: 'string' }, summary: { type: 'string' } },
        required: ['turnId', 'summary'],
      },
    },
    question: { type: ['string', 'null'] },
  },
  required: ['summaries', 'question'],
} as const;

/** For OpenAI strict structured outputs: every object closed, every property required. */
export const ANALYSIS_STRICT_JSON_SCHEMA = {
  ...ANALYSIS_JSON_SCHEMA,
  additionalProperties: false,
  properties: {
    ...ANALYSIS_JSON_SCHEMA.properties,
    summaries: {
      ...ANALYSIS_JSON_SCHEMA.properties.summaries,
      items: { ...ANALYSIS_JSON_SCHEMA.properties.summaries.items, additionalProperties: false },
    },
  },
} as const;
