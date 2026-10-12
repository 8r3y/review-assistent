import * as z from 'zod/v4';

/** Shape of an analysis response: turn gists and question operations (see ANALYZE_SYSTEM). */
export const AnalysisSchema = z.object({
  summaries: z.array(z.object({ turnId: z.string(), summary: z.string() })),
  ops: z.array(
    z.object({
      op: z.enum(['create', 'update', 'clarify', 'close']),
      questionId: z.string().nullable(),
      text: z.string().nullable(),
      turnIds: z.array(z.string()),
    }),
  ),
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
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'clarify', 'close'] },
          questionId: { type: ['string', 'null'] },
          text: { type: ['string', 'null'] },
          turnIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['op', 'questionId', 'text', 'turnIds'],
      },
    },
  },
  required: ['summaries', 'ops'],
} as const;
