import type { SignalTypeKey } from '../../domain/taxonomy/signal-types';

/**
 * Deterministic helpers every adapter shares.
 *
 * Classification here is rule-based on purpose. It runs on every fetched item,
 * so an LLM at this stage would be the single largest cost in the system for
 * work that keyword rules do adequately. The AI stage runs later, on the far
 * smaller set of things that survived.
 */

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

const TYPE_PATTERNS: Array<{ type: SignalTypeKey; patterns: RegExp[] }> = [
  {
    type: 'spending',
    patterns: [
      /\b(?:we|i|they)\s+(?:pay|paid|spend|spent)\b[^.!?]{0,40}[£$€]\s*\d/i,
      /[£$€]\s*\d[^.!?]{0,40}\b(?:we|i|they)\s+(?:pay|paid|spend|spent)\b/i,
      /\b(?:costs?|paying|subscription|licence|license)\b[^.!?]{0,30}[£$€]\s*\d/i,
      /[£$€]\s*\d+(?:[.,]\d+)?\s*(?:\/|per\s+|a\s+|each\s+)(?:month|mo\b|year|yr\b|seat|user)/i,
    ],
  },
  {
    type: 'demand',
    patterns: [
      /\b(?:is there|are there|looking for|anyone know|recommend)\b.{0,60}\b(?:tool|software|service|app|solution)\b/i,
      /\bwould pay\b/i,
      /\bshut up and take my money\b/i,
    ],
  },
  {
    type: 'workaround',
    patterns: [
      /\b(?:spreadsheet|google sheet|excel|zapier|manually|by hand|copy.?paste)\b/i,
      /\bwe (?:glue|stitch|duct.?tape)\b/i,
      /\b(?:we|i|they)\s+(?:spend|spent)\b[^.!?]{0,30}\b(?:hours?|days?|weeks?)\b/i,
    ],
  },
  {
    type: 'labour',
    patterns: [/\b(?:hiring|we're hiring|job|vacancy|recruit(?:ing)?|contractor)\b/i],
  },
  {
    type: 'competitor_weakness',
    patterns: [
      /\b(?:switched away|migrated off|cancelled our|worst part of|hate(?:s|d)? that)\b/i,
      /\b(?:unusable|clunky|painfully slow)\b/i,
    ],
  },
  {
    type: 'regulation',
    patterns: [/\b(?:regulation|compliance|legislation|directive|mandat(?:e|ory)|gdpr|hipaa|statutory)\b/i],
  },
  {
    type: 'technology_unlock',
    patterns: [/\b(?:now possible|newly possible|api (?:launch|release)|now supports|just shipped)\b/i],
  },
  {
    type: 'cost_collapse',
    patterns: [/\b(?:price (?:drop|cut)|cheaper than|cost (?:fell|dropped)|\d+% cheaper)\b/i],
  },
  {
    type: 'pain',
    patterns: [
      /\b(?:losing|we lose|lost|wastes?|wasting|frustrating|nightmare|struggl(?:e|ing)|broken|keeps? failing)\b/i,
      /\b(?:too slow|too expensive|takes? hours|takes? days|manual(?:ly)?|by hand|miss(?:ing|ed)?|cannot|can't|unable to)\b/i,
      /\b(?:pain point|problem|complaint|annoying|difficult|hard to|fails? to)\b/i,
    ],
  },
  {
    type: 'trend',
    patterns: [
      /^\s*(?:show|launch|tell)\s+hn\s*:/i,
      /\b(?:introducing|announcing|new release|released today|launching today)\b/i,
    ],
  },
];

/**
 * Classifies text by rule.
 *
 * Crucially, unknown text is a weak `trend`, not `pain`. A product launch,
 * article, repository or random discussion is not evidence that somebody has a
 * painful problem merely because no stronger rule matched it.
 */
export function detectSignalType(text: string): SignalTypeKey {
  for (const entry of TYPE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) return entry.type;
  }
  return 'trend';
}

const MONEY =
  /([£$€])\s?(\d{1,3}(?:[,\d]{0,12})(?:\.\d{1,2})?)\s*(?:(?:\/|per\s+|a\s+|each\s+|every\s+)(month|mo\b|year|yr\b|annum|week|wk\b))?/gi;

const CURRENCY_BY_SYMBOL: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR' };

export function detectMoney(
  text: string,
): { monthlyAmount?: number; oneOffAmount?: number; currency?: string; quote?: string } | undefined {
  MONEY.lastIndex = 0;
  const match = MONEY.exec(text);
  if (!match) return undefined;

  const symbol = match[1] ?? '$';
  const amount = Number(match[2]?.replace(/,/g, '') ?? '0');
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const period = (match[3] ?? '').toLowerCase();
  const start = Math.max(0, match.index - 60);
  const quote = text.slice(start, Math.min(text.length, match.index + 80)).trim();

  const currency = CURRENCY_BY_SYMBOL[symbol] ?? 'USD';

  if (period.startsWith('month') || period === 'mo') {
    return { monthlyAmount: amount, currency, quote };
  }
  if (period.startsWith('year') || period === 'yr' || period === 'annum') {
    return { monthlyAmount: Number((amount / 12).toFixed(2)), currency, quote };
  }
  if (period.startsWith('week') || period === 'wk') {
    return { monthlyAmount: Number(((amount * 52) / 12).toFixed(2)), currency, quote };
  }
  return { oneOffAmount: amount, currency, quote };
}

export function detectEntities(text: string): string[] {
  const found = new Set<string>();

  const pattern = /\b([A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,}){0,2})\b/g;
  const stopWords = new Set([
    'The', 'This', 'That', 'They', 'There', 'These', 'Those', 'What', 'When',
    'Where', 'Which', 'While', 'With', 'Would', 'Could', 'Should', 'Their',
    'Because', 'However', 'Anyone', 'Everyone', 'Someone', 'Also', 'Just',
  ]);

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const candidate = match[1]!;
    if (stopWords.has(candidate.split(' ')[0]!)) continue;
    if (candidate.length > 60) continue;
    found.add(candidate);
    if (found.size >= 12) break;
  }

  return [...found];
}
