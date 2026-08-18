import { cosineSimilarity, lexicalEmbedding } from '../dedupe/embedding';

/**
 * Finding the records that could answer a question.
 *
 * Retrieval is deterministic and runs entirely over what this workspace has
 * recorded. That is the whole design of Ask Radar: it is not a chatbot with
 * opinions about the world, it is a way of interrogating your own evidence.
 * A question it has no records for gets a refusal, not an answer.
 */

export type RecordKind =
  | 'opportunity'
  | 'evidence'
  | 'cluster'
  | 'investigation'
  | 'decision'
  | 'experiment'
  | 'execution'
  | 'capability'
  | 'asset';

export interface RetrievableRecord {
  /** Stable, citable identity: "evidence:<uuid>". */
  id: string;
  kind: RecordKind;
  title: string;
  /** The substance, used for both matching and the prompt. */
  text: string;
  /** Where a person can go to check it. */
  href: string | null;
  occurredAt: Date | null;
  /** Whether it may be cited as evidence about the world, as opposed to about us. */
  isEvidence: boolean;
}

export interface RankedRecord extends RetrievableRecord {
  score: number;
  /** Why it matched, for the interface. */
  matchedOn: string[];
}

export interface RetrievalOptions {
  limit?: number;
  /** Below this a record is noise rather than a weak match. */
  minimumScore?: number;
}

const STOP_WORDS = new Set([
  'what', 'which', 'where', 'when', 'have', 'does', 'this', 'that', 'with', 'from', 'about',
  'should', 'would', 'could', 'there', 'their', 'been', 'were', 'they', 'them', 'into', 'than',
  'then', 'here', 'much', 'many', 'most', 'more', 'know', 'tell', 'show', 'give', 'find',
]);

export function retrieve(
  question: string,
  records: readonly RetrievableRecord[],
  options: RetrievalOptions = {},
): RankedRecord[] {
  const limit = options.limit ?? 12;
  const minimumScore = options.minimumScore ?? 0.12;

  const terms = termsOf(question);
  if (terms.length === 0 && question.trim().length === 0) return [];

  const questionVector = lexicalEmbedding(question);

  const ranked = records.map((record) => {
    const haystack = `${record.title}\n${record.text}`.toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term));

    const keywordScore = terms.length > 0 ? matched.length / terms.length : 0;
    const semanticScore = cosineSimilarity(questionVector, lexicalEmbedding(haystack.slice(0, 4_000)));

    /*
     * Keyword overlap is weighted above the vector because the vector is
     * lexical, not semantic: it is character n-grams, so it catches spelling
     * variation rather than meaning. Treating it as understanding would be a
     * claim the embedder cannot support.
     */
    return {
      ...record,
      score: Number((keywordScore * 0.65 + semanticScore * 0.35).toFixed(4)),
      matchedOn: matched,
    };
  });

  return ranked
    .filter((record) => record.score >= minimumScore)
    .sort((a, b) => b.score - a.score || (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0))
    .slice(0, limit);
}

export function termsOf(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 4 && !STOP_WORDS.has(word)),
    ),
  ];
}

export interface GroundingVerdict {
  grounded: boolean;
  reason: string;
  /** What the person could do about it. */
  remedy: string | null;
}

/**
 * Whether there is enough here to answer from at all.
 *
 * Checked before any model is called, so a question about something Radar has
 * never seen costs nothing and gets an honest answer rather than a fluent one.
 */
export function assessGrounding(
  ranked: readonly RankedRecord[],
  options: { minimumRecords?: number; strongScore?: number } = {},
): GroundingVerdict {
  const minimumRecords = options.minimumRecords ?? 1;
  const strongScore = options.strongScore ?? 0.3;

  if (ranked.length < minimumRecords) {
    return {
      grounded: false,
      reason: 'Radar has no records that bear on this question, so there is nothing it could answer from.',
      remedy: 'Record evidence about it, or ask about something already in the workspace.',
    };
  }

  const strongest = ranked[0]?.score ?? 0;
  if (strongest < strongEnough(strongScore, ranked.length)) {
    return {
      grounded: false,
      reason:
        'The records that came closest do not actually address this question, so answering would mean inventing the connection.',
      remedy: 'Try naming the opportunity, customer or technology you mean.',
    };
  }

  return { grounded: true, reason: `${ranked.length} record(s) bear on this.`, remedy: null };
}

/**
 * A single strong match is enough; several weak ones are not. Many weak
 * matches usually mean the question shares common words with everything,
 * which is exactly when a fluent answer would be least justified.
 */
function strongEnough(strongScore: number, count: number): number {
  return count >= 5 ? strongScore : strongScore * 0.8;
}
