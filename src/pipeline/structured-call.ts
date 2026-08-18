import type { z } from 'zod';
import type { AIProvider, CompletionResponse } from '../ports/ai';
import type { AssembledPrompt } from './prompts/assembler';
import type { SchemaDefinition } from './schemas/base';
import { toJsonSchema } from './schemas/base';

/**
 * Getting a validated object out of a model.
 *
 * The contract is strict: either a value that satisfies the schema is returned,
 * or nothing is written at all. There is no partial success, because a
 * half-parsed analysis silently entering the database is worse than an obvious
 * failure -- it becomes evidence nobody can trace.
 */

export type StructuredStatus = 'ok' | 'repaired' | 'invalid_output';

export interface StructuredResult<T> {
  value: T;
  status: Extract<StructuredStatus, 'ok' | 'repaired'>;
  raw: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  attempts: number;
  injectionAttempts: string[];
}

export class StructuredOutputError extends Error {
  readonly issues: string[];
  readonly raw: string;
  readonly attempts: number;

  constructor(message: string, options: { issues: string[]; raw: string; attempts: number }) {
    super(message);
    this.name = 'StructuredOutputError';
    this.issues = options.issues;
    this.raw = options.raw;
    this.attempts = options.attempts;
  }
}

export interface StructuredCallInput<T extends z.ZodTypeAny> {
  provider: AIProvider;
  modelKey: string;
  prompt: AssembledPrompt;
  schema: SchemaDefinition<T>;
  maxOutputTokens: number;
  temperature?: number;
  /** Model used for the single repair attempt, usually the cheapest available. */
  repairModelKey?: string;
}

export async function callStructured<T extends z.ZodTypeAny>(
  input: StructuredCallInput<T>,
): Promise<StructuredResult<z.infer<T>>> {
  const jsonSchema = { name: input.schema.key, schema: toJsonSchema(input.schema.schema) };

  const first = await input.provider.complete({
    modelKey: input.modelKey,
    system: input.prompt.system,
    user: input.prompt.user,
    maxOutputTokens: input.maxOutputTokens,
    temperature: input.temperature ?? 0,
    jsonSchema,
  });

  const parsed = parseAndValidate(input.schema.schema, first.text);
  if (parsed.ok) {
    return {
      value: parsed.value,
      status: 'ok',
      raw: first.text,
      usage: usageOf(first),
      attempts: 1,
      injectionAttempts: readInjections(parsed.value),
    };
  }

  /*
   * Exactly one repair attempt, and it is shown only the schema, the errors and
   * the malformed output.
   *
   * The untrusted source content is deliberately not resent: it is cheaper, and
   * it removes a second opportunity for injected instructions to be read. If the
   * repair also fails, nothing is written.
   */
  const repair = await input.provider.complete({
    modelKey: input.repairModelKey ?? input.modelKey,
    system:
      'You fix malformed JSON. Return only corrected JSON matching the schema. ' +
      'Do not add commentary, and do not invent values that were not present.',
    user: [
      'Schema:',
      JSON.stringify(jsonSchema.schema),
      '',
      'Validation errors:',
      parsed.issues.join('\n'),
      '',
      'Malformed output:',
      first.text.slice(0, 8000),
    ].join('\n'),
    maxOutputTokens: input.maxOutputTokens,
    temperature: 0,
    jsonSchema,
  });

  const repaired = parseAndValidate(input.schema.schema, repair.text);
  if (repaired.ok) {
    return {
      value: repaired.value,
      status: 'repaired',
      raw: repair.text,
      usage: sumUsage(usageOf(first), usageOf(repair)),
      attempts: 2,
      injectionAttempts: readInjections(repaired.value),
    };
  }

  throw new StructuredOutputError(
    `The model did not return output matching ${input.schema.key}@${input.schema.version} after one repair attempt.`,
    { issues: repaired.issues, raw: repair.text, attempts: 2 },
  );
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; issues: string[] };

/**
 * Parses text into a validated object.
 *
 * Models wrap JSON in prose and fences often enough that extracting the first
 * balanced object is worth doing before giving up; it turns a large share of
 * would-be failures into successes without loosening validation at all.
 */
export function parseAndValidate<T extends z.ZodTypeAny>(
  schema: T,
  text: string,
): ParseOutcome<z.infer<T>> {
  const candidates = [text, extractFenced(text), extractBalanced(text)].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0,
  );

  const issues: string[] = [];

  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }

    const result = schema.safeParse(json);
    if (result.success) return { ok: true, value: result.data };

    issues.push(
      ...result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  return {
    ok: false,
    issues: issues.length ? [...new Set(issues)] : ['The response was not valid JSON.'],
  };
}

function extractFenced(text: string): string | null {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1] ?? null;
}

function extractBalanced(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function readInjections(value: unknown): string[] {
  if (value && typeof value === 'object' && 'injectionAttempts' in value) {
    const attempts = (value as { injectionAttempts?: unknown }).injectionAttempts;
    if (Array.isArray(attempts)) return attempts.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function usageOf(response: CompletionResponse) {
  return {
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cachedInputTokens: response.cachedInputTokens,
  };
}

function sumUsage(a: ReturnType<typeof usageOf>, b: ReturnType<typeof usageOf>) {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  };
}
