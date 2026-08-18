import { z } from 'zod';
import { baseOutput, defineSchema } from './base';

/**
 * What Ask Radar is allowed to return.
 *
 * Two fields do the work. `answerable` lets the model decline, which it must
 * do rather than assemble something plausible from records that do not
 * actually address the question. And every claim carries its citations, so a
 * sentence that cannot name the record it came from is dropped before anyone
 * reads it.
 */
export const askAnswer = defineSchema(
  'ask.answer',
  'v1',
  baseOutput.extend({
    /** False when the supplied records do not contain the answer. */
    answerable: z.boolean(),
    /** Required when answerable is false: what is missing, specifically. */
    refusalReason: z.string().max(600).nullable().default(null),
    /**
     * One factual statement per entry, each citing the records it rests on.
     * Splitting the answer this way is what makes citation checkable at all:
     * a paragraph with a footnote is not.
     */
    claims: z
      .array(
        z.object({
          statement: z.string().min(1).max(600),
          recordIds: z.array(z.string()).max(12).default([]),
        }),
      )
      .max(12)
      .default([]),
    /** Optional single sentence tying the claims together. No new facts. */
    summary: z.string().max(600).nullable().default(null),
    /** What the person could do next, drawn from what Radar can see. */
    suggestedNextStep: z.string().max(400).nullable().default(null),
  }),
);
